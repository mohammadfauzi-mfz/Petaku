// Kartu info blok yang rapi: header, angka utama, grup detail dengan grafik mini
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

// ---------- data bulanan ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MNAME = '(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|agt|aug(?:ust)?|ags|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)';
const SEP = '[\\s_\\-./]*';
const RE_NAME = new RegExp('^(.*?)' + SEP + MNAME + SEP + '(\\d{2}|\\d{4})?$', 'i');       // BJR Jan, BJR Jan 25, BJR_Januari_2025
const RE_YM = new RegExp('^(.*?)' + SEP + '(20\\d{2})' + SEP + '(0?[1-9]|1[0-2])$');            // BJR 2025-01, BJR_2025_1
const RE_MY = new RegExp('^(.*?)' + SEP + '(0?[1-9]|1[0-2])' + SEP + '(20\\d{2})$');            // BJR 01-2025
const yy = (y) => (y == null ? '' : String(y).length === 2 ? '20' + y : String(y));

function parseMonthCol(c) {
  const t = String(c).trim();
  let m = t.match(RE_YM); if (m) return { base: m[1].trim(), year: m[2], mon: +m[3] };
  m = t.match(RE_MY); if (m) return { base: m[1].trim(), year: m[3], mon: +m[2] };
  m = t.match(RE_NAME);
  if (m) { const k = MON[m[2].slice(0, 3).toLowerCase()]; if (k) return { base: m[1].trim(), year: yy(m[3]), mon: k }; }
  return null;
}
// pisahkan kolom bulanan: Map(base -> Map(year -> {mon: kolom}))
function splitMonthly(cols) {
  const bases = new Map(), consumed = new Set();
  for (const c of cols) {
    const p = parseMonthCol(c); if (!p) continue;
    if (!bases.has(p.base)) bases.set(p.base, new Map());
    const yrs = bases.get(p.base); if (!yrs.has(p.year)) yrs.set(p.year, {});
    yrs.get(p.year)[p.mon] = c; 
  }
  // angka 01..12 polos: "BJR 01".."BJR 12" (minimal 6 bulan berbeda, semuanya <= 12)
  const plain = new Map();
  for (const c of cols) { const m = String(c).trim().match(/^(.*?)[\s_\-.]*(0?[1-9]|1[0-2])$/); if (m && /^0?\d+$/.test(m[2]) && (m[2].length === 2 || m[1].trim() !== '')) { const b = m[1].trim(); if (!plain.has(b)) plain.set(b, []); plain.get(b).push({ c, mon: +m[2], raw: m[2] }); } }
  for (const [b, items] of plain) {
    const allTwo = items.every((x) => x.raw.length === 2);
    const distinct = new Set(items.map((x) => x.mon)).size;
    if (allTwo && items.length >= 6 && distinct === items.length && !bases.has(b)) { const mm = {}; for (const x of items) mm[x.mon] = x.c; bases.set(b, new Map([['', mm]])); }
  }
  const out = [];
  for (const [base, yrs] of bases) {
    const n = [...yrs.values()].reduce((a, mm) => a + Object.keys(mm).length, 0);
    if (n < 2) continue;
    for (const mm of yrs.values()) for (const c of Object.values(mm)) consumed.add(c);
    out.push({ base, yrs: [...yrs.entries()].sort((x, y) => x[0].localeCompare(y[0])) });
  }
  return { monthly: out, consumed };
}
function fmtV(v) { const a = Math.abs(v); return a >= 100 ? String(Math.round(v)) : a >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString(); }

function monthChart(yrs, row, max) {
  const wrap = h('div', {});
  const many = yrs.length > 2;
  yrs.forEach(([year, mm], yi) => {
    const vals = []; for (let m = 1; m <= 12; m++) { const c = mm[m]; const raw = c ? getField(row, c) : null; vals.push(c && !HIDE_EMPTY(raw) ? num(raw) : null); }
    const nums = vals.filter((v) => v != null);
    if (!nums.length) return;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const chart = h('div', { class: 'mchart' });
    const H = 64;
    chart.append(h('div', { class: 'avgline', style: { bottom: (14 + Math.max(0, avg) / max * H) + 'px' } }));
    vals.forEach((v, i) => {
      chart.append(h('div', { class: 'mcol' + (v == null ? ' empty' : '') },
        h('span', { class: 'mv' }, v == null ? '' : fmtV(v)),
        h('i', { style: { height: v == null ? '2px' : Math.max(2, Math.abs(v) / max * H) + 'px' } }),
        h('span', { class: 'ml' }, MLAB[i])));
    });
    const cap = `${year || 'Per bulan'} · rata-rata ${fmtV(avg)} · ${nums.length} bulan`;
    if (yrs.length === 1) { wrap.append(h('div', { class: 'mcap' }, cap), chart); }
    else wrap.append(h('details', { class: 'ic-sub', open: !many || yi === yrs.length - 1 }, h('summary', {}, cap), chart));
  });
  return wrap.childNodes.length ? wrap : null;
}

// kelompokkan kolom berakhiran angka/tahun: "Yld 25", "Pupuk 21" -> grup "Yld", "Pupuk"
function groupColumns(cols) {
  const groups = new Map(), rest = [];
  for (const c of cols) {
    const m = String(c).trim().match(/^(.*?)[\s_\-.]*(\d{2,4})$/);
    if (m && m[1]) { const g = m[1].trim(); if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ col: c, tag: m[2] }); } else rest.push(c);
  }
  const grouped = [];
  for (const [g, items] of groups) {
    if (items.length >= 2) grouped.push({ name: g, items });
    else rest.push(items[0].col);
  }
  return { grouped, rest };
}

function bars(items, row) {
  const vals = items.map((it) => ({ tag: it.tag, raw: getField(row, it.col), v: num(getField(row, it.col)) })).filter((x) => !HIDE_EMPTY(x.raw));
  if (!vals.length) return null;
  vals.sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }));
  const nums = vals.map((x) => x.v).filter((v) => v != null);
  const max = nums.length ? Math.max(...nums.map(Math.abs), 1e-9) : 1;
  const box = h('div', { class: 'bars' });
  vals.forEach((x, i) => {
    const w = x.v == null ? 0 : Math.max(2, Math.abs(x.v) / max * 100);
    const prev = i > 0 ? vals[i - 1].v : null;
    const trend = x.v != null && prev != null ? (x.v > prev ? ' ▲' : x.v < prev ? ' ▼' : '') : '';
    box.append(h('div', { class: 'bar' }, h('span', { class: 'bl' }, x.tag), h('span', { class: 'bt' }, h('i', { style: { width: w + '%' } })), h('span', { class: 'bv' }, String(x.raw).trim() + trend)));
  });
  return box;
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

    // detail
    const others = S.ds.headers.filter((c) => !used.has(c) && !HIDE_EMPTY(row[c]));
    const avail = S.ds.headers.filter((c) => !used.has(c));
    const { monthly, consumed } = splitMonthly(avail);
    for (const g of monthly) {
      let max = 1e-9;
      for (const [, mm] of g.yrs) for (const c of Object.values(mm)) { const v = num(getField(row, c)); if (v != null && Math.abs(v) > max) max = Math.abs(v); }
      const ch = monthChart(g.yrs, row, max);
      if (ch) card.append(h('details', { class: 'ic-sec', open: true }, h('summary', {}, g.base || 'Bulanan', h('small', {}, ' per bulan')), ch));
    }
    const { grouped, rest } = groupColumns(avail.filter((c) => !consumed.has(c)));
    for (const g of grouped) {
      const b = bars(g.items, row);
      if (!b) continue;
      card.append(h('details', { class: 'ic-sec', open: g.items.length <= 6 }, h('summary', {}, g.name, h('small', {}, ` ${g.items.length} tahun`)), b));
    }
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
    h('a', { class: 'btn sec sm', href: 'https://wa.me/?text=' + encodeURIComponent(txt), target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, 'Kirim WhatsApp')));
  return card;
}
