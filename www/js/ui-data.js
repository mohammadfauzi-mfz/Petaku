import { S, bump, buildDs, indexDs, autoKeyCol, computeStats, theme, loadLayer } from './model.js';
import { parseCSV } from './geo.js';
import { h, $, toast, pickFile, readText, select, shareFile } from './util.js';
import { openSheet, check } from './ui-common.js';

export async function importCSVFile(file) {
  const text = await readText(file);
  let parsed;
  try { parsed = parseCSV(text); } catch (e) { toast('CSV gagal dibaca: ' + e.message, 4000); return; }
  // pastikan layer bertema sudah dimuat agar kolom kunci bisa ditebak
  for (const l of S.layers) if (l.themed && l.visible) { try { await loadLayer(l); } catch (e) { /* abaikan */ } }
  const ds = buildDs(parsed, file.name, parsed.headers[0]);
  ds.keyCol = autoKeyCol(ds);
  indexDs(ds);
  S.ds = ds;
  bump('data');
  const th = theme();
  const hasField = ds.hmap[String(th.field || '').toLowerCase().trim()] !== undefined;
  toast(hasField ? `CSV dimuat: ${ds.rows.length} baris` : `CSV dimuat, tetapi kolom "${th.field}" tidak ada → pilih di tab Tema`, 4200);
}

function listSheet(title, items) {
  openSheet(title, h('div', {}, items.length ? items.map((x) => h('span', { class: 'chip' }, x)) : h('span', { class: 'mut' }, 'Tidak ada')));
}

export function renderData() {
  const el = $('#p-data');
  el.innerHTML = '';
  const ds = S.ds;
  const card = h('div', { class: 'card' }, h('h3', {}, 'Data CSV'));
  card.append(h('div', { class: 'mut' }, 'Impor CSV hasil (satu baris per blok). Pemisah ; , tab otomatis dikenali. Angka seperti 110% atau 15,14 dibaca otomatis.'));
  card.append(h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: async () => { const f = await pickFile('.csv,.txt,text/csv,text/plain,application/vnd.ms-excel'); if (f[0]) await importCSVFile(f[0]); } }, ds ? 'Ganti CSV' : 'Impor CSV'),
    ds ? h('button', { class: 'btn red', onclick: () => { S.ds = null; bump('data'); } }, 'Hapus data') : null));
  el.append(card);
  if (!ds) { el.append(h('div', { class: 'hint' }, 'Belum ada CSV. Peta tetap tampil, blok diwarnai setelah CSV diimpor.')); return; }

  const info = h('div', { class: 'card' }, h('h3', {}, ds.name));
  info.append(h('div', { class: 'mut' }, `${ds.rows.length} baris · ${ds.headers.length} kolom · pemisah "${ds.delimiter === '\t' ? 'tab' : ds.delimiter}"`));
  info.append(h('div', { class: 'row' }, h('label', {}, 'Kolom kunci'), h('div', { class: 'grow' }, select(ds.headers, ds.keyCol, (v) => { ds.keyCol = v; indexDs(ds); bump('data'); }))));
  info.append(h('div', { class: 'mut small' }, 'Kolom yang isinya sama dengan kode blok di peta (otomatis dipilih yang paling cocok).'));
  info.append(h('div', { style: { margin: '8px 0' } }, check(S.cfg.ignoreDup !== false, (v) => { S.cfg.ignoreDup = v; bump('data'); renderData(); }, 'Abaikan kode blok kembar (muncul di >1 poligon, mis. C41, D3, D5)')));
  const st = computeStats();
  info.append(h('div', { style: { marginTop: '8px' } },
    h('div', { class: st.matchedPolys ? 'ok' : 'warn' }, `✔ ${st.matchedPolys} poligon blok mendapat data`),
    h('div', {}, h('button', { class: 'btn sec sm', onclick: () => listSheet(`Baris CSV tanpa poligon (${st.rowsNoPoly.length})`, st.rowsNoPoly) }, `${st.rowsNoPoly.length} baris CSV tanpa poligon`), ' ',
      h('button', { class: 'btn sec sm', onclick: () => listSheet(`Poligon tanpa baris CSV (${st.polysNoRow.length})`, st.polysNoRow) }, `${st.polysNoRow.length} poligon tanpa data`))));
  el.append(info);

  const prev = h('div', { class: 'card' }, h('h3', {}, 'Pratinjau (20 baris pertama)'));
  const tb = h('table', {}, h('thead', {}, h('tr', {}, ds.headers.map((x) => h('th', {}, x)))), h('tbody', {}, ds.rows.slice(0, 20).map((r) => h('tr', {}, ds.headers.map((x) => h('td', {}, r[x]))))));
  prev.append(h('div', { class: 'tblwrap' }, tb));
  el.append(prev);
}
