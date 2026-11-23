import { S, init, onChange, theme, loadLayer, bump, VERSION, saveNow } from './model.js';
import { $, $$, h, toast, select } from './util.js';
import { initMap, mapShown, doFit, refitIfNeeded, requestDraw } from './ui-map.js';
import { renderData } from './ui-data.js';
import { renderTheme } from './ui-theme.js';
import { renderLayers } from './ui-layers.js';
import { renderExport } from './ui-export.js';
import { openSheet, closeTopSheet } from './ui-common.js';
import { openSettings } from './ui-settings.js';
import { importCSVFile } from './ui-data.js';
import { importLayerFile } from './ui-layers.js';
import { checkRemote } from './sync.js';
import { checkUpdate, BUILD } from './update.js';
import { petaku } from './native.js';
import { base64ToBytes, applyUiMode } from './util.js';
import { requireLogin, backgroundCheck, canPublish } from './auth.js';
import { fbOn } from './firebase.js';
import { refreshPtList } from './pt.js';
import { pull } from './sync.js';
import { PRESETS } from './ui-tables.js';
import { importLayerPack } from './layerpack.js';
import { isZip } from './zip.js';
import { initNotes, onNotes, syncNotes, flush, notesOn } from './notes.js';
applyUiMode();
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyUiMode); } catch (e) { /* abaikan */ }

let page = 'map';
const renderers = { data: renderData, theme: renderTheme, layers: renderLayers, export: renderExport };

export function showPage(p) {
  page = p;
  $$('.page').forEach((el) => el.classList.toggle('active', el.id === 'p-' + p));
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.p === p));
  if (p === 'map') mapShown(); else renderers[p] && renderers[p]();
}

function fillThemeSel() {
  const sel = $('#themeSel');
  sel.innerHTML = '';
  for (const t of S.themes) sel.append(h('option', { value: t.id }, t.name));
  sel.value = S.themeId;
}

const seenIncoming = new Set();
async function handleIncoming(r) {
  if (!r || !r.data || seenIncoming.has(r.id)) return;
  seenIncoming.add(r.id);
  const name = r.name || 'berkas';
  const file = new File([base64ToBytes(r.data)], name);
  const ext = (name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'zip' || isZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) {
      showPage('layers');
      const r = await importLayerPack(new Uint8Array(await file.arrayBuffer()));
      toast(`Paket layer diimpor: ${r.added} ditambahkan, ${r.replaced} diperbarui`, 5000); renderLayers(); return;
    }
    if (ext === 'kml' || ext === 'geojson') { showPage('layers'); await importLayerFile(file); return; }
    if (ext === 'json') {
      const txt = await file.text();
      let o = null; try { o = JSON.parse(txt); } catch (e) { /* abaikan */ }
      if (o && Array.isArray(o.classes)) { toast('Berkas tema: impor lewat tab Tema → Impor tema', 4500); showPage('theme'); return; }
      showPage('layers'); await importLayerFile(file); return;
    }
    showPage('data');
    await importCSVFile(file);
    renderData();
  } catch (e) { console.error(e); toast('Gagal membuka ' + name + ': ' + e.message, 4500); }
}
async function takeIncoming() {
  const P = petaku();
  if (!P) return;
  try { const r = await P.getPending(); if (r && r.data) await handleIncoming(r); } catch (e) { console.error(e); }
}

async function startupChecks() {
  const c = S.sync;
  if (!fbOn() && c && /^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) {
    try {
      const r = await checkRemote();
      if (r.manifest && r.newer) toast('Ada data baru di GitHub → Pengaturan (⚙) → Tarik data terbaru', 6000);
    } catch (e) { /* offline / tidak ada akses: diam saja */ }
  }
  if (!c) return;
  if (Date.now() - (c.lastUpdateCheck || 0) > 12 * 3600 * 1000 && BUILD > 0) {
    try {
      const u = await checkUpdate();
      if (u.available) toast('Pembaruan Petaku tersedia (' + (u.tag || '') + ') → Pengaturan (⚙)', 6500);
    } catch (e) { /* diam */ }
  }
}

async function boot() {
  const ptp = refreshPtList(3000);   // daftar PT online (pt-list.json), jalan bersamaan dengan init
  await init();
  await initNotes();
  await ptp;
  await requireLogin();
  // tema lama belum punya tabel info: isi tabel bawaan (aman, tabel tanpa data otomatis tersembunyi)
  for (const t of S.themes) if (t.tables === undefined) t.tables = [PRESETS.lsu(), PRESETS.plan26(), PRESETS.yoy()];
  fillThemeSel();
  initMap();
  $('#themeSel').addEventListener('change', (e) => { S.themeId = e.target.value; bump('theme'); if (page !== 'map') renderers[page] && renderers[page](); });
  $$('#nav button').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.p)));
  $('#btnInfo').addEventListener('click', openSettings);
  onChange((k) => { if (k === 'theme' || k === 'themes') fillThemeSel(); if (page === 'data' && (k === 'data' || k === 'layers')) renderData(); });
  // muat layer yang terlihat
  const vis = S.layers.filter((l) => l.visible);
  for (const l of vis) {
    try { await loadLayer(l); } catch (e) { console.error(e); l.visible = false; toast('Layer "' + l.name + '" gagal dimuat: ' + e.message, 4000); }
  }
  S.ver++;
  refitIfNeeded();
  bump('layers');
  $('#loading').classList.add('hide');
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  // tombol back Android
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.App) {
    cap.Plugins.App.addListener('backButton', () => {
      if (closeTopSheet()) return;
      if (page !== 'map') { showPage('map'); return; }
      cap.Plugins.App.exitApp();
    });
  }
  // berkas yang dibuka dari WhatsApp / pengelola berkas (Android)
  const P = petaku();
  if (P) {
    if (P.addListener) P.addListener('fileOpened', handleIncoming);
    if (cap.Plugins.App) cap.Plugins.App.addListener('appStateChange', (st) => { if (st.isActive) takeIncoming(); });
    takeIncoming();
  }
  setTimeout(startupChecks, 2500);
  setTimeout(backgroundCheck, 4000);
  // Firebase: pengguna biasa otomatis menarik data terbaru bila ada internet (Admin tidak, agar datanya tidak tertimpa)
  if (fbOn() && !canPublish()) setTimeout(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await checkRemote();
      if (r.newer) { const res = await pull({ data: true, themes: true, layers: true, cfg: true }); fillThemeSel(); toast('Data terbaru diunduh: ' + res.done.join(', '), 4000); }
    } catch (e) { console.warn('auto-tarik gagal', e); }
  }, 6000);
  // catatan: gambar ulang penanda saat berubah; sinkron saat dibuka, saat online lagi, dan berkala
  onNotes(() => requestDraw());
  if (notesOn()) {
    const sn = () => { if (navigator.onLine && notesOn()) syncNotes().catch((e) => console.warn('sinkron catatan', e)); };
    setTimeout(sn, 3500);
    window.addEventListener('online', () => setTimeout(sn, 800));
    setInterval(() => { if (!document.hidden) sn(); }, 5 * 60 * 1000);
    if (cap && cap.Plugins && cap.Plugins.App) cap.Plugins.App.addListener('appStateChange', (st) => { if (st.isActive) sn(); });
    void flush;
  }
  window.__app = { S, showPage, handleIncoming };
}
boot().catch((e) => { console.error(e); $('#loading').textContent = 'Gagal memulai: ' + e.message; });
