// Tampilan catatan per blok: tab "Catatan" di kartu info, editor (volume, progres, foto, koordinat), arah & jarak, kategori (Admin), kartu Data & Pengaturan
import { h, toast, select, clone, dbGet } from './util.js';
import { getProp } from './model.js';
import { openSheet, confirmBox, row, textInput, textArea } from './ui-common.js';
import { isAdmin } from './auth.js';
import { openZoom } from './ui-zoom.js';
import { notesOn, notesFor, noteKeyOf, onNotes, catsList, DEF_CATS, saveNote, removeNote, removePhoto, canEdit, newId, pendingIds, compressImage, photoSrc, syncNotes, pendingCount, scriptUrl, saveUrl, saveCats, marksOn, setMarks, hasCoord, setProgress, areaOptions, filterList, setFilter, pingServer, coordNotes } from './notes.js';

const MAXPH = 5;
const fmt = (ms) => { try { return new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(ms); } };
const nf = (v) => { const x = Math.round((+v || 0) * 100) / 100; return x.toLocaleString('id-ID'); };
const UNITS = ['m', 'm²', 'm³', 'ha', 'unit', 'titik', 'pkk', 'kg', 'ton'];
export const baseOf = (layer, feat) => { const p = feat.props || {}; return { key: noteKeyOf(layer, feat), estate: getProp(p, 'Estate') || '', afd: getProp(p, 'Afdeling') || '', blok: String(getProp(p, layer.keyField) || '') }; };

function showImg(d) { openZoom(h('details', { open: true }, h('summary', {}, 'Foto catatan'), h('img', { src: d, style: { width: '100%', display: 'block' } }))); }
function thumb(ref, onRemove, isTmp) {
  const img = h('img', { class: 'nt-th', alt: 'Foto' });
  const box = h('span', { class: 'nt-thw' }, img);
  let data = null;
  if (/^data:/.test(ref)) { data = ref; img.src = ref; }
  else if (isTmp) dbGet('nph:' + ref).then((d) => { if (d) { data = d; img.src = d; } });
  else photoSrc(ref).then((d) => { data = d; img.src = d; }).catch(() => { img.classList.add('nt-th-x'); });
  img.addEventListener('click', async () => {
    if (data) return showImg(data);
    if (isTmp) return;
    try { data = await photoSrc(ref); img.src = data; img.classList.remove('nt-th-x'); showImg(data); } catch (e) { toast('Foto belum bisa dimuat: ' + (e.message || e), 4500); }
  });
  if (onRemove) box.append(h('button', { class: 'nt-rm', type: 'button', onclick: (e) => { e.stopPropagation(); onRemove(); } }, '✕'));
  return box;
}

// ---------- jarak & arah ----------
const R = 6371000, rad = (x) => x * Math.PI / 180;
export function distBearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = p2 - p1, dl = rad(b.lon - a.lon);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  const y = Math.sin(dl) * Math.cos(p2), z = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { d, br: (Math.atan2(y, z) * 180 / Math.PI + 360) % 360 };
}
const DIRS = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const dirName = (br) => DIRS[Math.round(br / 45) % 8];
export const fmtDist = (d) => (d >= 1000 ? (d / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' km' : Math.round(d).toLocaleString('id-ID') + ' m');

function navPanel(n) {
  const arrow = h('div', { class: 'nt-arrow' });
  arrow.innerHTML = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M12 2 L20 20 L12 15 L4 20 Z" fill="#0b6b45" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const txt = h('div', { class: 'nt-navt' }, 'Mencari lokasi Anda…');
  const sub = h('div', { class: 'mut small' });
  const box = h('div', { class: 'nt-nav' }, arrow, h('div', {}, txt, sub));
  let me = null, heading = null, wid = null;
  const upd = () => {
    if (!me) return;
    const { d, br } = distBearing(me, n);
    txt.textContent = `${fmtDist(d)} · ${dirName(br)} (${Math.round(br)}°)`;
    arrow.style.transform = `rotate(${Math.round(br - (heading == null ? 0 : heading))}deg)`;
    sub.textContent = (heading == null ? 'Kompas HP tidak terbaca: panah menunjuk arah dari utara. ' : 'Panah mengikuti arah HP. ') + `Akurasi lokasi ±${Math.round(me.acc || 0)} m.`;
  };
  if (!navigator.geolocation) txt.textContent = 'GPS tidak tersedia di perangkat ini';
  else wid = navigator.geolocation.watchPosition((p) => { me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; upd(); },
    (e) => { txt.textContent = e.code === 1 ? 'Izin lokasi ditolak: aktifkan izin lokasi untuk Petaku' : 'Lokasi belum didapat (cek GPS aktif, coba di tempat terbuka)'; },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  const onOri = (e) => {
    let hd = null;
    if (typeof e.webkitCompassHeading === 'number') hd = e.webkitCompassHeading;
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) hd = (360 - e.alpha) % 360;
    if (hd != null) { heading = hd; upd(); }
  };
  window.addEventListener('deviceorientationabsolute', onOri); window.addEventListener('deviceorientation', onOri);
  box.stop = () => { if (wid != null) navigator.geolocation.clearWatch(wid); window.removeEventListener('deviceorientationabsolute', onOri); window.removeEventListener('deviceorientation', onOri); };
  return box;
}
export function openNoteDetail(n0) {
  const body = h('div', {});
  const nav = hasCoord(n0) ? navPanel(n0) : null;
  const holder = h('div', {});
  const draw = () => {
    const n = notesFor(n0.key).find((x) => x.id === n0.id) || n0;
    holder.innerHTML = ''; holder.append(noteItem(n, { key: n.key, estate: n.estate, afd: n.afd, blok: n.blok }, true));
  };
  draw();
  const off = onNotes(() => { if (holder.isConnected) draw(); });
  const act = h('div', { class: 'btns', style: { marginTop: '8px' } });
  if (nav) act.append(h('button', { class: 'btn sec', onclick: async () => {
    const [m, g] = await Promise.all([import('./ui-map.js'), import('./geo.js')]);
    const [x, y] = g.toWorld(n0.lon, n0.lat), d = 0.0004; close(); m.zoomToBBox([x - d, y - d, x + d, y + d], 0.2);
  } }, '🎯 Pusatkan di peta'));
  body.append(h('div', { class: 'mut small', style: { marginBottom: '6px' } }, `Blok ${n0.blok}${n0.afd ? ' · ' + n0.afd : ''}${n0.estate ? ' · ' + n0.estate : ''}`), nav || h('div', { class: 'mut small' }, 'Catatan ini tidak punya koordinat.'), holder, act);
  const close = openSheet('Catatan', body, { onClose: () => { off(); if (nav) nav.stop(); } });
}

// ---------- editor ----------
export function openNoteEditor(base, note, done) {
  const cur = note ? { ...note } : { id: newId(), key: base.key, estate: base.estate, afd: base.afd, blok: base.blok, cat: '', sub: '', text: '', status: 'buka', photos: [], pp: [], vol: 0, done: 0, unit: '' };
  const cats = catsList();
  if (!cur.cat) cur.cat = cats[0].n;
  const st = { photos: [...(cur.photos || [])], pp: [...(cur.pp || [])], added: [], pos: hasCoord(cur) ? { lat: cur.lat, lon: cur.lon, acc: cur.acc || 0 } : null, wid: null };
  const body = h('div', { class: 'nt-ed' });
  const catSel = select(cats.map((c) => c.n).concat(cats.some((c) => c.n === cur.cat) ? [] : [cur.cat]), cur.cat, () => fillSub());
  const subSel = select([''], '', null);
  const subRow = row('Sub kategori', subSel);
  const fillSub = () => {
    const c = cats.find((x) => x.n === catSel.value); const list = c ? c.s : [];
    const opts = ['', ...list]; if (cur.sub && !opts.includes(cur.sub) && catSel.value === cur.cat) opts.push(cur.sub);
    subSel.innerHTML = ''; opts.forEach((o) => subSel.append(h('option', { value: o }, o || (list.length ? '— pilih —' : '—'))));
    subSel.value = catSel.value === cur.cat && opts.includes(cur.sub) ? cur.sub : '';
    subRow.style.display = list.length || subSel.value ? '' : 'none';
  };
  fillSub();
  const ta = textArea(cur.text, () => {}, { rows: 4, placeholder: 'Tulis catatan…', style: { width: '100%' } });
  const stSel = select([['buka', 'Terbuka'], ['selesai', 'Selesai']], cur.status || 'buka', null);
  // volume & progres
  const num = (v) => h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: v ? String(v) : '', style: { width: '100px' } });
  const vol = num(cur.vol), dn = num(cur.done);
  const unit = h('input', { type: 'text', list: 'ntUnits', value: cur.unit || '', placeholder: 'satuan', style: { width: '90px' } });
  const dl = h('datalist', { id: 'ntUnits' }); UNITS.forEach((u) => dl.append(h('option', { value: u })));
  const doneRow = row('Realisasi', dn, h('span', { class: 'mut small' }, 'dari volume'));
  const showDone = () => { doneRow.style.display = +vol.value > 0 ? '' : 'none'; };
  vol.addEventListener('input', showDone); showDone();
  // koordinat
  const posTx = h('span', { class: 'mut small' });
  const updPos = () => { posTx.textContent = st.pos ? `📍 ${st.pos.lat.toFixed(6)}, ${st.pos.lon.toFixed(6)} (±${Math.round(st.pos.acc || 0)} m)` : 'Belum ada koordinat (otomatis terisi saat memakai Ambil foto)'; };
  const stopWatch = () => { if (st.wid != null && navigator.geolocation) { navigator.geolocation.clearWatch(st.wid); st.wid = null; } };
  const startWatch = (force) => {
    if (!navigator.geolocation) { toast('GPS tidak tersedia di perangkat ini', 3000); return; }
    if (st.wid != null) return;
    if (force) st.pos = null;
    st.wid = navigator.geolocation.watchPosition((p) => {
      const q = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      if (!st.pos || (st.auto && q.acc <= st.pos.acc + 1)) { st.pos = q; st.auto = true; updPos(); }
    }, (e) => { if (e.code === 1) toast('Izin lokasi ditolak: koordinat tidak bisa diambil', 4000); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  };
  updPos();
  const posRow = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } }, posTx,
    h('button', { class: 'btn sec sm', type: 'button', onclick: () => { stopWatch(); st.auto = true; startWatch(true); updPos(); toast('Mengambil koordinat…', 1800); } }, '📍 Ambil'),
    h('button', { class: 'btn sec sm', type: 'button', onclick: () => { stopWatch(); st.pos = null; st.auto = false; updPos(); } }, 'Hapus'));
  const phBox = h('div', { class: 'nt-phs' });
  const drawPh = () => {
    phBox.innerHTML = '';
    for (const f of st.photos) phBox.append(thumb(f, () => { st.photos = st.photos.filter((x) => x !== f); drawPh(); }));
    for (const t of st.pp) phBox.append(thumb(t, () => { st.pp = st.pp.filter((x) => x !== t); drawPh(); }, true));
    for (const d of st.added) phBox.append(thumb(d, () => { st.added = st.added.filter((x) => x !== d); drawPh(); }));
  };
  drawPh();
  const total = () => st.photos.length + st.pp.length + st.added.length;
  const pick = (cap) => {
    if (cap && !st.pos) { st.auto = true; startWatch(false); }   // kamera: ambil koordinat bersamaan dengan foto
    const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (cap) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.addEventListener('change', async () => {
      for (const f of [...inp.files]) {
        if (total() >= MAXPH) { toast('Maksimal ' + MAXPH + ' foto per catatan'); break; }
        try { st.added.push(await compressImage(f, 150)); } catch (e) { toast('Foto gagal diproses: ' + e.message); }
      }
      drawPh(); inp.remove();
    });
    document.body.append(inp); inp.click();
  };
  const msg = h('div', { class: 'mut small' });
  if (!scriptUrl()) msg.textContent = 'Alamat server foto belum diisi Admin. Foto disimpan di HP dan terkirim setelah Admin mengisinya.';
  body.append(
    h('div', { class: 'mut small', style: { marginBottom: '6px' } }, `Blok ${cur.blok}${cur.afd ? ' · ' + cur.afd : ''}${cur.estate ? ' · ' + cur.estate : ''}`),
    row('Kategori', catSel), subRow, ta,
    row('Volume', vol, unit), dl, doneRow,
    row('Status', stSel),
    h('div', { class: 'btns', style: { margin: '8px 0' } }, h('button', { class: 'btn sec sm', type: 'button', onclick: () => pick(true) }, '📷 Ambil foto'), h('button', { class: 'btn sec sm', type: 'button', onclick: () => pick(false) }, '🖼 Galeri')),
    phBox, posRow, msg);
  const save = h('button', { class: 'btn' }, 'Simpan');
  save.onclick = async () => {
    const text = ta.value.trim();
    if (!text && !total() && !(+vol.value > 0)) { toast('Isi catatan, volume, atau tambahkan foto'); return; }
    save.disabled = true;
    try {
      for (const f of (cur.photos || []).filter((x) => !st.photos.includes(x))) await removePhoto({ id: cur.id }, f);
      for (const t of (cur.pp || []).filter((x) => !st.pp.includes(x))) await removePhoto({ id: cur.id }, t);
      const v = Math.max(0, +vol.value || 0), dd = v > 0 ? Math.max(0, +dn.value || 0) : 0;
      let status = stSel.value; if (v > 0 && dd >= v) status = 'selesai';
      const pos = st.pos || { lat: NaN, lon: NaN, acc: 0 };
      await saveNote({ ...cur, text, cat: catSel.value, sub: subSel.value, status, photos: st.photos, pp: st.pp, vol: v, done: dd, unit: v > 0 ? unit.value.trim() : '', lat: pos.lat, lon: pos.lon, acc: pos.acc }, st.added);
      close(); toast(navigator.onLine ? 'Catatan tersimpan' : 'Catatan tersimpan di HP, terkirim saat online'); if (done) done();
    } catch (e) { toast('Gagal: ' + (e.message || e), 4500); save.disabled = false; }
  };
  body.append(h('div', { class: 'btns' }, save));
  const close = openSheet(note ? 'Ubah catatan' : 'Catatan baru', body, { onClose: stopWatch });
}

function openProgress(n) {
  const inp = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: String(n.done || 0), style: { width: '120px' } });
  const quick = h('div', { class: 'btns', style: { margin: '8px 0' } });
  for (const p of [25, 50, 75, 100]) quick.append(h('button', { class: 'btn sec sm', type: 'button', onclick: () => { inp.value = String(Math.round(n.vol * p) / 100); } }, p + '%'));
  const sv = h('button', { class: 'btn' }, 'Simpan progres');
  sv.onclick = async () => { sv.disabled = true; try { await setProgress(n, inp.value); close(); toast('Progres diperbarui'); } catch (e) { toast(e.message || String(e), 4000); sv.disabled = false; } };
  const close = openSheet('Update progres', h('div', {}, h('div', { class: 'mut small' }, `Target ${nf(n.vol)} ${n.unit || ''}. Isi realisasi terkini (kumulatif).`), row('Realisasi', inp, h('span', {}, n.unit || '')), quick, sv));
}
const bar = (n) => {
  const pct = Math.max(0, Math.min(100, n.vol > 0 ? (n.done / n.vol) * 100 : 0));
  return h('div', { class: 'nt-prog' }, h('div', { class: 'nt-bar' }, h('div', { class: 'nt-fill' + (pct >= 100 ? ' full' : ''), style: { width: pct + '%' } })),
    h('div', { class: 'nt-pt' }, `${nf(n.done)} / ${nf(n.vol)} ${n.unit || ''} (${Math.round(pct)}%)`));
};

// ---------- tab Catatan ----------
export function buildNotesPane(layer, feat) {
  const base = baseOf(layer, feat);
  const box = h('div', { class: 'ic nt' });
  let seen = false;
  const draw = () => {
    if (seen && !box.isConnected) { off(); return; }
    box.innerHTML = '';
    const list = notesFor(base.key), open = list.filter((n) => n.status !== 'selesai').length;
    box.append(h('div', { class: 'ic-hd' }, h('div', { class: 'ic-code' }, 'Catatan ' + base.blok), h('div', { class: 'ic-badges' }, h('span', { class: 'bdg' }, list.length + ' catatan'), open ? h('span', { class: 'bdg dark' }, open + ' terbuka') : null)));
    box.append(h('div', { class: 'btns', style: { margin: '6px 0 10px' } }, h('button', { class: 'btn sm', onclick: () => openNoteEditor(base, null) }, '+ Catatan')));
    if (!list.length) box.append(h('div', { class: 'ic-none' }, 'Belum ada catatan untuk blok ini. Sinkron catatan ada di tab Data.'));
    for (const n of list) box.append(noteItem(n, base));
  };
  const off = onNotes(draw);
  draw(); seen = true;
  return box;
}
function noteItem(n, base, inDetail) {
  const el = h('div', { class: 'nt-i' + (n.status === 'selesai' ? ' done' : '') });
  const top = h('div', { class: 'nt-top' }, h('span', { class: 'bdg' }, n.cat + (n.sub ? ' › ' + n.sub : '')));
  const stb = h('span', { class: 'bdg ' + (n.status === 'selesai' ? '' : 'dark') + (canEdit(n) ? ' nt-st' : ''), title: canEdit(n) ? 'Ketuk untuk ganti status' : '' }, n.status === 'selesai' ? '✔ Selesai' : '● Terbuka');
  if (canEdit(n)) stb.addEventListener('click', () => saveNote({ ...n, status: n.status === 'selesai' ? 'buka' : 'selesai' }));
  top.append(stb); el.append(top);
  if (n.text) el.append(h('div', { class: 'nt-tx' }, n.text));
  if (n.vol > 0) el.append(bar(n));
  if ((n.photos || []).length || (n.pp || []).length) { const w = h('div', { class: 'nt-phs' }); for (const f of n.photos || []) w.append(thumb(f)); for (const t of n.pp || []) w.append(thumb(t, null, true)); el.append(w); }
  const ft = h('div', { class: 'nt-ft' }, h('span', {}, `${n.name || n.by} · ${fmt(n.at)}${n.updatedAt - n.at > 60000 ? ' (diubah)' : ''}`));
  if ((n.pp || []).length || pendingIds().has(n.id)) ft.append(h('span', { class: 'nt-wait' }, '⏳ menunggu kirim'));
  el.append(ft);
  const act = h('div', { class: 'nt-act' });
  if (hasCoord(n) && !inDetail) act.append(h('button', { class: 'btn sec sm', onclick: () => openNoteDetail(n) }, '🧭 Arah & jarak'));
  if (canEdit(n)) {
    if (n.vol > 0) act.append(h('button', { class: 'btn sm', onclick: () => openProgress(n) }, 'Progres'));
    act.append(h('button', { class: 'btn sec sm', onclick: () => openNoteEditor(base, n) }, 'Ubah'),
      h('button', { class: 'btn sec sm', onclick: async () => { if (await confirmBox('Hapus catatan ini?', 'Hapus')) { await removeNote(n); toast('Catatan dihapus'); } } }, 'Hapus'));
  }
  if (act.children.length) el.append(act);
  return el;
}

// ---------- kelola kategori (Admin) ----------
export function openCatEditor() {
  let list = clone(catsList());
  const body = h('div', {});
  const draw = () => {
    body.innerHTML = '';
    body.append(h('div', { class: 'mut small' }, 'Kategori dan sub kategori berlaku untuk semua pengguna. Mengubah nama tidak mengubah catatan lama.'));
    list.forEach((c, ci) => {
      const card = h('div', { class: 'card' });
      card.append(h('div', { style: { display: 'flex', gap: '6px' } }, textInput(c.n, (v) => { c.n = v; }, { placeholder: 'Nama kategori' }), h('button', { class: 'btn sec sm', onclick: () => { list.splice(ci, 1); draw(); } }, 'Hapus')));
      c.s.forEach((s, si) => card.append(h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', marginLeft: '14px' } }, textInput(s, (v) => { c.s[si] = v; }, { placeholder: 'Sub kategori' }), h('button', { class: 'btn sec sm', onclick: () => { c.s.splice(si, 1); draw(); } }, '✕'))));
      card.append(h('button', { class: 'btn sec sm', style: { marginTop: '6px' }, onclick: () => { c.s.push(''); draw(); } }, '+ Sub kategori'));
      body.append(card);
    });
    const sv = h('button', { class: 'btn' }, 'Simpan');
    sv.onclick = async () => {
      const out = list.map((c) => ({ n: String(c.n).trim(), s: c.s.map((x) => String(x).trim()).filter(Boolean) })).filter((c) => c.n);
      if (!out.length) { toast('Minimal satu kategori'); return; }
      sv.disabled = true;
      try { await saveCats(out); toast('Kategori disimpan & tersinkron'); close(); } catch (e) { toast(e.message || String(e), 4500); sv.disabled = false; }
    };
    body.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => { list.push({ n: '', s: [] }); draw(); } }, '+ Kategori'), h('button', { class: 'btn sec', onclick: () => { list = clone(DEF_CATS); draw(); } }, 'Pulihkan bawaan'), sv));
  };
  draw();
  const close = openSheet('Kategori catatan', body);
}

// ---------- pilih area (Estate / Afdeling) ----------
function openAreaPicker(after) {
  const opts = areaOptions();
  const sel = new Set(filterList());
  const body = h('div', {});
  body.append(h('div', { class: 'mut small', style: { marginBottom: '6px' } }, 'Pilih area yang dibutuhkan. Hanya catatan di area terpilih yang diunduh dan ditampilkan. Tanpa pilihan = semua area.'));
  const byE = new Map();
  for (const o of opts) { const k = o.e || '(tanpa estate)'; if (!byE.has(k)) byE.set(k, []); byE.get(k).push(o); }
  if (!opts.length) body.append(h('div', { class: 'ic-none' }, 'Belum ada data blok. Impor/tarik data peta dulu.'));
  for (const [e, arr] of byE) {
    const eb = h('input', { type: 'checkbox' });
    const subs = arr.map((o) => { const cb = h('input', { type: 'checkbox', checked: sel.has(o.k) }); cb.addEventListener('change', () => { cb.checked ? sel.add(o.k) : sel.delete(o.k); syncE(); }); return { o, cb }; });
    const syncE = () => { const n = subs.filter((x) => x.cb.checked).length; eb.checked = n === subs.length; eb.indeterminate = n > 0 && n < subs.length; };
    eb.addEventListener('change', () => { subs.forEach((x) => { x.cb.checked = eb.checked; eb.checked ? sel.add(x.o.k) : sel.delete(x.o.k); }); });
    syncE();
    const card = h('div', { class: 'card' }, h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: '700' } }, eb, 'Estate ' + e));
    const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', margin: '6px 0 0 22px' } });
    for (const { o, cb } of subs) grid.append(h('label', { style: { display: 'flex', gap: '5px', alignItems: 'center', fontSize: '14px' } }, cb, o.a || '(tanpa afdeling)'));
    card.append(grid); body.append(card);
  }
  const sv = h('button', { class: 'btn' }, 'Simpan & sinkron');
  sv.onclick = async () => {
    sv.disabled = true;
    try {
      const all = opts.length && opts.every((o) => sel.has(o.k));
      await setFilter(all ? [] : [...sel]); close(); if (after) after();
    } catch (e) { toast(e.message || String(e), 4000); sv.disabled = false; }
  };
  body.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => { sel.clear(); close(); setFilter([]).then(() => after && after()); } }, 'Semua area'), sv));
  const close = openSheet('Area catatan', body);
}

// ---------- kartu di tab Data ----------
export function notesDataCard() {
  if (!notesOn()) return null;
  const card = h('div', { class: 'card' }, h('h3', {}, 'Catatan blok'));
  const info = h('div', { class: 'mut small' });
  const st = h('div', { class: 'mut small', style: { minHeight: '1.4em', marginTop: '6px' } });
  const upd = () => {
    const f = filterList();
    const all = areaOptions();
    const cnt = coordNotes().length;
    info.textContent = `Area: ${f.length ? f.length + ' afdeling dipilih' + (all.length ? ' dari ' + all.length : '') : 'semua'}. ${pendingCount() ? pendingCount() + ' item menunggu dikirim.' : 'Semua catatan sudah terkirim.'}${cnt ? ' ' + cnt + ' catatan berkoordinat.' : ''}`;
  };
  upd(); onNotes(() => { if (info.isConnected) upd(); });
  const run = async (b) => {
    b.disabled = true; st.style.color = ''; st.textContent = 'Menyinkronkan…';
    try { const r = await syncNotes(); st.textContent = `✔ ${r.got} catatan baru${r.pending ? ' · ' + r.pending + ' menunggu kirim' : ''}`; if (r.err) { st.style.color = 'var(--warn)'; st.textContent += ' · ⚠ ' + r.err.message; } }
    catch (e) { st.style.color = 'var(--warn)'; st.textContent = '⚠ ' + (e.message || e); }
    b.disabled = false; upd();
  };
  const b = h('button', { class: 'btn' }, '⟳ Sinkron catatan');
  b.onclick = () => run(b);
  card.append(info, h('div', { class: 'btns', style: { marginTop: '8px' } }, b, h('button', { class: 'btn sec', onclick: () => openAreaPicker(() => run(b)) }, 'Pilih area')), st);
  return card;
}

// ---------- kartu di Pengaturan ----------
export function notesSettingsCard() {
  if (!notesOn()) return null;
  const card = h('div', { class: 'card' }, h('h3', {}, 'Catatan & foto'));
  const mk = h('label', { style: { display: 'flex', gap: '7px', alignItems: 'center', fontSize: '14px', margin: '8px 0' } });
  const ck = h('input', { type: 'checkbox', checked: marksOn() }); ck.addEventListener('change', () => setMarks(ck.checked));
  mk.append(ck, 'Tampilkan penanda catatan di peta (oranye = ada yang terbuka, hijau = semua selesai)');
  const st = h('div', { class: 'mut small', style: { minHeight: '1.4em', marginTop: '6px' } }, 'Sinkron catatan ada di tab Data.');
  const tb = h('button', { class: 'btn sec sm' }, 'Tes server foto');
  tb.onclick = async () => { tb.disabled = true; st.style.color = ''; st.textContent = 'Menguji…'; try { const ms = await pingServer(); st.textContent = `✔ Server foto terhubung (${ms} ms)`; } catch (e) { st.style.color = 'var(--warn)'; st.textContent = '⚠ ' + (e.message || e); } tb.disabled = false; };
  card.append(mk, h('div', { class: 'btns' }, tb), st);
  if (isAdmin()) {
    const url = textInput(scriptUrl(), () => {}, { placeholder: 'https://script.google.com/macros/s/…/exec', autocapitalize: 'none' });
    const sv = h('button', { class: 'btn sm' }, 'Simpan alamat');
    sv.onclick = async () => { sv.disabled = true; try { const v = url.value.trim(); if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) throw new Error('Alamat harus berakhiran /exec dan berasal dari script.google.com'); await saveUrl(v); toast('Alamat server foto disimpan & tersinkron ke pengguna'); } catch (e) { toast(e.message || String(e), 4500); } sv.disabled = false; };
    card.append(h('div', { style: { marginTop: '10px' } }, h('b', {}, 'Server foto (Admin)'), h('div', { class: 'mut small' }, 'Alamat Web App Apps Script (Google Drive). Pengguna menerimanya otomatis saat sinkron.'), url, h('div', { class: 'btns', style: { marginTop: '6px' } }, sv, h('button', { class: 'btn sec sm', onclick: openCatEditor }, 'Kelola kategori'))));
  }
  return card;
}
