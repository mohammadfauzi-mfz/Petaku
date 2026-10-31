// Model data: state global, layer, tema (jenis peta), dataset CSV, resolusi warna
import { num, normKey, uid, clone, dbGet, dbSet, dbDel } from './util.js';
import * as G from './geo.js';

export const VERSION = '1.0';

export const S = {
  layers: [],        // meta layer, urut dari bawah ke atas
  themes: [],
  themeId: null,
  dsList: [],        // semua dataset CSV
  dsActive: null,    // id dataset yang dipakai tema tanpa pilihan sendiri
  sync: null,        // pengaturan sinkron & pembaruan (tidak ikut disinkronkan)
  cfg: null,         // pengaturan ekspor
  ver: 0,            // naik setiap ada perubahan yang memengaruhi warna
  rt: new Map(),     // runtime layer: id -> {feats}
};

// dataset yang dipakai tema aktif (tema.dsId, kalau kosong: dataset aktif)
export function dsForTheme(t) {
  if (t && t.dsId) { const d = S.dsList.find((x) => x.id === t.dsId); if (d) return d; }
  return S.dsList.find((x) => x.id === S.dsActive) || S.dsList[0] || null;
}
Object.defineProperty(S, 'ds', { get() { return dsForTheme(S.themes.find((t) => t.id === S.themeId) || S.themes[0]); }, enumerable: false });

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(kind) { for (const f of listeners) try { f(kind); } catch (e) { console.error(e); } }
export function bump(kind) { S.ver++; saveSoon(); emit(kind || 'style'); }

// ---------------- default ----------------
const TBM_STYLE = { fill: '#ffffff', pattern: 'dots', pc: '#00a01e' };
export const defRules = () => [
  { id: 'r_tbm', enabled: true, source: 'poly', field: 'Blok', op: 'regex', value: 'R$', ...TBM_STYLE, legendShow: true, legendGroup: 'Area TBM', legendLabel: 'Blok Area TBM' },
  { id: 'r_tuntas', enabled: true, source: 'csv', field: 'Status', op: 'equals', value: 'Tuntas', ...TBM_STYLE, legendShow: false, legendGroup: 'Area TBM', legendLabel: 'Blok Tuntas' },
  { id: 'r_kosong', enabled: true, source: 'csv', field: 'Yld', op: 'empty', value: '', fill: '#ffffff', pattern: 'none', pc: '#000000', legendShow: false, legendGroup: '', legendLabel: 'Tanpa data' },
];

const C = (color, label, min, max, extra) => ({ id: uid(), color, label, min, max, values: '', pattern: 'none', pc: '#ff0004', opacity: 100, ...(extra || {}) });
const K = (color, label, values) => ({ id: uid(), color, label, min: null, max: null, values, pattern: 'none', pc: '#ff0004', opacity: 100 });

export function defThemes() {
  const base = (o) => ({
    scale: 1, mode: 'range', dsId: '', opacity: 100, noData: { fill: '#ffffff', transparent: false },
    rules: defRules(), showCounts: false, legendImage: '',
    label: { show: true, sizePx: 10, sizePt: 3.0, force: false }, ...o,
  });
  return [
    base({
      id: 'yoy', name: 'Pencapaian YOY', title: 'PENCAPAIAN PRODUKSI YOY\nSBI SEP 2026 VS 2025',
      legendTitle: 'Pencapaian YOY :', field: 'YOY', label: { show: true, sizePx: 10, sizePt: 3.0, force: false, template: '{BLOK}\n{Yld}\n{YOY}' },
      classes: [C('#00c6f7', '> 100%', 100.5, null), C('#00d518', '95% - 99%', 95, 100.5), C('#fbff02', '90% - 94%', 90, 95), C('#ffd30b', '85% - 89%', 85, 90), C('#ff0004', '< 85%', null, 85)],
    }),
    base({
      id: 'bbc3', name: 'BBC3 Scoring', title: 'PENCAPAIAN PRODUKSI BBC3\nSCORING SEP 2026',
      legendTitle: 'Kategori BBC (Scoring)', field: 'BBC3S', mode: 'category', legendImage: 'asset:assets/kurva.jpg',
      label: { show: true, sizePx: 10, sizePt: 3.0, force: false, template: '{BLOK}\n{Yld}\n{BBC3}' },
      classes: [K('#00c6f7', 'SB (95% - 100%)', 'SB'), K('#00d518', 'B (80% - 94%)', 'B'), K('#ffd30b', 'KB (<80%)', 'KB')],
    }),
    base({
      id: 's3', name: 'Std S3', title: 'PENCAPAIAN PRODUKSI STD S3\nSBI SEP 2026',
      legendTitle: 'Pencapaian Std S3 Sep', field: 'std.S3',
      label: { show: true, sizePx: 10, sizePt: 3.0, force: false, template: '{BLOK}\n{Yld}\n{std.S3}' },
      classes: [C('#00d518', '> 90%', 90.5, null), C('#fbff02', '80% - 90%', 80, 90.5), C('#ff0004', '< 80%', null, 80)],
    }),
    base({
      id: 'evbbc3', name: 'Evaluasi BBC3', title: 'EVALUASI CAPAIAN JJG BBC3\nPERIODE SEPTEMBER 2026',
      legendTitle: 'Evaluasi BBC terhadap Sebaran BBC3 :', field: 'Evaluasi',
      label: { show: true, sizePx: 10, sizePt: 3.0, force: false, template: '{BLOK}\n{BBC3}\n{Evaluasi}' },
      classes: [
        C('#ffffff', 'Over > +20% (Anomali)', 20.5, null, { pattern: 'diag', pc: '#ff0004' }),
        C('#ffd30b', 'Over +10% sd +20%', 9.5, 20.5),
        C('#fbff02', 'Over +6% sd +9%', 5.5, 9.5),
        C('#a1ff79', 'Over +3% sd +5%', 2.5, 5.5),
        C('#00d518', 'Normal -2% sd +2%', -2.5, 2.5),
        C('#ff8b8d', 'Under -3% sd -5%', -5.5, -2.5),
        C('#ff0004', 'Under -6% sd -9%', null, -5.5),
      ],
    }),
  ];
}

const LBL = { labelField: '', labelSizePt: 3, labelBold: false, labelColor: '#000000', labelHalo: true };
export function defLayers() {
  return [
    { id: 'rendahan', name: 'Areal Rendahan', src: 'asset', url: 'data/rendahan.geojson', visible: false, themed: false, keyField: 'Blok',
      style: { stroke: '#a05a00', strokeWidth: 0.3, fill: '#f5c27a', fillOpacity: 0.55, dash: '', pointRadius: 3, pointColor: '#d32f2f', ...LBL },
      legend: { show: true, group: 'Lapisan', label: 'Areal Rendahan', symbol: 'box' } },
    { id: 'sungai', name: 'Sungai', src: 'asset', url: 'data/sungai.geojson', visible: true, themed: false, keyField: 'Blok',
      style: { stroke: '#3b7fd4', strokeWidth: 0.9, fill: null, fillOpacity: 1, dash: '', pointRadius: 3, pointColor: '#d32f2f', ...LBL },
      legend: { show: true, group: 'Perairan', label: 'BPN_Sungai', symbol: 'line' } },
    { id: 'blok', name: 'Blok', src: 'asset', url: 'data/blok.geojson', visible: true, themed: true, keyField: 'Blok',
      style: { stroke: '#000000', strokeWidth: 0.45, fill: '#ffffff', fillOpacity: 1, dash: '', pointRadius: 3, pointColor: '#d32f2f', ...LBL },
      legend: { show: false, group: 'Batas Area', label: 'Blok' } },
    { id: 'batas_afdeling', name: 'Batas Afdeling', src: 'asset', url: 'data/batas_afdeling.geojson', visible: true, themed: false, keyField: 'Afdeling',
      style: { stroke: '#000000', strokeWidth: 0.9, fill: null, fillOpacity: 1, dash: '4 2', pointRadius: 3, pointColor: '#d32f2f', ...LBL },
      legend: { show: true, group: 'Batas Area', label: 'BPN_Afdeling', symbol: 'box' } },
    { id: 'batas_estate', name: 'Batas Estate', src: 'asset', url: 'data/batas_estate.geojson', visible: true, themed: false, keyField: 'Estate',
      style: { stroke: '#000000', strokeWidth: 1.8, fill: null, fillOpacity: 1, dash: '', pointRadius: 3, pointColor: '#d32f2f', ...LBL },
      legend: { show: true, group: 'Batas Area', label: 'BPN_Estate', symbol: 'box' } },
    { id: 'label_afdeling', name: 'Nama Afdeling', src: 'asset', url: 'data/label_afdeling.geojson', visible: true, themed: false, keyField: 'Nama',
      style: { stroke: '#000000', strokeWidth: 1, fill: null, fillOpacity: 1, dash: '', pointRadius: 0, pointColor: '#000000', ...LBL, labelField: 'Nama', labelSizePt: 3.6, labelBold: false },
      legend: { show: false, group: '', label: 'Nama Afdeling' } },
    { id: 'label_estate', name: 'Nama Estate', src: 'asset', url: 'data/label_estate.geojson', visible: true, themed: false, keyField: 'Nama',
      style: { stroke: '#000000', strokeWidth: 1, fill: null, fillOpacity: 1, dash: '', pointRadius: 0, pointColor: '#000000', ...LBL, labelField: 'Nama', labelSizePt: 7, labelBold: true },
      legend: { show: false, group: '', label: 'Nama Estate' } },
  ];
}

export function defCfg() {
  return {
    paper: 'A4', orient: 'landscape', dpi: 200, fit: 'all', format: 'pdf',
    company: 'PT. Bima Palma Nugraha\nKecamatan Bengalon, Kabupaten Kutai Timur\nProvinsi Kalimantan Timur',
    footer: 'PT. Bima Palma Nugraha\nJl. Poros Bengalon - Ma. Wahau, Km.93\nDs. Tepian Langsat, Kec. Bengalon, Kab. Kutai Timur',
    logo: 'asset:assets/logo.png', index: 'asset:assets/indeks.jpg', indexTitle: 'INDEKS PETA',
    legendHeader: 'KETERANGAN',
    showNorth: true, showScale: true, showLegendLayers: true, ignoreDup: true,
  };
}

// ---------------- persistensi ----------------
let saveT;
export function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }
export const slimDs = (d) => ({ id: d.id, name: d.name, headers: d.headers, rows: d.rows, keyCol: d.keyCol, delimiter: d.delimiter, updatedAt: d.updatedAt || 0 });
export const defSync = () => ({ repo: 'mohammadfauzi-mfz/Petaku', branch: 'main', folder: 'sync', token: '', lastManifest: '', lastPull: 0, scope: { data: true, themes: true, layers: true, cfg: false }, lastUpdateCheck: 0 });
export async function saveNow() {
  try {
    await dbSet('layers', S.layers.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('_')))));
    await dbSet('themes', S.themes);
    await dbSet('themeId', S.themeId);
    await dbSet('cfg', S.cfg);
    await dbSet('dsList', S.dsList.map(slimDs));
    await dbSet('dsActive', S.dsActive);
    await dbSet('sync', S.sync);
  } catch (e) { console.error('simpan gagal', e); }
}

export async function init() {
  const L = await dbGet('layers');
  const dl = defLayers();
  if (Array.isArray(L) && L.length) {
    // gabungkan: layer bawaan baru yang belum ada ditambahkan di posisi default
    S.layers = L;
    for (const d of dl) if (!S.layers.some((x) => x.id === d.id)) S.layers.push(d);
  } else S.layers = dl;
  const T = await dbGet('themes');
  S.themes = Array.isArray(T) && T.length ? T : defThemes();
  S.themeId = (await dbGet('themeId')) || S.themes[0].id;
  if (!S.themes.some((t) => t.id === S.themeId)) S.themeId = S.themes[0].id;
  S.cfg = { ...defCfg(), ...((await dbGet('cfg')) || {}) };
  S.sync = { ...defSync(), ...((await dbGet('sync')) || {}) };
  S.sync.scope = { ...defSync().scope, ...(S.sync.scope || {}) };
  const L2 = await dbGet('dsList');
  if (Array.isArray(L2)) S.dsList = L2.filter((d) => d && d.rows).map((d) => buildDs(d, d.name, d.keyCol, d.id, d.updatedAt));
  else {
    const old = await dbGet('ds');   // migrasi dari versi 1 CSV
    if (old && old.rows) S.dsList = [buildDs(old, old.name, old.keyCol)];
  }
  S.dsActive = (await dbGet('dsActive')) || (S.dsList[0] && S.dsList[0].id) || null;
  if (!S.dsList.some((d) => d.id === S.dsActive)) S.dsActive = S.dsList[0] ? S.dsList[0].id : null;
  for (const t of S.themes) { if (t.dsId === undefined) t.dsId = ''; if (t.opacity === undefined) t.opacity = 100; }
  S.ver++;
}

export const theme = () => S.themes.find((t) => t.id === S.themeId) || S.themes[0];
export const layerById = (id) => S.layers.find((l) => l.id === id);

// ---------------- dataset ----------------
export function buildDs(parsed, name, keyCol, id, updatedAt) {
  const hmap = {};
  parsed.headers.forEach((h) => { hmap[h.toLowerCase().trim()] = h; });
  const ds = { id: id || 'd' + uid(), name, headers: parsed.headers, rows: parsed.rows, delimiter: parsed.delimiter, hmap, keyCol: keyCol || parsed.headers[0], map: new Map(), updatedAt: updatedAt || Date.now() };
  indexDs(ds);
  return ds;
}
// tambah dataset; bila nama sama sudah ada -> isinya diganti (id tetap)
export function putDataset(ds) {
  const i = S.dsList.findIndex((d) => d.name.toLowerCase() === ds.name.toLowerCase());
  if (i >= 0) { ds.id = S.dsList[i].id; S.dsList[i] = ds; } else S.dsList.push(ds);
  S.dsActive = ds.id;
  return ds;
}
export function removeDataset(id) {
  S.dsList = S.dsList.filter((d) => d.id !== id);
  for (const t of S.themes) if (t.dsId === id) t.dsId = '';
  if (S.dsActive === id) S.dsActive = S.dsList[0] ? S.dsList[0].id : null;
}
export function indexDs(ds) {
  ds.map = new Map();
  for (const r of ds.rows) {
    const k = normKey(r[ds.keyCol]);
    if (k && !ds.map.has(k)) ds.map.set(k, r);
  }
}
export function getField(row, name) {
  if (!row || !name) return undefined;
  if (name in row) return row[name];
  const k = S.ds && S.ds.hmap[String(name).toLowerCase().trim()];
  return k !== undefined ? row[k] : undefined;
}
const getProp = (props, name) => {
  if (!props) return undefined;
  if (name in props) return props[name];
  const lc = String(name).toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lc) return props[k];
  return undefined;
};

// tebak kolom kunci: kolom CSV yang paling banyak cocok dengan kode blok di layer bertema
export function autoKeyCol(ds) {
  const keys = new Set();
  for (const l of S.layers) {
    const rt = S.rt.get(l.id);
    if (l.themed && rt && rt.feats) for (const f of rt.feats) keys.add(normKey(getProp(f.props, l.keyField)));
  }
  if (!keys.size) return ds.headers[0];
  let best = ds.headers[0], bn = -1;
  for (const h of ds.headers) {
    let n = 0; for (const r of ds.rows) if (keys.has(normKey(r[h]))) n++;
    if (n > bn) { bn = n; best = h; }
  }
  return best;
}

// ---------------- layer runtime ----------------
export async function loadLayer(meta) {
  let rt = S.rt.get(meta.id);
  if (rt) return rt.promise;
  rt = { feats: null };
  rt.promise = (async () => {
    let obj;
    if (meta.src === 'asset') {
      const r = await fetch(meta.url);
      if (!r.ok) throw new Error('Gagal memuat ' + meta.url);
      obj = await r.json();
    } else obj = await dbGet('geo:' + meta.id);
    if (!obj) throw new Error('Data layer tidak ditemukan: ' + meta.name);
    rt.feats = G.parseGeoJSON(obj);
    rt.bbox = bboxOf(rt.feats);
    meta._kind = rt.feats.some((f) => f.polys) ? 'poly' : rt.feats.some((f) => f.lines) ? 'line' : 'point';
    return rt;
  })();
  S.rt.set(meta.id, rt);
  try { await rt.promise; } catch (e) { S.rt.delete(meta.id); throw e; }
  return rt;
}
export function bboxOf(feats) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of feats) { if (f.bbox[0] < b[0]) b[0] = f.bbox[0]; if (f.bbox[1] < b[1]) b[1] = f.bbox[1]; if (f.bbox[2] > b[2]) b[2] = f.bbox[2]; if (f.bbox[3] > b[3]) b[3] = f.bbox[3]; }
  return b;
}
export async function addImportedLayer(name, geojson, extra) {
  const id = 'u_' + uid();
  await dbSet('geo:' + id, geojson);
  const kinds = new Set();
  for (const f of geojson.features) { const t = f.geometry && f.geometry.type || ''; kinds.add(/Polygon/.test(t) ? 'poly' : /Line/.test(t) ? 'line' : 'point'); }
  const isPoly = kinds.has('poly');
  const palette = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f9a825', '#6d4c41'];
  const col = palette[S.layers.length % palette.length];
  const keys = geojson.features[0] && geojson.features[0].properties ? Object.keys(geojson.features[0].properties) : [];
  const meta = {
    id, name, src: 'idb', visible: true, themed: false, keyField: keys.find((k) => /blok|block|kode|code|id/i.test(k)) || keys[0] || '',
    style: { stroke: isPoly ? '#000000' : col, strokeWidth: isPoly ? 0.8 : 1.4, fill: isPoly ? col : null, fillOpacity: 0.35, dash: '', pointRadius: 4, pointColor: col, ...LBL },
    legend: { show: true, group: 'Lapisan', label: name, symbol: isPoly ? 'box' : kinds.has('line') ? 'line' : 'dot' }, ...(extra || {}),
  };
  S.layers.push(meta);
  await loadLayer(meta);
  S.ver++; saveSoon(); emit('layers');
  return meta;
}
export async function removeLayer(id) {
  const i = S.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  S.layers.splice(i, 1); S.rt.delete(id);
  await dbDel('geo:' + id);
  S.ver++; saveSoon(); emit('layers');
}

// ---------------- aturan & kelas ----------------
const reCache = new Map();
function re(v) { let r = reCache.get(v); if (!r) { try { r = new RegExp(v, 'i'); } catch (e) { r = /$^/; } reCache.set(v, r); } return r; }
const isBlank = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' || s === '-' || s.startsWith('#'); };

export function matchRule(r, row, props) {
  let v;
  if (r.source === 'poly') v = getProp(props, r.field);
  else { if (!row) return false; v = getField(row, r.field); }
  if (v === undefined) return false;
  const s = String(v == null ? '' : v).trim(), a = s.toLowerCase(), b = String(r.value == null ? '' : r.value).trim().toLowerCase();
  switch (r.op) {
    case 'equals': return a === b;
    case 'notequals': return a !== b;
    case 'contains': return a.includes(b);
    case 'startsWith': return a.startsWith(b);
    case 'endsWith': return a.endsWith(b);
    case 'regex': return re(r.value).test(s);
    case 'empty': return isBlank(v);
    case 'notempty': return !isBlank(v);
    case 'gt': { const x = num(v), y = num(r.value); return x != null && y != null && x > y; }
    case 'gte': { const x = num(v), y = num(r.value); return x != null && y != null && x >= y; }
    case 'lt': { const x = num(v), y = num(r.value); return x != null && y != null && x < y; }
    case 'lte': { const x = num(v), y = num(r.value); return x != null && y != null && x <= y; }
  }
  return false;
}

// opasitas isi: opasitas tema x opasitas kelas (0..1)
export function alphaOf(t, c) {
  const a = (t.opacity == null || t.opacity === '' ? 100 : Number(t.opacity)) / 100;
  const b = (c && c.opacity != null && c.opacity !== '' ? Number(c.opacity) : 100) / 100;
  return Math.max(0, Math.min(1, a * b));
}

export function noDataStyle(t) {
  const nd = t.noData || {};
  return { fill: nd.transparent ? null : (nd.fill || '#ffffff'), pattern: 'none', pc: '#000', ci: -1, rule: null };
}

// aturan mode "overlay": arsiran di atas warna kelas tema (warna tema tetap)
export function resolveStyle(t, row, props) {
  const base = resolveBase(t, row, props);
  if (base.rule) return base;
  let ov = null;
  for (const r of t.rules || []) {
    if (r.enabled === false || r.mode !== 'overlay') continue;
    if (matchRule(r, row, props)) { (ov = ov || []).push({ pattern: r.pattern || 'diag', pc: r.pc || '#000000', alpha: alphaOf(t, r), rule: r.id }); }
  }
  if (ov) base.over = ov;
  return base;
}
function resolveBase(t, row, props) {
  for (const r of t.rules || []) {
    if (r.enabled === false || r.mode === 'overlay') continue;
    if (matchRule(r, row, props)) return { fill: r.noFill ? null : r.fill, pattern: r.pattern || 'none', pc: r.pc, ci: -1, rule: r.id, alpha: alphaOf(t, r) };
  }
  if (!row) return noDataStyle(t);
  const raw = getField(row, t.field);
  if (raw === undefined) return noDataStyle(t);
  const cls = t.classes || [];
  if (t.mode === 'category') {
    const val = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!val || val.startsWith('#')) return noDataStyle(t);
    for (let i = 0; i < cls.length; i++) {
      const vs = String(cls[i].values || '').split(/[;,|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (vs.includes(val) || vs.includes('*')) return { fill: cls[i].color, pattern: cls[i].pattern || 'none', pc: cls[i].pc, ci: i, rule: null, alpha: alphaOf(t, cls[i]) };
    }
    return noDataStyle(t);
  }
  let v = num(raw);
  if (v == null) return noDataStyle(t);
  v *= (t.scale == null || t.scale === '' ? 1 : Number(t.scale));
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    const lo = c.min === null || c.min === '' || c.min === undefined, hi = c.max === null || c.max === '' || c.max === undefined;
    if ((lo || v >= Number(c.min)) && (hi || v < Number(c.max))) return { fill: c.color, pattern: c.pattern || 'none', pc: c.pc, ci: i, rule: null, alpha: alphaOf(t, c) };
  }
  return noDataStyle(t);
}

// ---------------- filter peta (per tema) ----------------
const lcs = (v) => String(v == null ? '' : v).trim().toLowerCase();
export const filterActive = (t) => { t = t || theme(); const f = t && t.filter; return !!f && !!((f.estates && f.estates.length) || (f.afds && f.afds.length) || (f.conds && f.conds.length)); };
export const filterHides = (t) => { t = t || theme(); return filterActive(t) && (t.filter.mode || 'hide') === 'hide'; };
export const filterDims = (t) => { t = t || theme(); return filterActive(t) && t.filter.mode === 'dim'; };
const fctx = { v: -1, t: '', c: null };
function filterCtx() {
  if (fctx.v === S.ver && fctx.t === S.themeId && fctx.c) return fctx.c;
  const f = theme().filter || {};
  const est = new Set((f.estates || []).map(lcs)), afd = new Set((f.afds || []).map(lcs));
  const afdEst = new Map();
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    for (const x of rt.feats) {
      const e = lcs(getProp(x.props, 'Estate')), a = lcs(getProp(x.props, 'Afdeling'));
      if (!a) continue;
      if (!afdEst.has(a)) afdEst.set(a, new Set());
      afdEst.get(a).add(e);
    }
  }
  const eff = new Set(est);
  for (const a of afd) for (const e of afdEst.get(a) || []) eff.add(e);
  fctx.v = S.ver; fctx.t = S.themeId; fctx.c = { est, afd, eff, afdEst, conds: (f.conds || []).filter((c) => c && c.field) };
  return fctx.c;
}
function estAfdOk(c, props) {
  if (c.est.size && !c.est.has(lcs(getProp(props, 'Estate')))) return false;
  if (c.afd.size && !c.afd.has(lcs(getProp(props, 'Afdeling')))) return false;
  return true;
}
// true bila fitur lolos filter tema aktif
export function featPass(meta, f) {
  if (!filterActive()) return true;
  const c = filterCtx();
  if (meta.themed) {
    if (!estAfdOk(c, f.props)) return false;
    for (const q of c.conds) if (!matchRule(q, f._row, f.props)) return false;
    return true;
  }
  switch (meta.id) {
    case 'rendahan': return estAfdOk(c, f.props);
    case 'batas_estate': return !c.eff.size || c.eff.has(lcs(getProp(f.props, 'Estate')));
    case 'label_estate': return !c.eff.size || c.eff.has(lcs(getProp(f.props, 'Nama')));
    case 'batas_afdeling': case 'label_afdeling': {
      const a = lcs(getProp(f.props, meta.id === 'label_afdeling' ? 'Nama' : 'Afdeling'));
      if (c.afd.size) return c.afd.has(a);
      if (c.est.size) { for (const e of c.afdEst.get(a) || []) if (c.est.has(e)) return true; return false; }
      return true;
    }
  }
  return true;
}
// lapisan non-tema: hitung bendera _pass (lapisan bertema dihitung di ensureStyles)
export function ensurePass(meta, feats) {
  if (meta._fv === S.ver && meta._ft === S.themeId) return;
  const on = filterActive();
  for (const f of feats) f._pass = on ? featPass(meta, f) : true;
  meta._fv = S.ver; meta._ft = S.themeId;
}
export function filterNote(t) {
  t = t || theme();
  if (!filterActive(t) || !t.filter.titleNote) return '';
  const f = t.filter, parts = [];
  if (f.estates && f.estates.length) parts.push('Estate: ' + f.estates.join(', '));
  if (f.afds && f.afds.length) parts.push('Afdeling: ' + f.afds.join(', '));
  const OPN = { equals: '=', notequals: '≠', contains: 'mengandung', startsWith: 'diawali', endsWith: 'diakhiri', regex: '~', empty: 'kosong', notempty: 'terisi', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  for (const q of f.conds || []) if (q && q.field) parts.push(`${q.field} ${OPN[q.op] || q.op}${q.op === 'empty' || q.op === 'notempty' ? '' : ' ' + q.value}`);
  return parts.join(' · ');
}
export function filterSummary(t) {
  return filterNote(Object.assign({}, t || theme(), { filter: Object.assign({}, (t || theme()).filter, { titleNote: true }) }));
}

export function ensureStyles(meta, feats) {
  if (meta._sv === S.ver && meta._st === S.themeId) return;
  const t = theme();
  let dups = null;
  if (S.cfg && S.cfg.ignoreDup !== false) {
    const cnt = new Map(); dups = new Set();
    for (const f of feats) { if (!f.polys) continue; const k = normKey(getProp(f.props, meta.keyField)); if (!k) continue; if (cnt.has(k)) dups.add(k); else cnt.set(k, 1); }
  }
  for (const f of feats) {
    const key = normKey(getProp(f.props, meta.keyField));
    const row = S.ds && !(dups && dups.has(key)) ? S.ds.map.get(key) || null : null;
    f._dup = !!(dups && dups.has(key));
    f._row = row;
    f._style = resolveStyle(t, row, f.props);
  }
  const on = filterActive(t);
  for (const f of feats) f._pass = on ? featPass(meta, f) : true;
  meta._sv = S.ver; meta._st = S.themeId;
}

// statistik: jumlah blok per kelas, kecocokan CSV <-> poligon
export function computeStats() {
  const t = theme();
  const st = { classCounts: t.classes.map(() => 0), ruleCounts: {}, nodata: 0, polys: 0, matchedPolys: 0, rowsUsed: new Set(), polysNoRow: [], rowsNoPoly: [] };
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id);
    if (!rt || !rt.feats) continue;
    ensureStyles(l, rt.feats);
    for (const f of rt.feats) {
      if (!f.polys) continue;
      if (f._row) st.rowsUsed.add(f._row);
      st.total = (st.total || 0) + 1;
      if (f._pass === false) continue;
      st.pass = (st.pass || 0) + 1;
      st.polys++;
      const s = f._style;
      if (f._row) { st.matchedPolys++; } else if (!s.rule) st.polysNoRow.push(String(getProp(f.props, l.keyField)));
      if (s.over) for (const o of s.over) st.ruleCounts[o.rule] = (st.ruleCounts[o.rule] || 0) + 1;
      if (s.rule) st.ruleCounts[s.rule] = (st.ruleCounts[s.rule] || 0) + 1;
      else if (s.ci >= 0) st.classCounts[s.ci]++;
      else st.nodata++;
    }
  }
  if (S.ds) for (const r of S.ds.rows) if (!st.rowsUsed.has(r) && normKey(r[S.ds.keyCol])) st.rowsNoPoly.push(r[S.ds.keyCol]);
  return st;
}

// teks label dari template
export function labelLines(t, row, props) {
  const tpl = (t.label && t.label.template) || '';
  if (!tpl) return [];
  return tpl.split('\n').map((line) => line.replace(/\{([^}]+)\}/g, (_, k) => {
    k = k.trim();
    let v;
    if (k.startsWith('@')) v = getProp(props, k.slice(1));
    else { v = row ? getField(row, k) : undefined; if (v === undefined && k.toLowerCase() === 'blok') v = getProp(props, 'Blok'); }
    return v == null ? '' : String(v).trim();
  }).trim()).filter((s) => s !== '' && s !== '-');
}

export { getProp };
