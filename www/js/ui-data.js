import { S, bump, buildDs, indexDs, autoKeyCol, computeStats, theme, loadLayer, putDataset, removeDataset, dsForTheme } from './model.js';
import { parseCSV } from './geo.js';
import { h, $, toast, pickFile, readText, select, uid, shareFile, shareFiles } from './util.js';
import { openSheet, check, confirmBox, textInput } from './ui-common.js';

// Impor satu berkas CSV sebagai dataset. Nama sama -> isi dataset lama diganti.
export async function importCSVFile(file, opts) {
  opts = opts || {};
  const text = await readText(file);
  let parsed;
  try { parsed = parseCSV(text); } catch (e) { toast('CSV gagal dibaca: ' + e.message, 4000); return null; }
  // pastikan layer bertema sudah dimuat agar kolom kunci bisa ditebak
  for (const l of S.layers) if (l.themed && l.visible) { try { await loadLayer(l); } catch (e) { /* abaikan */ } }
  const ds = buildDs(parsed, file.name, parsed.headers[0]);
  ds.keyCol = autoKeyCol(ds);
  indexDs(ds);
  putDataset(ds);
  const th = theme();
  if (!opts.silent) {
    th.dsId = ds.id;           // tema yang sedang dibuka langsung memakai CSV ini
    bump('data');
    const hasField = ds.hmap[String(th.field || '').toLowerCase().trim()] !== undefined;
    toast(hasField ? `CSV dimuat: ${ds.rows.length} baris → dipakai tema "${th.name}"` : `CSV dimuat (${ds.rows.length} baris), tetapi kolom "${th.field}" tidak ada → pilih kolom di tab Tema`, 4800);
  }
  return ds;
}

export async function importCSVFiles(files) {
  let last = null;
  for (const f of files) last = await importCSVFile(f, { silent: files.length > 1 });
  if (files.length > 1 && last) {
    theme().dsId = last.id; bump('data');
    toast(`${files.length} CSV dimuat. Pilih sumber CSV tiap tema di tab Tema.`, 4800);
  }
}

function listSheet(title, items) {
  openSheet(title, h('div', {}, items.length ? items.map((x) => h('span', { class: 'chip' }, x)) : h('span', { class: 'mut' }, 'Tidak ada')));
}

function previewSheet(ds) {
  const tb = h('table', {}, h('thead', {}, h('tr', {}, ds.headers.map((x) => h('th', {}, x)))), h('tbody', {}, ds.rows.slice(0, 30).map((r) => h('tr', {}, ds.headers.map((x) => h('td', {}, r[x]))))));
  openSheet(`${ds.name} (30 baris pertama)`, h('div', { class: 'tblwrap' }, tb));
}

const DELIMS = [['orig', 'Sama seperti aslinya'], [';', 'Titik koma ( ; ) — Excel Indonesia'], [',', 'Koma ( , )'], ['\t', 'Tab']];
function csvQuote(v, d) {
  const s = v == null ? '' : String(v);
  return (s.includes(d) || /["\r\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function dsToCSV(ds, delim, bom) {
  const d = !delim || delim === 'orig' ? (ds.delimiter || ';') : delim;
  const lines = [ds.headers.map((x) => csvQuote(x, d)).join(d)];
  for (const r of ds.rows) lines.push(ds.headers.map((x) => csvQuote(r[x], d)).join(d));
  return (bom ? '\ufeff' : '') + lines.join('\r\n') + '\r\n';
}
const csvName = (ds) => { const n = String(ds.name || 'data').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'data'; return /\.(csv|txt|tsv)$/i.test(n) ? n.replace(/\.(txt|tsv)$/i, '.csv') : n + '.csv'; };

function shareSheet(list) {
  let delim = 'orig', bom = true;
  const many = list.length > 1;
  const body = h('div', {},
    h('div', { class: 'mut' }, many ? `${list.length} CSV akan dibagikan sekaligus.` : `${list[0].name} · ${list[0].rows.length} baris`),
    h('div', { class: 'row' }, h('label', {}, 'Pemisah'), h('div', { class: 'grow' }, select(DELIMS, delim, (v) => { delim = v; }))),
    h('div', { style: { margin: '8px 0' } }, check(true, (v) => { bom = v; }, 'Sertakan penanda UTF-8 (agar dibuka rapi di Excel)')),
    h('div', { class: 'mut small' }, 'Di Android akan muncul lembar bagikan — pilih WhatsApp lalu kontak/grup tujuan. Penerima dapat membuka CSV langsung ke Petaku.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => {
      const files = list.map((d) => ({ name: csvName(d), data: dsToCSV(d, delim, bom), mime: 'text/csv' }));
      const ok = many ? await shareFiles(files, 'Data CSV Petaku') : await shareFile(files[0].name, files[0].data, 'text/csv', files[0].name);
      if (ok) { toast('CSV siap dibagikan'); close(); }
    } }, 'Bagikan')));
  const close = openSheet(many ? 'Bagikan semua CSV' : 'Bagikan CSV', body, { center: true });
}

function usedBy(ds) {
  return S.themes.filter((t) => (dsForTheme(t) || {}).id === ds.id).map((t) => t.name);
}

export function renderData() {
  const el = $('#p-data');
  el.innerHTML = '';
  const card = h('div', { class: 'card' }, h('h3', {}, 'Data CSV'));
  card.append(h('div', { class: 'mut' }, 'Boleh lebih dari satu CSV (mis. produksi dan evaluasi). Tiap tema memilih CSV-nya di tab Tema. Pemisah ; , tab otomatis dikenali. Angka seperti 110% atau 15,14 dibaca otomatis. CSV dengan nama berkas sama akan memperbarui yang lama.'));
  card.append(h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: async () => { const f = await pickFile('.csv,.txt,.tsv,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel', true); if (f.length) await importCSVFiles(f); } }, S.dsList.length ? '+ Tambah CSV' : 'Impor CSV')));
  el.append(card);
  if (!S.dsList.length) { el.append(h('div', { class: 'hint' }, 'Belum ada CSV. Peta tetap tampil, blok diwarnai setelah CSV diimpor.')); return; }

  const cur = S.ds;
  const list = h('div', { class: 'card' }, h('h3', {}, `Daftar CSV (${S.dsList.length})`));
  for (const d of S.dsList) {
    const by = usedBy(d);
    const item = h('div', { class: 'themeItem' + (cur && cur.id === d.id ? ' active' : '') },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'nm', style: { wordBreak: 'break-all' } }, d.name),
        h('div', { class: 'mut small' }, `${d.rows.length} baris · ${d.headers.length} kolom` + (by.length ? ' · dipakai: ' + by.join(', ') : ' · belum dipakai tema'))),
      h('button', { class: 'btn sec sm', onclick: () => previewSheet(d) }, 'Lihat'),
      h('button', { class: 'btn sec sm', onclick: () => shareSheet([d]) }, 'Bagikan'),
      h('button', { class: 'btn sec sm', onclick: () => {
        const inp = textInput(d.name, () => {});
        const close = openSheet('Ganti nama CSV', h('div', {}, inp, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { const v = inp.value.trim(); if (v) { d.name = v; bump('data'); renderData(); } close(); } }, 'Simpan'))), { center: true });
      } }, 'Nama'),
      h('button', { class: 'btn red sm', onclick: async () => { if (!await confirmBox(`Hapus CSV "${d.name}"?`, 'Hapus')) return; removeDataset(d.id); bump('data'); renderData(); } }, 'Hapus'));
    list.append(item);
  }
  if (S.dsList.length > 1) list.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec sm', onclick: () => shareSheet(S.dsList.slice()) }, 'Bagikan semua')));
  list.append(h('div', { class: 'mut small' }, 'Disorot = CSV yang dipakai tema aktif (“' + theme().name + '”).'));
  el.append(list);

  const ds = cur;
  if (!ds) return;
  const info = h('div', { class: 'card' }, h('h3', {}, ds.name));
  info.append(h('div', { class: 'mut' }, `${ds.rows.length} baris · ${ds.headers.length} kolom · pemisah "${ds.delimiter === '\t' ? 'tab' : ds.delimiter}"`));
  info.append(h('div', { class: 'row' }, h('label', {}, 'Kolom kunci'), h('div', { class: 'grow' }, select(ds.headers, ds.keyCol, (v) => { ds.keyCol = v; indexDs(ds); bump('data'); renderData(); }))));
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
