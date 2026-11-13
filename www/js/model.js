// Model data: state global, layer, tema (jenis peta), dataset CSV, resolusi warna
import { num, normKey, uid, clone, dbGet, dbSet, dbDel } from './util.js';
import * as G from './geo.js';

export const VERSION = '1.0';

export const S = {
  layers: [],        // meta layer, urut dari bawah ke atas
  themes: [],
  glob: null,
  themeId: null,
  dsList: [],        // semua dataset CSV
  dsActive: null,    // id dataset yang dipakai tema tanpa pilihan sendiri
  sync: null,        // pengaturan sinkron & pembaruan (tidak ikut disinkronkan)
  cfg: null,         // pengaturan ekspor
  ver: 0,            // naik setiap ada perubahan yang memengaruhi warna
  rt: new Map(),     // runtime layer: id -> {feats}
};

// dataset yang dipakai tema aktif: tema.dsId (satu CSV tertentu); kalau kosong = SEMUA CSV blok digabung per kode blok
const mergedCache = new Map();
function mergeDs(list) {
  const sig = list.map((d) => d.id + ':' + d.rows.length + ':' + (d.updatedAt || '')).join('|');
  const hit = mergedCache.get(sig); if (hit) return hit;
  const first = list[0], kc = first.keyCol;
  const headers = [], seenH = new Set();
  for (const d of list) for (const h of d.headers) if (!seenH.has(h)) { seenH.add(h); headers.push(h); }
  const rows = [], idx = new Map();
  for (const d of list) {
    for (const r of d.rows) {
      const k = normKey(r[d.keyCol]); if (!k) continue;
      const ex = idx.get(k);
      if (!ex) { const n = { ...r }; n[kc] = r[d.keyCol]; idx.set(k, n); rows.push(n); }
      else for (const h of d.headers) if (h !== d.keyCol && (ex[h] === undefined || ex[h] === '')) ex[h] = r[h];
    }
  }
  const m = buildDs({ headers, rows, delimiter: first.delimiter }, list.map((d) => d.name).join(' + '), kc, 'm:' + sig);
  m.parts = list.map((d) => d.id); m.merged = true;
  mergedCache.clear(); mergedCache.set(sig, m);
  return m;
}
export function dsForTheme(t) {
  const all = S.dsList.filter((x) => x.level !== 'afd');   // CSV tingkat afdeling tidak dipakai mewarnai blok
  if (t && t.dsId) { const d = all.find((x) => x.id === t.dsId); if (d) return d; }   // pilihan eksplisit tetap dipakai walau saklarnya mati
  const blk = all.filter((x) => !x.off);
  if (blk.length > 1) {
    // data dari server didahulukan (menang bila bentrok), lalu data buatan pengguna
    return mergeDs([...blk.filter((x) => x.src === 'srv'), ...blk.filter((x) => x.src !== 'srv')]);
  }
  return blk[0] || null;
}
Object.defineProperty(S, 'ds', { get() { return dsForTheme(S.themes.find((t) => t.id === S.themeId) || S.themes[0]); }, enumerable: false });

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(kind) { for (const f of listeners) try { f(kind); } catch (e) { console.error(e); } }
export function bump(kind) { wireAll(); S.ver++; saveSoon(); emit(kind || 'style'); }

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
export const slimDs = (d) => ({ id: d.id, name: d.name, headers: d.headers, rows: d.rows, keyCol: d.keyCol, delimiter: d.delimiter, level: d.level || '', groupCol: d.groupCol || '', off: !!d.off, src: d.src || '', updatedAt: d.updatedAt || 0 });
export const defSync = () => ({ repo: 'mohammadfauzi-mfz/Petaku', branch: 'main', folder: 'sync', token: '', lastManifest: '', lastPull: 0, scope: { data: true, themes: true, layers: true, cfg: false }, lastUpdateCheck: 0 });
export async function saveNow() {
  try {
    await dbSet('layers', S.layers.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('_')))));
    wireAll();
    await dbSet('themes', S.themes);
    await dbSet('glob', S.glob);
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
  S.glob = (await dbGet('glob')) || null;
  S.themeId = (await dbGet('themeId')) || S.themes[0].id;
  if (!S.themes.some((t) => t.id === S.themeId)) S.themeId = S.themes[0].id;
  S.cfg = { ...defCfg(), ...((await dbGet('cfg')) || {}) };
  S.sync = { ...defSync(), ...((await dbGet('sync')) || {}) };
  S.sync.scope = { ...defSync().scope, ...(S.sync.scope || {}) };
  const L2 = await dbGet('dsList');
  if (Array.isArray(L2)) S.dsList = L2.filter((d) => d && d.rows).map((d) => { const x = buildDs(d, d.name, d.keyCol, d.id, d.updatedAt); x.level = d.level || ''; x.groupCol = d.groupCol || ''; x.off = !!d.off; x.src = d.src || ''; return x; });
  else {
    const old = await dbGet('ds');   // migrasi dari versi 1 CSV
    if (old && old.rows) S.dsList = [buildDs(old, old.name, old.keyCol)];
  }
  S.dsActive = (await dbGet('dsActive')) || (S.dsList[0] && S.dsList[0].id) || null;
  if (!S.dsList.some((d) => d.id === S.dsActive)) S.dsActive = S.dsList[0] ? S.dsList[0].id : null;
  healLevels();
  for (const t of S.themes) { if (t.dsId === undefined) t.dsId = ''; if (t.opacity === undefined) t.opacity = 100; }
  if (!S.cfg.mergeMig) {
    S.cfg.mergeMig = 1;
    const blk = S.dsList.filter((x) => x.level !== 'afd'), big = Math.max(0, ...blk.map((x) => x.rows.length));
    if (blk.length > 1) for (const t of S.themes) { const d = blk.find((x) => x.id === t.dsId); if (d && d.rows.length < big * 0.5) t.dsId = ''; }
  }
  wireAll();
  S.ver++;
}

export const theme = () => { wireAll(); return S.themes.find((t) => t.id === S.themeId) || S.themes[0]; };

// ---- pengaturan GLOBAL: tabel info lokasi, grafik info lokasi, aturan khusus/arsiran = satu untuk semua tema ----
const GKEYS = ['tables', 'charts', 'rules'];
const tabKey = (t) => (t.title || '') + '|' + (t.kind || '');
export function wireAll() {
  const own = (t, k) => { const d = Object.getOwnPropertyDescriptor(t, k); return d && 'value' in d && Array.isArray(d.value) ? d.value : null; };
  if (!S.glob) {
    S.glob = {};
    const act = S.themes.find((t) => t.id === S.themeId) || S.themes[0];
    const order = [act, ...S.themes.filter((t) => t !== act)].filter(Boolean);
    for (const k of GKEYS) {
      const out = [], seen = new Set();
      for (const t of order) for (const it of own(t, k) || []) {
        const key = k === 'charts' ? it.key : k === 'tables' ? tabKey(it) : it.id;
        if (key != null && seen.has(key)) continue; if (key != null) seen.add(key);
        out.push(it);
      }
      if (out.length || order.some((t) => own(t, k))) S.glob[k] = out;
    }
  }
  if (!Array.isArray(S.glob.charts)) S.glob.charts = [];
  if (!Array.isArray(S.glob.rules)) S.glob.rules = [];
  for (const t of S.themes) {
    for (const k of GKEYS) {
      const d = Object.getOwnPropertyDescriptor(t, k);
      if (d && d.get) continue;
      Object.defineProperty(t, k, { get() { return S.glob[k]; }, set(v) { S.glob[k] = v; }, enumerable: false, configurable: true });
    }
  }
}
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
  const i = S.dsList.findIndex((d) => d.name.toLowerCase() === ds.name.toLowerCase() && (d.src === 'srv') === (ds.src === 'srv'));   // CSV pengguna tidak menimpa CSV dari server
  if (i >= 0) { ds.id = S.dsList[i].id; S.dsList[i] = ds; } else S.dsList.push(ds);
  if (ds.level !== 'afd') S.dsActive = ds.id;
  return ds;
}
// ---- CSV tingkat afdeling ----
const AFD_HDR = /^(afd|afdeling)\b/i;
// perbaiki penanda tingkat CSV yang salah (mis. CSV lama berisi afdeling yang dulu terbaca sebagai CSV blok, atau CSV blok besar yang salah ditandai afdeling)
export function healLevels() {
  let n = 0;
  for (const d of S.dsList) {
    if (d.level === 'afd' && d.groupCol === undefined) d.groupCol = detectGroupCol(d);
    const afdLike = AFD_HDR.test(String(d.headers[0] || '').trim());
    if (d.level !== 'afd' && afdLike && d.rows.length <= 100) { d.level = 'afd'; d.keyCol = afdKeyCol(d); indexDs(d); n++; }
    else if (d.level === 'afd' && !afdLike && !d.headers.some((x) => AFD_HDR.test(String(x).trim())) && d.rows.length > 100) { d.level = ''; d.keyCol = autoKeyCol(d); indexDs(d); n++; }
  }
  if (n) { const blk = S.dsList.filter((x) => x.level !== 'afd'); if (!blk.some((x) => x.id === S.dsActive)) S.dsActive = blk[0] ? blk[0].id : null; }
  return n;
}
export const afdDatasets = () => S.dsList.filter((d) => d.level === 'afd' && !d.off);
// samakan penulisan afdeling: "Afd.04", "AFD 4", "Afdeling 4" -> "4"; "KT 1.1" -> "kt1.1"
export function afdKey(v) {
  let t = String(v == null ? '' : v).trim().toLowerCase();
  t = t.replace(/^(afdeling|afd)[\s._\-:]*/, '').replace(/\s+/g, '');
  if (/^0*\d+$/.test(t)) t = String(parseInt(t, 10));
  return t;
}
// kolom kunci afdeling: header "Afd"/"Afdeling", kalau tidak ada kolom pertama
export const afdKeyCol = (ds) => ds.headers.find((h) => /^(afd|afdeling)\b/i.test(String(h).trim())) || ds.headers[0];
// kolom pengelompokan (mis. KELAS): satu afdeling punya beberapa baris. Otomatis bila nama kolom KELAS/CLASS/GRUP atau kunci afdeling berulang.
export function detectGroupCol(ds) {
  const kc = afdKeyCol(ds);
  const byName = ds.headers.find((h) => h !== kc && /^(kelas|class|grup|group|kategori)$/i.test(String(h).trim()));
  if (byName) return byName;
  const seen = new Set(); let dup = false;
  for (const r of ds.rows) { const k = afdKey(r[kc]); if (!k) continue; if (seen.has(k)) { dup = true; break; } seen.add(k); }
  if (!dup) return '';
  for (const h of ds.headers) { if (h === kc) continue; const vals = new Set(ds.rows.map((r) => String(r[h] == null ? '' : r[h]).trim()).filter(Boolean)); if (vals.size > 1 && vals.size <= 8 && [...vals].every((v) => isNaN(parseFloat(v)))) return h; }
  return '';
}
export function afdRows(ds, name) {
  const kc = afdKeyCol(ds), k = afdKey(name);
  return ds.rows.filter((r) => afdKey(r[kc]) === k);
}
export function afdRow(ds, name) {
  if (!ds._amap || ds._amapN !== ds.rows.length) {
    ds._amap = new Map(); const kc = afdKeyCol(ds);
    for (const r of ds.rows) { const k = afdKey(r[kc]); if (k && !ds._amap.has(k)) ds._amap.set(k, r); }
    ds._amapN = ds.rows.length;
  }
  return ds._amap.get(afdKey(name)) || null;
}
// gabungan semua CSV afdeling untuk satu afdeling -> {row, headers, hmap, rows:[row], names, miss}; null bila tidak ada CSV afdeling
export function afdCombined(afdName) {
  const list = afdDatasets(); if (!list.length) return null;
  const row = {}, headers = [], hmap = {}, names = [], groups = new Map(); let hit = 0;
  for (const d of list) {
    if (d.groupCol) {   // beberapa baris per afdeling (mis. kelas A-D)
      const rs = afdRows(d, afdName); if (!rs.length) continue;
      hit++; names.push(d.name);
      const rowsBy = {}, order = [];
      for (const r of rs) { const g = String(r[d.groupCol] == null ? '' : r[d.groupCol]).trim(); if (!g) continue; if (!(g in rowsBy)) { rowsBy[g] = r; order.push(g); } }
      groups.set(d.id, { ds: d, rows: rowsBy, keys: order.sort(), headers: d.headers.filter((x) => x !== afdKeyCol(d) && x !== d.groupCol) });
      continue;
    }
    const r = afdRow(d, afdName); if (!r) continue;
    hit++; names.push(d.name);
    const kc = afdKeyCol(d);
    for (const hd of d.headers) { if (hd === kc && headers.includes(hd)) continue; if (!(hd in row)) { headers.push(hd); hmap[String(hd).toLowerCase().trim()] = hd; } row[hd] = r[hd]; }
  }
  return { row: hit ? row : null, groups, headers, hmap, rows: hit ? [row] : [], names, keyCol: list[0] ? afdKeyCol(list[0]) : '', total: list.length, hit, id: '_afd' };
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
export const hooks = { calc: null };
export function fieldValue(t, row) {
  if (t && t.calc && t.calc.on && hooks.calc) return hooks.calc(t, row);
  return getField(row, t && t.field);
}
export function getField(row, name, ds) {
  if (!row || !name) return undefined;
  if (name in row) return row[name];
  ds = ds || S.ds;
  const k = ds && ds.hmap[String(name).toLowerCase().trim()];
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

// aturan = syarat utama + syarat tambahan r.and (semua harus terpenuhi).
// Tiap syarat boleh memakai CSV tertentu (dsId) selain CSV tema; baris dicari lewat kode blok (key).
export function matchRule(r, row, props, key) {
  if (!condMatch(r, row, props, key)) return false;
  if (r.and) for (const q of r.and) if (q && q.field && !condMatch(q, row, props, key)) return false;
  return true;
}
function condMatch(r, row, props, key) {
  let v;
  if (r.source === 'poly') v = getProp(props, r.field);
  else {
    let rw = row, ds = null;
    if (r.dsId) {
      ds = S.dsList.find((x) => x.id === r.dsId);
      if (!ds) return false;
      rw = key ? ds.map.get(key) || null : null;
    }
    if (!rw) return false;
    v = getField(rw, r.field, ds);
  }
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
export function resolveStyle(t, row, props, key) {
  const base = resolveBase(t, row, props, key);
  if (base.rule) return base;
  let ov = null;
  for (const r of t.rules || []) {
    if (r.enabled === false || r.mode !== 'overlay') continue;
    if (matchRule(r, row, props, key)) { (ov = ov || []).push({ pattern: r.pattern || 'diag', pc: r.pc || '#000000', alpha: alphaOf(t, r), rule: r.id }); }
  }
  if (ov) base.over = ov;
  return base;
}
function resolveBase(t, row, props, key) {
  for (const r of t.rules || []) {
    if (r.enabled === false || r.mode === 'overlay') continue;
    if (matchRule(r, row, props, key)) return { fill: r.noFill ? null : r.fill, pattern: r.pattern || 'none', pc: r.pc, ci: -1, rule: r.id, alpha: alphaOf(t, r) };
  }
  if (!row) return noDataStyle(t);
  const raw = fieldValue(t, row);
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
  v *= (t.calc && t.calc.on) || t.scale == null || t.scale === '' ? 1 : Number(t.scale);
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
    const key = normKey(getProp(f.props, meta.keyField));
    for (const q of c.conds) if (!matchRule(q, f._row, f.props, key)) return false;
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
  // kelompokkan poligon berkode sama (blok kembar)
  const grp = new Map();
  for (const f of feats) {
    if (!f.polys) continue;
    const k = normKey(getProp(f.props, meta.keyField)); if (!k) continue;
    const sig = String(getProp(f.props, 'Estate') || '') + '|' + String(getProp(f.props, 'Afdeling') || '');
    const g = grp.get(k) || { n: 0, sig: new Set() }; g.n++; g.sig.add(sig); grp.set(k, g);
  }
  const ign = !(S.cfg && S.cfg.ignoreDup === false);
  for (const f of feats) {
    const key = normKey(getProp(f.props, meta.keyField));
    const g = grp.get(key), isDup = !!(g && g.n > 1);
    const any = S.ds ? S.ds.map.get(key) || null : null;
    f._dup = ign && isDup;                       // pewarnaan: kembar diabaikan (tanpa data)
    f._row = f._dup ? null : any;
    f._rowAll = any;                             // baris CSV apa adanya (dipakai rekap, dihitung sekali per baris)
    f._dupSame = isDup && g.sig.size === 1;      // kembar di estate+afdeling yang sama = satu blok terbagi
    f._style = resolveStyle(t, f._row, f.props, key);
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
