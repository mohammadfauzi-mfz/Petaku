// Daftar PT dan PT aktif. Tiap PT punya Firebase sendiri dan database lokal sendiri di HP.
// Daftar = bawaan APK (fbconfig.js) + daftar online (pt-list.json di repo GitHub, di-cache di HP).
import { PTS as BUNDLED } from './fbconfig.js';
const KEY = 'petaku-pt', CK = 'petaku-ptlist';
export const PT_LIST_URL = 'https://raw.githubusercontent.com/mohammadfauzi-mfz/Petaku/main/pt-list.json';

const okId = (s) => /^[A-Za-z0-9]{2,8}$/.test(String(s || ''));
const clean = (x) => x && okId(x.id) ? { id: String(x.id).toUpperCase(), nama: String(x.nama || x.id).slice(0, 60), apiKey: String(x.apiKey || '').trim(), projectId: String(x.projectId || '').trim() } : null;
function readCache() { try { const a = JSON.parse(localStorage.getItem(CK) || '[]'); return Array.isArray(a) ? a.map(clean).filter(Boolean) : []; } catch (e) { return []; } }
// bawaan dulu (urutan tetap; PT pertama = data lama), lalu PT dari daftar online; id sama -> nilai online menimpa
function merge(online) {
  const out = BUNDLED.map((b) => ({ ...b }));
  for (const o of online) {
    const i = out.findIndex((p) => p.id === o.id);
    if (i >= 0) { const p = out[i]; out[i] = { ...p, nama: o.nama || p.nama, apiKey: o.apiKey || p.apiKey, projectId: o.projectId || p.projectId }; }
    else out.push(o);
  }
  return out;
}
let LIST = merge(readCache());

export const ptList = () => LIST;
export const ptReady = (p) => !!(p && p.apiKey && p.projectId);
// aplikasi memakai mode Firebase bila ada minimal satu PT yang sudah diisi
export const ptMode = () => LIST.some(ptReady);
export function activePT() {
  let id = '';
  try { id = localStorage.getItem(KEY) || ''; } catch (e) { /* abaikan */ }
  return LIST.find((p) => p.id === id) || LIST[0];
}
export function setPT(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* abaikan */ } }
// PT pertama memakai database lama ('petasbi') supaya data yang sudah ada di HP otomatis menjadi data PT tersebut
export function dbName() { const p = activePT(); return p.id === BUNDLED[0].id ? 'petasbi' : 'petasbi-' + p.id; }

// ambil daftar online; true bila daftar berubah. Gagal/offline -> pakai cache
export async function refreshPtList(ms = 5000) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(PT_LIST_URL + '?_=' + Date.now(), { cache: 'no-store', signal: ac.signal }); clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    const arr = (Array.isArray(j) ? j : (j && j.pts) || []).map(clean).filter(Boolean);
    const before = JSON.stringify(LIST);
    try { localStorage.setItem(CK, JSON.stringify(arr)); } catch (e) { /* abaikan */ }
    LIST = merge(arr);
    return JSON.stringify(LIST) !== before;
  } catch (e) { return false; }
}

export const FB = {
  get apiKey() { return activePT().apiKey || ''; },
  get projectId() { return activePT().projectId || ''; },
  collection: 'sync',
};
