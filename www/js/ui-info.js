// Kartu info blok yang rapi: header, angka utama, grup detail dengan grafik mini
import { buildTables, tableSourceCols } from './ui-tables.js';
import { buildCharts } from './ui-charts.js';
import { S, theme, getProp, getField, afdCombined, afdDatasets } from './model.js';
import { h, num, toast } from './util.js';

const METRICS = ['Yld', 'YOY', 'BBC3', 'BBC3S', 'std.S3', 'AP', 'Evaluasi'];
const HIDE_EMPTY = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' || s === '-' || s.startsWith('#'); };

function contrast(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#16201b';
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#16201b' : '#ffffff';
}

function classInfo(th, s) {
  if (!s) return null;
  if (s.rule) { const r = (th.rules || []).find((x) => x.id === s.rule); return { label: r ? (r.legendLabel || 'Aturan khusus') : 'Aturan khusus', color: s.fill || '#e5ebe8', pattern: s.pattern }; }
  if (s.ci >= 0 && th.classes[s.ci]) return { label: th.classes[s.ci].label, color: th.classes[s.ci].color };
  return { label: 'Tanpa data', color: '#e5ebe8' };
}

export function summaryText(layer, feat) {
  const th = theme(), row = feat._row;
  const blok = getProp(feat.props, layer.keyField) || '';
  const lines = [`Blok ${blok}` + (feat.props && feat.props.Estate ? ` (${feat.props.Estate}${feat.props.Afdeling ? ' · ' + feat.props.Afdeling : ''})` : '')];
  const ci = classInfo(th, feat._style); if (ci) lines.push(`${th.name}: ${ci.label}`);
  if (row) for (const [k, v] of Object.entries(row)) { if (!HIDE_EMPTY(v) && k !== (S.ds && S.ds.keyCol)) lines.push(`${k}: ${String(v).trim()}`); }
  return lines.join('\n');
}

async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast('Data blok disalin'); }
  catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Data blok disalin'); } catch (e2) { toast('Gagal menyalin'); }
    ta.remove();
  }
}

export function buildBlockCard(layer, feat) {
  const th = theme(), row = feat._row, props = feat.props || {};
  const blok = getProp(props, layer.keyField) || layer.name;
  const ci = classInfo(th, feat._style);
  const card = h('div', { class: 'ic' });

  // header
  const hd = h('div', { class: 'ic-hd' });
  hd.append(h('div', { class: 'ic-code' }, String(blok)));
  const badges = h('div', { class: 'ic-badges' });
  if (props.Estate) badges.append(h('span', { class: 'bdg' }, String(props.Estate)));
  if (props.Afdeling) badges.append(h('span', { class: 'bdg' }, String(props.Afdeling)));
  if (feat._style && feat._style.over) for (const o of feat._style.over) { const r = (th.rules || []).find((x) => x.id === o.rule); badges.append(h('span', { class: 'bdg dark' }, r ? (r.legendLabel || 'Aturan') : 'Aturan')); }
  if (row) for (const k of ['Status', 'LA']) { const v = getField(row, k); if (!HIDE_EMPTY(v)) badges.append(h('span', { class: 'bdg dark' }, k === 'LA' ? 'LA' : `${k}: ${String(v).trim()}`)); }
  hd.append(badges);
  card.append(hd);
  if (ci) card.append(h('div', { class: 'ic-class', style: { background: ci.color, color: contrast(ci.color) } }, h('small', {}, th.legendTitle || th.name), h('b', {}, ci.label)));

  if (!row) {
    card.append(h('div', { class: 'ic-none' }, S.ds ? 'Tidak ada baris CSV untuk blok ini.' : 'Belum ada CSV diimpor (tab Data).'));
  } else {
    const key = S.ds && S.ds.keyCol;
    // angka utama
    const used = new Set([key, 'Status', 'LA']);
    const mcols = [];
    const first = th.field && S.ds && S.ds.hmap[String(th.field).toLowerCase().trim()];
    if (first) mcols.push(first);
    for (const m of METRICS) { const c = S.ds.hmap[m.toLowerCase()]; if (c && !mcols.includes(c)) mcols.push(c); }
    for (const tb of buildTables(th, row, props, 'top')) card.append(tb);
    const grid = h('div', { class: 'ic-grid' });
    let nm = 0;
    for (const c of mcols) {
      const v = getField(row, c); used.add(c);
      if (HIDE_EMPTY(v)) continue;
      nm++;
      const hl = c === first && ci;
      grid.append(h('div', { class: 'mt' + (hl ? ' hl' : ''), style: hl ? { background: ci.color, color: contrast(ci.color) } : null }, h('small', {}, c), h('b', {}, String(v).trim())));
    }
    if (nm) card.append(grid);

    for (const tb of buildTables(th, row, props, 'rest')) card.append(tb);

    // detail
    const others = S.ds.headers.filter((c) => !used.has(c) && !HIDE_EMPTY(row[c]));
    const tsrc = tableSourceCols(th, S.ds.headers);
    const avail = S.ds.headers.filter((c) => !used.has(c));
    const ch = buildCharts(th, row, avail);
    for (const el of ch.els) card.append(el);
    const rest = ch.rest;
    const rk = rest.filter((c) => !tsrc.has(c) && !HIDE_EMPTY(row[c]));
    if (rk.length) {
      const kv = h('div', { class: 'kv' });
      for (const c of rk) kv.append(h('b', {}, c), h('span', {}, String(row[c]).trim()));
      card.append(h('details', { class: 'ic-sec', open: true }, h('summary', {}, 'Data lainnya'), kv));
    }
    void others;
    card.append(h('div', { class: 'ic-src' }, 'Sumber: ' + (S.ds ? S.ds.name : '')));
  }

  const txt = summaryText(layer, feat);
  card.append(h('div', { class: 'ic-act' },
    h('button', { class: 'btn sec sm', onclick: () => copy(txt) }, 'Salin'),
    h('button', { class: 'btn sec sm', onclick: () => import('./ui-share.js').then((m) => m.openShare(layer, feat)) }, 'Bagikan…')));
  return card;
}


// ---- tab Afdeling: data dari CSV tingkat afdeling untuk afdeling blok yang diketuk ----
export function afdNameOf(feat) { const p = feat.props || {}; return getProp(p, 'Afdeling') || ''; }
export function hasAfdTab(feat) { return afdDatasets().length > 0 && !!afdNameOf(feat); }

export function summaryTextAfd(layer, feat) {
  const ac = afdCombined(afdNameOf(feat)); const p = feat.props || {};
  const lines = [`${afdNameOf(feat)}` + (p.Estate ? ` (${p.Estate})` : '') + ' – data afdeling'];
  if (ac && ac.row) for (const k of ac.headers) { if (k !== ac.keyCol && !HIDE_EMPTY(ac.row[k])) lines.push(`${k}: ${String(ac.row[k]).trim()}`); }
  return lines.join('\n');
}

export function buildAfdCard(layer, feat) {
  const th = theme(), props = feat.props || {}, afd = afdNameOf(feat);
  const ac = afdCombined(afd);
  const card = h('div', { class: 'ic' });
  const hd = h('div', { class: 'ic-hd' }, h('div', { class: 'ic-code' }, String(afd)));
  const badges = h('div', { class: 'ic-badges' });
  if (props.Estate) badges.append(h('span', { class: 'bdg' }, String(props.Estate)));
  badges.append(h('span', { class: 'bdg dark' }, 'Data afdeling'));
  hd.append(badges); card.append(hd);
  if (!ac || !ac.hit) {
    card.append(h('div', { class: 'ic-none' }, `Afdeling "${afd}" tidak ditemukan di CSV afdeling (${ac ? ac.total : 0} file). Pastikan kolom Afd berisi nama yang sama dengan peta (mis. 4, Afd.4, atau AFD04 dianggap sama).`));
  } else {
    for (const tb of buildTables(th, ac.row, props, 'top', ac)) card.append(tb);
    for (const tb of buildTables(th, ac.row, props, 'rest', ac)) card.append(tb);
    const ch = buildCharts(th, ac.row, ac.headers.filter((c) => c !== ac.keyCol), ac);
    for (const el of ch.els) card.append(el);
    const rk = ch.rest.filter((c) => !HIDE_EMPTY(ac.row[c]));
    if (rk.length) {
      const kv = h('div', { class: 'kv' });
      for (const c of rk) kv.append(h('b', {}, c), h('span', {}, String(ac.row[c]).trim()));
      card.append(h('details', { class: 'ic-sec', open: true }, h('summary', {}, 'Data lainnya'), kv));
    }
    if (!ch.els.length && !rk.length && !card.querySelector('.ic-sec')) card.append(h('div', { class: 'ic-none' }, 'Belum ada tabel/grafik untuk data afdeling ini.'));
    card.append(h('div', { class: 'ic-src' }, 'Sumber: ' + ac.names.join(', ')));
  }
  const txt = summaryTextAfd(layer, feat);
  card.append(h('div', { class: 'ic-act' },
    h('button', { class: 'btn sec sm', onclick: () => copy(txt) }, 'Salin'),
    h('button', { class: 'btn sec sm', onclick: () => import('./ui-share.js').then((m) => m.openShare(layer, feat, 'afd')) }, 'Bagikan…')));
  return card;
}

let lastTab = 'blok';
// kartu info dengan sub tab Blok | Afdeling (tab hanya ada bila ada CSV afdeling)
export function buildInfo(layer, feat) {
  const blok = buildBlockCard(layer, feat);
  if (!hasAfdTab(feat)) return blok;
  const wrap = h('div', {});
  const pane = h('div', {});
  let afdCard = null;
  const tabs = h('div', { class: 'ictabs' });
  const show = (k) => {
    lastTab = k;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    pane.innerHTML = '';
    if (k === 'afd') { if (!afdCard) afdCard = buildAfdCard(layer, feat); pane.append(afdCard); } else pane.append(blok);
  };
  for (const [k, l] of [['blok', 'Blok'], ['afd', 'Afdeling']]) tabs.append(h('button', { class: 'ictab', 'data-k': k, onclick: () => show(k) }, l));
  wrap.append(tabs, pane);
  show(lastTab);
  return wrap;
}
