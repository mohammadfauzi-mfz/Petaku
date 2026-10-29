import { S, init, onChange, theme, loadLayer, bump, VERSION, saveNow } from './model.js';
import { $, $$, h, toast, select } from './util.js';
import { initMap, mapShown, doFit, refitIfNeeded, requestDraw } from './ui-map.js';
import { renderData } from './ui-data.js';
import { renderTheme } from './ui-theme.js';
import { renderLayers } from './ui-layers.js';
import { renderExport } from './ui-export.js';
import { openSheet, closeTopSheet } from './ui-common.js';

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

function about() {
  const wa = '6285252390543';
  const body = h('div', {},
    h('p', {}, h('b', {}, 'Peta SBI'), ' — pewarna peta blok dari CSV. Impor CSV, pilih jenis peta, atur warna & layer, lalu ekspor PDF/PNG.'),
    h('p', { class: 'mut' }, 'Kiat: buat jenis peta baru di tab Tema (Salin tema lalu ubah kolom, kelas, dan judul). Layer tambahan (GeoJSON/KML/CSV titik) diimpor dari tab Layer.'),
    h('p', {}, 'Create By Mohammad Fauzi'),
    h('p', {}, 'Contact Me for Suggestion & Feedback ', h('a', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', style: { textDecoration: 'none', fontSize: '20px' }, 'aria-label': 'WhatsApp' }, '💬')),
    h('p', { class: 'mut', style: { textAlign: 'center', marginTop: '22px' } }, 'Versi Aplikasi ' + VERSION));
  openSheet('Tentang aplikasi', body);
}

async function boot() {
  await init();
  fillThemeSel();
  initMap();
  $('#themeSel').addEventListener('change', (e) => { S.themeId = e.target.value; bump('theme'); if (page !== 'map') renderers[page] && renderers[page](); });
  $$('#nav button').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.p)));
  $('#btnInfo').addEventListener('click', about);
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
  window.__app = { S, showPage };
}
boot().catch((e) => { console.error(e); $('#loading').textContent = 'Gagal memulai: ' + e.message; });
