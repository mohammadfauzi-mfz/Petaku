// Catatan per blok: disimpan di HP (bisa offline) dan disinkron ke Firestore (koleksi "notes"); foto ke Google Drive lewat Apps Script.
import { dbGet, dbSet, dbDel } from './util.js';
import { normKey } from './util.js';
import { getProp, afdKey } from './model.js';
import { fbOn, fbSession, fbDocGet, fbDocSet, fbQueryNotes, fbToken } from './firebase.js';

export const DEF_CATS = [
  { n: 'Infrastruktur', s: ['Titi panen', 'Jalan', 'Parit / drainase', 'Jembatan / gorong-gorong', 'Tanggul'] },
  { n: 'Tanaman', s: ['Hama', 'Penyakit', 'Gulma', 'Pokok mati / abnormal'] },
  { n: 'Panen', s: ['TPH', 'Restan buah', 'Alat panen', 'Rotasi panen'] },
  { n: 'Lahan', s: ['Banjir / tergenang', 'Longsor', 'Klaim / konflik lahan'] },
  { n: 'Lainnya', s: [] },
];
const N = { notes: {}, pend: [], delq: [], last: 0, cats: null, url: '', loaded: false, marks: true };
const subs = new Set();
let byKey = new Map(), keyVer = 0;
export const onNotes = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => { rebuild(); subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };
function rebuild() {
  byKey = new Map(); keyVer++;
  for (const n of Object.values(N.notes)) { if (n.del) continue; if (!byKey.has(n.key)) byKey.set(n.key, []); byKey.get(n.key).push(n); }
  for (const a of byKey.values()) a.sort((x, y) => y.at - x.at);
}
async function save() { try { await dbSet('notes:v1', { notes: N.notes, pend: N.pend, delq: N.delq, last: N.last, cats: N.cats, url: N.url, marks: N.marks }); } catch (e) { console.error(e); } }

export async function initNotes() {
  const d = await dbGet('notes:v1').catch(() => null);
  if (d) Object.assign(N, d);
  N.loaded = true; rebuild();
}
export const notesOn = () => fbOn() && !!fbSession();
export const notesVer = () => keyVer;
export const hasNotes = (key) => byKey.has(key);
export const notesFor = (key) => byKey.get(key) || [];
export const openCount = (key) => notesFor(key).filter((n) => n.status !== 'selesai').length;
export const noteKeyOf = (layer, feat) => {
  const p = (feat && feat.props) || {};
  return normKey(getProp(p, 'Estate')) + '|' + afdKey(getProp(p, 'Afdeling')) + '|' + normKey(getProp(p, layer && layer.keyField ? layer.keyField : 'Blok'));
};
export const catsList = () => (N.cats && N.cats.length ? N.cats : DEF_CATS);
export const scriptUrl = () => N.url || '';
export const pendingIds = () => new Set(N.pend);
export const pendingCount = () => N.pend.length + N.delq.length;
export const marksOn = () => N.marks !== false;
export function setMarks(v) { N.marks = !!v; save(); emit(); }

const me = () => { const s = fbSession() || {}; return { email: s.email || '', name: s.name || (s.email || '').split('@')[0], admin: s.role === 'admin' }; };
export const isMine = (n) => n.by === me().email;
export const canEdit = (n) => { const m = me(); return m.admin || n.by === m.email; };
export const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- penyimpanan Firestore <-> objek ----
const S_ = (v) => ({ stringValue: String(v == null ? '' : v) });
const I_ = (v) => ({ integerValue: String(Math.round(+v || 0)) });
const toFields = (n) => ({
  key: S_(n.key), estate: S_(n.estate), afd: S_(n.afd), blok: S_(n.blok), cat: S_(n.cat), sub: S_(n.sub), text: S_(n.text), status: S_(n.status || 'buka'),
  by: S_(n.by), name: S_(n.name), at: I_(n.at), updatedAt: I_(n.updatedAt), del: I_(n.del ? 1 : 0),
  photos: { arrayValue: { values: (n.photos || []).map(S_) } },
});
function fromDoc(d) {
  const f = d.fields || {}, s = (k) => (f[k] && f[k].stringValue) || '', i = (k) => +(f[k] && f[k].integerValue || 0);
  return { id: decodeURIComponent(d.name.split('/').pop()), key: s('key'), estate: s('estate'), afd: s('afd'), blok: s('blok'), cat: s('cat'), sub: s('sub'), text: s('text'), status: s('status') || 'buka',
    by: s('by'), name: s('name'), at: i('at'), updatedAt: i('updatedAt'), del: i('del') ? 1 : 0,
    photos: ((f.photos && f.photos.arrayValue && f.photos.arrayValue.values) || []).map((v) => v.stringValue).filter(Boolean), pp: [] };
}

// ---- Apps Script (foto di Google Drive) ----
async function call(payload) {
  if (!N.url) throw new Error('Alamat Apps Script belum diisi Admin');
  let r;
  try { r = await fetch(N.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: await fbToken(), ...payload }) }); }
  catch (e) { const er = new Error('Tidak bisa menghubungi server foto'); er.offline = true; throw er; }
  let j; try { j = await r.json(); } catch (e) { throw new Error('Balasan server foto tidak dikenal (cek deploy Apps Script)'); }
  if (!j.ok) throw new Error(j.err || 'Server foto menolak');
  return j;
}
// kompres gambar: sisi terpanjang <= 1280 px, kualitas diturunkan sampai <= maxKB
export async function compressImage(file, maxKB) {
  maxKB = maxKB || 150;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Gambar tidak bisa dibaca')); im.src = url; });
    let side = 1280, best = null;
    for (let t = 0; t < 4; t++) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
        const d = c.toDataURL('image/jpeg', q); best = d;
        if ((d.length - 23) * 0.75 <= maxKB * 1024) return d;
      }
      side = Math.round(side * 0.75);
    }
    return best;
  } finally { URL.revokeObjectURL(url); }
}
const b64of = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);
// foto -> data URL (dari cache HP, atau diunduh lewat Apps Script)
const photoJobs = new Map();
export function photoSrc(ref) {
  if (photoJobs.has(ref)) return photoJobs.get(ref);
  const p = (async () => {
    const c = await dbGet('nph:' + ref).catch(() => null); if (c) return c;
    const j = await call({ a: 'get', id: ref });
    const d = 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data;
    await dbSet('nph:' + ref, d).catch(() => {}); return d;
  })();
  photoJobs.set(ref, p); p.catch(() => photoJobs.delete(ref));
  return p;
}

// ---- operasi catatan ----
export async function saveNote(n, newPhotos) {
  const m = me(); const now = Date.now();
  const cur = N.notes[n.id];
  const note = { ...(cur || {}), ...n };
  if (!cur) { note.at = now; note.by = m.email; note.name = m.name; note.photos = note.photos || []; }
  note.updatedAt = now; note.del = 0; note.pp = note.pp || [];
  for (const d of newPhotos || []) { const tid = 'tmp' + newId(); await dbSet('nph:' + tid, d); note.pp.push(tid); }
  N.notes[note.id] = note;
  if (!N.pend.includes(note.id)) N.pend.push(note.id);
  await save(); emit(); flush().catch(() => {});
  return note;
}
export async function removeNote(n) {
  const note = N.notes[n.id]; if (!note) return;
  for (const f of note.photos || []) if (!N.delq.includes(f)) N.delq.push(f);
  for (const t of note.pp || []) await dbDel('nph:' + t).catch(() => {});
  note.del = 1; note.updatedAt = Date.now(); note.text = ''; note.photos = []; note.pp = [];
  if (!N.pend.includes(note.id)) N.pend.push(note.id);
  await save(); emit(); flush().catch(() => {});
}
export async function removePhoto(n, ref) {
  const note = N.notes[n.id]; if (!note) return;
  if ((note.pp || []).includes(ref)) { note.pp = note.pp.filter((x) => x !== ref); await dbDel('nph:' + ref).catch(() => {}); }
  else if ((note.photos || []).includes(ref)) { note.photos = note.photos.filter((x) => x !== ref); if (!N.delq.includes(ref)) N.delq.push(ref); }
  note.updatedAt = Date.now(); if (!N.pend.includes(note.id)) N.pend.push(note.id);
  await save(); emit(); flush().catch(() => {});
}

let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!notesOn() || !navigator.onLine) return { ok: false };
    let err = null;
    for (const id of [...N.pend]) {
      const n = N.notes[id]; if (!n) { N.pend = N.pend.filter((x) => x !== id); continue; }
      for (const t of [...(n.pp || [])]) {
        try {
          const d = await dbGet('nph:' + t); if (!d) { n.pp = n.pp.filter((x) => x !== t); continue; }
          const j = await call({ a: 'put', name: id + '.jpg', mime: 'image/jpeg', data: b64of(d) });
          n.photos = [...(n.photos || []), j.id]; n.pp = n.pp.filter((x) => x !== t);
          await dbSet('nph:' + j.id, d); await dbDel('nph:' + t);
          n.updatedAt = Date.now(); await save();
        } catch (e) { err = err || e; break; }
      }
      try {
        await fbDocSet('notes/' + encodeURIComponent(id), toFields(n));
        if (!(n.pp || []).length) N.pend = N.pend.filter((x) => x !== id);
      } catch (e) { err = err || e; }
    }
    for (const f of [...N.delq]) {
      try { await call({ a: 'del', id: f }); N.delq = N.delq.filter((x) => x !== f); await dbDel('nph:' + f).catch(() => {}); } catch (e) { err = err || e; break; }
    }
    await save(); emit();
    return { ok: !err, err };
  })().finally(() => { flushing = null; });
  return flushing;
}

// kategori + alamat Apps Script dari Firestore (dibaca semua anggota)
export async function loadConfig() {
  const [c, a] = await Promise.all([fbDocGet('config/categories').catch(() => null), fbDocGet('config/app').catch(() => null)]);
  if (c && c.fields && c.fields.json) { try { const v = JSON.parse(c.fields.json.stringValue); if (Array.isArray(v) && v.length) N.cats = v; } catch (e) { /* abaikan */ } }
  if (a && a.fields && a.fields.url) N.url = a.fields.url.stringValue || '';
  await save(); emit();
}
export async function saveCats(list) { await fbDocSet('config/categories', { json: S_(JSON.stringify(list)) }); N.cats = list; await save(); emit(); }
export async function saveUrl(url) { url = String(url || '').trim(); await fbDocSet('config/app', { url: S_(url) }); N.url = url; await save(); emit(); }

// satu putaran sinkron: kirim antrean, lalu tarik catatan baru
export async function syncNotes() {
  if (!notesOn()) throw new Error('Catatan butuh login Firebase');
  if (!navigator.onLine) throw new Error('Tidak ada internet');
  await loadConfig().catch(() => {});
  const f = await flush();
  const docs = await fbQueryNotes(Math.max(0, (N.last || 0) - 600000));
  let got = 0, mx = N.last || 0;
  for (const d of docs) {
    const n = fromDoc(d); mx = Math.max(mx, n.updatedAt);
    if (N.pend.includes(n.id)) continue;
    const cur = N.notes[n.id];
    if (cur && cur.updatedAt >= n.updatedAt) continue;
    n.pp = cur ? (cur.pp || []) : [];
    N.notes[n.id] = n; got++;
  }
  N.last = mx; await save(); emit();
  return { got, pending: pendingCount(), err: f && f.err };
}
// bersihkan data catatan lokal saat keluar akun
export async function resetNotes() { N.notes = {}; N.pend = []; N.delq = []; N.last = 0; await save(); emit(); }
