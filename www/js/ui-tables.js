// Tabel kustom di info lokasi: "grid" (sel bebas dengan {Kolom}, mis. tabel LSU) dan "compare" (Plan vs Act dari kolom bulanan)
import { S, theme, getField, getProp, bump } from './model.js';
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
  const ds = S.ds; if (!ds || !prefix) return null;
  const cols = serMap(ds).get(String(prefix).trim().toLowerCase());
  if (!cols) return null;
  return cols.map((c) => (c ? numT(getField(row, c)) : null));
}
const lastMonth = (arr) => { let k = 0; if (arr) arr.forEach((v, i) => { if (v != null) k = i + 1; }); return k; };
const sumRange = (arr, a, b) => { if (!arr) return null; let s = 0, n = 0; for (let i = a - 1; i < b; i++) if (arr[i] != null) { s += arr[i]; n++; } return n ? s : null; };

// ---- sel bebas ----
function fillTpl(str, row, props) {
  return String(str == null ? '' : str).replace(/\{([^}]+)\}/g, (_, k) => {
    let dec = null;
    const bar = k.lastIndexOf('|');
    if (bar > 0 && /^\d$/.test(k.slice(bar + 1).trim())) { dec = +k.slice(bar + 1).trim(); k = k.slice(0, bar); }
    k = k.trim();
    let v;
    if (k.startsWith('@')) v = getProp(props, k.slice(1));
    else { v = getField(row, k); if (v === undefined && k.toLowerCase() === 'blok') v = getProp(props, 'Blok'); }
    if (v == null) return '';
    v = String(v).trim();
    if (dec != null) { const n = numT(v); if (n != null) return n.toFixed(dec); }
    return v;
  }).trim();
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
function head(t, labels) {
  const bg = t.color || '#0b5d3b', fg = contrast(bg);
  return h('thead', {}, h('tr', {}, labels.map((l) => h('th', { style: { background: bg, color: fg } }, l))));
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
function compareTable(t, row) {
  const v = view.get(t.id) || {};
  const sideSeries = (s) => ({ ton: series(row, s.ton), jjg: series(row, s.jjg) });
  const L = sideSeries(t.left), R = sideSeries(t.right);
  const from = v.from || t.from || 1;
  const toSel = v.to != null ? v.to : t.to;
  const to = toSel === 'auto' || toSel == null ? (lastMonth(R.ton) || lastMonth(R.jjg) || 12) : +toSel;
  const luas = numT(getField(row, t.luas)), pkk = numT(getField(row, t.pkk));
  const calc = (S_) => {
    const ton = sumRange(S_.ton, from, to), jjg = sumRange(S_.jjg, from, to);
    return {
      ton, jjg,
      tonha: ton != null && luas ? ton / luas : null,
      jjgpkk: jjg != null && pkk ? jjg / pkk : null,
      bjr: ton != null && jjg ? ton * 1000 / jjg : null,
    };
  };
  const a = calc(L), b = calc(R);
  const keys = (t.metrics || []).filter((k) => METRIC[k]);
  if (!keys.length || keys.every((k) => a[k] == null && b[k] == null)) return null;
  const body = h('tbody', {});
  for (const k of keys) {
    const pct = (t.pct || []).includes(k) && a[k] && b[k] != null ? b[k] / a[k] * 100 : null;
    const bg = rangeColor(t, pct);
    body.append(h('tr', {}, h('td', { class: 'lft' }, METRIC[k].label), h('td', {}, fmtN(a[k], METRIC[k].dec)), h('td', {}, fmtN(b[k], METRIC[k].dec)),
      h('td', { style: bg ? { background: bg, color: contrast(bg), fontWeight: 700 } : { fontWeight: 700 } }, pct == null ? '' : Math.round(pct) + '%')));
  }
  const per = from === 1 && to === 12 ? 'Jan–Des' : (from === to ? MLAB[from - 1] : `${MLAB[from - 1]}–${MLAB[to - 1]}`);
  const wrap = h('div', {});
  // pilih periode
  const mo = MLAB.map((m, i) => [i + 1, m]);
  const rerender = () => { const n = buildTable(t, row, null, true); wrap.replaceWith(n); };
  const sel = h('div', { class: 'perrow' }, h('span', { class: 'mut small' }, 'Periode'),
    select(mo, from, (x) => { view.set(t.id, { ...(view.get(t.id) || {}), from: +x, to }); rerender(); }),
    h('span', { class: 'mut small' }, 's/d'),
    select(mo, to, (x) => { view.set(t.id, { ...(view.get(t.id) || {}), from, to: +x }); rerender(); }),
    h('button', { class: 'btn sec sm', onclick: () => { view.delete(t.id); rerender(); } }, 'Otomatis'));
  wrap.append(sel, h('div', { class: 'tblwrap' }, h('table', { class: 'itab' }, head(t, [per, t.left.label, t.right.label, '%']), body)));
  return wrap;
}
// kembalikan elemen tabel (atau null bila tidak ada data)
function buildTable(t, row, props, inner) {
  const body = t.kind === 'compare' ? compareTable(t, row) : gridTable(t, row, props || {});
  if (inner) return body || h('div', {});
  return body;
}
export function buildTables(th, row, props) {
  const out = [];
  if (!row) return out;
  for (const t of th.tables || []) {
    if (t.enabled === false) continue;
    let body = null;
    try { body = buildTable(t, row, props); } catch (e) { console.error(e); }
    if (!body) continue;
    out.push(h('details', { class: 'ic-sec', open: t.open !== false }, h('summary', {}, t.title || 'Tabel'), body));
  }
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
  blank: () => ({
    id: 't' + uid(), kind: 'grid', title: 'Tabel baru', enabled: true, color: '#0b5d3b', hideEmpty: true,
    cols: ['Keterangan', 'Nilai'], rows: [['Luas (ha)', '{Luas}'], ['Pokok produktif', '{Pkk Produktif}']], colors: [],
  }),
};
const PRESET_LABEL = [['lsu', 'LSU (kategori berwarna)'], ['plan26', 'Plan vs Act 2026'], ['plan25', 'Plan vs Act 2025'], ['yoy', 'Act 2025 vs Act 2026'], ['blank', 'Tabel kosong']];

// ---- editor ----
function sampleFeat() {
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    const f = rt.feats.find((x) => x._row); if (f) return f;
  }
  return null;
}
function headers() { return S.ds ? S.ds.headers : []; }

function listEditor(arr, mk, draw, rowEd) {
  const box = h('div', {});
  arr.forEach((it, i) => box.append(h('div', { class: 'lrow' }, rowEd(it, i), h('button', { class: 'btn red sm', onclick: () => { arr.splice(i, 1); draw(); } }, '✕'))));
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
    let b = null; try { b = buildTable(t, f._row, f.props); } catch (e) { b = h('div', { class: 'mut' }, 'Error: ' + e.message); }
    prev.append(b || h('div', { class: 'mut small' }, 'Tabel kosong untuk blok ini (kolom belum cocok?).'));
  };
  const draw = () => {
    body.innerHTML = '';
    body.append(h('datalist', { id: 'dl-tc' }, headers().map((x) => h('option', { value: x }))));
    body.append(frow('Judul', textInput(t.title, (v) => { t.title = v; touch(); })));
    body.append(frow('Warna header', colorInput(t.color || '#0b5d3b', (v) => { t.color = v; touch(); })));
    body.append(h('div', { style: { margin: '6px 0' } }, check(t.open !== false, (v) => { t.open = v; touch(); }, 'Tampil terbuka di info lokasi')));

    if (t.kind === 'grid') {
      body.append(h('div', { class: 'mut small' }, 'Isi sel boleh teks biasa atau {NamaKolom}. {Kolom|2} = 2 angka desimal, {@AtributPeta} = atribut poligon.'));
      body.append(h('h4', {}, 'Kolom tabel'));
      body.append(listEditor(t.cols, () => 'Kolom', () => { fixRows(); draw(); touch(); }, (c, i) => textInput(c, (v) => { t.cols[i] = v; touch(); })));
      body.append(h('h4', {}, 'Baris'));
      const fixRows = () => { t.rows.forEach((r) => { while (r.length < t.cols.length) r.push(''); r.length = t.cols.length; }); };
      fixRows();
      body.append(listEditor(t.rows, () => t.cols.map(() => ''), () => { draw(); touch(); }, (r) => {
        const w = h('div', { class: 'cellrow' });
        r.forEach((c, j) => w.append(textInput(c, (v) => { r[j] = v; touch(); }, { list: 'dl-tc', placeholder: t.cols[j] || '' })));
        return w;
      }));
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
      side('Sisi kiri (pembanding / plan)', t.left);
      side('Sisi kanan (aktual)', t.right);
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
  for (const tb of t.tables) {
    box.append(h('div', { class: 'themeItem' },
      h('span', { class: 'nm' }, (tb.enabled === false ? '○ ' : '● ') + (tb.title || 'Tabel') + (tb.kind === 'compare' ? '  · Plan vs Act' : '')),
      h('button', { class: 'btn sec sm', onclick: () => { tb.enabled = tb.enabled === false; bump('style'); rerender(); } }, tb.enabled === false ? 'Aktifkan' : 'Matikan'),
      h('button', { class: 'btn sec sm', onclick: () => openEditor(tb, rerender) }, 'Ubah'),
      S.themes.length > 1 ? h('button', { class: 'btn sec sm', title: 'Salin ke semua tema lain', onclick: () => {
        let n = 0;
        for (const x of S.themes) { if (x === t) continue; x.tables = x.tables || []; if (x.tables.some((y) => y.title === tb.title && y.kind === tb.kind)) continue; x.tables.push({ ...JSON.parse(JSON.stringify(tb)), id: 't' + uid() }); n++; }
        bump('style'); toast(n ? `Disalin ke ${n} tema` : 'Sudah ada di semua tema');
      } }, 'Ke semua') : null,
      h('button', { class: 'btn red sm', onclick: async () => { if (!await confirmBox(`Hapus tabel "${tb.title}"?`, 'Hapus')) return; t.tables = t.tables.filter((x) => x !== tb); bump('style'); rerender(); } }, 'Hapus')));
  }
  let pick = 'lsu';
  box.append(h('div', { class: 'row' }, h('label', {}, 'Tambah dari'), h('div', { class: 'grow', style: { display: 'flex', gap: '8px' } },
    select(PRESET_LABEL, pick, (v) => { pick = v; }),
    h('button', { class: 'btn', onclick: () => { const n = PRESETS[pick](); t.tables.push(n); bump('style'); rerender(); openEditor(n, rerender); } }, 'Tambah'))));
  return box;
}
void theme; void toast;
