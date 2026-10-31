import { S, theme, bump, defThemes, defRules, saveSoon, emit, getProp } from './model.js';
import { PATTERNS } from './render.js';
import { h, $, uid, clone, toast, select, pickFile, readText, readDataURL, shareFile } from './util.js';
import { confirmBox, textInput, numInput, colorInput, textArea, check, row } from './ui-common.js';

const openKeys = new Set(['dasar', 'kelas']);
const PAL = ['#1f77b4', '#2ca02c', '#ff7f0e', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f', '#00c6f7', '#ffd30b'];
export const OPS = [['equals', 'sama dengan'], ['notequals', 'tidak sama dengan'], ['contains', 'mengandung'], ['startsWith', 'diawali'], ['endsWith', 'diakhiri'], ['regex', 'cocok regex'], ['empty', 'kosong / “-” / error'], ['notempty', 'terisi'], ['gt', '> (angka)'], ['gte', '≥ (angka)'], ['lt', '< (angka)'], ['lte', '≤ (angka)']];

function rerender() { const el = $('#p-theme'); const y = el.scrollTop; renderTheme(); el.scrollTop = y; }
const touch = () => bump('style');

function csvHeaders() { return S.ds ? S.ds.headers : []; }
function polyKeys() {
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id);
    if (rt && rt.feats && rt.feats[0]) return Object.keys(rt.feats[0].props || {});
  }
  return [];
}

function patternSel(val, on) { return select(PATTERNS, val || 'none', on); }

function classEditor(t, c, i) {
  const wrap = h('div', { class: 'cls' });
  wrap.append(h('div', { class: 'r1' },
    colorInput(c.color, (v) => { c.color = v; touch(); }),
    h('div', { style: { flex: 1 } }, textInput(c.label, (v) => { c.label = v; touch(); }, { placeholder: 'Teks legenda' })),
    h('button', { class: 'btn red sm', onclick: () => { t.classes.splice(i, 1); touch(); rerender(); } }, '✕')));
  const r2 = h('div', { class: 'r2' });
  if (t.mode === 'category') {
    r2.append(textInput(c.values, (v) => { c.values = v; touch(); }, { placeholder: 'Nilai (pisah ; ) mis. SB; B' }));
  } else {
    r2.append(numInput(c.min, (v) => { c.min = v; touch(); }, { placeholder: 'min (≥)' }), numInput(c.max, (v) => { c.max = v; touch(); }, { placeholder: 'maks (<)' }));
  }
  r2.append(patternSel(c.pattern, (v) => { c.pattern = v; touch(); }), colorInput(c.pc || '#ff0004', (v) => { c.pc = v; touch(); }),
    h('button', { class: 'btn sec sm', onclick: () => { if (i > 0) { [t.classes[i - 1], t.classes[i]] = [t.classes[i], t.classes[i - 1]]; touch(); rerender(); } } }, '↑'),
    h('button', { class: 'btn sec sm', onclick: () => { if (i < t.classes.length - 1) { [t.classes[i + 1], t.classes[i]] = [t.classes[i], t.classes[i + 1]]; touch(); rerender(); } } }, '↓'));
  wrap.append(r2);
  const op = c.opacity == null ? 100 : c.opacity;
  const val = h('span', { class: 'mut small', style: { minWidth: '38px', textAlign: 'right' } }, op + '%');
  const rg = h('input', { type: 'range', min: 0, max: 100, step: 5, value: op, style: { flex: 1 } });
  rg.addEventListener('input', () => { c.opacity = +rg.value; val.textContent = rg.value + '%'; touch(); });
  wrap.append(h('div', { class: 'r2' }, h('span', { class: 'mut small', style: { flex: 'none', minWidth: 0 } }, 'Opasitas'), rg, val));
  return wrap;
}

function ruleEditor(t, r, i) {
  const wrap = h('div', { class: 'rule' });
  wrap.append(h('div', { class: 'r1' },
    check(r.enabled !== false, (v) => { r.enabled = v; touch(); }, ''),
    select([['csv', 'Kolom CSV'], ['poly', 'Atribut poligon']], r.source, (v) => { r.source = v; touch(); rerender(); }, { style: 'flex:0 0 120px' }),
    h('div', { style: { flex: 1 } }, textInput(r.field, (v) => { r.field = v; touch(); }, { placeholder: 'Nama kolom', list: r.source === 'poly' ? 'dl-poly' : 'dl-fields' })),
    h('button', { class: 'btn red sm', onclick: () => { t.rules.splice(i, 1); touch(); rerender(); } }, '✕')));
  const r2 = h('div', { class: 'r2' },
    select(OPS, r.op, (v) => { r.op = v; touch(); rerender(); }),
    (r.op === 'empty' || r.op === 'notempty') ? h('span', { class: 'mut' }, '(tanpa nilai)') : textInput(r.value, (v) => { r.value = v; touch(); }, { placeholder: 'Nilai / regex' }));
  wrap.append(r2);
  wrap.append(h('div', { class: 'r2' }, h('span', { class: 'mut small', style: { flex: 'none', minWidth: 0 } }, 'Cara'),
    select([['replace', 'Ganti warna blok'], ['overlay', 'Arsiran di atas warna tema']], r.mode === 'overlay' ? 'overlay' : 'replace', (v) => { r.mode = v; if (v === 'overlay' && (!r.pattern || r.pattern === 'none')) r.pattern = 'diag'; touch(); rerender(); })));
  if (r.mode === 'overlay') {
    wrap.append(h('div', { class: 'mut small' }, 'Warna blok tetap mengikuti kelas tema; hanya arsiran ini yang ditambahkan.'));
    wrap.append(h('div', { class: 'r2' }, h('span', { class: 'mut small', style: { flex: 'none', minWidth: 0 } }, 'Arsiran'),
      patternSel(r.pattern, (v) => { r.pattern = v; touch(); }), colorInput(r.pc || '#000000', (v) => { r.pc = v; touch(); })));
  } else wrap.append(h('div', { class: 'r2' },
    h('span', { class: 'mut', style: { flex: 'none', minWidth: 0 } }, 'Isi'),
    colorInput(r.fill || '#ffffff', (v) => { r.fill = v; touch(); }),
    patternSel(r.pattern, (v) => { r.pattern = v; touch(); }),
    colorInput(r.pc || '#00a01e', (v) => { r.pc = v; touch(); })));
  if (r.mode !== 'overlay') wrap.append(h('div', { class: 'r2' }, check(!!r.noFill, (v) => { r.noFill = v; touch(); }, 'Tanpa warna isi (transparan penuh; arsiran tetap tampil)')));
  const rop = r.opacity == null ? 100 : r.opacity;
  const rval = h('span', { class: 'mut small', style: { minWidth: '38px', textAlign: 'right' } }, rop + '%');
  const rrg = h('input', { type: 'range', min: 0, max: 100, step: 5, value: rop, style: { flex: 1 } });
  rrg.addEventListener('input', () => { r.opacity = +rrg.value; rval.textContent = rrg.value + '%'; touch(); });
  wrap.append(h('div', { class: 'r2' }, h('span', { class: 'mut small', style: { flex: 'none', minWidth: 0 } }, 'Opasitas'), rrg, rval));
  wrap.append(h('div', { class: 'r2' },
    check(!!r.legendShow, (v) => { r.legendShow = v; touch(); }, 'Legenda'),
    textInput(r.legendGroup, (v) => { r.legendGroup = v; touch(); }, { placeholder: 'Grup' }),
    textInput(r.legendLabel, (v) => { r.legendLabel = v; touch(); }, { placeholder: 'Teks' }),
    h('button', { class: 'btn sec sm', onclick: () => { if (i > 0) { [t.rules[i - 1], t.rules[i]] = [t.rules[i], t.rules[i - 1]]; touch(); rerender(); } } }, '↑'),
    h('button', { class: 'btn sec sm', onclick: () => { if (i < t.rules.length - 1) { [t.rules[i + 1], t.rules[i]] = [t.rules[i], t.rules[i + 1]]; touch(); rerender(); } } }, '↓')));
  return wrap;
}

function section(key, title, ...kids) {
  const d = h('details', {}, h('summary', {}, title), ...kids);
  if (openKeys.has(key)) d.open = true;
  d.addEventListener('toggle', () => { if (d.open) openKeys.add(key); else openKeys.delete(key); });
  return d;
}

function uniqueValues(t) {
  if (!S.ds) { toast('Impor CSV dulu'); return; }
  const k = S.ds.hmap[String(t.field || '').toLowerCase().trim()];
  if (k === undefined) { toast('Kolom "' + t.field + '" tidak ada di CSV'); return; }
  const set = [...new Set(S.ds.rows.map((r) => String(r[k]).trim()).filter((v) => v && v !== '-' && !v.startsWith('#')))].slice(0, 24);
  if (!set.length) { toast('Tidak ada nilai'); return; }
  t.mode = 'category';
  t.classes = set.map((v, i) => ({ id: uid(), color: PAL[i % PAL.length], label: v, min: null, max: null, values: v, pattern: 'none', pc: '#ff0004', opacity: 100 }));
  touch(); rerender();
  toast(set.length + ' kelas dibuat dari nilai unik');
}

export function renderTheme() {
  const el = $('#p-theme');
  el.innerHTML = '';
  const t = theme();
  el.append(h('datalist', { id: 'dl-fields' }, csvHeaders().map((x) => h('option', { value: x }))));
  el.append(h('datalist', { id: 'dl-poly' }, polyKeys().map((x) => h('option', { value: x }))));

  // ---- daftar tema ----
  const list = h('div', { class: 'card' }, h('h3', {}, 'Jenis peta'));
  list.append(h('div', { class: 'mut small' }, 'Setiap jenis peta punya aturan warna, legenda, dan label sendiri. Ketuk untuk memilih.'));
  for (const x of S.themes) {
    list.append(h('div', { class: 'themeItem' + (x.id === S.themeId ? ' active' : ''), onclick: () => { S.themeId = x.id; bump('theme'); rerender(); } },
      h('span', { class: 'nm' }, (x.id === S.themeId ? '● ' : '○ ') + x.name),
      h('button', { class: 'btn sec sm', onclick: (e) => { e.stopPropagation(); const c = clone(x); c.id = 'u' + uid(); c.name = x.name + ' (salinan)'; c.classes.forEach((k) => { k.id = uid(); }); S.themes.push(c); S.themeId = c.id; bump('theme'); rerender(); } }, 'Salin'),
      h('button', { class: 'btn red sm', onclick: async (e) => { e.stopPropagation(); if (S.themes.length < 2) { toast('Minimal satu tema'); return; } if (!await confirmBox(`Hapus tema "${x.name}"?`, 'Hapus')) return; S.themes = S.themes.filter((y) => y.id !== x.id); if (S.themeId === x.id) S.themeId = S.themes[0].id; bump('theme'); rerender(); } }, 'Hapus')));
  }
  list.append(h('div', { class: 'btns' },
    h('button', { class: 'btn sec', onclick: () => { const base = defThemes()[0]; base.id = 'u' + uid(); base.name = 'Tema baru'; base.title = 'JUDUL PETA\nPERIODE'; base.legendTitle = 'Keterangan :'; base.field = ''; base.classes = []; base.legendImage = ''; S.themes.push(base); S.themeId = base.id; bump('theme'); rerender(); } }, '+ Tema kosong'),
    h('button', { class: 'btn sec', onclick: async () => {
      const f = (await pickFile('.json,application/json'))[0]; if (!f) return;
      try {
        const o = JSON.parse(await readText(f));
        if (!o || !Array.isArray(o.classes)) throw new Error('bukan berkas tema');
        o.id = 'u' + uid(); o.dsId = ''; if (o.opacity == null) o.opacity = 100; o.name = o.name || f.name.replace(/\.json$/i, ''); o.rules = o.rules || defRules(); o.label = o.label || { show: true, sizePx: 10, sizePt: 3, force: false, template: '{BLOK}' };
        S.themes.push(o); S.themeId = o.id; bump('theme'); rerender(); toast('Tema diimpor');
      } catch (e) { toast('Gagal impor tema: ' + e.message, 4000); }
    } }, 'Impor tema'),
    h('button', { class: 'btn sec', onclick: () => shareFile((t.name || 'tema').replace(/[^\w.-]+/g, '_') + '.json', JSON.stringify(t, null, 1), 'application/json', 'Tema peta') }, 'Ekspor tema'),
    h('button', { class: 'btn sec', onclick: async () => {
      if (!await confirmBox('Kembalikan 4 tema bawaan ke pengaturan awal? Tema buatan sendiri tetap ada.', 'Kembalikan')) return;
      const d = defThemes(); const ids = new Set(d.map((x) => x.id));
      S.themes = [...d, ...S.themes.filter((x) => !ids.has(x.id))];
      if (!S.themes.some((x) => x.id === S.themeId)) S.themeId = S.themes[0].id;
      bump('theme'); rerender();
    } }, 'Reset bawaan')));
  el.append(list);

  // ---- editor ----
  const ed = h('div', { class: 'card' }, h('h3', {}, 'Atur: ' + t.name));
  ed.append(section('dasar', 'Judul & kolom data',
    row('Nama tema', textInput(t.name, (v) => { t.name = v; touch(); emit('themes'); }, {})),
    row('Judul peta', textArea(t.title, (v) => { t.title = v; touch(); }, { rows: 2, placeholder: 'Baris 1\nBaris 2 (mis. periode)' })),
    row('Judul legenda', textInput(t.legendTitle, (v) => { t.legendTitle = v; touch(); })),
    row('Sumber CSV', select([['', '(otomatis: CSV aktif)'], ...S.dsList.map((d) => [d.id, d.name])], t.dsId || '', (v) => { t.dsId = v; touch(); rerender(); })),
    S.dsList.length ? null : h('div', { class: 'mut small' }, 'Belum ada CSV — impor di tab Data.'),
    row('Cara warna', select([['range', 'Rentang angka'], ['category', 'Kategori teks']], t.mode, (v) => { t.mode = v; touch(); rerender(); })),
    row('Kolom data', textInput(t.field, (v) => { t.field = v; touch(); }, { list: 'dl-fields', placeholder: 'Nama kolom CSV' })),
    t.mode === 'range' ? row('Pengali', numInput(t.scale, (v) => { t.scale = v == null ? 1 : v; touch(); }, { placeholder: '1' })) : null,
    t.mode === 'range' ? h('div', { class: 'mut small' }, 'Nilai dikalikan pengali sebelum dicocokkan ke kelas (mis. 100 bila CSV berisi 1,10 untuk 110%).') : null,
    check(!!t.showCounts, (v) => { t.showCounts = v; touch(); }, 'Tampilkan jumlah blok per kelas di legenda'),
    (() => {
      const op = t.opacity == null ? 100 : t.opacity;
      const val = h('span', { class: 'mut small', style: { minWidth: '40px', textAlign: 'right' } }, op + '%');
      const rg = h('input', { type: 'range', min: 0, max: 100, step: 5, value: op, style: { flex: 1 } });
      rg.addEventListener('input', () => { t.opacity = +rg.value; val.textContent = rg.value + '%'; touch(); });
      return h('div', {}, row('Opasitas warna', rg, val), h('div', { class: 'mut small' }, '100% = pekat, 50% = transparan sebagian (layer di bawah blok tembus pandang), 0% = hanya garis blok. Opasitas per kelas ada di bagian Kelas warna dan dikalikan dengan ini.'));
    })()));

  const clsKids = [h('div', { class: 'mut small' }, t.mode === 'category' ? 'Kelas cocok bila isi kolom sama dengan salah satu nilai (huruf besar/kecil diabaikan). Tulis * untuk “selain itu”. Urutan menentukan prioritas.' : 'Kelas cocok bila nilai ≥ min dan < maks (kosong = tanpa batas). Angka % dibaca tanpa tanda %. Urutan menentukan prioritas dan urutan legenda.')];
  t.classes.forEach((c, i) => clsKids.push(classEditor(t, c, i)));
  clsKids.push(h('div', { class: 'btns' },
    h('button', { class: 'btn sec sm', onclick: () => { t.classes.push({ id: uid(), color: PAL[t.classes.length % PAL.length], label: 'Kelas baru', min: null, max: null, values: '', pattern: 'none', pc: '#ff0004', opacity: 100 }); touch(); rerender(); } }, '+ Kelas'),
    h('button', { class: 'btn sec sm', onclick: () => uniqueValues(t) }, 'Buat dari nilai unik'),
    h('button', { class: 'btn sec sm', onclick: () => { t.classes.reverse(); touch(); rerender(); } }, 'Balik urutan')));
  clsKids.push(row('Tanpa data', colorInput(t.noData.fill || '#ffffff', (v) => { t.noData.fill = v; touch(); }), check(!!t.noData.transparent, (v) => { t.noData.transparent = v; touch(); }, 'Kosongkan (tanpa warna)')));
  ed.append(section('kelas', `Kelas warna (${t.classes.length})`, ...clsKids));

  const ruleKids = [h('div', { class: 'mut small' }, 'Aturan dicek lebih dulu sebelum kelas warna; aturan pertama yang cocok dipakai. Contoh bawaan: poligon berakhiran R dan Status “Tuntas” diarsir hijau, Yld kosong dikosongkan.')];
  (t.rules || []).forEach((r, i) => ruleKids.push(ruleEditor(t, r, i)));
  ruleKids.push(h('div', { class: 'btns' }, h('button', { class: 'btn sec sm', onclick: () => { t.rules = t.rules || []; t.rules.push({ id: 'r' + uid(), enabled: true, source: 'csv', field: 'Status', op: 'equals', value: '', fill: '#ffffff', pattern: 'diag', pc: '#000000', legendShow: true, legendGroup: 'Keterangan', legendLabel: 'Aturan baru' }); touch(); rerender(); } }, '+ Aturan')));
  ed.append(section('aturan', `Aturan khusus / arsiran (${(t.rules || []).length})`, ...ruleKids));

  const L = t.label;
  const fieldChips = [...csvHeaders(), ...polyKeys().map((k) => '@' + k)].map((k) => h('button', { class: 'chip btn2', onclick: () => { const ta = $('#tplTa'); L.template = (L.template ? L.template + '\n' : '') + '{' + k + '}'; ta.value = L.template; touch(); } }, k));
  ed.append(section('label', 'Label di dalam blok',
    check(L.show !== false, (v) => { L.show = v; touch(); }, 'Tampilkan label'),
    h('div', { class: 'mut small', style: { margin: '6px 0 4px' } }, 'Satu baris = satu baris label. Isi dengan {NamaKolom}; {@Atribut} untuk atribut poligon.'),
    textArea(L.template, (v) => { L.template = v; touch(); }, { id: 'tplTa', rows: 4, placeholder: '{BLOK}\n{Yld}\n{YOY}' }),
    h('div', { style: { margin: '6px 0' } }, fieldChips),
    row('Ukuran di layar', numInput(L.sizePx, (v) => { L.sizePx = v || 10; touch(); }), h('span', { class: 'mut small' }, 'px')),
    row('Ukuran ekspor', numInput(L.sizePt, (v) => { L.sizePt = v || 3; touch(); }), h('span', { class: 'mut small' }, 'pt kertas')),
    check(!!L.force, (v) => { L.force = v; touch(); }, 'Paksa tampil semua label (walau tidak muat)'),
    check(!!L.unmatched, (v) => { L.unmatched = v; touch(); }, 'Beri label juga pada blok tanpa data CSV')));

  const imgKids = [h('div', { class: 'mut small' }, 'Gambar tambahan di bawah legenda (mis. kurva zona toleransi).'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn sec sm', onclick: async () => { const f = (await pickFile('image/*'))[0]; if (!f) return; t.legendImage = await readDataURL(f); touch(); rerender(); } }, 'Pilih gambar'),
      h('button', { class: 'btn sec sm', onclick: () => { t.legendImage = 'asset:assets/kurva.jpg'; touch(); rerender(); } }, 'Kurva BBC'),
      h('button', { class: 'btn red sm', onclick: () => { t.legendImage = ''; touch(); rerender(); } }, 'Hapus')),
    h('div', { class: 'mut small' }, t.legendImage ? (t.legendImage.startsWith('asset:') ? 'Gambar bawaan dipakai' : 'Gambar sendiri dipakai') : 'Tidak ada gambar')];
  ed.append(section('img', 'Gambar legenda', ...imgKids));
  el.append(ed);
}
