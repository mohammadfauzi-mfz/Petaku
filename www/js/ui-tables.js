// Tabel kustom di info lokasi: "grid" (sel bebas dengan {Kolom}, mis. tabel LSU) dan "compare" (Plan vs Act dari kolom bulanan)
import { afdCombined, S, theme, getField, getProp, bump } from './model.js';
import { h, num, uid, select, toast } from './util.js';
import { openSheet, confirmBox, textInput, colorInput, check, row as frow } from './ui-common.js';

const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const METRIC = {
  jjgpkk: { label: 'JJG/PKK', dec: 2 }, jjg: { label: 'JJG', dec: 0 }, tonha: { label: 'TON/HA', dec: 2 }, ton: { label: 'TON', dec: 0 }, bjr: { label: 'BJR', dec: 2 },
};
const empty = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' || s === '-' || s.startsWith('#'); };
function contrast(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#000';
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.55 ? '#000' : '#fff';
}
// angka dari CSV: "3,449" = 3449 (ribuan), "15,60" = 15.6 (desimal koma)
function numT(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  const t = String(s).trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return num(t);
}
const fmtN = (v, dec) => (v == null || !isFinite(v)) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ---- deret bulanan: kolom "<prefix>_01" … "<prefix>_12" ----
function serMap(ds) {
  if (ds._ser && ds._ser.n === ds.headers.length) return ds._ser.m;
  const m = new Map();
  for (const c of ds.headers) {
    const x = /^(.*?)[\s_\-./]+(0?[1-9]|1[0-2])$/.exec(String(c).trim());
    if (!x) continue;
    const k = x[1].trim().toLowerCase();
    if (!m.has(k)) m.set(k, new Array(12).fill(null));
    m.get(k)[parseInt(x[2], 10) - 1] = c;
  }
  ds._ser = { n: ds.headers.length, m };
  return m;
}
function series(row, prefix) {
  const ds = CUR_DS || S.ds; if (!ds || !prefix) return null;
  const cols = serMap(ds).get(String(prefix).trim().toLowerCase());
  if (!cols) return null;
  return cols.map((c) => (c ? numT(gf(row, c)) : null));
}
let CUR_DS = null; // dataset virtual (afdeling) saat membangun tabel tingkat afdeling
const gf = (r, k) => getField(r, k, CUR_DS);
let TH = null; // tema aktif (dipakai untuk mencari sumber Outlook otomatis)
// sumber bulan sisa untuk Outlook: t.fill, atau sisi "Plan" tabel ini, atau sisi Plan tabel lain yang aktualnya sama
export function outlookSource(t) {
  if (t.fill && (t.fill.ton || t.fill.jjg)) return { ton: t.fill.ton, jjg: t.fill.jjg, label: t.fill.label || 'Plan' };
  const isP = (sd) => /plan/i.test((sd && sd.label) || '');
  if (isP(t.left)) return { ton: t.left.ton, jjg: t.left.jjg, label: t.left.label };
  for (const o of (TH && TH.tables) || []) if (o !== t && o.kind === 'compare' && o.enabled !== false && isP(o.left) && o.right && t.right && o.right.ton === t.right.ton) return { ton: o.left.ton, jjg: o.left.jjg, label: o.left.label };
  return null;
}
const mergeOL = (act, fill, to) => Array.from({ length: 12 }, (_, i) => (i < to ? (act ? act[i] : null) : (fill ? fill[i] : null)));
const lastMonth = (arr) => { let k = 0; if (arr) arr.forEach((v, i) => { if (v != null) k = i + 1; }); return k; };
const sumRange = (arr, a, b) => { if (!arr) return null; let s = 0, n = 0; for (let i = a - 1; i < b; i++) if (arr[i] != null) { s += arr[i]; n++; } return n ? s : null; };

// ---- sel bebas + rumus ----
// Teks biasa: {Kolom} / {Kolom|2} / {@Atribut} diganti isinya.
// Rumus: diawali "=" , mis. =({Pkk Awal}/{Luas})  atau  ={Act}/{Plan}|0%   (akhiran |n = n desimal, |n% = dikali 100 + tanda %)
function tokenize(src) {
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_]+)|(<=|>=|<>|[-+*/^(),<>=%]))/y, out = [];
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(pos))) break; throw new Error('Karakter tidak dikenal'); }
    pos = re.lastIndex;
    if (m[1] != null) out.push({ t: 'n', v: parseFloat(m[1]) });
    else if (m[2] != null) out.push({ t: 'i', v: m[2].toUpperCase() });
    else out.push({ t: 'o', v: m[3] });
  }
  return out;
}
function evalFormula(src) {
  const tk = tokenize(src); let i = 0;
  const peek = () => tk[i], isO = (v) => tk[i] && tk[i].t === 'o' && tk[i].v === v;
  const need = (v) => { if (!isO(v)) throw new Error('Tanda ' + v + ' kurang'); i++; };
  const nn = (a, b, f) => (a == null || b == null ? null : f(a, b));
  const cmp = () => {
    let a = add();
    while (tk[i] && tk[i].t === 'o' && ['<', '>', '<=', '>=', '=', '<>'].includes(tk[i].v)) {
      const o = tk[i++].v, b = add();
      a = nn(a, b, (x, y) => ({ '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '=': x === y, '<>': x !== y }[o] ? 1 : 0));
    }
    return a;
  };
  const add = () => { let a = mul(); while (isO('+') || isO('-')) { const o = tk[i++].v, b = mul(); a = nn(a, b, (x, y) => (o === '+' ? x + y : x - y)); } return a; };
  const mul = () => { let a = pow(); while (isO('*') || isO('/')) { const o = tk[i++].v, b = pow(); a = nn(a, b, (x, y) => (o === '*' ? x * y : (y === 0 ? null : x / y))); } return a; };
  const pow = () => { const a = un(); if (isO('^')) { i++; const b = pow(); return nn(a, b, (x, y) => Math.pow(x, y)); } return a; };
  const un = () => { if (isO('-')) { i++; const a = un(); return a == null ? null : -a; } if (isO('+')) { i++; return un(); } return post(); };
  const post = () => { let a = prim(); while (isO('%')) { i++; a = a == null ? null : a / 100; } return a; };
  const prim = () => {
    const t = tk[i++]; if (!t) throw new Error('Rumus belum lengkap');
    if (t.t === 'n') return t.v;
    if (t.t === 'o' && t.v === '(') { const a = cmp(); need(')'); return a; }
    if (t.t === 'i') {
      if (t.v === 'NA') return null;
      need('(');
      const args = [];
      if (!isO(')')) { args.push(cmp()); while (isO(',')) { i++; args.push(cmp()); } }
      need(')');
      const ok = args.filter((x) => x != null);
      switch (t.v) {
        case 'ROUND': { if (args[0] == null) return null; const d = args[1] == null ? 0 : args[1], f = Math.pow(10, d); return Math.round(args[0] * f) / f; }
        case 'ABS': return args[0] == null ? null : Math.abs(args[0]);
        case 'SQRT': return args[0] == null || args[0] < 0 ? null : Math.sqrt(args[0]);
        case 'SUM': return ok.length ? ok.reduce((x, y) => x + y, 0) : null;
        case 'AVG': return ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : null;
        case 'MIN': return ok.length ? Math.min(...ok) : null;
        case 'MAX': return ok.length ? Math.max(...ok) : null;
        case 'IF': return args[0] == null ? null : (args[0] ? args[1] : args[2]) == null ? null : (args[0] ? args[1] : args[2]);
        default: throw new Error('Fungsi ' + t.v + ' tidak dikenal');
      }
    }
    throw new Error('Rumus tidak valid');
  };
  const r = cmp();
  if (i < tk.length) throw new Error('Rumus tidak valid');
  return r;
}
const fmtF = (v, dec, pct) => {
  if (v == null || !isFinite(v)) return '';
  if (pct) v *= 100;
  const d = dec == null ? 2 : dec;
  return v.toLocaleString('en-US', { minimumFractionDigits: dec == null ? 0 : d, maximumFractionDigits: d }) + (pct ? '%' : '');
};
// resolve(k) -> nilai mentah (string / angka / null). Dipakai untuk satu blok maupun jumlah banyak blok.
function fillTplR(str, resolve) {
  str = String(str == null ? '' : str).trim();
  const braces = (txt, asNum) => txt.replace(/\{([^}]+)\}/g, (_, k) => {
    let dec = null;
    const bar = k.lastIndexOf('|');
    if (bar > 0 && /^\d$/.test(k.slice(bar + 1).trim())) { dec = +k.slice(bar + 1).trim(); k = k.slice(0, bar); }
    const v = resolve(k.trim());
    if (asNum) { const n = numT(v); return n == null ? 'NA' : '(' + n + ')'; }
    if (v == null || v === '') return '';
    if (typeof v === 'number') return fmtF(v, dec == null ? 2 : dec, false);
    const t = String(v).trim();
    if (dec != null) { const n = numT(t); if (n != null) return n.toFixed(dec); }
    return t;
  });
  if (str.startsWith('=')) {
    let body = str.slice(1), dec = null, pct = false;
    const m = /\|\s*(\d)?\s*(%)?\s*$/.exec(body);
    if (m && (m[1] != null || m[2])) { dec = m[1] != null ? +m[1] : 0; pct = !!m[2]; body = body.slice(0, m.index); }
    try { return fmtF(evalFormula(braces(body, true)), dec, pct); } catch (e) { return '#ERR'; }
  }
  return braces(str, false).trim();
}
function fillTpl(str, row, props) {
  return fillTplR(str, (k) => {
    if (k.startsWith('@')) return getProp(props, k.slice(1));
    let v = gf(row, k); if (v === undefined && k.toLowerCase() === 'blok') v = getProp(props, 'Blok');
    return v;
  });
}
// jumlah kolom numerik dari banyak blok (untuk rekap per wilayah)
function fillTplSum(str, blocks) {
  const cache = new Map();
  return fillTplR(str, (k) => {
    if (k.startsWith('@')) return null;
    if (!cache.has(k)) { let sum = null; for (const b of blocks) { const n = numT(gf(b.row, k)); if (n != null) sum = (sum || 0) + n; } cache.set(k, sum); }
    return cache.get(k);
  });
}
function colorOf(t, text) {
  const s = String(text || '').trim().toLowerCase(); if (!s) return null;
  const c = (t.colors || []).find((x) => String(x.key).trim().toLowerCase() === s);
  return c ? c.color : null;
}

function rangeColor(t, pct) {
  if (!t.useRanges || pct == null) return null;
  for (const r of t.ranges || []) if (r.min == null || pct >= r.min) return r.color;
  return null;
}

// ---- render ----
const view = new Map();    // periode pilihan pengguna per tabel (sementara)
const viewSubs = new Map(); // id tabel -> Set(fn) : grafik yang ikut berubah saat periode tabel diubah
export function onTableView(id, fn) { if (!viewSubs.has(id)) viewSubs.set(id, new Set()); viewSubs.get(id).add(fn); }
const notifyView = (id) => { const set = viewSubs.get(id); if (!set) return; for (const fn of [...set]) { let keep = true; try { keep = fn() !== false; } catch (e) { keep = false; } if (!keep) set.delete(fn); } };
function head(t, labels) {
  const bg = t.color || '#0b5d3b', fg = contrast(bg);
  return h('thead', {}, h('tr', {}, labels.map((l) => h('th', { style: { background: bg, color: fg, whiteSpace: 'pre-line' } }, l))));
}
function gridTable(t, row, props) {
  const body = h('tbody', {});
  let any = false;
  for (const r of t.rows || []) {
    const cells = r.map((c) => fillTpl(c, row, props));
    if (t.hideEmpty !== false && cells.slice(1).every(empty)) continue;
    any = true;
    body.append(h('tr', {}, cells.map((c, i) => {
      const bg = i > 0 ? colorOf(t, c) : null;
      return h('td', { class: i === 0 ? 'lft' : '', style: bg ? { background: bg, color: contrast(bg), fontWeight: 700, textAlign: 'center' } : null }, c);
    })));
  }
  if (!any) return null;
  return h('div', { class: 'tblwrap' }, h('table', { class: 'itab' }, head(t, t.cols || []), body));
}
function calcSides(t, row, from, to, ol) {
  const fl = ol ? outlookSource(t) : null;
  const sideSeries = (sd) => ({ ton: series(row, sd.ton), jjg: series(row, sd.jjg) });
  const L = sideSeries(t.left); let R = sideSeries(t.right);
  if (fl) { const F = sideSeries(fl); R = { ton: mergeOL(R.ton, F.ton, to), jjg: mergeOL(R.jjg, F.jjg, to) }; }
  const end = fl ? 12 : to;
  const luas = numT(gf(row, t.luas)), pkk = numT(gf(row, t.pkk));
  const calc = (S_) => {
    const ton = sumRange(S_.ton, from, end), jjg = sumRange(S_.jjg, from, end);
    return { ton, jjg, tonha: ton != null && luas ? ton / luas : null, jjgpkk: jjg != null && pkk ? jjg / pkk : null, bjr: ton != null && jjg ? ton * 1000 / jjg : null };
  };
  return { a: calc(L), b: calc(R), end, fl, R0: sideSeries(t.right) };
}
const autoToRow = (t, row) => { const R = { ton: series(row, t.right.ton), jjg: series(row, t.right.jjg) }; return lastMonth(R.ton) || lastMonth(R.jjg) || 12; };
// nilai Outlook satu baris metrik untuk satu blok (dipakai grafik)
export function outlookValue(th, t, row, metric) {
  TH = th;
  const vw = view.get(t.id) || {};
  const from = vw.from || t.from || 1, toSel = vw.to != null ? vw.to : t.to, to = toSel == null || toSel === 'auto' ? autoToRow(t, row) : +toSel;
  const r = calcSides(t, row, from, to, true);
  return r.fl ? r.b[metric || 'tonha'] : null;
}
export const METRIC_OPT = Object.keys(METRIC).map((k) => [k, METRIC[k].label]);
function compareTable(t, row) {
  const v = view.get(t.id) || {};
  const from = v.from || t.from || 1;
  const toSel = v.to != null ? v.to : t.to;
  const to = toSel === 'auto' || toSel == null ? autoToRow(t, row) : +toSel;
  const flAvail = outlookSource(t);
  const ol = !!v.ol && !!flAvail;
  const cs = calcSides(t, row, from, to, ol);
  const a = cs.a, b = cs.b;
  const keys = (t.metrics || []).filter((k) => METRIC[k]);
  if (!keys.length || keys.every((k) => a[k] == null && b[k] == null)) return null;
  const body = h('tbody', {});
  for (const k of keys) {
    const pct = (t.pct || []).includes(k) && a[k] && b[k] != null ? b[k] / a[k] * 100 : null;
    const bg = rangeColor(t, pct);
    body.append(h('tr', {}, h('td', { class: 'lft' }, METRIC[k].label), h('td', {}, fmtN(a[k], METRIC[k].dec)), h('td', {}, fmtN(b[k], METRIC[k].dec)),
      h('td', { style: bg ? { background: bg, color: contrast(bg), fontWeight: 700 } : { fontWeight: 700 } }, pct == null ? '' : Math.round(pct) + '%')));
  }
  const end = cs.end;
  const per = from === 1 && end === 12 ? 'Jan–Des' : (from === end ? MLAB[from - 1] : `${MLAB[from - 1]}–${MLAB[end - 1]}`);
  const wrap = h('div', {});
  // pilih periode
  const mo = MLAB.map((m, i) => [i + 1, m]);
  const ds0 = CUR_DS;
  const rerender = () => { const sv = CUR_DS; CUR_DS = ds0; let n; try { n = buildTable(t, row, null, true); } finally { CUR_DS = sv; } wrap.replaceWith(n); notifyView(t.id); };
  const sel = h('div', { class: 'perrow' }, h('span', { class: 'mut small' }, 'Periode'),
    select(mo, from, (x) => { view.set(t.id, { ...(view.get(t.id) || {}), from: +x, to }); rerender(); }),
    h('span', { class: 'mut small' }, 's/d'),
    select(mo, to, (x) => { view.set(t.id, { ...(view.get(t.id) || {}), from, to: +x }); rerender(); }),
    h('button', { class: 'btn sec sm', onclick: () => { view.delete(t.id); rerender(); } }, 'Otomatis'),
    flAvail && (to < 12 || ol) ? h('button', { class: 'btn' + (ol ? '' : ' sec') + ' sm', title: `Act ${MLAB[0]}–${MLAB[to - 1]} + ${flAvail.label} sisa bulan sampai Des`, onclick: () => { view.set(t.id, { ...(view.get(t.id) || {}), from, to, ol: !ol }); rerender(); } }, 'Outlook') : null);
  const rLabel = ol ? `Outlook\n(Act ${MLAB[from - 1]}–${MLAB[to - 1]}${to < 12 ? ' + ' + flAvail.label + ' ' + MLAB[to] + '–Des' : ''})` : t.right.label;
  wrap.append(sel, h('div', { class: 'tblwrap' }, h('table', { class: 'itab' }, head(t, [per, t.left.label, rLabel, '%']), body)));
  return wrap;
}
// kembalikan elemen tabel (atau null bila tidak ada data)
function buildTable(t, row, props, inner) {
  const body = t.kind === 'compare' ? compareTable(t, row) : gridTable(t, row, props || {});
  if (inner) return body || h('div', {});
  return body;
}
// kolom data yang sudah dipakai tabel (dan dipilih disembunyikan dari "Data lainnya")
export function tableSourceCols(th, headers) {
  const out = new Set(), hs = headers || [];
  for (const t of th.tables || []) {
    if (t.enabled === false || t.hideSrc === false || t.level === 'afd') continue;
    if (t.kind === 'grid') {
      for (const r of t.rows || []) for (const c of r.slice(1)) String(c || '').replace(/\{([^}]+)\}/g, (_, k) => {
        k = k.trim(); const b = k.lastIndexOf('|'); if (b > 0 && /^\d$/.test(k.slice(b + 1).trim())) k = k.slice(0, b).trim();
        if (!k.startsWith('@')) { const hh = hs.find((x) => String(x).trim().toLowerCase() === k.toLowerCase()); if (hh) out.add(hh); } return '';
      });
    } else if (t.kind === 'compare') {
      for (const sd of [t.left, t.right]) for (const key of ['ton', 'jjg']) {
        const pre = sd && sd[key]; if (!pre) continue;
        for (const x of hs) if (x === pre || (String(x).startsWith(pre) && /^[\s_\-.]*\d{1,2}$/.test(String(x).slice(pre.length)))) out.add(x);
      }
    }
  }
  return out;
}
// ds (opsional) = dataset virtual afdeling -> hanya tabel bersumber "afdeling"; tanpa ds -> hanya tabel blok
export function buildTables(th, row, props, where, ds) {
  TH = th; CUR_DS = ds || null;
  const out = [];
  if (!row) { CUR_DS = null; return out; }
  for (const t of th.tables || []) {
    if (t.enabled === false) continue;
    if ((t.level === 'afd') !== !!ds) continue;
    if (where && (where === 'top') !== !!t.top) continue;
    let body = null;
    try { body = buildTable(t, row, props); } catch (e) { console.error(e); }
    if (!body) continue;
    out.push(h('details', { class: 'ic-sec', open: t.open !== false }, h('summary', {}, t.title || 'Tabel'), body));
  }
  CUR_DS = null;
  return out;
}

// ---- preset ----
const CATC = [{ key: 'R', color: '#ffc000' }, { key: 'D', color: '#ff0000' }, { key: 'E', color: '#bfbfbf' }, { key: 'O', color: '#92d050' }, { key: 'T', color: '#00b0f0' }];
const RANGES = () => [{ min: 100, color: '#7fd1ff' }, { min: 95, color: '#9be59b' }, { min: 90, color: '#fff27a' }, { min: null, color: '#ff9c9c' }];
export const PRESETS = {
  lsu: () => ({
    id: 't' + uid(), kind: 'grid', title: 'Status LSU', enabled: true, color: '#e6a0e0', hideEmpty: true,
    cols: ['LSU', 'Kategori', 'Nilai'],
    rows: ['N', 'P', 'K', 'Mg', 'Ca', 'B'].map((e) => [e, `{Status LSU_${e}}`, `{Nilai LSU_${e}|2}`]),
    colors: CATC.map((c) => ({ ...c })),
  }),
  plan26: () => ({
    id: 't' + uid(), kind: 'compare', title: 'Plan BBC 2026 vs Act 2026', enabled: true, color: '#e6a0e0',
    left: { label: 'Plan BBC', ton: 'Ton BBC 2026', jjg: 'JJG BBC 2026' }, right: { label: 'Act 2026', ton: 'Ton Act 2026', jjg: 'JJG Act 2026' },
    luas: 'Luas', pkk: 'Pkk Produktif', from: 1, to: 'auto', metrics: ['jjgpkk', 'jjg', 'tonha', 'ton', 'bjr'], pct: ['jjgpkk', 'tonha', 'bjr'], useRanges: true, ranges: RANGES(),
  }),
  plan25: () => ({
    id: 't' + uid(), kind: 'compare', title: 'Plan BBC 2025 vs Act 2025', enabled: true, color: '#ff4040',
    left: { label: 'Plan BBC', ton: 'Ton BBC 2025', jjg: 'JJG BBC 2025' }, right: { label: 'Act 2025', ton: 'Ton Act 2025', jjg: 'JJG Act 2025' },
    luas: 'Luas', pkk: 'Pkk Produktif', from: 1, to: 12, metrics: ['jjgpkk', 'jjg', 'tonha', 'ton', 'bjr'], pct: ['jjgpkk', 'tonha', 'bjr'], useRanges: true, ranges: RANGES(),
  }),
  yoy: () => ({
    id: 't' + uid(), kind: 'compare', title: 'Act 2025 vs Act 2026', enabled: true, color: '#7ec8ea',
    left: { label: 'Act 2025', ton: 'Ton Act 2025', jjg: 'JJG Act 2025' }, right: { label: 'Act 2026', ton: 'Ton Act 2026', jjg: 'JJG Act 2026' },
    luas: 'Luas', pkk: 'Pkk Produktif', from: 1, to: 'auto', metrics: ['jjgpkk', 'jjg', 'tonha', 'ton', 'bjr'], pct: ['jjgpkk', 'tonha', 'bjr'], useRanges: true, ranges: RANGES(),
  }),
  sph: () => ({
    id: 't' + uid(), kind: 'grid', title: 'SPH (pokok per hektar)', enabled: true, color: '#0b5d3b', hideEmpty: true, recapCols: [3],
    cols: ['Keterangan', 'Pokok', 'Luas (ha)', 'SPH'],
    rows: [['Awal', '{Pkk Awal}', '{Luas}', '={Pkk Awal}/{Luas}|1'], ['Sensus', '{Pkk Sensus}', '{Luas}', '={Pkk Sensus}/{Luas}|1'], ['Produktif', '{Pkk Produktif}', '{Luas}', '={Pkk Produktif}/{Luas}|1']],
    colors: [],
  }),
  blank: () => ({
    id: 't' + uid(), kind: 'grid', title: 'Tabel baru', enabled: true, color: '#0b5d3b', hideEmpty: true,
    cols: ['Keterangan', 'Nilai'], rows: [['Luas (ha)', '{Luas}'], ['Pokok produktif', '{Pkk Produktif}']], colors: [],
  }),
};
const PRESET_LABEL = [['lsu', 'LSU (kategori berwarna)'], ['sph', 'SPH (pokok per hektar)'], ['plan26', 'Plan vs Act 2026'], ['plan25', 'Plan vs Act 2025'], ['yoy', 'Act 2025 vs Act 2026'], ['blank', 'Tabel kosong']];

// ---- editor ----
function sampleFeat() {
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    const f = rt.feats.find((x) => x._row); if (f) return f;
  }
  return null;
}
function headers(level) {
  if (level === 'afd') { const set = new Set(); for (const d of S.dsList) if (d.level === 'afd') d.headers.forEach((x) => set.add(x)); return [...set]; }
  return S.ds ? S.ds.headers : [];
}
function sampleAfd() {
  const f = sampleFeat(); const a = f && f.props && (f.props.Afdeling || f.props.afdeling);
  return a ? afdCombined(a) : null;
}

function listEditor(arr, mk, draw, rowEd, onMove) {
  const box = h('div', {});
  const mv = (i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; if (onMove) onMove(i, j); else [arr[i], arr[j]] = [arr[j], arr[i]]; draw(); };
  arr.forEach((it, i) => box.append(h('div', { class: 'lrow' }, rowEd(it, i),
    h('div', { class: 'mvb' }, h('button', { class: 'btn sec sm', disabled: i === 0, onclick: () => mv(i, -1) }, '↑'), h('button', { class: 'btn sec sm', disabled: i === arr.length - 1, onclick: () => mv(i, 1) }, '↓')),
    h('button', { class: 'btn red sm', onclick: () => { arr.splice(i, 1); draw(); } }, '✕'))));
  box.append(h('button', { class: 'btn sec sm', onclick: () => { arr.push(mk()); draw(); } }, '+ Tambah'));
  return box;
}

function openEditor(t, done) {
  const t0 = JSON.stringify(t);
  const body = h('div', {});
  const prev = h('div', { class: 'prevbox' });
  const touch = () => { bump('style'); refresh(); };
  const refresh = () => {
    prev.innerHTML = '';
    const f = sampleFeat();
    prev.append(h('div', { class: 'mut small' }, 'Pratinjau' + (f ? ' (blok ' + (getProp(f.props, 'Blok') || '') + ')' : '')));
    if (!f) { prev.append(h('div', { class: 'mut small' }, 'Belum ada blok berdata.')); return; }
    let b = null;
    if (t.level === 'afd') {
      const ac = sampleAfd();
      if (!ac || !ac.row) { prev.append(h('div', { class: 'mut small' }, 'Belum ada data afdeling yang cocok.')); return; }
      CUR_DS = ac; try { b = buildTable(t, ac.row, f.props); } catch (e) { b = h('div', { class: 'mut' }, 'Error: ' + e.message); } CUR_DS = null;
      prev.append(b || h('div', { class: 'mut small' }, 'Tabel kosong untuk afdeling ini (kolom belum cocok?).')); return;
    }
    try { b = buildTable(t, f._row, f.props); } catch (e) { b = h('div', { class: 'mut' }, 'Error: ' + e.message); }
    prev.append(b || h('div', { class: 'mut small' }, 'Tabel kosong untuk blok ini (kolom belum cocok?).'));
  };
  const draw = () => {
    body.innerHTML = '';
    body.append(h('datalist', { id: 'dl-tc' }, headers(t.level).map((x) => h('option', { value: x }))));
    body.append(frow('Judul', textInput(t.title, (v) => { t.title = v; touch(); })));
    body.append(frow('Warna header', colorInput(t.color || '#0b5d3b', (v) => { t.color = v; touch(); })));
    body.append(frow('Sumber data', select([['', 'CSV blok (tab Blok)'], ['afd', 'CSV afdeling (tab Afdeling)']], t.level || '', (v) => { t.level = v; touch(); draw(); })));
    body.append(h('div', { style: { margin: '6px 0' } }, check(t.open !== false, (v) => { t.open = v; touch(); }, 'Tampil terbuka di info lokasi')));

    if (t.kind === 'grid') {
      body.append(h('div', { class: 'mut small' }, 'Isi sel: teks biasa, {NamaKolom}, {Kolom|2} (2 desimal), {@AtributPeta}. Diawali = untuk menghitung, mis. ={Pkk Awal}/{Luas}|1  atau  ={Act}/{Plan}|0%  (|n = n desimal, |n% = tampil persen).'));
      body.append(h('div', { class: 'mut small' }, 'Operator + - * / ^ ( ) dan fungsi ROUND, ABS, SQRT, SUM, AVG, MIN, MAX, IF(syarat; mis. IF({A}>100,1,0)). Kolom kosong atau pembagi 0 menghasilkan sel kosong.'));
      body.append(h('h4', {}, 'Kolom tabel'));
      body.append(listEditor(t.cols, () => 'Kolom', () => { fixRows(); draw(); touch(); }, (c, i) => textInput(c, (v) => { t.cols[i] = v; touch(); }), (i, j) => {
        [t.cols[i], t.cols[j]] = [t.cols[j], t.cols[i]];
        t.rows.forEach((r) => { [r[i], r[j]] = [r[j], r[i]]; });
        t.recapCols = (t.recapCols || []).map((x) => (x === i ? j : x === j ? i : x)).sort();
      }));
      body.append(h('h4', {}, 'Baris'));
      const fixRows = () => { t.rows.forEach((r) => { while (r.length < t.cols.length) r.push(''); r.length = t.cols.length; }); };
      fixRows();
      body.append(listEditor(t.rows, () => t.cols.map(() => ''), () => { draw(); touch(); }, (r) => {
        const w = h('div', { class: 'cellrow' });
        r.forEach((c, j) => w.append(textInput(c, (v) => { r[j] = v; touch(); }, { list: 'dl-tc', placeholder: t.cols[j] || '' })));
        return w;
      }));
      body.append(h('h4', {}, 'Rekap per wilayah (Ringkasan)'));
      body.append(h('div', { class: 'mut small' }, 'Centang kolom yang ingin dirangkum per afdeling/estate. Angkanya dijumlahkan dulu per wilayah, lalu rumus dihitung dari jumlahnya (SPH = total pokok ÷ total luas).'));
      t.recapCols = t.recapCols || [];
      const rc = h('div', { class: 'chk2' });
      t.cols.forEach((c, j) => { if (j > 0) rc.append(h('div', {}, check(t.recapCols.includes(j), (v) => { t.recapCols = v ? [...new Set([...t.recapCols, j])].sort() : t.recapCols.filter((x) => x !== j); touch(); }, c || 'Kolom ' + (j + 1)))); });
      body.append(rc);
      body.append(h('div', { style: { margin: '6px 0' } }, check(t.hideSrc !== false, (v) => { t.hideSrc = v; touch(); }, 'Sembunyikan data sumbernya dari "Data lainnya"')), h('div', { style: { margin: '6px 0' } }, check(!!t.top, (v) => { t.top = v; touch(); }, 'Tampilkan paling atas (di atas kotak ringkasan)')));
      body.append(h('div', { style: { margin: '6px 0' } }, check(t.hideEmpty !== false, (v) => { t.hideEmpty = v; touch(); }, 'Sembunyikan baris yang nilainya kosong')));
      body.append(h('h4', {}, 'Warna otomatis menurut isi sel'));
      body.append(h('div', { class: 'mut small' }, 'Jika isi sel sama dengan kata di bawah (mis. R, D, O, T), sel diberi warna ini.'));
      t.colors = t.colors || [];
      body.append(listEditor(t.colors, () => ({ key: '', color: '#cccccc' }), () => { draw(); touch(); }, (c) => h('div', { class: 'cellrow' }, textInput(c.key, (v) => { c.key = v; touch(); }, { placeholder: 'isi sel' }), colorInput(c.color, (v) => { c.color = v; touch(); }))));
    } else {
      const side = (name, s) => {
        body.append(h('h4', {}, name));
        body.append(frow('Label', textInput(s.label, (v) => { s.label = v; touch(); })));
        body.append(frow('Awalan TON', textInput(s.ton, (v) => { s.ton = v; touch(); }, { placeholder: 'mis. Ton BBC 2026' })));
        body.append(frow('Awalan JJG', textInput(s.jjg, (v) => { s.jjg = v; touch(); }, { placeholder: 'mis. JJG BBC 2026' })));
      };
      body.append(h('div', { class: 'mut small' }, 'Awalan = nama kolom tanpa bulan. Kolom "Ton Act 2026_01" … "_12" dibaca sebagai awalan "Ton Act 2026".'));
      body.append(h('div', { style: { margin: '6px 0' } }, check(t.hideSrc !== false, (v) => { t.hideSrc = v; touch(); }, 'Sembunyikan data sumbernya dari "Data lainnya"')), h('div', { style: { margin: '6px 0' } }, check(!!t.top, (v) => { t.top = v; touch(); }, 'Tampilkan paling atas (di atas kotak ringkasan)')));
      side('Sisi kiri (pembanding / plan)', t.left);
      side('Sisi kanan (aktual)', t.right);
      body.append(h('h4', {}, 'Outlook (isi bulan sisa)'));
      body.append(h('div', { class: 'mut small' }, 'Tombol Outlook mengisi bulan setelah "s/d" dari sumber ini (mis. Plan BBC) sampai Des. Kosong = otomatis memakai sisi Plan (tabel ini, atau tabel Plan lain yang aktualnya sama).'));
      const others = (theme().tables || []).filter((o) => o !== t && o.kind === 'compare');
      body.append(frow('Ambil dari tabel', select([['', '— pilih —'], ...others.map((o) => [o.id, o.title + ' · sisi ' + o.left.label])], '', (v) => { const o = others.find((x) => x.id === v); if (o) { t.fill = { ton: o.left.ton, jjg: o.left.jjg, label: o.left.label }; touch(); draw(); } })));
      const fl0 = t.fill || {};
      const setFill = (k, v) => { t.fill = t.fill || {}; t.fill[k] = v; touch(); };
      body.append(frow('Sumber Ton', textInput(fl0.ton || '', (v) => setFill('ton', v), { list: 'dl-tc', placeholder: 'otomatis' })));
      body.append(frow('Sumber JJG', textInput(fl0.jjg || '', (v) => setFill('jjg', v), { list: 'dl-tc', placeholder: 'otomatis' })));
      body.append(frow('Nama sumber', textInput(fl0.label || '', (v) => setFill('label', v), { placeholder: 'Plan' })));
      body.append(h('h4', {}, 'Pembagi'));
      body.append(frow('Kolom luas (ha)', textInput(t.luas, (v) => { t.luas = v; touch(); }, { list: 'dl-tc' })));
      body.append(frow('Kolom pokok', textInput(t.pkk, (v) => { t.pkk = v; touch(); }, { list: 'dl-tc' })));
      body.append(h('h4', {}, 'Periode bawaan'));
      const mo = MLAB.map((m, i) => [i + 1, m]);
      body.append(frow('Dari', select(mo, t.from || 1, (v) => { t.from = +v; touch(); })));
      body.append(frow('Sampai', select([['auto', 'Otomatis (bulan terakhir terisi)'], ...mo], t.to == null ? 'auto' : t.to, (v) => { t.to = v === 'auto' ? 'auto' : +v; touch(); })));
      body.append(h('h4', {}, 'Baris yang ditampilkan'));
      const wm = h('div', { class: 'chk2' });
      for (const k of Object.keys(METRIC)) wm.append(h('div', {}, check((t.metrics || []).includes(k), (v) => { t.metrics = Object.keys(METRIC).filter((x) => x === k ? v : (t.metrics || []).includes(x)); touch(); }, METRIC[k].label),
        check((t.pct || []).includes(k), (v) => { t.pct = Object.keys(METRIC).filter((x) => x === k ? v : (t.pct || []).includes(x)); touch(); }, '% ')));
      body.append(h('div', { class: 'mut small' }, 'Kiri: tampilkan baris. Kanan: hitung persentase (kanan ÷ kiri).'), wm);
      body.append(h('h4', {}, 'Warna persentase'));
      body.append(h('div', { style: { margin: '6px 0' } }, check(!!t.useRanges, (v) => { t.useRanges = v; touch(); }, 'Warnai sel % menurut batas')));
      t.ranges = t.ranges || RANGES();
      body.append(h('div', { class: 'mut small' }, 'Berlaku dari atas ke bawah: batas ≥ nilai. Kosongkan batas untuk "selain itu".'));
      body.append(listEditor(t.ranges, () => ({ min: 0, color: '#cccccc' }), () => { draw(); touch(); }, (r) => h('div', { class: 'cellrow' },
        textInput(r.min == null ? '' : r.min, (v) => { const n = numT(v); r.min = String(v).trim() === '' ? null : n; touch(); }, { placeholder: '≥ batas (%)' }), colorInput(r.color, (v) => { r.color = v; touch(); }))));
    }
    body.append(prev);
    refresh();
  };
  draw();
  openSheet('Atur tabel', body, { onClose: () => { if (JSON.stringify(t) !== t0) bump('style'); done(); } });
}

// ---- kartu di editor tema ----
export function tablesBody(t, rerender) {
  t.tables = t.tables || [];
  const box = h('div', {});
  box.append(h('div', { class: 'mut small' }, 'Tabel yang tampil di info lokasi saat blok diketuk. Isinya diambil dari kolom CSV.'));
  t.tables.forEach((tb, ti) => {
    const mv = (d) => { const j = ti + d; if (j < 0 || j >= t.tables.length) return; [t.tables[ti], t.tables[j]] = [t.tables[j], t.tables[ti]]; bump('style'); rerender(); };
    box.append(h('div', { class: 'themeItem' },
      h('span', { class: 'nm' }, (tb.enabled === false ? '○ ' : '● ') + (tb.title || 'Tabel') + (tb.kind === 'compare' ? '  · Plan vs Act' : '')),
      h('button', { class: 'btn sec sm', title: 'Naikkan', disabled: ti === 0, onclick: () => mv(-1) }, '↑'),
      h('button', { class: 'btn sec sm', title: 'Turunkan', disabled: ti === t.tables.length - 1, onclick: () => mv(1) }, '↓'),
      h('button', { class: 'btn sec sm', onclick: () => { tb.enabled = tb.enabled === false; bump('style'); rerender(); } }, tb.enabled === false ? 'Aktifkan' : 'Matikan'),
      h('button', { class: 'btn sec sm', onclick: () => openEditor(tb, rerender) }, 'Ubah'),
      S.themes.length > 1 ? h('button', { class: 'btn sec sm', title: 'Salin ke semua tema lain', onclick: () => {
        let n = 0;
        for (const x of S.themes) { if (x === t) continue; x.tables = x.tables || []; if (x.tables.some((y) => y.title === tb.title && y.kind === tb.kind)) continue; x.tables.push({ ...JSON.parse(JSON.stringify(tb)), id: 't' + uid() }); n++; }
        bump('style'); toast(n ? `Disalin ke ${n} tema` : 'Sudah ada di semua tema');
      } }, 'Ke semua') : null,
      h('button', { class: 'btn red sm', onclick: async () => { if (!await confirmBox(`Hapus tabel "${tb.title}"?`, 'Hapus')) return; t.tables = t.tables.filter((x) => x !== tb); bump('style'); rerender(); } }, 'Hapus')));
  });
  let pick = 'lsu';
  box.append(h('div', { class: 'row' }, h('label', {}, 'Tambah dari'), h('div', { class: 'grow', style: { display: 'flex', gap: '8px' } },
    select(PRESET_LABEL, pick, (v) => { pick = v; }),
    h('button', { class: 'btn', onclick: () => { const n = PRESETS[pick](); t.tables.push(n); bump('style'); rerender(); openEditor(n, rerender); } }, 'Tambah'))));
  return box;
}

// ---- rekap Plan vs Act per kelompok (mis. per afdeling): jumlahkan blok lalu hitung ulang rasio ----
export const compareTables = (th) => (TH = th, th.tables || []).filter((x) => x.kind === 'compare' && x.enabled !== false && x.level !== 'afd');
function aggSide(rowsData, from, to) {
  let ton = null, jjg = null, luas = 0, pkk = 0;
  for (const b of rowsData) {
    const t = sumRange(b.ton, from, to), j = sumRange(b.jjg, from, to);
    if (t == null && j == null) continue;
    if (t != null) ton = (ton || 0) + t;
    if (j != null) jjg = (jjg || 0) + j;
    luas += b.luas || 0; pkk += b.pkk || 0;
  }
  return { ton, jjg, tonha: ton != null && luas ? ton / luas : null, jjgpkk: jjg != null && pkk ? jjg / pkk : null, bjr: ton != null && jjg ? ton * 1000 / jjg : null };
}
// blocks: [{row}]; kembalikan {a, b, from, to} untuk satu kelompok
export function aggCompare(t, blocks, from, to, ol) {
  const fl = ol ? outlookSource(t) : null;
  const mk = (s, f) => blocks.map((x) => {
    let ton = series(x.row, s.ton), jjg = series(x.row, s.jjg);
    if (f) { ton = mergeOL(ton, series(x.row, f.ton), to); jjg = mergeOL(jjg, series(x.row, f.jjg), to); }
    return { ton, jjg, luas: numT(gf(x.row, t.luas)), pkk: numT(gf(x.row, t.pkk)) };
  });
  const L = mk(t.left), R = mk(t.right, fl), end = fl ? 12 : to;
  return { a: aggSide(L, from, end), b: aggSide(R, from, end) };
}
export function autoTo(t, blocks) {
  let m = 0; for (const x of blocks) { const r = series(x.row, t.right.ton) || series(x.row, t.right.jjg); m = Math.max(m, lastMonth(r)); }
  return m || 12;
}
// groups: [{name, blocks}]; tabel lebar (geser ke samping), kolom pertama menempel
export function recapTable(t, groups, from, to, ol) {
  const rlab = ol && outlookSource(t) ? 'Outlook' : t.right.label;
  const keys = (t.metrics || []).filter((k) => METRIC[k]);
  const pk = keys.filter((k) => (t.pct || []).includes(k));
  const bg = t.color || '#0b5d3b', fg = contrast(bg);
  const th = (txt, span, st) => h('th', { colspan: span || 1, style: { background: bg, color: fg, ...(st || {}) } }, txt);
  const thead = h('thead', {}, h('tr', {}, th('', 1, { position: 'sticky', left: 0, zIndex: 2 }), th(t.left.label, keys.length), th(rlab, keys.length), pk.length ? th('%', pk.length) : null),
    h('tr', {}, th('Wilayah', 1, { position: 'sticky', left: 0, zIndex: 2 }), ...keys.map((k) => th(METRIC[k].label)), ...keys.map((k) => th(METRIC[k].label)), ...pk.map((k) => th(METRIC[k].label))));
  const body = h('tbody', {});
  const all = [];
  const line = (name, blocks, total) => {
    const { a, b } = aggCompare(t, blocks, from, to, ol);
    if (keys.every((k) => a[k] == null && b[k] == null)) return;
    const cells = [h('td', { class: 'lft stick' + (total ? ' tot' : '') }, name)];
    for (const k of keys) cells.push(h('td', {}, fmtN(a[k], METRIC[k].dec)));
    for (const k of keys) cells.push(h('td', {}, fmtN(b[k], METRIC[k].dec)));
    for (const k of pk) {
      const pct = a[k] && b[k] != null ? b[k] / a[k] * 100 : null;
      const c = rangeColor(t, pct);
      cells.push(h('td', { style: c ? { background: c, color: contrast(c), fontWeight: 700 } : { fontWeight: 700 } }, pct == null ? '' : Math.round(pct) + '%'));
    }
    body.append(h('tr', { class: total ? 'tot' : '' }, cells));
    all.push({ name, a, b, pct: Object.fromEntries(pk.map((k) => [k, a[k] && b[k] != null ? b[k] / a[k] * 100 : null])) });
  };
  for (const g of groups) line(g.name, g.blocks, false);
  if (groups.length > 1) line('Total', groups.flatMap((g) => g.blocks), true);
  return { el: h('div', { class: 'tblwrap recap' }, h('table', { class: 'itab' }, thead, body)), rows: all, keys, pk };
}
export const recapGridTables = (th) => (th.tables || []).filter((x) => x.kind === 'grid' && x.enabled !== false && x.level !== 'afd' && (x.recapCols || []).length);
// groups: [{name, blocks:[{row}]}] -> tabel: baris = wilayah, kolom = (kolom terpilih x baris tabel)
export function recapGrid(t, groups) {
  const cols = (t.recapCols || []).filter((j) => j > 0 && j < (t.cols || []).length);
  const rowsT = (t.rows || []).filter((r) => String(r[0] || '').trim() !== '');
  if (!cols.length || !rowsT.length) return null;
  const bg = t.color || '#0b5d3b', fg = contrast(bg);
  const th = (txt, span, st) => h('th', { colspan: span || 1, style: { background: bg, color: fg, ...(st || {}) } }, txt);
  const thead = h('thead', {}, h('tr', {}, th('', 1, { position: 'sticky', left: 0, zIndex: 2 }), ...cols.map((j) => th(t.cols[j], rowsT.length))),
    h('tr', {}, th('Wilayah', 1, { position: 'sticky', left: 0, zIndex: 2 }), ...cols.flatMap(() => rowsT.map((r) => th(r[0])))));
  const body = h('tbody', {}); let any = false;
  const line = (name, blocks, total) => {
    const cells = [h('td', { class: 'lft stick' + (total ? ' tot' : '') }, name)]; let has = false;
    for (const j of cols) for (const r of rowsT) { const v = fillTplSum(r[j] || '', blocks); if (v !== '') has = true; cells.push(h('td', {}, v)); }
    if (!has) return;
    any = true; body.append(h('tr', { class: total ? 'tot' : '' }, cells));
  };
  for (const g of groups) line(g.name, g.blocks, false);
  if (groups.length > 1) line('Total', groups.flatMap((g) => g.blocks), true);
  return any ? h('div', { class: 'tblwrap recap' }, h('table', { class: 'itab' }, thead, body)) : null;
}
void theme; void toast;
