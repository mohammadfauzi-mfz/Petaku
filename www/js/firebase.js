// Backend Firebase lewat REST (tanpa SDK): Authentication (email+sandi) dan Firestore (berkas teks dikompres + dipecah).
import { FB } from './fbconfig.js';
import { dbGet, dbSet, dbDel, bytesToBase64, base64ToBytes } from './util.js';

export const fbOn = () => !!(FB.apiKey && FB.projectId);
const KEY = () => encodeURIComponent(FB.apiKey);
const DOCS = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB.projectId)}/databases/(default)/documents`;
let ses = null;   // { email, refreshToken, idToken, exp, role, name }
export const fbSession = () => ses;

const MSG = {
  EMAIL_NOT_FOUND: 'Email atau password salah', INVALID_PASSWORD: 'Email atau password salah', INVALID_LOGIN_CREDENTIALS: 'Email atau password salah',
  INVALID_EMAIL: 'Format email tidak valid', USER_DISABLED: 'Akun dinonaktifkan oleh admin', TOO_MANY_ATTEMPTS_TRY_LATER: 'Terlalu banyak percobaan, tunggu beberapa menit',
  OPERATION_NOT_ALLOWED: 'Login email/password belum diaktifkan di Firebase Authentication', API_KEY_INVALID: 'API key Firebase salah',
};
const errText = (m) => MSG[String(m || '').split(' ')[0]] || ('Firebase: ' + (m || 'gagal'));

async function post(url, body, form) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }); }
  catch (e) { const er = new Error('Tidak bisa terhubung ke internet'); er.offline = true; throw er; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const er = new Error(errText(j.error && j.error.message)); er.code = j.error && j.error.message; throw er; }
  return j;
}

const saveSes = () => dbSet('fb:session', ses);
export async function fbRestore() { ses = (await dbGet('fb:session')) || null; return ses; }
export async function fbSignOut() { ses = null; await dbDel('fb:session'); }

export async function fbSignIn(email, pw) {
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY()}`, { email: String(email).trim(), password: pw, returnSecureToken: true });
  ses = { email: String(j.email || email).toLowerCase(), refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + (+j.expiresIn || 3600) * 1000, role: 'user', name: '' };
  await fbLoadRole();
  if (!ses.member) { ses = null; await dbDel('fb:session'); throw new Error('Akun ini belum didaftarkan oleh Admin Petaku'); }
  await saveSes(); return ses;
}
// 'ok' | 'revoked' | 'offline'
export async function fbRefresh(force) {
  if (!ses) return 'revoked';
  if (!force && ses.exp - 60000 > Date.now()) return 'ok';
  try {
    const j = await post(`https://securetoken.googleapis.com/v1/token?key=${KEY()}`, { grant_type: 'refresh_token', refresh_token: ses.refreshToken }, true);
    ses.idToken = j.id_token; ses.refreshToken = j.refresh_token || ses.refreshToken; ses.exp = Date.now() + (+j.expires_in || 3600) * 1000;
    await saveSes(); return 'ok';
  } catch (e) { return e.offline ? 'offline' : 'revoked'; }
}
async function token() {
  const r = await fbRefresh();
  if (r === 'revoked') throw new Error('Sesi login berakhir atau akun dinonaktifkan. Masuk lagi.');
  if (r === 'offline' && ses.exp < Date.now()) throw new Error('Tidak ada internet');
  return ses.idToken;
}

async function rawGet(path, retry) {
  let r;
  try { r = await fetch(`${DOCS()}/${path}`, { headers: { Authorization: 'Bearer ' + await token() }, cache: 'no-store' }); }
  catch (e) { if (e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message)) throw e; throw new Error('Tidak bisa terhubung ke internet'); }
  if (r.status === 404) return null;
  if (r.status === 401 && !retry) { await fbRefresh(true); return rawGet(path, true); }
  if (r.status === 403) throw new Error('Akses ditolak oleh aturan Firestore (belum login atau bukan Admin).');
  if (!r.ok) throw new Error('Firestore ' + r.status);
  return r.json();
}
async function rawPut(path, fields) {
  const r = await fetch(`${DOCS()}/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (r.status === 403) throw new Error('Hanya Admin yang boleh mengirim data (ditolak oleh aturan Firestore).');
  if (!r.ok) throw new Error('Firestore ' + r.status);
}

// peran: Admin bila email ada di dokumen config/roles (field "admins": daftar email)
export async function fbLoadRole() {
  const d = await rawGet('config/roles').catch(() => null);
  const vals = d && d.fields && d.fields.admins && d.fields.admins.arrayValue && d.fields.admins.arrayValue.values || [];
  const admins = vals.map((v) => String(v.stringValue || '').toLowerCase());
  ses.role = admins.includes(ses.email) ? 'admin' : 'user';
  ses.member = ses.role === 'admin' || !!(await rawGet('members/' + encodeURIComponent(ses.email)).catch(() => null));
  const nm = d && d.fields && d.fields.names && d.fields.names.mapValue && d.fields.names.mapValue.fields;
  ses.name = (nm && nm[ses.email] && nm[ses.email].stringValue) || '';
  await saveSes();
}

// ---- berkas teks: gzip -> base64 -> potongan <= 600rb karakter ----
const CHUNK = 600000;
const docId = (p) => encodeURIComponent(p.replace(/\//g, '~'));
async function gz(text) {
  if (typeof CompressionStream === 'undefined') return { z: 'raw', b64: bytesToBase64(new TextEncoder().encode(text)) };
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { z: 'gz', b64: bytesToBase64(new Uint8Array(buf)) };
}
async function gunz(b64, z) {
  const bytes = base64ToBytes(b64);
  if (z !== 'gz') return new TextDecoder().decode(bytes);
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new TextDecoder().decode(buf);
}
export async function fbGetText(p) {
  const id = docId(p), c = FB.collection;
  const m = await rawGet(`${c}/${id}`); if (!m || !m.fields) return null;
  const n = +(m.fields.n && m.fields.n.integerValue || 0), z = (m.fields.z && m.fields.z.stringValue) || 'raw';
  let b64 = '';
  for (let i = 0; i < n; i++) {
    const d = await rawGet(`${c}/${id}~c${i}`); if (!d) throw new Error(`Potongan data ${p} (${i + 1}/${n}) hilang di server`);
    b64 += d.fields.d.stringValue;
  }
  return gunz(b64, z);
}
export async function fbPutText(p, text) {
  const id = docId(p), c = FB.collection, { z, b64 } = await gz(text);
  const n = Math.max(1, Math.ceil(b64.length / CHUNK));
  for (let i = 0; i < n; i++) await rawPut(`${c}/${id}~c${i}`, { d: { stringValue: b64.slice(i * CHUNK, (i + 1) * CHUNK) } });
  await rawPut(`${c}/${id}`, { n: { integerValue: String(n) }, z: { stringValue: z }, t: { integerValue: String(Date.now()) } });
}

// ---- kelola pengguna (Admin) ----
const memId = (email) => encodeURIComponent(String(email).trim().toLowerCase());
const MSG2 = { EMAIL_EXISTS: 'EMAIL_EXISTS', WEAK_PASSWORD: 'Password terlalu lemah (minimal 6 karakter)', OPERATION_NOT_ALLOWED: 'Pendaftaran akun dimatikan di Firebase. Aktifkan: Authentication → Settings → User actions → Enable create (sign-up)', MISSING_EMAIL: 'Isi email' };
// buat akun login (bila belum ada) lalu daftarkan sebagai anggota; hasil: 'baru' | 'sudah ada'
export async function fbAddUser(email, password, name) {
  email = String(email).trim().toLowerCase();
  let status = 'baru';
  try { await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY()}`, { email, password, returnSecureToken: false }); }
  catch (e) {
    const c = String(e.code || '').split(' ')[0];
    if (c === 'EMAIL_EXISTS') status = 'sudah ada';
    else if (e.offline) throw e;
    else throw new Error(MSG2[c] || e.message);
  }
  await rawPut('members/' + memId(email), { name: { stringValue: String(name || '') }, addedAt: { integerValue: String(Date.now()) } });
  return status;
}
export async function fbListMembers() {
  const d = await rawGet('members?pageSize=300'); const out = [];
  for (const x of (d && d.documents) || []) out.push({ email: decodeURIComponent(x.name.split('/').pop()), name: (x.fields && x.fields.name && x.fields.name.stringValue) || '' });
  return out.sort((a, b) => a.email.localeCompare(b.email));
}
export async function fbRemoveMember(email) {
  const r = await fetch(`${DOCS()}/members/${memId(email)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + await token() } });
  if (!r.ok && r.status !== 404) throw new Error('Firestore ' + r.status);
}
export async function fbResetPassword(email) {
  await post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${KEY()}`, { requestType: 'PASSWORD_RESET', email: String(email).trim().toLowerCase() });
}

// ---- bersihkan sisa data lama di server (potongan basi + berkas layer yang sudah dihapus) ----
async function rawDel(id) {
  const r = await fetch(`${DOCS()}/${FB.collection}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + await token() } });
  if (!r.ok && r.status !== 404) throw new Error('Firestore ' + r.status);
}
// layerFiles: nama berkas layer yang MASIH dipakai (null = jangan sentuh berkas layer)
export async function fbCleanup(layerFiles) {
  const ids = []; let page = '';
  for (let k = 0; k < 50; k++) {
    const d = await rawGet(`${FB.collection}?pageSize=300${page}`); if (!d) break;
    for (const x of d.documents || []) ids.push(x.name.split('/').pop());
    if (!d.nextPageToken) break; page = '&pageToken=' + encodeURIComponent(d.nextPageToken);
  }
  const mains = new Map(), chunks = [];
  for (const id of ids) { const m = id.match(/^(.*)~c(\d+)$/); if (m) chunks.push([id, m[1], +m[2]]); else mains.set(id, null); }
  for (const [id] of mains) { const d = await rawGet(`${FB.collection}/${encodeURIComponent(id)}`).catch(() => null); mains.set(id, d && d.fields && d.fields.n ? +d.fields.n.integerValue : 0); }
  const keepLayers = layerFiles ? new Set(layerFiles.map((p) => p.replace(/\//g, '~'))) : null;
  let removed = 0;
  for (const id of mains.keys()) {
    if (keepLayers && id.startsWith('layer-') && !keepLayers.has(id)) { for (const [cid, base] of chunks) if (base === id) { await rawDel(cid); removed++; } await rawDel(id); removed++; mains.delete(id); }
  }
  for (const [cid, base, i] of chunks) {
    if (cid.length && !mains.has(base)) { if (base.startsWith('layer-') && !keepLayers) continue; await rawDel(cid).catch(() => {}); removed++; continue; }
    if (mains.has(base) && i >= mains.get(base)) { await rawDel(cid); removed++; }
  }
  return removed;
}
