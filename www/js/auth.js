// Login pengguna (Admin / User). Daftar akun disimpan di sync/users.json pada repo (password di-hash PBKDF2),
// dan di-cache di HP agar login tetap jalan tanpa internet. Ini penguncian aplikasi, bukan keamanan tingkat server.
import { h, $, toast, select, dbGet, dbSet, dbDel, bytesToBase64, base64ToBytes } from './util.js';
import { openSheet, confirmBox, textInput, row } from './ui-common.js';
import { remoteText, pushText } from './sync.js';
import { fbOn, fbRestore, fbSignIn, fbSignOut, fbRefresh, fbLoadRole, fbSession, fbAddUser, fbListMembers, fbRemoveMember, fbResetPassword } from './firebase.js';

const ITER = 150000;
const te = new TextEncoder();
const UNAME = /^[a-z0-9._-]{3,24}$/;
const MINPW = 6;

let DB = { v: 1, users: [], updatedAt: 0, dirty: false };
let me = null;
export const currentUser = () => me;
export const isAdmin = () => !!me && me.role === 'admin';
export const roleLabel = (r) => (r === 'admin' ? 'Admin' : 'User');

async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256);
  return bytesToBase64(new Uint8Array(bits));
}
export async function makeUser(u, name, role, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { u: u.trim().toLowerCase(), name: (name || '').trim() || u.trim(), role: role === 'admin' ? 'admin' : 'user', iter: ITER, salt: bytesToBase64(salt), hash: await pbkdf2(pw, salt, ITER) };
}
async function checkPw(user, pw) { return (await pbkdf2(pw, base64ToBytes(user.salt), user.iter || ITER)) === user.hash; }
const pub = (u) => ({ u: u.u, name: u.name, role: u.role });
const fp = (u) => String(u.hash || '').slice(0, 12);
const saveDB = () => dbSet('auth:users', DB);
const saveSession = (u) => dbSet('auth:session', { u: u.u, fp: fp(u) });

// ---- sinkron daftar akun ----
// hasil: 'ok' (diperbarui / ada), 'none' (repo belum punya users.json), 'error' (gagal / offline)
async function refreshRemote() {
  try {
    const t = await remoteText('users.json');
    if (t === null) return 'none';
    const j = JSON.parse(t);
    if (!j || !Array.isArray(j.users)) return 'error';
    if (DB.dirty) return 'ok';        // perubahan admin yang belum dikirim jangan ditimpa
    DB = { v: 1, users: j.users, updatedAt: j.updatedAt || 0, dirty: false };
    await saveDB();
    return 'ok';
  } catch (e) { return 'error'; }
}

export async function logout() { await dbDel('auth:session'); if (fbOn()) await fbSignOut(); location.reload(); }

// dipanggil setelah aplikasi berjalan: pastikan akun masih berlaku
export async function backgroundCheck() {
  if (!me) return;
  if (fbOn()) {
    const r = await fbRefresh(true);
    if (r === 'revoked') { toast('Sesi berakhir atau akun dinonaktifkan. Silakan masuk lagi.', 5000); setTimeout(logout, 1800); return; }
    if (r === 'ok') { try { await fbLoadRole(); const s = fbSession(); me = { u: s.email, name: s.name || s.email, role: s.role }; } catch (e) { /* abaikan */ } }
    return;
  }
  if ((await refreshRemote()) !== 'ok') return;
  const u = DB.users.find((x) => x.u === me.u);
  const ses = await dbGet('auth:session');
  if (!u || (ses && ses.fp !== fp(u))) { toast('Akun Anda diubah atau dihapus admin. Silakan masuk lagi.', 5000); setTimeout(logout, 1800); return; }
  me = pub(u);
}

// ---- layar login ----
export async function requireLogin() {
  if (fbOn()) {
    const s = await fbRestore();
    if (s) { me = { u: s.email, name: s.name || s.email, role: s.role || 'user' }; return; }
    await fbLoginScreen(); return;
  }
  DB = (await dbGet('auth:users')) || DB;
  const ses = await dbGet('auth:session');
  if (ses) {
    const u = DB.users.find((x) => x.u === ses.u);
    if (u && fp(u) === ses.fp) { me = pub(u); return; }
  }
  await loginScreen();
}

function fbLoginScreen() {
  return new Promise((resolve) => {
    const wrap = h('div', { id: 'loginWrap' }); document.body.append(wrap);
    let msg = '', busy = false;
    const draw = () => {
      wrap.innerHTML = '';
      const box = h('div', { class: 'loginbox' });
      box.append(h('div', { class: 'logo' }, '🗺'), h('h2', {}, 'Petaku'));
      const em = textInput('', () => {}, { placeholder: 'Email', autocapitalize: 'none', autocomplete: 'username', type: 'email' });
      const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
      const err = h('div', { class: 'loginmsg' }, msg);
      const btn = h('button', { class: 'btn block' }, 'Masuk');
      const go = async () => {
        if (busy) return;
        if (!em.value.trim() || !pw.value) { msg = 'Isi email dan password'; return draw(); }
        busy = true; btn.disabled = true; btn.textContent = 'Memeriksa…';
        try { const s = await fbSignIn(em.value, pw.value); me = { u: s.email, name: s.name || s.email, role: s.role }; wrap.remove(); resolve(); }
        catch (e) { busy = false; msg = e.message || 'Gagal masuk'; draw(); }
      };
      btn.onclick = go; pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      box.append(em, pw, err, btn, h('div', { class: 'mut small', style: { marginTop: '8px' } }, 'Akun dibuat oleh Admin. Login pertama di HP ini butuh internet.'));
      wrap.append(box); setTimeout(() => em.focus(), 50);
    };
    draw();
  });
}

function loginScreen() {
  return new Promise((resolve) => {
    let mode = 'login', msg = '', busy = false, fails = 0, lockUntil = 0;
    const wrap = h('div', { id: 'loginWrap' });
    document.body.append(wrap);
    const finish = async (u) => { me = pub(u); await saveSession(u); wrap.remove(); resolve(); };

    const draw = () => {
      wrap.innerHTML = '';
      const box = h('div', { class: 'loginbox' });
      box.append(h('div', { class: 'logo' }, '🗺'), h('h2', {}, 'Petaku'));
      const err = h('div', { class: 'loginmsg' }, msg);
      if (mode === 'loading') { box.append(h('div', { class: 'mut' }, 'Memuat daftar akun…')); wrap.append(box); return; }
      if (mode === 'offline') {
        box.append(h('div', { class: 'loginmsg' }, 'Daftar akun belum bisa dimuat. Pastikan internet aktif, lalu coba lagi (login pertama di HP ini butuh internet).'));
        box.append(h('button', { class: 'btn block', onclick: start }, 'Coba lagi'));
        wrap.append(box); return;
      }
      const un = textInput('', () => {}, { placeholder: 'Username', autocapitalize: 'none', autocomplete: 'username' });
      const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
      if (mode === 'setup') {
        box.append(h('div', { class: 'mut small' }, 'Belum ada akun di repo ini. Buat akun Admin pertama. Setelah itu kirim daftar akun lewat ⚙ → Kelola akun → Kirim akun, agar pengguna lain bisa masuk.'));
        const nm = textInput('', () => {}, { placeholder: 'Nama lengkap' });
        const pw2 = h('input', { type: 'password', placeholder: 'Ulangi password', autocomplete: 'new-password' });
        box.append(nm, un, pw, pw2, err);
        box.append(h('button', { class: 'btn block', onclick: async () => {
          if (busy) return;
          const u = un.value.trim().toLowerCase();
          if (!UNAME.test(u)) { msg = 'Username 3–24 karakter: huruf kecil, angka, titik, - atau _'; return draw(); }
          if (pw.value.length < MINPW) { msg = `Password minimal ${MINPW} karakter`; return draw(); }
          if (pw.value !== pw2.value) { msg = 'Ulangi password tidak sama'; return draw(); }
          busy = true;
          const user = await makeUser(u, nm.value, 'admin', pw.value);
          DB = { v: 1, users: [user], updatedAt: Date.now(), dirty: true };
          await saveDB(); busy = false;
          await finish(user);
          toast('Akun Admin dibuat. Kirim akun lewat ⚙ → Kelola akun.', 6000);
        } }, 'Buat akun Admin'));
      } else {
        box.append(un, pw, err);
        const go = async () => {
          if (busy) return;
          const now = Date.now();
          if (now < lockUntil) { msg = `Terlalu banyak percobaan. Tunggu ${Math.ceil((lockUntil - now) / 1000)} detik.`; return draw(); }
          const name = un.value.trim().toLowerCase();
          if (!name || !pw.value) { msg = 'Isi username dan password'; return draw(); }
          busy = true; btn.disabled = true; btn.textContent = 'Memeriksa…';
          let u = DB.users.find((x) => x.u === name);
          let ok = !!u && await checkPw(u, pw.value);
          if (!ok) {   // mungkin akun baru / password diganti: ambil daftar terbaru lalu coba lagi
            if ((await refreshRemote()) === 'ok') { u = DB.users.find((x) => x.u === name); ok = !!u && await checkPw(u, pw.value); }
          }
          busy = false;
          if (ok) return finish(u);
          fails++; if (fails >= 3) lockUntil = Date.now() + Math.min(60, 5 * (fails - 2)) * 1000;
          msg = 'Username atau password salah'; draw();
        };
        const btn = h('button', { class: 'btn block', onclick: go }, 'Masuk');
        pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        box.append(btn);
      }
      wrap.append(box);
      setTimeout(() => un.focus(), 50);
    };

    const start = async () => {
      if (DB.users.length) { mode = 'login'; msg = ''; return draw(); }
      mode = 'loading'; draw();
      const r = await refreshRemote();
      if (r === 'ok' && DB.users.length) mode = 'login';
      else if (r === 'none') mode = 'setup';
      else mode = 'offline';
      msg = ''; draw();
    };
    start();
  });
}

// ---- kelola akun (Admin) ----
async function touchDB() { DB.updatedAt = Date.now(); DB.dirty = true; await saveDB(); }

export function openAccounts() {
  if (!isAdmin()) { toast('Hanya Admin'); return; }
  if (fbOn()) return openFbAccounts();
  const body = h('div', {});
  let close;
  const adminCount = () => DB.users.filter((x) => x.role === 'admin').length;

  const editor = (u) => {
    const isNew = !u;
    let f = { u: u ? u.u : '', name: u ? u.name : '', role: u ? u.role : 'user', pw: '' };
    const b = h('div', {});
    const un = textInput(f.u, (v) => { f.u = v; }, { placeholder: 'username (huruf kecil/angka)', autocapitalize: 'none' });
    if (!isNew) un.disabled = true;
    const pw = h('input', { type: 'password', placeholder: isNew ? 'Password' : 'Password baru (kosongkan bila tidak diganti)', autocomplete: 'new-password' });
    b.append(row('Username', un), row('Nama', textInput(f.name, (v) => { f.name = v; })), row('Role', select([['user', 'User'], ['admin', 'Admin']], f.role, (v) => { f.role = v; })), row('Password', pw));
    b.append(h('div', { class: 'mut small' }, `Password minimal ${MINPW} karakter; sebaiknya 8+ karena daftar akun tersimpan di repo.`));
    const save = async () => {
      f.u = f.u.trim().toLowerCase();
      if (isNew) {
        if (!UNAME.test(f.u)) return toast('Username 3–24 karakter: huruf kecil, angka, titik, - atau _', 4000);
        if (DB.users.some((x) => x.u === f.u)) return toast('Username sudah dipakai');
        if (pw.value.length < MINPW) return toast(`Password minimal ${MINPW} karakter`);
        DB.users.push(await makeUser(f.u, f.name, f.role, pw.value));
      } else {
        if (f.role !== 'admin' && u.role === 'admin' && adminCount() < 2) return toast('Harus ada minimal satu Admin');
        if (pw.value && pw.value.length < MINPW) return toast(`Password minimal ${MINPW} karakter`);
        const n = pw.value ? await makeUser(u.u, f.name, f.role, pw.value) : { ...u, name: f.name.trim() || u.u, role: f.role };
        DB.users[DB.users.findIndex((x) => x.u === u.u)] = n;
        if (me && me.u === u.u) { me = pub(n); await saveSession(n); }
      }
      await touchDB(); c2(); draw();
    };
    b.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: save }, 'Simpan')));
    const c2 = openSheet(isNew ? 'Tambah akun' : 'Ubah akun · ' + u.u, b, { center: true });
  };

  const draw = () => {
    body.innerHTML = '';
    body.append(h('div', { class: 'mut small' }, `${DB.users.length} akun. Perubahan baru berlaku untuk pengguna lain setelah dikirim ke GitHub.`));
    for (const u of DB.users) {
      body.append(h('div', { class: 'themeItem' },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'nm' }, u.name || u.u), h('div', { class: 'mut small' }, `${u.u} · ${roleLabel(u.role)}` + (me && me.u === u.u ? ' · (Anda)' : ''))),
        h('button', { class: 'btn sec sm', onclick: () => editor(u) }, 'Ubah'),
        h('button', { class: 'btn red sm', onclick: async () => {
          if (me && me.u === u.u) return toast('Tidak bisa menghapus akun sendiri');
          if (u.role === 'admin' && adminCount() < 2) return toast('Harus ada minimal satu Admin');
          if (!await confirmBox(`Hapus akun "${u.u}"?`, 'Hapus')) return;
          DB.users = DB.users.filter((x) => x.u !== u.u); await touchDB(); draw();
        } }, 'Hapus')));
    }
    const st = h('div', { class: 'mut small', style: { minHeight: '1.4em', margin: '6px 0' } }, DB.dirty ? '● Ada perubahan akun yang belum dikirim ke GitHub.' : '✔ Daftar akun sama dengan di GitHub.');
    const send = h('button', { class: 'btn' + (DB.dirty ? '' : ' sec') }, 'Kirim akun ke GitHub');
    send.onclick = async () => {
      send.disabled = true; st.textContent = 'Mengirim…';
      try {
        await pushText('users.json', JSON.stringify({ v: 1, updatedAt: DB.updatedAt, users: DB.users }), 'Petaku: akun');
        DB.dirty = false; await saveDB(); toast('Akun terkirim'); draw();
      } catch (e) { st.textContent = '⚠ ' + (e.message || e); st.style.color = 'var(--warn)'; send.disabled = false; }
    };
    body.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => editor(null) }, '+ Tambah akun'), send), st);
  };
  draw();
  close = openSheet('Kelola akun', body, {});
}

// kartu "Akun" untuk Pengaturan
export function accountCard() {
  const c = h('div', { class: 'card' }, h('h3', {}, 'Akun'));
  if (!me) return c;
  c.append(h('div', {}, h('b', {}, me.name || me.u), ` · ${roleLabel(me.role)} (${me.u})`));
  const bt = h('div', { class: 'btns' });
  if (isAdmin()) bt.append(h('button', { class: 'btn sec', onclick: openAccounts }, 'Kelola akun'));
  bt.append(h('button', { class: 'btn red', onclick: async () => { if (await confirmBox('Keluar dari akun ini?', 'Keluar')) logout(); } }, 'Keluar'));
  c.append(bt);
  return c;
}

async function openFbAccounts() {
  const body = h('div', {});
  const list = h('div', {});
  let close;
  const draw = async () => {
    list.innerHTML = '<div class="mut small">Memuat…</div>';
    let ms = [];
    try { ms = await fbListMembers(); } catch (e) { list.innerHTML = ''; list.append(h('div', { class: 'hint' }, e.message)); return; }
    list.innerHTML = '';
    if (!ms.length) list.append(h('div', { class: 'mut small' }, 'Belum ada pengguna terdaftar (Admin tidak perlu didaftarkan).'));
    for (const m of ms) list.append(h('div', { class: 'cellrow', style: { alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
      h('div', { style: { flex: 1, minWidth: '160px', wordBreak: 'break-all' } }, h('b', {}, m.name || m.email), m.name ? h('div', { class: 'mut small' }, m.email) : null),
      h('button', { class: 'btn sec sm', onclick: async () => { try { await fbResetPassword(m.email); toast('Email reset password dikirim ke ' + m.email, 3500); } catch (e) { toast(e.message, 4000); } } }, 'Reset password'),
      h('button', { class: 'btn sec sm danger', onclick: async () => { if (!await confirmBox(`Cabut akses ${m.email}? Akun login tetap ada di Firebase, tapi tidak bisa membaca data lagi.`, 'Cabut')) return; try { await fbRemoveMember(m.email); toast('Akses dicabut'); draw(); } catch (e) { toast(e.message, 4000); } } }, 'Cabut')));
  };
  const em = textInput('', () => {}, { placeholder: 'Email pengguna', autocapitalize: 'none', type: 'email' });
  const nm = textInput('', () => {}, { placeholder: 'Nama (opsional)' });
  const pw = h('input', { type: 'password', placeholder: 'Password awal (min. 6 karakter)', autocomplete: 'new-password' });
  const add = h('button', { class: 'btn', onclick: async () => {
    const e = em.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return toast('Format email tidak valid');
    if (pw.value.length < 6) return toast('Password minimal 6 karakter');
    add.disabled = true;
    try { const st = await fbAddUser(e, pw.value, nm.value); toast(st === 'baru' ? 'Akun dibuat dan didaftarkan' : 'Akun sudah ada, hanya didaftarkan (password lama tetap)', 3500); em.value = ''; nm.value = ''; pw.value = ''; draw(); }
    catch (er) { toast(er.message, 5000); } finally { add.disabled = false; }
  } }, '+ Tambah pengguna');
  body.append(h('div', { class: 'mut small' }, 'Pengguna biasa hanya bisa membaca data. Berikan email dan password awal kepada yang bersangkutan.'), em, nm, pw, add, h('h4', {}, 'Pengguna terdaftar'), list);
  close = openSheet('Kelola akun', body);
  draw();
}
