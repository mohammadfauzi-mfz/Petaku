// Grafik info lokasi: otomatis (bulanan & per-tahun) + pengaturan/kustom per tema (th.charts)
import { S, getField, bump, afdCombined } from './model.js';
import { h, num, uid, select, toast } from './util.js';
import { compareTables, outlookValue, onTableView, METRIC_OPT } from './ui-tables.js';
import { zoomable } from './ui-zoom.js';
import { openSheet, confirmBox, textInput, numInput, colorInput, check, row as frow } from './ui-common.js';

// angka CSV: "3,449" = 3449 (ribuan), "15,60" = 15.6 (desimal koma)
function numT(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  const t = String(x).trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return num(t);
}
const HIDE_EMPTY = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' || s === '-' || s.startsWith('#'); };

// ---------- data bulanan ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MNAME = '(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|agt|aug(?:ust)?|ags|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)';
const SEP = '[\\s_\\-./]*';
const RE_NAME = new RegExp('^(.*?)' + SEP + MNAME + SEP + '(\\d{2}|\\d{4})?$', 'i');       // BJR Jan, BJR Jan 25, BJR_Januari_2025
const RE_YM = new RegExp('^(.*?)' + SEP + '(20\\d{2})' + SEP + '(0?[1-9]|1[0-2])$');            // BJR 2025-01, BJR_2025_1
const RE_MY = new RegExp('^(.*?)' + SEP + '(0?[1-9]|1[0-2])' + SEP + '(20\\d{2})$');            // BJR 01-2025
const RE_YN = new RegExp('^(.*?)' + SEP + '(20\\d{2})' + SEP + MNAME + '$', 'i');            // WD 2022_Jan, BJR-2025-Mar
const yy = (y) => (y == null ? '' : String(y).length === 2 ? '20' + y : String(y));

function parseMonthCol(c) {
  const t = String(c).trim();
  let m = t.match(RE_YM); if (m) return { base: m[1].trim(), year: m[2], mon: +m[3] };
  m = t.match(RE_MY); if (m) return { base: m[1].trim(), year: m[3], mon: +m[2] };
  m = t.match(RE_YN); if (m) { const k = MON[m[3].slice(0, 3).toLowerCase()]; if (k) return { base: m[1].trim(), year: m[2], mon: k }; }
  m = t.match(RE_NAME);
  if (m) { const k = MON[m[2].slice(0, 3).toLowerCase()]; if (k) return { base: m[1].trim(), year: yy(m[3]), mon: k }; }
  return null;
}
// pisahkan kolom bulanan: Map(base -> Map(year -> {mon: kolom}))
export function splitMonthly(cols) {
  const bases = new Map(), consumed = new Set();
  for (const c of cols) {
    const p = parseMonthCol(c); if (!p) continue;
    if (!bases.has(p.base)) bases.set(p.base, new Map());
    const yrs = bases.get(p.base); if (!yrs.has(p.year)) yrs.set(p.year, {});
    yrs.get(p.year)[p.mon] = c; 
  }
  // angka 01..12 polos: "BJR 01".."BJR 12" (minimal 6 bulan berbeda, semuanya <= 12)
  const plain = new Map();
  const taken = new Set(); for (const yrs of bases.values()) for (const mm of yrs.values()) for (const c of Object.values(mm)) taken.add(c);
  for (const c of cols) { if (taken.has(c)) continue; const m = String(c).trim().match(/^(.*?)[\s_\-.]*(0?[1-9]|1[0-2])$/); if (m && /^0?\d+$/.test(m[2]) && (m[2].length === 2 || m[1].trim() !== '')) { const b = m[1].trim(); if (!plain.has(b)) plain.set(b, []); plain.get(b).push({ c, mon: +m[2], raw: m[2] }); } }
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
export function fmtV(v) { const a = Math.abs(v); return a >= 100 ? String(Math.round(v)) : a >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString(); }


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

// ---------- daftar grafik ----------
export function chartDescs(headers, extras) {
  const { monthly, consumed } = splitMonthly(headers);
  const descs = monthly.map((g) => ({ key: 'm:' + g.base, type: 'month', title: g.base || 'Bulanan', sub: ' per bulan', yrs: g.yrs }));
  const { grouped, rest } = groupColumns(headers.filter((c) => !consumed.has(c)));
  for (const g of grouped) descs.push({ key: 'g:' + g.name, type: 'items', title: g.name, sub: ` ${g.items.length} tahun`, items: g.items.slice().sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true })) });
  for (const x of extras || []) descs.push(x);
  return { descs, rest };
}
// kolom kustom: "Ton Act 2026, Luas" -> tiap koma = kolom persis, atau awalan (semua kolom yang diawali teks itu)
function customDesc(cfg, headers) {
  if (cfg.mode === 'ratio') {
    const { monthly } = splitMonthly(headers);
    const f = (b) => monthly.find((g) => g.base === b);
    const side = (v) => {
      if (String(v || '').startsWith('col:')) { const c = headers.find((x) => x === v.slice(4)); if (!c) return null; const mm = {}; for (let m = 1; m <= 12; m++) mm[m] = c; return [['', mm]]; }
      const g = f(v); return g ? g.yrs : null;
    };
    const n = { yrs: side(cfg.numBase) }, d = { yrs: side(cfg.denBase) };
    return { key: cfg.key, type: 'ratio', title: cfg.title || 'Rasio bulanan', sub: ' per bulan', num: n.yrs, den: d.yrs, mult: cfg.mult == null || cfg.mult === '' ? 1 : +cfg.mult, custom: true };
  }
  const items = [], seen = new Set();
  const toks = String(cfg.cols || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
  for (const tk of toks) {
    const low = tk.toLowerCase();
    const ex = headers.find((x) => String(x).trim().toLowerCase() === low);
    if (ex) { if (!seen.has(ex)) { seen.add(ex); items.push({ col: ex, tag: String(ex).trim() }); } continue; }
    for (const x of headers) {
      const xs = String(x).trim();
      if (xs.toLowerCase().startsWith(low) && !seen.has(x)) { seen.add(x); items.push({ col: x, tag: xs.slice(tk.length).replace(/^[\s_\-.:]+/, '') || xs }); }
    }
  }
  return { key: cfg.key, type: 'items', title: cfg.title || 'Grafik', sub: items.length ? ` ${items.length} data` : ' (kolom belum cocok)', items, custom: true };
}
export function resolveCharts(th, headers, extras) {
  const { descs, rest } = chartDescs(headers || [], extras);
  const ov = th.charts || [], list = [], used = new Set();
  for (const o of ov) {
    if (o.custom) list.push({ cfg: o, desc: customDesc(o, headers || []) });
    else { const d = descs.find((x) => x.key === o.key); if (d) { used.add(d.key); list.push({ cfg: o, desc: d }); } }
  }
  for (const d of descs) if (!used.has(d.key)) list.push({ cfg: null, desc: d });
  return { list, rest };
}

// ---------- penggambar ----------
const YCOL = ['#c3ccd5', '#9fb3c8', '#f2a541', '#8e7cc3', '#0b8f5a'];
const pickYears = (arr, cfg) => { const sel = Array.isArray(cfg.years) && cfg.years.length ? arr.filter((x) => cfg.years.includes(String(x.name))) : arr; const cut = !cfg._all && !(Array.isArray(cfg.years) && cfg.years.length) && sel.length > 5 ? sel.length - 5 : 0; return { sets: sel.slice(cut), cut }; };
const TCOL = '#d6402a';
const itemRaw = (row, it) => (it.val != null ? it.val : getField(row, it.col));
const val = (cfg, v) => (v == null ? '' : cfg.dec != null && cfg.dec !== '' ? Number(v).toFixed(+cfg.dec) : fmtV(v));
function scale(nums, cfg, nonZeroDef) {
  const tg = cfg.target != null && cfg.target !== '' ? +cfg.target : null;
  const all = tg != null && isFinite(tg) ? [...nums, tg] : nums.slice();
  let mx = Math.max(...all), mn = Math.min(...all);
  const mode = cfg.axis || 'auto';
  let lo, hi;
  const nonZero = mode === 'auto' ? nonZeroDef : false;
  if (nonZero) { const span = mx - mn; lo = span > 0 ? mn - span * 0.35 : mn * 0.9; hi = span > 0 ? mx : mx * 1.05 || 1; }
  else { lo = Math.min(0, mn); hi = mx > lo ? mx : lo + 1; }
  if (mode === 'manual') {
    if (cfg.min !== '' && cfg.min != null && isFinite(+cfg.min)) lo = +cfg.min;
    if (cfg.max !== '' && cfg.max != null && isFinite(+cfg.max)) hi = +cfg.max;
    if (hi <= lo) hi = lo + 1;
  }
  return { lo, hi, nonZero };
}

// batang horizontal (satu seri)
function hbarChart(items, row, cfg) {
  const vals = items.map((it) => ({ tag: it.tag, ol: !!it.ol, raw: itemRaw(row, it), v: numT(itemRaw(row, it)) })).filter((x) => !HIDE_EMPTY(x.raw));
  if (!vals.length) return null;
  const nums = vals.map((x) => x.v).filter((v) => v != null);
  const { lo, hi } = nums.length ? scale(nums, cfg, false) : { lo: 0, hi: 1 };
  const mode = cfg.chg || 'arrow';
  const box = h('div', { class: 'bars' });
  box.setAttribute('style', `--bl:${Math.max(34, Math.max(...vals.map((x) => String(x.tag).length)) * 8 + 6)}px;--bv:${mode === 'pct' ? 128 : mode === 'diff' ? 112 : 74}px`);
  const tg = cfg.target != null && cfg.target !== '' ? +cfg.target : null;
  vals.forEach((x, i) => {
    const w = x.v == null ? 0 : Math.max(2, Math.min(100, (x.v - lo) / (hi - lo) * 100));
    const prev = i > 0 ? vals[i - 1].v : null;
    const has = x.v != null && prev != null && x.v !== prev;
    const up = has && x.v > prev;
    const arrow = has ? (up ? '▲' : '▼') : '';
    const good = cfg.upGood === false ? !up : up;
    const txt = cfg.labels === false ? '' : (cfg.dec != null && cfg.dec !== '' && x.v != null ? val(cfg, x.v) : (typeof x.raw === 'number' ? fmtV(x.raw) : String(x.raw).trim()));
    const bv = h('span', { class: 'bv' }, txt);
    if (cfg.trend !== false && has) {
      if (mode === 'arrow') bv.append(' ' + arrow);
      else {
        const d = x.v - prev;
        const t2 = mode === 'pct' ? (prev ? (d >= 0 ? '+' : '−') + Math.abs(d / prev * 100).toFixed(1) + '%' : '') : (d >= 0 ? '+' : '−') + val(cfg, Math.abs(d));
        bv.append(' ', h('em', { class: 'chg ' + (good ? 'g' : 'b') }, arrow + ' ' + t2));
      }
    }
    const bt = h('span', { class: 'bt' }, h('i', { class: x.ol ? 'ol' : '', style: { width: w + '%', ...(x.ol ? { background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.6) 0 3px,transparent 3px 6px),' + (cfg.color || 'linear-gradient(90deg,#1f8a5b,#4fc08d)') } : cfg.color ? { background: cfg.color } : {}) } }));
    if (tg != null && isFinite(tg)) { const p = (tg - lo) / (hi - lo) * 100; if (p >= 0 && p <= 100) bt.append(h('b', { class: 'tgv', style: { left: p + '%' } })); }
    box.append(h('div', { class: 'bar' }, h('span', { class: 'bl' }, x.tag), bt, bv));
  });
  return box;
}

// batang vertikal / garis. labels: sumbu X; sets: [{name,color,vals,avg?}]
function colChart(labels, sets, cfg, kind, opt) {
  const nums = sets.flatMap((x) => x.vals.filter((v) => v != null));
  if (!nums.length) return null;
  const { lo, hi, nonZero } = scale(nums, cfg, true);
  const H = kind === 'line' ? 120 : 74, Y = (v) => Math.max(3, Math.min(H, (v - lo) / (hi - lo) * H));
  const n = sets.length, N = labels.length, last = sets[n - 1];
  const wrap = h('div', {});
  if (opt.legend) {
    const leg = h('div', { class: 'mleg' });
    for (const x of sets) leg.append(h('span', { class: 'mly' }, h('i', { style: { background: x.color } }), (x.name || 'Data') + ' ', x.avg != null ? h('em', {}, `rata-rata ${val(cfg, x.avg)} · ${x.vals.filter((v) => v != null).length} bln`) : null));
    wrap.append(leg);
  }
  const chart = h('div', { class: 'mchart grp' + (kind !== 'line' && n > 1 && cfg.labelAll === true ? ' tall' : ''), style: { gridTemplateColumns: `repeat(${N},1fr)` } });
  const tg = cfg.target != null && cfg.target !== '' ? +cfg.target : null;
  if (opt.avg) for (const x of sets) if (x.avg != null) chart.append(h('div', { class: 'avgline', style: { bottom: (14 + Y(x.avg)) + 'px', borderTopColor: x.color } }));
  if (tg != null && isFinite(tg)) chart.append(h('div', { class: 'avgline tg', style: { bottom: (14 + Y(tg)) + 'px' } }));
  const showLbl = (x) => cfg.labels !== false && (n === 1 || x === last || cfg.labelAll === true);
  if (kind === 'line') {
    const W = 300, P = 8, X = (i) => (N === 1 ? W / 2 : P + (W - 2 * P) * i / (N - 1)), YY = (v) => H + 4 - (Y(v));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 24}`); svg.setAttribute('class', 'lnsvg'); svg.setAttribute('preserveAspectRatio', 'none');
    const mk = (t, a) => { const e = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    for (const x of sets) {
      let d = '', pen = false;
      x.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + (YY(v) + 8).toFixed(1) + ' '; pen = true; });
      svg.append(mk('path', { d, fill: 'none', stroke: x.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    }
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    for (const x of sets) x.vals.forEach((v, i) => {
      if (v == null) return;
      svg.append(mk('circle', { cx: X(i), cy: YY(v) + 8, r: 2.6, fill: x.color }));
      if (showLbl(x)) { const t = mk('text', { x: X(i), y: x === last || n === 1 ? YY(v) + 3 : YY(v) + 21, fill: x === last || n === 1 ? 'currentColor' : x.color, 'text-anchor': i === 0 && N > 2 ? 'start' : i === N - 1 && N > 2 ? 'end' : 'middle', 'font-size': 8 }); t.textContent = val(cfg, v); svg.append(t); }
    });
    labels.forEach((l, i) => { const t = mk('text', { x: X(i), y: H + 22, 'text-anchor': i === 0 && N > 2 ? 'start' : i === N - 1 && N > 2 ? 'end' : 'middle', 'font-size': 8.5, fill: '#7a8a82' }); t.textContent = l; svg.append(t); });
    if (tg != null && isFinite(tg)) svg.append(mk('line', { x1: 0, x2: W, y1: YY(tg) + 8, y2: YY(tg) + 8, stroke: TCOL, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
    chart.className = 'mchart line'; chart.style.gridTemplateColumns = '1fr'; chart.style.height = 'auto';
    chart.innerHTML = ''; chart.append(svg);
  } else {
    for (let i = 0; i < N; i++) {
      const col = h('div', { class: 'mgrp' }), bars = h('div', { class: 'mbars' });
      for (const x of sets) {
        const v = x.vals[i];
        bars.append(h('div', { class: 'mb' }, h('span', { class: 'mv' + (n > 1 && cfg.labelAll === true ? ' sm' : ''), style: n > 1 && cfg.labelAll === true ? { color: x.color } : null }, v != null && showLbl(x) ? val(cfg, v) : ''),
          h('i', { style: { height: v == null ? '2px' : Y(v) + 'px', background: v == null ? '#d9dedb' : x.color } })));
      }
      col.append(bars, h('span', { class: 'ml' }, labels[i]));
      chart.append(col);
    }
  }
  wrap.append(chart);
  const notes = [];
  if (nonZero) notes.push(`Sumbu tidak mulai dari 0 (${val(cfg, lo) || fmtV(lo)} – ${val(cfg, hi) || fmtV(hi)}) agar perubahan terlihat jelas.`);
  if (opt.avg && n > 1) notes.push(cfg.labelAll === true ? 'Angka berwarna sesuai tahunnya.' : (kind === 'line' ? 'Angka di titik = tahun terbaru.' : 'Angka di atas batang = tahun terbaru.') + ' Garis putus = rata-rata.');
  else if (opt.avg) notes.push('Garis putus = rata-rata.');
  if (tg != null && isFinite(tg)) notes.push(`Garis merah = target ${val(cfg, tg)}.`);
  if (opt.cut) notes.push(`Hanya ${n} tahun terbaru ditampilkan (pilih tahun lain lewat Ubah grafik).`);
  if (notes.length) wrap.append(h('div', { class: 'mut small' }, notes.join(' ')));
  return wrap;
}

function monthSets(yrs, row, cfg) {
  let sets = [];
  for (const [year, mm] of yrs) {
    const vals = []; for (let m = 1; m <= 12; m++) { const c = mm[m]; const raw = c ? getField(row, c) : null; vals.push(c && !HIDE_EMPTY(raw) ? numT(raw) : null); }
    const nums = vals.filter((v) => v != null);
    if (nums.length) sets.push({ name: year || '', vals, avg: nums.reduce((a, b) => a + b, 0) / nums.length });
  }
  const pk = pickYears(sets, cfg); const cut = pk.cut;
  sets = pk.sets;
  sets.forEach((x, i) => { x.color = YCOL[YCOL.length - sets.length + i]; });
  if (sets.length && cfg.color) sets[sets.length - 1].color = cfg.color;
  return { sets, cut };
}

function ratioSets(d, row, cfg) {
  if (!d.num || !d.den) return { sets: [], cut: 0 };
  const dm = new Map(d.den), g = (c) => { if (!c) return null; const r = getField(row, c); return HIDE_EMPTY(r) ? null : numT(r); };
  const yrs = [];
  for (const [year, nm] of d.num) {
    const dd = dm.get(year) || (dm.size === 1 ? [...dm.values()][0] : null); if (!dd) continue;
    const mm = {}, vals = [];
    for (let m = 1; m <= 12; m++) { const a = g(nm[m]), b = g(dd[m]); vals.push(a != null && b != null && b !== 0 ? a / b * d.mult : null); }
    const nums = vals.filter((v) => v != null);
    if (nums.length) yrs.push({ name: year || '', vals, avg: nums.reduce((x, y) => x + y, 0) / nums.length });
    void mm;
  }
  yrs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pk = pickYears(yrs, cfg); const cut = pk.cut;
  const sets = pk.sets;
  sets.forEach((x, i) => { x.color = YCOL[YCOL.length - sets.length + i]; });
  if (sets.length && cfg.color) sets[sets.length - 1].color = cfg.color;
  return { sets, cut };
}

// ---------- grafik kelas: batang bertumpuk 100% per bulan + tabel ----------
const CLS_COL = { A: '#00b0f0', B: '#92d050', C: '#ffff00', D: '#ff0000' };
const CLS_LBL = { A: '> 125%', B: '110% – 125%', C: '100% – 109%', D: '< 100%' };
const CLS_NOTE = 'Kelas = jumlah karyawan yang mencapai Basic: A (> 125%), B (110–125%), C (100–109%), D (< 100% = tidak mencapai Basic).';
export function groupExtras() {
  return S.dsList.filter((d) => d.level === 'afd' && !d.off && d.groupCol).map((d) => ({ key: 'k:' + d.id, type: 'classes', title: String(d.name).replace(/\.[a-z0-9]+$/i, ''), sub: ' per bulan', dsId: d.id }));
}
function renderClasses(entry, ctx) {
  const cfg = entry.cfg || {}, d = entry.desc;
  const g = ctx && ctx.groups && ctx.groups.get(d.dsId); if (!g) return null;
  const { monthly } = splitMonthly(g.headers); if (!monthly.length) return null;
  const base = monthly.slice().sort((a, b) => b.yrs.reduce((n, y) => n + Object.keys(y[1]).length, 0) - a.yrs.reduce((n, y) => n + Object.keys(y[1]).length, 0))[0];
  const keys = ['A', 'B', 'C', 'D'].filter((k) => g.keys.includes(k)).concat(g.keys.filter((k) => !'ABCD'.includes(k)));
  if (!keys.length) return null;
  const ykey = d.key + ':y';
  const years = base.yrs.map((y) => y[0]);
  const draw = () => {
    const yr = years.includes(yearView.get(ykey)) ? yearView.get(ykey) : years[years.length - 1];
    const mm = (base.yrs.find((y) => y[0] === yr) || base.yrs[0])[1];
    let anyPct = false, mx = 0;
    const raw = {}; for (const k of keys) { raw[k] = []; for (let m = 1; m <= 12; m++) { const r = mm[m] ? g.rows[k][mm[m]] : null; const t = r == null ? '' : String(r).trim(); if (t === '' || t === '-') { raw[k].push(null); continue; } const n = numT(t); if (/%/.test(t)) anyPct = true; if (n != null) mx = Math.max(mx, n); raw[k].push(n); } }
    const scale = !anyPct && mx <= 1 ? 100 : 1;
    const vals = {}; for (const k of keys) vals[k] = raw[k].map((v) => (v == null ? null : v * scale));
    let last = 0; for (let m = 0; m < 12; m++) if (keys.some((k) => vals[k][m] != null)) last = m + 1;
    if (!last) return null;
    const col = (k) => (cfg.classColors && cfg.classColors[k]) || CLS_COL[k] || '#999';
    const lbl = (k) => (cfg.classLabels && cfg.classLabels[k]) || CLS_LBL[k] || '';
    const dec = cfg.dec != null && cfg.dec !== '' ? +cfg.dec : 0;
    const fmt = (v) => (v == null ? '' : v.toFixed(dec) + '%');
    const H = 110;
    const chart = h('div', { class: 'clsbars', style: { gridTemplateColumns: `repeat(${last},1fr)`, height: H + 'px' } });
    for (let m = 0; m < last; m++) {
      const tot = keys.reduce((n, k) => n + (vals[k][m] || 0), 0);
      const colEl = h('div', { class: 'clscol' });
      if (tot > 0) for (const k of keys) { const v = vals[k][m]; if (v) colEl.append(h('i', { style: { height: (v / tot * 100) + '%', background: col(k) }, title: `${k} ${fmt(v)}` })); }
      chart.append(colEl);
    }
    const head = h('tr', {}, h('th', {}, ''), ...Array.from({ length: last }, (_, m) => h('th', {}, MLAB[m])));
    const rows = keys.slice().reverse().map((k) => h('tr', {}, h('td', { class: 'lft' }, h('span', { class: 'clsdot', style: { background: col(k) } }), k), ...Array.from({ length: last }, (_, m) => h('td', {}, fmt(vals[k][m])))));
    const leg = h('div', { class: 'mleg' }, ...keys.map((k) => h('span', { class: 'mly' }, h('i', { style: { background: col(k) } }), h('b', {}, k), ' ' + lbl(k))));
    const note = cfg.note == null ? CLS_NOTE : cfg.note;
    return h('div', {}, chart, h('div', { class: 'tblwrap' }, h('table', { class: 'itab cls' }, h('thead', {}, head), h('tbody', {}, rows))), leg, note ? h('div', { class: 'mut small' }, note) : null);
  };
  const first = draw(); if (!first) return null;
  const holder = h('div', {}, first);
  const sel = years.length > 1 && years.some((y) => y) ? h('div', { class: 'perrow' }, h('span', { class: 'mut small' }, 'Tahun'),
    select(years.map((y) => [y, y || 'Data']), years.includes(yearView.get(ykey)) ? yearView.get(ykey) : years[years.length - 1], (v) => { yearView.set(ykey, v); const n = draw(); holder.innerHTML = ''; if (n) holder.append(n); })) : null;
  return h('details', { class: 'ic-sec', open: cfg.open != null ? cfg.open : true }, h('summary', {}, cfg.title || d.title, h('small', {}, (d.sub || ''))), sel, holder);
}

// satu grafik -> elemen <details>, atau null jika tidak ada data
const yearView = new Map();   // pilihan tahun pengguna per grafik (sementara, selama aplikasi dibuka)
export function renderChart(entry, row, th, ctx) { return zoomable(renderChart0(entry, row, th, ctx)); }
function renderChart0(entry, row, th, ctx) {
  if (entry.desc.type === 'classes') return renderClasses(entry, ctx);
  const cfg0 = entry.cfg || {}, d = entry.desc;
  const cfg = cfg0;
  let body = null;
  if (d.type === 'month' || d.type === 'ratio') {
    const key = d.key, sel = yearView.get(key);
    const setsOf = (c) => (d.type === 'ratio' ? ratioSets(d, row, c) : monthSets(d.yrs, row, c));
    const avail = setsOf({ ...cfg, years: [], _all: true }).sets.map((x) => String(x.name));
    const draw = () => {
      const c = { ...cfg, years: yearView.get(key) && yearView.get(key).length ? yearView.get(key) : cfg.years };
      const { sets, cut } = setsOf(c);
      return sets.length ? colChart(MLAB, sets, c, c.kind === 'line' ? 'line' : 'vbar', { legend: true, avg: true, cut }) : null;
    };
    let cur = draw();
    if (!cur) return null;
    const holder = h('div', {}, cur);
    const refresh = () => { const n = draw(); holder.innerHTML = ''; if (n) holder.append(n); };
    const shown = () => { const v = yearView.get(key); const a = v && v.length ? v : (Array.isArray(cfg.years) && cfg.years.length ? cfg.years : avail.slice(-5)); return a.map(String); };
    let selRow = null;
    if (avail.length > 1) {
      const panel = h('div', { class: 'yrpanel', style: { display: 'none' } });
      const btn = h('button', { class: 'btn sec sm' }, '');
      const upd = () => { const n = shown().length; btn.textContent = `Tahun (${n}/${avail.length}) ▾`; };
      const fill = () => {
        panel.innerHTML = '';
        const cur2 = new Set(shown());
        for (const y of avail) {
          const inp = h('input', { type: 'checkbox', checked: cur2.has(y) });
          inp.addEventListener('change', () => {
            const now = new Set(shown()); if (inp.checked) now.add(y); else now.delete(y);
            if (!now.size) { inp.checked = true; return; }
            yearView.set(key, avail.filter((x) => now.has(x))); upd(); refresh();
          });
          panel.append(h('label', { class: 'yrchip' }, inp, y || 'Data'));
        }
        panel.append(h('button', { class: 'btn sec sm', onclick: () => { yearView.set(key, avail.slice()); fill(); upd(); refresh(); } }, 'Semua'),
          h('button', { class: 'btn sec sm', onclick: () => { yearView.delete(key); fill(); upd(); refresh(); } }, 'Bawaan'));
      };
      btn.onclick = () => { const open = panel.style.display === 'none'; panel.style.display = open ? 'flex' : 'none'; if (open) fill(); };
      upd();
      selRow = h('div', { class: 'perrow' }, h('span', { class: 'mut small' }, 'Tampilkan tahun'), btn);
      selRow.append(panel);
    }
    const title0 = cfg.title || d.title;
    return h('details', { class: 'ic-sec', open: cfg.open != null ? cfg.open : true },
      h('summary', {}, title0, h('small', {}, (d.sub || '') + (cfg.unit ? ' · ' + cfg.unit : ''))), selRow, holder);
  } else {
    const all = d.items.slice();
    if (cfg.olTable && th) {
      const tb = (th.tables || []).find((x) => x.id === cfg.olTable && x.kind === 'compare');
      let ov = null; try { ov = tb ? outlookValue(th, tb, row, cfg.olMetric || 'tonha') : null; } catch (e) { console.error(e); }
      if (ov != null) all.push({ tag: cfg.olLabel || 'OL', val: ov, ol: true });
    }
    const items = all.filter((it) => !HIDE_EMPTY(itemRaw(row, it)));
    if (!items.length) return null;
    const k = cfg.kind || 'hbar';
    if (k === 'hbar') body = hbarChart(all, row, cfg);
    else {
      const vals = all.map((it) => { const raw = itemRaw(row, it); return HIDE_EMPTY(raw) ? null : numT(raw); });
      body = colChart(all.map((it) => it.tag), [{ name: d.title, vals, color: cfg.color || '#0b8f5a' }], cfg, k, {});
    }
  }
  if (!body) return null;
  const title = cfg.title || d.title;
  const nItems = d.type !== 'items' ? 99 : d.items.length;
  return h('details', { class: 'ic-sec', open: cfg.open != null ? cfg.open : nItems <= 6 || d.type !== 'items' },
    h('summary', {}, title, h('small', {}, (d.sub || '') + (cfg.unit ? ' · ' + cfg.unit : ''))), body);
}

// semua grafik untuk satu blok; kembalikan {els, rest} (rest = kolom yang tidak jadi grafik)
export function buildCharts(th, row, headers, ctx) {
  const { list, rest } = resolveCharts(th, headers, ctx ? groupExtras() : []);
  const els = [], src = new Set();
  for (const e of list) {
    if (e.cfg && e.cfg.hidden) continue;
    if (e.desc.custom && e.cfg.hideSrc !== false) {
      const d = e.desc;
      if (d.type === 'items') for (const it of d.items) src.add(it.col);
      else for (const yrs of [d.num, d.den]) if (yrs) for (const [, mm] of yrs) for (const c of Object.values(mm)) src.add(c);
    }
    let el = null; try { el = renderChart(e, row, th, ctx); } catch (err) { console.error(err); }
    if (el) {
      els.push(el);
      // batang Outlook ikut berubah saat periode (s/d) tabel diubah
      if (e.cfg && e.cfg.olTable) {
        const box = { el };
        onTableView(e.cfg.olTable, () => {
          if (!box.el.isConnected) return false;
          const n = renderChart(e, row, th); if (!n) return true;
          n.open = box.el.open; box.el.replaceWith(n); box.el = n; return true;
        });
      }
    }
  }
  return { els, rest: rest.filter((c) => !src.has(c)) };
}

// ---------- editor di tab Tema ----------
const KIND_M = [['vbar', 'Batang per bulan (bertumpuk per tahun)'], ['line', 'Garis per bulan']];
const KIND_I = [['hbar', 'Batang mendatar'], ['vbar', 'Batang tegak'], ['line', 'Garis']];
const AXIS = [['auto', 'Otomatis'], ['zero', 'Selalu mulai dari 0'], ['manual', 'Atur sendiri (min / maks)']];

// kolom CSV blok + semua CSV afdeling (untuk daftar & editor grafik)
function allHeaders() {
  const set = new Set(S.ds ? S.ds.headers : []);
  for (const d of S.dsList) if (d.level === 'afd' && !d.off) d.headers.forEach((x) => set.add(x));
  return [...set];
}
export function chartsBody(t, rerender) {
  t.charts = t.charts || [];
  const box = h('div', {});
  const headers = allHeaders();
  box.append(h('div', { class: 'mut small' }, 'Grafik yang tampil di info lokasi. Bawaannya otomatis dari kolom CSV; ubah hanya yang perlu. Urutan di daftar = urutan tampil.'));
  if (!headers.length) box.append(h('div', { class: 'mut small' }, 'Impor CSV dulu (tab Data) agar grafik otomatis terdaftar.'));
  const { list } = resolveCharts(t, headers, groupExtras());
  const entryOf = (e) => { if (e.cfg) return e.cfg; const c = { key: e.desc.key }; t.charts.push(c); return c; };
  const materialize = () => { const { list: l2 } = resolveCharts(t, headers, groupExtras()); const out = []; for (const e of l2) out.push(e.cfg || { key: e.desc.key }); t.charts = out; };
  const mv = (i, dlt) => { const j = i + dlt; if (j < 0 || j >= list.length) return; materialize(); [t.charts[i], t.charts[j]] = [t.charts[j], t.charts[i]]; bump('style'); rerender(); };
  list.forEach((e, i) => {
    const hid = e.cfg && e.cfg.hidden;
    box.append(h('div', { class: 'themeItem' },
      h('span', { class: 'nm' }, (hid ? '○ ' : '● ') + ((e.cfg && e.cfg.title) || e.desc.title) + (e.desc.custom ? '  · buatan sendiri' : '')),
      h('button', { class: 'btn sec sm', title: 'Naikkan', disabled: i === 0, onclick: () => mv(i, -1) }, '↑'),
      h('button', { class: 'btn sec sm', title: 'Turunkan', disabled: i === list.length - 1, onclick: () => mv(i, 1) }, '↓'),
      h('button', { class: 'btn sec sm', onclick: () => { const c = entryOf(e); c.hidden = !c.hidden; bump('style'); rerender(); } }, hid ? 'Tampilkan' : 'Sembunyikan'),
      h('button', { class: 'btn sec sm', onclick: () => openChartEditor(t, e, headers, rerender) }, 'Ubah'),
      false && e.cfg ? h('button', { class: 'btn sec sm', title: 'Salin ke semua tema lain', onclick: () => {
        let n = 0;
        for (const x of S.themes) {
          if (x === t) continue; x.charts = x.charts || [];
          const cp = { ...JSON.parse(JSON.stringify(e.cfg)) }; const at = x.charts.findIndex((y) => y.key === cp.key);
          if (at >= 0) x.charts[at] = cp; else x.charts.push(cp); n++;
        }
        bump('style'); toast(`Disalin ke ${n} tema`);
      } }, 'Ke semua') : null,
      e.desc.custom ? h('button', { class: 'btn red sm', onclick: async () => { if (!await confirmBox(`Hapus grafik "${e.cfg.title || 'Grafik'}"?`, 'Hapus')) return; t.charts = t.charts.filter((x) => x !== e.cfg); bump('style'); rerender(); } }, 'Hapus')
        : (e.cfg ? h('button', { class: 'btn sec sm', title: 'Kembali ke otomatis', onclick: () => { t.charts = t.charts.filter((x) => x !== e.cfg); bump('style'); rerender(); } }, 'Reset') : null)));
  });
  box.append(h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => {
    const c = { key: 'c:' + uid(), custom: true, title: 'Grafik baru', cols: '', kind: 'hbar' };
    t.charts.push(c); bump('style'); rerender();
    const e = resolveCharts(t, headers, groupExtras()).list.find((x) => x.cfg === c); openChartEditor(t, e, headers, rerender);
  } }, '+ Grafik buatan sendiri'));
  return box;
}

function openChartEditor(t, entry, headers, done) {
  let cfg = entry.cfg;
  const ensure = () => { if (!cfg) { cfg = { key: entry.desc.key }; t.charts.push(cfg); } return cfg; };
  const c0 = JSON.stringify(t.charts);
  const body = h('div', {});
  const prev = h('div', { class: 'prevbox' });
  const set = (k, v) => { const c = ensure(); if (v === '' || v == null) delete c[k]; else c[k] = v; bump('style'); refresh(); };
  const sampleRow = () => { for (const l of S.layers) { const rt = S.rt.get(l.id); const f = rt && rt.feats && rt.feats.find((x) => x._row); if (f) return f._row; } return null; };
  const sampleCtx = () => { for (const l of S.layers) { const rt = S.rt.get(l.id); const f = rt && rt.feats && rt.feats.find((x) => x.props && (x.props.Afdeling || x.props.afdeling) && afdCombined(x.props.Afdeling || x.props.afdeling) && afdCombined(x.props.Afdeling || x.props.afdeling).hit); if (f) return afdCombined(f.props.Afdeling || f.props.afdeling); } return null; };
  const refresh = () => {
    prev.innerHTML = ''; prev.append(h('div', { class: 'mut small' }, 'Pratinjau'));
    const e = resolveCharts(t, headers, groupExtras()).list.find((x) => x.desc.key === entry.desc.key);
    if (!e) { prev.append(h('div', { class: 'mut small' }, 'Grafik tidak ditemukan.')); return; }
    let el = null;
    const row = sampleRow(), ac = sampleCtx();
    if (row && entry.desc.type !== 'classes') { try { el = renderChart(e, row, t); } catch (er) { console.error(er); } }
    if (!el && ac) { try { el = renderChart(e, ac.row || {}, t, ac); } catch (er) { console.error(er); } }
    if (el) { el.open = true; prev.append(el); } else prev.append(h('div', { class: 'mut small' }, row || ac ? 'Grafik kosong untuk contoh ini (kolom belum cocok / tanpa data).' : 'Belum ada blok berdata.'));
  };
  const c = cfg || {}, isM = entry.desc.type === 'month' || entry.desc.type === 'ratio';
  const draw = () => {
    body.innerHTML = '';
    const cc = cfg || {}, isMd = isM || cc.mode === 'ratio';
    body.append(h('datalist', { id: 'dl-ch' }, headers.map((x) => h('option', { value: x }))));
    if (entry.desc.custom) body.append(h('div', { style: { margin: '6px 0' } }, check(cc.hideSrc !== false, (v) => { set('hideSrc', v ? '' : false); }, 'Sembunyikan data sumbernya dari "Data lainnya"')));
    if (entry.desc.type === 'classes') {
      body.append(frow('Judul', textInput(cc.title || '', (v) => { set('title', v.trim() ? v : ''); }, { placeholder: entry.desc.title })));
      body.append(h('div', { class: 'mut small' }, 'Warna dan keterangan tiap kelas (mis. A = lebih dari 125% basic).'));
      for (const k of ['A', 'B', 'C', 'D']) {
        body.append(h('div', { class: 'cellrow' }, h('span', { style: { width: '22px', fontWeight: 700 } }, k),
          colorInput((cc.classColors && cc.classColors[k]) || CLS_COL[k], (v) => { const c2 = ensure(); c2.classColors = { ...(c2.classColors || {}), [k]: v }; bump('style'); refresh(); }),
          textInput((cc.classLabels && cc.classLabels[k]) || CLS_LBL[k], (v) => { const c2 = ensure(); c2.classLabels = { ...(c2.classLabels || {}), [k]: v }; bump('style'); refresh(); }, { placeholder: CLS_LBL[k] })));
      }
      body.append(frow('Catatan', textInput(cc.note == null ? CLS_NOTE : cc.note, (v) => { set('note', v); })));
      body.append(frow('Desimal', numInput(cc.dec == null ? '' : cc.dec, (v) => { const n = parseInt(v, 10); set('dec', isFinite(n) && n >= 0 && n <= 2 ? n : ''); }, { placeholder: '0' })));
      body.append(h('div', { style: { margin: '6px 0' } }, check(cc.open !== false && cc.open != null ? cc.open : false, (v) => { set('open', v ? true : ''); }, 'Selalu terbuka (tidak dilipat)')));
      body.append(prev); refresh(); return;
    }
    body.append(frow('Judul', textInput(cc.title || '', (v) => { set('title', v.trim() ? v : ''); }, { placeholder: entry.desc.title })));
    const sm = splitMonthly(headers);
    const bases = [...sm.monthly.map((g) => [g.base, g.base || '(tanpa nama)']), ...headers.filter((x) => !sm.consumed.has(x) && String(x).trim()).map((x) => ['col:' + x, 'Kolom tunggal: ' + String(x).trim()])];
    if (entry.desc.custom) {
      body.append(frow('Sumber', select([['cols', 'Kolom langsung dari CSV'], ['ratio', 'Hitung rasio dari data bulanan']], cc.mode || 'cols', (v) => {
        const c2 = ensure(); if (v === 'ratio') { c2.mode = 'ratio'; c2.kind = 'vbar'; if (c2.mult == null) c2.mult = 1000; if (!c2.numBase && bases[0]) c2.numBase = bases[0][0]; if (!c2.denBase && bases[1]) c2.denBase = bases[1][0]; } else { delete c2.mode; c2.kind = 'hbar'; }
        bump('style'); draw();
      })));
    }
    if (entry.desc.custom && cc.mode === 'ratio') {
      body.append(h('div', { class: 'mut small' }, 'Nilai per bulan = Pembilang ÷ Penyebut × Pengali, dihitung per tahun yang sama. Bulan yang penyebutnya kosong atau 0 dilewati.'));
      if (!bases.length) body.append(h('div', { class: 'mut small' }, 'Belum ada data bulanan terdeteksi di CSV.'));
      body.append(frow('Pembilang', select([['', '— pilih —'], ...bases], cc.numBase || '', (v) => { set('numBase', v); })));
      body.append(frow('Penyebut', select([['', '— pilih —'], ...bases], cc.denBase || '', (v) => { set('denBase', v); })));
      body.append(frow('Rumus siap pakai', select([['', '— pilih —'], ['1000', 'BJR (Ton × 1000 ÷ JJG)'], ['1', 'Rasio biasa (A ÷ B)'], ['100', 'Persen (A ÷ B × 100)']], String(cc.mult == null ? '' : cc.mult).replace(/^(?!1000$|1$|100$).*$/, ''), (v) => { if (v) { set('mult', +v); if (v === '1000' && (!cc.title || cc.title === 'Grafik baru')) set('title', 'BJR'); draw(); } })));
      body.append(frow('Pengali', numInput(cc.mult == null ? '' : cc.mult, (v) => { const n = parseFloat(String(v).replace(',', '.')); set('mult', isFinite(n) ? n : ''); }, { placeholder: '1000' })));
    }
    if (entry.desc.custom && cc.mode !== 'ratio') {
      body.append(h('div', { class: 'mut small' }, 'Kolom data: pisahkan dengan koma. Tulis nama kolom persis, atau awalan kolom (mis. "Ton Act 2026" mengambil semua kolom yang diawali itu). Label tiap batang = sisa nama setelah awalan.'));
      body.append(h('textarea', { rows: 2, style: { width: '100%' }, placeholder: 'Pkk Awal, Pkk Sensus, Pkk Produktif', oninput: (ev) => { set('cols', ev.target.value); } }, cc.cols || ''));
      body.lastChild.value = cc.cols || '';
    }
    body.append(frow('Jenis', select(isMd ? KIND_M : KIND_I, cc.kind || (isMd ? 'vbar' : 'hbar'), (v) => { set('kind', v); })));
    if (isMd) {
      const yrs = entry.desc.type === 'month' ? entry.desc.yrs.map((x) => String(x[0])) : (entry.desc.num ? entry.desc.num.map((x) => String(x[0])) : []);
      if (yrs.length) {
        body.append(h('div', { class: 'mut small' }, 'Tahun yang ditampilkan (tidak ada yang dicentang = 5 tahun terbaru).'));
        const yw = h('div', { class: 'chk2' });
        for (const y of yrs) yw.append(h('div', {}, check(Array.isArray(cc.years) && cc.years.includes(y), (v) => { const cur = (Array.isArray(ensure().years) ? ensure().years : []).filter((x) => x !== y); if (v) cur.push(y); cur.sort(); set('years', cur.length ? cur : ''); }, y || 'Data')));
        body.append(yw);
      }
    }
    body.append(frow('Satuan', textInput(cc.unit || '', (v) => { set('unit', v.trim() ? v : ''); }, { placeholder: 'mis. ton/ha' })));
    body.append(frow('Warna', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, colorInput(cc.color || '#0b8f5a', (v) => { set('color', v); }),
      h('button', { class: 'btn sec sm', onclick: () => { set('color', ''); draw(); } }, 'Otomatis'),
      h('span', { class: 'mut small' }, isMd ? '(untuk tahun terbaru)' : ''))));
    body.append(frow('Sumbu', select(AXIS, cc.axis || 'auto', (v) => { set('axis', v === 'auto' ? '' : v); draw(); })));
    if (cc.axis === 'manual') {
      body.append(frow('Minimum', numInput(cc.min == null ? '' : cc.min, (v) => { const n = parseFloat(String(v).replace(',', '.')); set('min', isFinite(n) ? n : ''); }, { placeholder: 'otomatis' })));
      body.append(frow('Maksimum', numInput(cc.max == null ? '' : cc.max, (v) => { const n = parseFloat(String(v).replace(',', '.')); set('max', isFinite(n) ? n : ''); }, { placeholder: 'otomatis' })));
    }
    body.append(h('div', { style: { margin: '6px 0' } }, check(cc.labels !== false, (v) => { set('labels', v ? '' : false); }, 'Tampilkan angka pada grafik')));
    if (isMd) body.append(frow('Angka tahun', select([['last', 'Hanya tahun terbaru'], ['all', 'Semua tahun']], cc.labelAll === true ? 'all' : 'last', (v) => { set('labelAll', v === 'all' ? true : ''); })));
    body.append(frow('Desimal', numInput(cc.dec == null ? '' : cc.dec, (v) => { const n = parseInt(v, 10); set('dec', isFinite(n) && n >= 0 && n <= 4 ? n : ''); }, { placeholder: 'otomatis' })));
    if (!isMd) {
      body.append(h('div', { style: { margin: '6px 0' } }, check(cc.trend !== false, (v) => { set('trend', v ? '' : false); }, 'Tampilkan panah naik/turun (▲▼) untuk batang mendatar')));
      body.append(frow('Perubahan', select([['arrow', 'Panah saja'], ['pct', 'Panah + persen (vs batang sebelumnya)'], ['diff', 'Panah + selisih angka']], cc.chg || 'arrow', (v) => { set('chg', v === 'arrow' ? '' : v); })));
      body.append(frow('Naik berarti', select([['good', 'Baik (hijau)'], ['bad', 'Buruk (merah)']], cc.upGood === false ? 'bad' : 'good', (v) => { set('upGood', v === 'bad' ? false : ''); })));
      const cts = (t.tables || []).filter((x) => x.kind === 'compare');
      body.append(h('div', { class: 'mut small' }, 'Batang Outlook: nilai estimasi dari tombol Outlook pada tabel perbandingan (Act sampai bulan terakhir + Plan sisa bulan), ditambahkan di ujung batang.'));
      body.append(frow('Batang Outlook', select([['', 'Tidak ada'], ...cts.map((x) => [x.id, x.title])], cc.olTable || '', (v) => { set('olTable', v); draw(); })));
      if (cc.olTable) {
        body.append(frow('Baris', select(METRIC_OPT, cc.olMetric || 'tonha', (v) => { set('olMetric', v === 'tonha' ? '' : v); })));
        body.append(frow('Label batang', textInput(cc.olLabel || '', (v) => { set('olLabel', v.trim()); }, { placeholder: 'OL' })));
      }
    }
    body.append(frow('Garis target', numInput(cc.target == null ? '' : cc.target, (v) => { const n = parseFloat(String(v).replace(',', '.')); set('target', isFinite(n) ? n : ''); }, { placeholder: 'kosong = tanpa garis' })));
    body.append(h('div', { style: { margin: '6px 0' } }, check(cc.open !== false && cc.open != null ? cc.open : false, (v) => { set('open', v ? true : ''); }, 'Selalu terbuka (tidak dilipat)')));
    body.append(prev);
    refresh();
  };
  void c;
  draw();
  openSheet('Atur grafik', body, { onClose: () => { if (JSON.stringify(t.charts) !== c0) bump('style'); done(); } });
}
