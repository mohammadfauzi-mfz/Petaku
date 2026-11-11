// Pewarnaan dari HASIL HITUNG data bulanan (YoY SBI, scoring/akurasi BBC, selisih terhadap sebaran).
import { S, hooks, getField } from './model.js';
import { splitMonthly, numT } from './ui-charts.js';
import { h, select } from './util.js';
import { check, numInput, row as frow } from './ui-common.js';

export const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const sm = new WeakMap();
const split = (headers) => { let r = sm.get(headers); if (!r) { r = splitMonthly(headers); sm.set(headers, r); } return r; };
// base -> Map(tahun -> {bulan: kolom})
export function monthsOf(headers, base) {
  const g = split(headers).monthly.find((x) => x.base === base);
  const out = new Map(); if (!g) return out;
  for (const [y, mm] of g.yrs) out.set(String(y), mm);
  return out;
}
export const basesOf = (headers) => split(headers).monthly.map((g) => g.base);
export const singleCols = (headers) => headers.filter((x) => !split(headers).consumed.has(x) && String(x).trim());

const val = (row, col) => { if (!col) return null; const r = getField(row, col); if (r == null || String(r).trim() === '' || /^[-#]/.test(String(r).trim())) return null; return numT(r); };
function sum(row, mm, from, to) {
  if (!mm) return { s: 0, n: 0 };
  let s = 0, n = 0;
  for (let m = from; m <= to; m++) { const v = val(row, mm[m]); if (v != null) { s += v; n++; } }
  return { s, n };
}
// bulan terakhir yang sudah ada isinya (bukan 0) di seluruh blok
const lastCache = new Map();
function autoTo(ds, base, year) {
  const key = `${ds.id}|${ds.rows.length}|${base}|${year}`;
  if (lastCache.has(key)) return lastCache.get(key);
  const mm = monthsOf(ds.headers, base).get(String(year)); let last = 0;
  if (mm) for (const r of ds.rows) for (let m = 12; m > last; m--) { const v = val(r, mm[m]); if (v != null && v !== 0) { last = m; break; } }
  if (lastCache.size > 50) lastCache.clear();
  lastCache.set(key, last || 12); return last || 12;
}

export function calcRaw(t, row) {
  const c = t.calc, ds = S.ds; if (!c || !ds || !row) return undefined;
  const A = monthsOf(ds.headers, c.base).get(String(c.year));
  if (!A) return undefined;
  const from = +c.from || 1, to = +c.to || autoTo(ds, c.base, c.year);
  let r = null;
  if (c.kind === 'yoy') {
    const B = monthsOf(ds.headers, c.base).get(String(c.prevYear));
    let div = 1; if (c.divCol) { div = val(row, c.divCol); if (!(div > 0)) return undefined; }
    const a = sum(row, A, from, to), b = sum(row, B, from, to);
    if (!a.n || !b.n || !b.s) return undefined;
    const x = a.s / div, y = b.s / div;
    r = c.out === 'growth' ? (x / y - 1) * 100 : x / y * 100;
  } else if (c.kind === 'acc' || c.kind === 'sebaran') {
    const P = monthsOf(ds.headers, c.planBase).get(String(c.year)); if (!P) return undefined;
    const a = sum(row, A, from, to), p = sum(row, P, from, to);
    if (!a.n || !p.n || !p.s) return undefined;
    if (c.kind === 'acc') {
      if (t.mode === 'category') {
        const dev = Math.abs(a.s / p.s - 1) * 100;
        return dev <= (c.tolSB == null ? 5 : +c.tolSB) ? 'SB' : dev <= (c.tolB == null ? 10 : +c.tolB) ? 'B' : 'KB';
      }
      r = a.s / p.s * 100;
    } else {
      const tot = sum(row, P, from, +c.planEnd || 12);
      if (!tot.s) return undefined;
      r = c.out === 'share' ? a.s / tot.s * 100 : (a.s - p.s) / tot.s * 100;
    }
  }
  return r == null || !isFinite(r) ? undefined : r;
}
hooks.calc = calcRaw;

// ---------- editor ----------
const KINDS = [['yoy', 'Rasio dua periode (mis. YoY SBI: Ton ÷ Ha tahun ini vs tahun lalu)'], ['acc', 'Akurasi Act vs Plan (mis. scoring BBC: SB / B / KB)'], ['sebaran', 'Selisih terhadap sebaran Plan (poin %)']];
const MON = MLAB.map((m, i) => [i + 1, m]);
export function calcEditor(t, touch, rerender) {
  const ds = S.ds, headers = ds ? ds.headers : [];
  const c = t.calc;
  const wrap = h('div', { class: 'calcbox' });
  wrap.append(check(!!(c && c.on), (v) => {
    if (v && !t.calc) {
      const b = basesOf(headers), yrs = b[0] ? [...monthsOf(headers, b[0]).keys()] : [];
      t.calc = { on: true, kind: 'yoy', base: b[0] || '', year: yrs[yrs.length - 1] || '', prevYear: yrs[yrs.length - 2] || '', from: 1, to: 0, divCol: '', out: 'pct', tolSB: 5, tolB: 10, planBase: b[1] || '', planEnd: 12 };
    } else if (t.calc) t.calc.on = v;
    touch(); rerender();
  }, 'Hitung nilai dari data bulanan (bukan kolom langsung)'));
  if (!c || !c.on) return wrap;
  const bases = basesOf(headers);
  if (!bases.length) { wrap.append(h('div', { class: 'mut small' }, 'Belum ada kolom bulanan di CSV (mis. "Ton Act 2026_Jan").')); return wrap; }
  const bopt = bases.map((b) => [b, b || '(tanpa nama)']);
  const yearsOf = (b) => [...monthsOf(headers, b).keys()].map((y) => [y, y || 'Data']);
  const set = (k, v) => { c[k] = v; touch(); rerender(); };
  const kindSel = select(KINDS, c.kind, (v) => set('kind', v));
  wrap.append(frow('Jenis', kindSel));
  wrap.append(frow(c.kind === 'yoy' ? 'Data' : 'Data Act', select(bopt, c.base, (v) => { const y = yearsOf(v).map((x) => x[0]); c.base = v; if (!y.includes(String(c.year))) c.year = y[y.length - 1] || ''; touch(); rerender(); })));
  if (c.kind !== 'yoy') wrap.append(frow('Data Plan', select(bopt, c.planBase, (v) => set('planBase', v))));
  const yo = yearsOf(c.base);
  wrap.append(frow(c.kind === 'yoy' ? 'Tahun ini' : 'Tahun', select(yo, String(c.year), (v) => set('year', v))));
  if (c.kind === 'yoy') {
    wrap.append(frow('Tahun pembanding', select(yo, String(c.prevYear), (v) => set('prevYear', v))));
    wrap.append(frow('Dibagi (Ha)', select([['', '(tanpa pembagi)'], ...singleCols(headers).map((x) => [x, x])], c.divCol || '', (v) => set('divCol', v))));
    wrap.append(frow('Hasil', select([['pct', 'Persen capaian (A ÷ B × 100)'], ['growth', 'Naik / turun (%)']], c.out || 'pct', (v) => set('out', v))));
  }
  wrap.append(frow('Bulan awal', select(MON, +c.from || 1, (v) => set('from', +v))));
  wrap.append(frow('Bulan akhir (s/d)', select([[0, 'Otomatis (bulan terakhir ada data)'], ...MON], +c.to || 0, (v) => set('to', +v))));
  if (c.kind === 'acc') {
    wrap.append(frow('Batas SB (±%)', numInput(c.tolSB, (v) => { c.tolSB = v; touch(); }, { placeholder: '5' })));
    wrap.append(frow('Batas B (±%)', numInput(c.tolB, (v) => { c.tolB = v; touch(); }, { placeholder: '10' })));
    wrap.append(h('div', { class: 'mut small' }, 'Penyimpangan dihitung dua arah: |Act ÷ Plan − 1|. ≤ batas SB = SB, ≤ batas B = B, selebihnya KB. Gunakan "Cara warna = Kategori teks" dengan nilai SB / B / KB; atau "Rentang angka" untuk memakai persen Act ÷ Plan.'));
    wrap.append(h('button', { class: 'btn sec sm', onclick: () => { t.mode = 'category'; t.classes = [{ values: 'SB', color: '#2ecc40', label: 'SB' }, { values: 'B', color: '#ffeb3b', label: 'B' }, { values: 'KB', color: '#ff4136', label: 'KB' }]; touch(); rerender(); } }, 'Isi kelas SB / B / KB'));
  }
  if (c.kind === 'sebaran') {
    wrap.append(frow('Plan sampai bulan', select(MON, +c.planEnd || 12, (v) => set('planEnd', +v))));
    wrap.append(frow('Hasil', select([['diff', 'Selisih poin dari sebaran (±)'], ['share', 'Realisasi % dari total Plan']], c.out === 'share' ? 'share' : 'diff', (v) => set('out', v))));
    wrap.append(h('div', { class: 'mut small' }, 'Contoh: sebaran 21–25–27–27%. Setelah 2 bulan, hasil = (Act s/d bulan ÷ total Plan) − (Plan s/d bulan ÷ total Plan), dalam poin %.'));
  }
  // contoh hasil
  const ex = []; let n = 0;
  if (ds) for (const r of ds.rows) { const v = calcRaw(t, r); if (v !== undefined) { n++; if (ex.length < 2) ex.push(`${r[ds.keyCol]}: ${typeof v === 'number' ? v.toFixed(1) : v}`); } }
  wrap.append(h('div', { class: 'mut small' }, `Terhitung: ${n} blok${ex.length ? ' · contoh ' + ex.join(', ') : ''}${+c.to ? '' : ` · s/d ${MLAB[autoTo(ds, c.base, c.year) - 1] || ''}`}`));
  return wrap;
}
