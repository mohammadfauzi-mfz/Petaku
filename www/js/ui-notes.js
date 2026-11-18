// Tampilan catatan per blok: tab "Catatan" di kartu info, editor catatan + foto, kelola kategori (Admin), kartu pengaturan
import { h, toast, select, clone, dbGet } from './util.js';
import { getProp } from './model.js';
import { openSheet, confirmBox, row, textInput, textArea } from './ui-common.js';
import { isAdmin } from './auth.js';
import { openZoom } from './ui-zoom.js';
import { notesOn, notesFor, noteKeyOf, onNotes, catsList, DEF_CATS, saveNote, removeNote, removePhoto, canEdit, newId, pendingIds, compressImage, photoSrc, flush, syncNotes, pendingCount, scriptUrl, saveUrl, saveCats, marksOn, setMarks } from './notes.js';

const MAXPH = 5;
const fmt = (ms) => { try { return new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(ms); } };

function viewPhoto(ref) {
  const img = h('img', { alt: 'Foto catatan', style: { width: '100%', display: 'block' } });
  photoSrc(ref).then((d) => {
    img.onload = () => openZoom(h('details', { open: true }, h('summary', {}, 'Foto catatan'), img));
    img.src = d;
  }).catch((e) => toast('Foto belum bisa dimuat: ' + (e.message || e), 4000));
}
function thumb(ref, onRemove, isTmp) {
  const img = h('img', { class: 'nt-th', alt: 'Foto' });
  const box = h('span', { class: 'nt-thw' }, img);
  let data = null;
  const show = (d) => openZoom(h('details', { open: true }, h('summary', {}, 'Foto catatan'), h('img', { src: d, style: { width: '100%', display: 'block' } })));
  if (/^data:/.test(ref)) { data = ref; img.src = ref; }
  else if (isTmp) dbGet('nph:' + ref).then((d) => { if (d) { data = d; img.src = d; } });
  else photoSrc(ref).then((d) => { data = d; img.src = d; }).catch(() => { img.classList.add('nt-th-x'); });
  img.addEventListener('click', () => { if (data) show(data); else if (!isTmp) viewPhoto(ref); });
  if (onRemove) box.append(h('button', { class: 'nt-rm', type: 'button', onclick: (e) => { e.stopPropagation(); onRemove(); } }, '✕'));
  return box;
}

// ---------- editor ----------
export function openNoteEditor(layer, feat, note, done) {
  const props = feat.props || {};
  const cur = note ? { ...note } : { id: newId(), key: noteKeyOf(layer, feat), estate: getProp(props, 'Estate') || '', afd: getProp(props, 'Afdeling') || '', blok: String(getProp(props, layer.keyField) || ''), cat: '', sub: '', text: '', status: 'buka', photos: [], pp: [] };
  const cats = catsList();
  if (!cur.cat) cur.cat = cats[0].n;
  const st = { photos: [...(cur.photos || [])], pp: [...(cur.pp || [])], added: [] };
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
  const phBox = h('div', { class: 'nt-phs' });
  const drawPh = () => {
    phBox.innerHTML = '';
    for (const f of st.photos) phBox.append(thumb(f, () => { st.photos = st.photos.filter((x) => x !== f); drawPh(); }));
    for (const t of st.pp) phBox.append(thumb(t, () => { st.pp = st.pp.filter((x) => x !== t); drawPh(); }, true));
    for (const d of st.added) phBox.append(thumb(d, () => { st.added = st.added.filter((x) => x !== d); drawPh(); }));
  };
  // foto sementara (belum terkirim) tampil dari cache HP
  drawPh();
  const total = () => st.photos.length + st.pp.length + st.added.length;
  const pick = (cap) => {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple: !cap, style: { display: 'none' } });
    if (cap) inp.setAttribute('capture', 'environment');
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
    row('Status', stSel),
    h('div', { class: 'btns', style: { margin: '8px 0' } }, h('button', { class: 'btn sec sm', type: 'button', onclick: () => pick(true) }, '📷 Ambil foto'), h('button', { class: 'btn sec sm', type: 'button', onclick: () => pick(false) }, '🖼 Galeri')),
    phBox, msg);
  const save = h('button', { class: 'btn' }, 'Simpan');
  save.onclick = async () => {
    const text = ta.value.trim();
    if (!text && !total()) { toast('Isi catatan atau tambahkan foto'); return; }
    save.disabled = true;
    try {
      // foto lama yang dibuang
      for (const f of (cur.photos || []).filter((x) => !st.photos.includes(x))) await removePhoto({ id: cur.id }, f);
      for (const t of (cur.pp || []).filter((x) => !st.pp.includes(x))) await removePhoto({ id: cur.id }, t);
      await saveNote({ ...cur, text, cat: catSel.value, sub: subSel.value, status: stSel.value, photos: st.photos, pp: st.pp }, st.added);
      close(); toast(navigator.onLine ? 'Catatan tersimpan' : 'Catatan tersimpan di HP, terkirim saat online'); if (done) done();
    } catch (e) { toast('Gagal: ' + (e.message || e), 4500); save.disabled = false; }
  };
  body.append(h('div', { class: 'btns' }, save));
  const close = openSheet(note ? 'Ubah catatan' : 'Catatan baru', body);
}

// ---------- tab Catatan ----------
export function buildNotesPane(layer, feat) {
  const key = noteKeyOf(layer, feat);
  const props = feat.props || {};
  const blok = String(getProp(props, layer.keyField) || '');
  const box = h('div', { class: 'ic nt' });
  let seen = false;
  const draw = () => {
    if (seen && !box.isConnected) { off(); return; }
    box.innerHTML = '';
    const list = notesFor(key), open = list.filter((n) => n.status !== 'selesai').length;
    box.append(h('div', { class: 'ic-hd' }, h('div', { class: 'ic-code' }, 'Catatan ' + blok), h('div', { class: 'ic-badges' }, h('span', { class: 'bdg' }, list.length + ' catatan'), open ? h('span', { class: 'bdg dark' }, open + ' terbuka') : null)));
    const sync = h('button', { class: 'btn sec sm' }, '⟳ Sinkron');
    sync.onclick = async () => { sync.disabled = true; try { const r = await syncNotes(); toast(`Sinkron: ${r.got} catatan baru${r.pending ? ', ' + r.pending + ' menunggu kirim' : ''}`); } catch (e) { toast(e.message || String(e), 4000); } sync.disabled = false; };
    box.append(h('div', { class: 'btns', style: { margin: '6px 0 10px' } }, h('button', { class: 'btn sm', onclick: () => openNoteEditor(layer, feat, null) }, '+ Catatan'), sync));
    if (!list.length) box.append(h('div', { class: 'ic-none' }, 'Belum ada catatan untuk blok ini.'));
    for (const n of list) box.append(noteItem(n, layer, feat));
  };
  const off = onNotes(draw);
  draw(); seen = true;
  setTimeout(() => { seen = true; }, 0);
  return box;
}
function noteItem(n, layer, feat) {
  const el = h('div', { class: 'nt-i' + (n.status === 'selesai' ? ' done' : '') });
  const top = h('div', { class: 'nt-top' }, h('span', { class: 'bdg' }, n.cat + (n.sub ? ' › ' + n.sub : '')));
  const stb = h('span', { class: 'bdg ' + (n.status === 'selesai' ? '' : 'dark') + (canEdit(n) ? ' nt-st' : ''), title: canEdit(n) ? 'Ketuk untuk ganti status' : '' }, n.status === 'selesai' ? '✔ Selesai' : '● Terbuka');
  if (canEdit(n)) stb.addEventListener('click', () => saveNote({ ...n, status: n.status === 'selesai' ? 'buka' : 'selesai' }));
  top.append(stb); el.append(top);
  if (n.text) el.append(h('div', { class: 'nt-tx' }, n.text));
  if ((n.photos || []).length || (n.pp || []).length) { const w = h('div', { class: 'nt-phs' }); for (const f of n.photos || []) w.append(thumb(f)); for (const t of n.pp || []) w.append(thumb(t, null, true)); el.append(w); }
  const ft = h('div', { class: 'nt-ft' }, h('span', {}, `${n.name || n.by} · ${fmt(n.at)}${n.updatedAt - n.at > 60000 ? ' (diubah)' : ''}`));
  if ((n.pp || []).length || pendingIds().has(n.id)) ft.append(h('span', { class: 'nt-wait' }, '⏳ menunggu kirim'));
  if (canEdit(n)) {
    ft.append(h('span', { class: 'nt-act' },
      h('button', { class: 'btn sec sm', onclick: () => openNoteEditor(layer, feat, n) }, 'Ubah'),
      h('button', { class: 'btn sec sm', onclick: async () => { if (await confirmBox('Hapus catatan ini?', 'Hapus')) { await removeNote(n); toast('Catatan dihapus'); } } }, 'Hapus')));
  }
  el.append(ft);
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

// ---------- kartu di Pengaturan ----------
export function notesSettingsCard() {
  if (!notesOn()) return null;
  const card = h('div', { class: 'card' }, h('h3', {}, 'Catatan & foto'));
  const st = h('div', { class: 'mut small', style: { minHeight: '1.4em' } });
  const upd = () => { st.textContent = pendingCount() ? `${pendingCount()} item menunggu dikirim.` : 'Semua catatan sudah terkirim.'; };
  upd(); onNotes(() => { if (st.isConnected) upd(); });
  const b = h('button', { class: 'btn sec' }, '⟳ Sinkron catatan sekarang');
  b.onclick = async () => { b.disabled = true; try { const r = await syncNotes(); st.style.color = ''; st.textContent = `✔ ${r.got} catatan baru${r.pending ? ' · ' + r.pending + ' menunggu kirim' : ''}`; if (r.err) st.textContent += ' · ' + r.err.message; } catch (e) { st.style.color = 'var(--warn)'; st.textContent = '⚠ ' + (e.message || e); } b.disabled = false; };
  const mk = h('label', { style: { display: 'flex', gap: '7px', alignItems: 'center', fontSize: '14px', margin: '8px 0' } });
  const ck = h('input', { type: 'checkbox', checked: marksOn() }); ck.addEventListener('change', () => setMarks(ck.checked));
  mk.append(ck, 'Tampilkan penanda catatan di peta (titik oranye = ada catatan terbuka, hijau = semua selesai)');
  card.append(mk, h('div', { class: 'btns' }, b), st);
  if (isAdmin()) {
    const url = textInput(scriptUrl(), () => {}, { placeholder: 'https://script.google.com/macros/s/…/exec', autocapitalize: 'none' });
    const sv = h('button', { class: 'btn sm' }, 'Simpan alamat');
    sv.onclick = async () => { sv.disabled = true; try { const v = url.value.trim(); if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) throw new Error('Alamat harus berakhiran /exec dan berasal dari script.google.com'); await saveUrl(v); toast('Alamat server foto disimpan & tersinkron ke pengguna'); } catch (e) { toast(e.message || String(e), 4500); } sv.disabled = false; };
    card.append(h('div', { style: { marginTop: '10px' } }, h('b', {}, 'Server foto (Admin)'), h('div', { class: 'mut small' }, 'Alamat Web App Apps Script (Google Drive). Pengguna menerimanya otomatis saat sinkron.'), url, h('div', { class: 'btns', style: { marginTop: '6px' } }, sv, h('button', { class: 'btn sec sm', onclick: openCatEditor }, 'Kelola kategori'))));
  }
  void flush;
  return card;
}
