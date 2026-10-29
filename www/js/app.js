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
import { base64ToBytes } from './util.js';

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
  if (!c || !/^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) return;
  try {
    const r = await checkRemote();
    if (r.manifest && r.newer) toast('Ada data baru di GitHub → Pengaturan (⚙) → Tarik data terbaru', 6000);
  } catch (e) { /* offline / tidak ada akses: diam saja */ }
  if (Date.now() - (c.lastUpdateCheck || 0) > 12 * 3600 * 1000 && BUILD > 0) {
    try {
      const u = await checkUpdate();
      if (u.available) toast('Pembaruan Petaku tersedia (' + (u.tag || '') + ') → Pengaturan (⚙)', 6500);
    } catch (e) { /* diam */ }
  }
}

async function boot() {
  await init();
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
  window.__app = { S, showPage, handleIncoming };
}
boot().catch((e) => { console.error(e); $('#loading').textContent = 'Gagal memulai: ' + e.message; });
