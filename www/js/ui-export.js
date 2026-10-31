import { S, theme, bump, saveSoon, onChange } from './model.js';
import { renderPage, buildFile, PAPERS } from './export.js';
import { h, $, toast, select, pickFile, readDataURL, shareFile } from './util.js';
import { row, textInput, textArea, check } from './ui-common.js';
import { getView } from './ui-map.js';
import { filterCard } from './ui-filter.js';

let prevTimer = 0, busy = false;
function cfgChanged() { saveSoon(); clearTimeout(prevTimer); prevTimer = setTimeout(drawPreview, 350); }

async function drawPreview() {
  const cv = $('#expPrev'); if (!cv) return;
  try {
    const r = await renderPage(S.cfg, { dpi: 55, maxSide: 1100, view: getView() });
    cv.width = r.W; cv.height = r.H;
    cv.getContext('2d').drawImage(r.canvas, 0, 0);
  } catch (e) { console.error(e); }
}
export function refreshExportPreview() { if ($('#p-export').classList.contains('active')) cfgChanged(); }

function imgControl(label, key, defAsset) {
  const cfg = S.cfg;
  const st = h('span', { class: 'mut small' }, cfg[key] ? (cfg[key].startsWith('asset:') ? 'bawaan' : 'gambar sendiri') : 'kosong');
  return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'grow', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
    h('button', { class: 'btn sec sm', onclick: async () => { const f = (await pickFile('image/*'))[0]; if (!f) return; cfg[key] = await readDataURL(f); cfgChanged(); renderExport(); } }, 'Pilih…'),
    h('button', { class: 'btn sec sm', onclick: () => { cfg[key] = defAsset; cfgChanged(); renderExport(); } }, 'Bawaan'),
    h('button', { class: 'btn red sm', onclick: () => { cfg[key] = ''; cfgChanged(); renderExport(); } }, 'Hapus'), st));
}

export function renderExport() {
  const el = $('#p-export');
  el.innerHTML = '';
  const cfg = S.cfg, th = theme();
  const pv = h('div', { class: 'card' }, h('h3', {}, 'Pratinjau hasil'), h('canvas', { class: 'prev', id: 'expPrev' }));
  el.append(pv);

  el.append(filterCard());
  const go = h('div', { class: 'card' }, h('h3', {}, 'Simpan / bagikan'));
  go.append(row('Format', select([['pdf', 'PDF'], ['png', 'PNG'], ['jpg', 'JPG']], cfg.format, (v) => { cfg.format = v; saveSoon(); })));
  const btn = h('button', { class: 'btn block', onclick: async () => {
    if (busy) return; busy = true; btn.textContent = 'Memproses…'; btn.disabled = true;
    try {
      const f = await buildFile(cfg, cfg.format, getView());
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const nm = (th.title || th.name).split('\n').join(' ').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Peta';
      const ok = await shareFile(`${nm}_${stamp}.${f.ext}`, f.bytes, f.mime, th.name);
      if (ok) toast('Selesai (' + Math.round(f.bytes.length / 1024) + ' KB)');
    } catch (e) { console.error(e); toast('Gagal ekspor: ' + e.message, 5000); }
    busy = false; btn.textContent = 'Bagikan / Simpan'; btn.disabled = false;
  } }, 'Bagikan / Simpan');
  go.append(btn);
  go.append(h('div', { class: 'mut small', style: { marginTop: '6px' } }, 'Di Android akan muncul lembar bagikan (WhatsApp, Drive, Simpan ke file, dll).'));
  el.append(go);

  const lay = h('div', { class: 'card' }, h('h3', {}, 'Halaman'));
  lay.append(row('Kertas', select(Object.keys(PAPERS), cfg.paper, (v) => { cfg.paper = v; cfgChanged(); }),
    select([['landscape', 'Lanskap'], ['portrait', 'Potret']], cfg.orient, (v) => { cfg.orient = v; cfgChanged(); })));
  lay.append(row('Resolusi', select([[100, '100 dpi (ringan)'], [150, '150 dpi'], [200, '200 dpi'], [300, '300 dpi (tajam)']], cfg.dpi, (v) => { cfg.dpi = +v; saveSoon(); })));
  lay.append(row('Area peta', select([['all', 'Seluruh data'], ['view', 'Tampilan layar saat ini']], cfg.fit, (v) => { cfg.fit = v; cfgChanged(); })));
  lay.append(h('div', { class: 'mut small' }, 'Untuk “Tampilan layar”, atur zoom/geser di tab Peta lebih dulu.'));
  el.append(lay);

  const txt = h('div', { class: 'card' }, h('h3', {}, 'Teks & panel'));
  txt.append(row('Judul peta', textArea(th.title, (v) => { th.title = v; bump('style'); cfgChanged(); }, { rows: 2 })));
  txt.append(h('div', { class: 'mut small' }, 'Judul mengikuti tema aktif (“' + th.name + '”) — ubah periode di sini sebelum ekspor.'));
  txt.append(row('Judul legenda', textInput(th.legendTitle, (v) => { th.legendTitle = v; bump('style'); cfgChanged(); })));
  txt.append(row('Info perusahaan', textArea(cfg.company, (v) => { cfg.company = v; cfgChanged(); }, { rows: 3 })));
  txt.append(row('Teks bawah', textArea(cfg.footer, (v) => { cfg.footer = v; cfgChanged(); }, { rows: 3 })));
  txt.append(row('Header legenda', textInput(cfg.legendHeader, (v) => { cfg.legendHeader = v; cfgChanged(); })));
  txt.append(row('Judul indeks', textInput(cfg.indexTitle, (v) => { cfg.indexTitle = v; cfgChanged(); })));
  txt.append(imgControl('Logo', 'logo', 'asset:assets/logo.png'));
  txt.append(imgControl('Peta indeks', 'index', 'asset:assets/indeks.jpg'));
  txt.append(h('div', { class: 'btns' },
    check(cfg.showNorth, (v) => { cfg.showNorth = v; cfgChanged(); }, 'Panah utara'),
    check(cfg.showScale, (v) => { cfg.showScale = v; cfgChanged(); }, 'Skala'),
    check(cfg.showLegendLayers, (v) => { cfg.showLegendLayers = v; cfgChanged(); }, 'Layer di legenda')));
  el.append(txt);
  cfgChanged();
}
