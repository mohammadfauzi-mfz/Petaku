import { S, bump, loadLayer, addImportedLayer, removeLayer, saveSoon, emit, getProp } from './model.js';
import { parseCSV, kmlToGeoJSON, csvPointsToFeatures } from './geo.js';
import { h, $, toast, pickFile, readText, select, uid } from './util.js';
import { openSheet, confirmBox, row, textInput, numInput, colorInput, check, toggle } from './ui-common.js';
import { zoomToBBox } from './ui-map.js';
import { showPage } from './app.js';

function kindOf(l) { const k = l._kind; return k === 'poly' ? 'poligon' : k === 'line' ? 'garis' : k === 'point' ? 'titik' : '…'; }

export async function importLayerFile(f) {
  const name = f.name.replace(/\.[^.]+$/, '');
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const text = await readText(f);
  let gj;
  try {
    if (ext === 'kml') gj = kmlToGeoJSON(text);
    else if (ext === 'csv' || ext === 'txt') gj = csvPointsToFeatures(parseCSV(text));
    else if (ext === 'kmz') throw new Error('KMZ belum didukung — ekstrak ke KML dahulu');
    else gj = JSON.parse(text);
    if (!gj || (!gj.type)) throw new Error('bukan GeoJSON');
    if (!gj.features && gj.type !== 'Feature' && !gj.coordinates) throw new Error('GeoJSON tanpa fitur');
    const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
    if (!feats.length) throw new Error('layer kosong');
    const meta = await addImportedLayer(name, gj);
    toast(`Layer "${name}" ditambahkan`);
    return meta;
  } catch (e) {
    toast('Gagal impor layer: ' + e.message, 4500);
    return null;
  }
}

function propKeys(l) {
  const rt = S.rt.get(l.id);
  const keys = new Set();
  if (rt && rt.feats) for (const f of rt.feats.slice(0, 30)) Object.keys(f.props || {}).forEach((k) => keys.add(k));
  return [...keys];
}

async function editLayer(l) {
  if (!(S.rt.get(l.id) && S.rt.get(l.id).feats)) { try { toast('Memuat layer…', 6000); await loadLayer(l); } catch (e) { toast(e.message, 4000); } }
  const st = l.style, lg = l.legend = l.legend || { show: true, group: 'Lapisan', label: l.name };
  const keys = propKeys(l);
  const touch = () => bump('style');
  const body = h('div', {});
  body.append(row('Nama', textInput(l.name, (v) => { l.name = v; saveSoon(); })));
  const poly = l._kind === 'poly';
  if (poly) {
    body.append(h('h4', {}, 'Pewarnaan data'));
    body.append(check(!!l.themed, (v) => { l.themed = v; touch(); }, 'Warnai layer ini dengan data CSV (tema aktif)'));
    body.append(row('Kolom kunci', select(keys.length ? keys : [''], l.keyField, (v) => { l.keyField = v; touch(); })));
    body.append(h('div', { class: 'mut small' }, 'Atribut poligon yang berisi kode blok yang sama dengan kolom kunci CSV.'));
  }
  body.append(h('h4', {}, 'Tampilan'));
  body.append(row('Garis', colorInput(st.stroke || '#000000', (v) => { st.stroke = v; touch(); }), numInput(st.strokeWidth, (v) => { st.strokeWidth = v == null ? 0 : v; touch(); }, { placeholder: 'tebal' }),
    check(!st.stroke, (v) => { st.stroke = v ? '' : '#000000'; touch(); }, 'tanpa')));
  body.append(row('Pola garis', select([['', 'Lurus'], ['4 2', 'Putus-putus'], ['1 2', 'Titik-titik'], ['8 3 2 3', 'Putus-titik']], st.dash || '', (v) => { st.dash = v; touch(); })));
  if (poly) body.append(row('Isi', colorInput(st.fill || '#ffffff', (v) => { st.fill = v; touch(); }), numInput(st.fillOpacity, (v) => { st.fillOpacity = v == null ? 1 : Math.max(0, Math.min(1, v)); touch(); }, { placeholder: 'opasitas 0-1' }),
    check(!st.fill, (v) => { st.fill = v ? null : '#cccccc'; touch(); }, 'tanpa')));
  body.append(row('Titik', colorInput(st.pointColor || '#d32f2f', (v) => { st.pointColor = v; touch(); }), numInput(st.pointRadius, (v) => { st.pointRadius = v == null ? 0 : v; touch(); }, { placeholder: 'radius' })));
  body.append(h('h4', {}, 'Label'));
  body.append(row('Isi label', select([['', '(tanpa label)'], ...keys.map((k) => [k, k])], st.labelField || '', (v) => { st.labelField = v; touch(); })));
  body.append(row('Ukuran', numInput(st.labelSizePt, (v) => { st.labelSizePt = v || 3; touch(); }), h('span', { class: 'mut small' }, 'pt kertas'), colorInput(st.labelColor || '#000000', (v) => { st.labelColor = v; touch(); })));
  body.append(h('div', { class: 'row' }, check(!!st.labelBold, (v) => { st.labelBold = v; touch(); }, 'Tebal'), check(st.labelHalo !== false, (v) => { st.labelHalo = v; touch(); }, 'Garis tepi putih')));
  body.append(h('h4', {}, 'Legenda di hasil ekspor'));
  body.append(check(!!lg.show, (v) => { lg.show = v; touch(); }, 'Tampil di legenda'));
  body.append(row('Grup', textInput(lg.group, (v) => { lg.group = v; touch(); })));
  body.append(row('Teks', textInput(lg.label, (v) => { lg.label = v; touch(); })));
  body.append(row('Simbol', select([['', 'Otomatis'], ['line', 'Garis'], ['box', 'Kotak'], ['dot', 'Titik']], lg.symbol || '', (v) => { lg.symbol = v; touch(); })));
  const btns = h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: () => { const rt = S.rt.get(l.id); if (rt && rt.bbox) { close(); showPage('map'); setTimeout(() => zoomToBBox(rt.bbox, 0.1), 60); } } }, 'Zoom ke layer'));
  if (l.src === 'idb') btns.append(h('button', { class: 'btn red', onclick: async () => { if (await confirmBox(`Hapus layer "${l.name}" dari aplikasi?`, 'Hapus')) { await removeLayer(l.id); close(); renderLayers(); } } }, 'Hapus layer'));
  body.append(btns);
  const close = openSheet('Atur layer', body, { onClose: renderLayers });
}

export function renderLayers() {
  const el = $('#p-layers');
  el.innerHTML = '';
  const top = h('div', { class: 'card' }, h('h3', {}, 'Layer peta'));
  top.append(h('div', { class: 'mut' }, 'Layer paling atas di daftar digambar paling depan. Tambahkan lapisan baru dari file di HP: GeoJSON, KML, atau CSV titik (kolom lat/lon).'));
  top.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => {
    const fs = await pickFile('.geojson,.json,.kml,.csv,.txt,application/json,application/geo+json,application/vnd.google-earth.kml+xml,text/csv', true);
    let last = null;
    for (const f of fs) last = await importLayerFile(f) || last;
    renderLayers();
    if (last) editLayer(last);
  } }, '+ Impor layer dari HP')));
  el.append(top);
  const rev = [...S.layers].reverse();
  for (const l of rev) {
    const rt = S.rt.get(l.id);
    const idx = S.layers.indexOf(l);
    const sub = rt && rt.feats ? `${kindOf(l)} · ${rt.feats.length} fitur` : (l.visible ? 'memuat…' : 'belum dimuat');
    el.append(h('div', { class: 'layer' },
      toggle(l.visible, async (v) => {
        l.visible = v;
        if (v && !(S.rt.get(l.id) && S.rt.get(l.id).feats)) {
          try { toast('Memuat ' + l.name + '…', 8000); await loadLayer(l); toast('Siap', 800); } catch (e) { toast(e.message, 4000); l.visible = false; }
        }
        bump('layers'); renderLayers();
      }),
      h('div', { class: 'nm', onclick: () => editLayer(l) }, h('b', {}, l.name + (l.themed ? '  ★' : '')), h('span', { class: 'mut small' }, sub)),
      h('button', { class: 'btn sec sm', onclick: () => { if (idx < S.layers.length - 1) { [S.layers[idx + 1], S.layers[idx]] = [S.layers[idx], S.layers[idx + 1]]; bump('layers'); renderLayers(); } } }, '↑'),
      h('button', { class: 'btn sec sm', onclick: () => { if (idx > 0) { [S.layers[idx - 1], S.layers[idx]] = [S.layers[idx], S.layers[idx - 1]]; bump('layers'); renderLayers(); } } }, '↓'),
      h('button', { class: 'btn sec sm', onclick: () => editLayer(l) }, 'Atur')));
  }
  el.append(h('div', { class: 'mut small', style: { marginTop: '8px' } }, '★ = layer yang diwarnai dari data CSV. Layer poligon lain bisa dijadikan ★ lewat Atur → Pewarnaan data.'));
}
