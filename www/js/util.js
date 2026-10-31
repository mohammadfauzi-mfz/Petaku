// Util umum: DOM helper, parsing angka, penyimpanan IndexedDB, berbagi file
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function select(options, value, onchange, attrs) {
  const el = h('select', attrs || {});
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    el.append(h('option', { value: v }, l));
  }
  el.value = value;
  if (el.value !== String(value) && options.length) el.selectedIndex = -1;
  if (onchange) el.addEventListener('change', () => onchange(el.value));
  return el;
}

export const uid = () => Math.random().toString(36).slice(2, 9);
export const clone = (o) => JSON.parse(JSON.stringify(o));

let toastTimer;
export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- angka ----------
export function num(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  s = String(s).trim().replace(/−/g, '-').replace('%', '').trim();
  if (s === '' || s === '-' || s.startsWith('#')) return null;
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}
export const normKey = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');

// ---------- penyimpanan ----------
const mem = new Map();
let dbp;
function openDB() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('petasbi', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
  }
  return dbp;
}
export async function dbGet(k) {
  const d = await openDB();
  if (!d) return mem.get(k);
  return new Promise((res) => {
    const q = d.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => res(undefined);
  });
}
export async function dbSet(k, v) {
  const d = await openDB();
  if (!d) { mem.set(k, v); return; }
  return new Promise((res) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
export async function dbDel(k) {
  const d = await openDB();
  if (!d) { mem.delete(k); return; }
  return new Promise((res) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

// ---------- file ----------
export function pickFile(accept, multiple) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: accept || '*/*', style: { display: 'none' } });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
export const readText = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file);
});
export const readDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
});

export function bytesToBase64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// warna hex + alpha -> rgba()
export function hexA(c, a) {
  if (a == null || a >= 1 || !/^#[0-9a-f]{6}$/i.test(c || '')) return c;
  const n = parseInt(c.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, a)})`;
}

// Simpan/bagikan file: di Android lewat lembar Share, di browser lewat unduhan
export async function shareFile(name, bytesOrString, mime, title) {
  const bytes = typeof bytesOrString === 'string' ? new TextEncoder().encode(bytesOrString) : bytesOrString;
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem && cap.Plugins.Share) {
    try {
      const r = await cap.Plugins.Filesystem.writeFile({ path: name, data: bytesToBase64(bytes), directory: 'CACHE', recursive: true });
      await cap.Plugins.Share.share({ title: title || name, files: [r.uri], dialogTitle: title || name });
      return true;
    } catch (e) {
      if (String(e && e.message || e).toLowerCase().includes('cancel')) return false;
      toast('Gagal membagikan: ' + (e.message || e), 4000);
      return false;
    }
  }
  const blob = new Blob([bytes], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return true;
}

// Bagikan beberapa berkas sekaligus: Android -> satu lembar Share berisi semua; browser -> unduh berurutan
export async function shareFiles(list, title) {
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem && cap.Plugins.Share) {
    try {
      const uris = [];
      for (const f of list) {
        const bytes = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
        const r = await cap.Plugins.Filesystem.writeFile({ path: f.name, data: bytesToBase64(bytes), directory: 'CACHE', recursive: true });
        uris.push(r.uri);
      }
      await cap.Plugins.Share.share({ title: title || 'Berkas', files: uris, dialogTitle: title || 'Berkas' });
      return true;
    } catch (e) {
      if (String(e && e.message || e).toLowerCase().includes('cancel')) return false;
      toast('Gagal membagikan: ' + (e.message || e), 4000);
      return false;
    }
  }
  for (const f of list) { await shareFile(f.name, f.data, f.mime || 'application/octet-stream', title); await new Promise((r) => setTimeout(r, 350)); }
  return true;
}
