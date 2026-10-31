// Filter peta: pilih estate / afdeling / syarat kolom agar peta & ekspor hanya memuat area tertentu
import { S, theme, bump, getProp, computeStats, filterActive, filterSummary } from './model.js';
import { h, select, uid } from './util.js';
import { openSheet, check, textInput } from './ui-common.js';
import { OPS } from './ui-theme.js';
import { doFit } from './ui-map.js';

function distinct(fn) {
  const set = new Set();
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    for (const f of rt.feats) { const v = fn(f); if (v) set.add(String(v).trim()); }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
}

export function filterOf(t) {
  if (!t.filter) t.filter = { mode: 'hide', estates: [], afds: [], conds: [], titleNote: true };
  const f = t.filter;
  f.estates = f.estates || []; f.afds = f.afds || []; f.conds = f.conds || [];
  if (!f.mode) f.mode = 'hide';
  return f;
}

export function openFilter() {
  const t = theme();
  const f = filterOf(t);
  const host = h('div', {});
  const changed = (fit) => { bump('style'); if (fit) doFit(); upd(); };
  const cnt = h('div', { class: 'ok', style: { margin: '6px 0', fontWeight: '600' } });
  const upd = () => {
    const st = computeStats();
    cnt.textContent = filterActive(t) ? `${st.pass || 0} dari ${st.total || 0} blok tampil` : `Filter tidak aktif · ${st.total || 0} blok`;
  };

  const chips = (title, items, sel, onToggle) => {
    const box = h('div', { class: 'card' }, h('h3', {}, title));
    if (!items.length) { box.append(h('span', { class: 'mut' }, 'Tidak ada data')); return box; }
    const wrap = h('div', {});
    for (const it of items) {
      const on = sel.some((x) => x.toLowerCase() === it.toLowerCase());
      wrap.append(h('button', { class: 'chip btn2 fchip' + (on ? ' sel' : ''), onclick: () => onToggle(it, on) }, it));
    }
    box.append(wrap);
    return box;
  };

  const render = () => {
    host.innerHTML = '';
    host.append(cnt);
    const estates = distinct((x) => getProp(x.props, 'Estate'));
    host.append(chips('Estate', estates, f.estates, (it, on) => {
      f.estates = on ? f.estates.filter((x) => x.toLowerCase() !== it.toLowerCase()) : [...f.estates, it];
      // buang afdeling yang tidak termasuk estate terpilih
      if (f.estates.length) {
        const ok = new Set(distinct((x) => f.estates.some((e) => e.toLowerCase() === String(getProp(x.props, 'Estate') || '').trim().toLowerCase()) ? getProp(x.props, 'Afdeling') : '').map((a) => a.toLowerCase()));
        f.afds = f.afds.filter((a) => ok.has(a.toLowerCase()));
      }
      changed(true); render();
    }));
    const estSel = f.estates.map((e) => e.toLowerCase());
    const afds = distinct((x) => (!estSel.length || estSel.includes(String(getProp(x.props, 'Estate') || '').trim().toLowerCase())) ? getProp(x.props, 'Afdeling') : '');
    host.append(chips('Afdeling' + (estSel.length ? ' (dari estate terpilih)' : ''), afds, f.afds, (it, on) => {
      f.afds = on ? f.afds.filter((x) => x.toLowerCase() !== it.toLowerCase()) : [...f.afds, it];
      changed(true); render();
    }));

    const cc = h('div', { class: 'card' }, h('h3', {}, 'Syarat kolom (semua harus terpenuhi)'));
    cc.append(h('datalist', { id: 'dl-ff' }, ...(S.ds ? S.ds.headers : []).map((x) => h('option', { value: x }))));
    cc.append(h('datalist', { id: 'dl-fp' }, ...distinct(() => '').concat(Object.keys(((S.rt.get('blok') || {}).feats || [{ props: {} }])[0].props || {})).map((x) => h('option', { value: x }))));
    f.conds.forEach((q, i) => {
      const w = h('div', { class: 'rule' });
      w.append(h('div', { class: 'r1' },
        select([['csv', 'Kolom CSV'], ['poly', 'Atribut poligon']], q.source || 'csv', (v) => { q.source = v; changed(true); render(); }, { style: 'flex:0 0 120px' }),
        h('div', { style: { flex: 1 } }, textInput(q.field, (v) => { q.field = v; changed(false); }, { placeholder: 'Nama kolom', list: q.source === 'poly' ? 'dl-fp' : 'dl-ff' })),
        h('button', { class: 'btn red sm', onclick: () => { f.conds.splice(i, 1); changed(true); render(); } }, '✕')));
      w.append(h('div', { class: 'r2' },
        select(OPS, q.op || 'equals', (v) => { q.op = v; changed(true); render(); }),
        (q.op === 'empty' || q.op === 'notempty') ? h('span', { class: 'mut' }, '(tanpa nilai)') : textInput(q.value, (v) => { q.value = v; changed(false); }, { placeholder: 'Nilai' })));
      cc.append(w);
    });
    cc.append(h('div', { class: 'btns' }, h('button', { class: 'btn sec sm', onclick: () => { f.conds.push({ id: uid(), source: 'csv', field: '', op: 'equals', value: '' }); render(); } }, '+ Tambah syarat')));
    cc.append(h('div', { class: 'mut small' }, 'Contoh: kolom BBC3S sama dengan Rendah, atau kolom YOY ≥ 100. Syarat dengan nama kolom kosong diabaikan.'));
    host.append(cc);

    const oc = h('div', { class: 'card' }, h('h3', {}, 'Tampilan'));
    oc.append(h('div', { class: 'row' }, h('label', {}, 'Blok di luar filter'), h('div', { class: 'grow' },
      select([['hide', 'Disembunyikan (tidak digambar)'], ['dim', 'Diredupkan abu-abu']], f.mode, (v) => { f.mode = v; changed(true); }))));
    oc.append(h('div', { style: { margin: '8px 0' } }, check(f.titleNote !== false, (v) => { f.titleNote = v; changed(false); }, 'Tulis keterangan filter di judul peta saat ekspor')));
    oc.append(h('div', { class: 'btns' },
      h('button', { class: 'btn sec', onclick: () => doFit() }, 'Zoom ke hasil'),
      h('button', { class: 'btn red', onclick: () => { t.filter = null; bump('style'); doFit(); close(); } }, 'Reset filter')));
    host.append(oc);
    upd();
  };
  render();
  const close = openSheet('Filter peta · ' + t.name, host, {});
}

// kartu ringkas untuk tab Ekspor
export function filterCard(rerender) {
  const t = theme();
  const on = filterActive(t);
  return h('div', { class: 'card' }, h('h3', {}, 'Filter area'),
    h('div', { class: 'mut' }, on ? 'Aktif: ' + (filterSummary(t) || '—') : 'Tidak aktif — seluruh area diekspor.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn sec', onclick: () => { openFilter(); } }, on ? 'Ubah filter' : 'Atur filter')));
}
