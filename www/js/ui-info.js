// Kartu info blok yang rapi: header, angka utama, grup detail dengan grafik mini
import { buildTables, tableSourceCols } from './ui-tables.js';
import { buildCharts } from './ui-charts.js';
import { S, theme, getProp, getField } from './model.js';
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
    const avail = S.ds.headers.filter((c) => !used.has(c) && !tsrc.has(c));
    const ch = buildCharts(th, row, avail);
    for (const el of ch.els) card.append(el);
    const rest = ch.rest;
    const rk = rest.filter((c) => !HIDE_EMPTY(row[c]));
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
