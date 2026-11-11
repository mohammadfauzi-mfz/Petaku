// Ringkasan & peringkat blok untuk tema aktif (mengikuti filter peta)
import { S, theme, getField, getProp, computeStats, filterActive, filterSummary, ensureStyles } from './model.js';
import { h, num, select, toast } from './util.js';
import { openSheet } from './ui-common.js';
import { compareTables, recapTable, autoTo, recapGridTables, recapGrid, outlookSource } from './ui-tables.js';

const fmt = (v) => { if (v == null || !isFinite(v)) return '–'; const a = Math.abs(v); return a >= 100 ? String(Math.round(v)) : a >= 10 ? String(Math.round(v * 10) / 10).replace('.', ',') : String(Math.round(v * 100) / 100).replace('.', ','); };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function collect() {
  const t = theme(), out = [];
  const sc = t.scale == null || t.scale === '' ? 1 : Number(t.scale);
  for (const l of S.layers) {
    if (!l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    ensureStyles(l, rt.feats);
    for (const f of rt.feats) {
      if (!f.polys || f._pass === false || !f._row) continue;
      const raw = getField(f._row, t.field);
      const v = num(raw);
      const cls = f._style && f._style.ci >= 0 ? t.classes[f._style.ci] : null;
      out.push({
        code: String(getProp(f.props, l.keyField) || ''), estate: String(getProp(f.props, 'Estate') || '–'), afd: String(getProp(f.props, 'Afdeling') || '–'),
        row: f._row, props: f.props,
        v: v == null ? null : v * sc, raw: String(raw == null ? '' : raw).trim(), ci: f._style ? f._style.ci : -1, color: cls ? cls.color : '#cfd6d2',
      });
    }
  }
  return out;
}

function textReport(t, items, numeric, groupBy, groups, lows, highs, topN, recap) {
  const L = [];
  L.push(`*${(t.title || t.name).split('\n').join(' ')}*`);
  if (filterActive(t)) L.push('Filter: ' + filterSummary(t));
  if (numeric) {
    const vs = items.filter((x) => x.v != null).map((x) => x.v);
    L.push(`${vs.length} blok · rata-rata ${fmt(avg(vs))} · terendah ${fmt(Math.min(...vs))} · tertinggi ${fmt(Math.max(...vs))}`);
    L.push('', `*Per ${groupBy === 'estate' ? 'Estate' : 'Afdeling'}* (blok · rata-rata)`);
    for (const g of groups) L.push(`${g.name}: ${g.n} · ${fmt(g.avg)}`);
    L.push('', `*${topN} terendah*`); lows.forEach((x, i) => L.push(`${i + 1}. ${x.code} (${x.afd}) ${fmt(x.v)}`));
    L.push('', `*${topN} tertinggi*`); highs.forEach((x, i) => L.push(`${i + 1}. ${x.code} (${x.afd}) ${fmt(x.v)}`));
  } else {
    L.push(`${items.length} blok`);
    const m = new Map(); for (const x of items) m.set(x.raw || '(kosong)', (m.get(x.raw || '(kosong)') || 0) + 1);
    for (const [k, n] of [...m].sort((a, b) => b[1] - a[1])) L.push(`${k}: ${n} blok`);
  }
  if (recap && recap.rows.length) {
    L.push('', `*${recap.title}* (${recap.per})`);
    const f2 = (v, d) => (v == null ? '–' : v.toFixed(d));
    for (const r of recap.rows) L.push(`${r.name}: TON/HA ${recap.ct.right.label} ${f2(r.b.tonha, 2)} · ${recap.ct.left.label} ${f2(r.a.tonha, 2)}` + (r.pct.tonha != null ? ` (${Math.round(r.pct.tonha)}%)` : '') + (r.pct.bjr != null ? ` · BJR ${Math.round(r.pct.bjr)}%` : ''));
  }
  L.push('', '_Petaku_');
  return L.join('\n');
}

export function openSummary() {
  const t = theme();
  const items = collect();
  const body = h('div', {});
  if (!items.length) { openSheet('Ringkasan', h('div', { class: 'hint' }, 'Belum ada blok berdata. Impor CSV dan pastikan kolom data tema sudah dipilih.')); return; }
  const numeric = t.mode !== 'category' && items.some((x) => x.v != null);
  let groupBy = 'afd', sortBy = 'avgdesc', topN = 10, recapId = '', rFrom = 1, rTo = 'auto', rOl = false;
  const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  let recapRows = null;

  const render = () => {
    body.innerHTML = '';
    const st = computeStats();
    body.append(h('div', { class: 'mut small' }, `${t.name} · ${items.length} blok berdata` + (filterActive(t) ? ` (filter aktif: ${filterSummary(t)})` : '')));
    let groups = [], lows = [], highs = [];

    if (numeric) {
      const withV = items.filter((x) => x.v != null);
      const vs = withV.map((x) => x.v).sort((a, b) => a - b);
      const med = vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
      const tiles = h('div', { class: 'sumgrid' });
      for (const [k, v] of [['Rata-rata', avg(vs)], ['Median', med], ['Terendah', vs[0]], ['Tertinggi', vs[vs.length - 1]]]) tiles.append(h('div', { class: 'mt' }, h('small', {}, k), h('b', {}, fmt(v))));
      body.append(tiles);
      body.append(h('div', { class: 'mut small' }, 'Rata-rata dihitung sederhana antar blok (tidak diberi bobot luas atau produksi).'));
    }

    // sebaran kelas
    const dist = h('div', { class: 'card' }, h('h3', {}, 'Sebaran kelas'));
    const tot = Math.max(1, items.length);
    t.classes.forEach((c, i) => {
      const n = st.classCounts[i] || 0;
      dist.append(h('div', { class: 'distrow' }, h('span', { class: 'sw', style: { background: c.color || 'transparent', border: '1px solid var(--line)' } }), h('span', { class: 'dl' }, c.label), h('span', { class: 'dbar' }, h('i', { style: { width: (n / tot * 100) + '%', background: c.color || '#999' } })), h('b', {}, String(n))));
    });
    body.append(dist);

    if (numeric) {
      const gc = h('div', { class: 'card' }, h('h3', {}, 'Per wilayah'));
      gc.append(h('div', { class: 'row' }, h('label', {}, 'Kelompokkan'), h('div', { class: 'grow' }, select([['estate', 'Estate'], ['afd', 'Afdeling']], groupBy, (v) => { groupBy = v; render(); }))));
      gc.append(h('div', { class: 'row' }, h('label', {}, 'Urutkan'), h('div', { class: 'grow' }, select([['avgdesc', 'Rata-rata tertinggi'], ['avgasc', 'Rata-rata terendah'], ['name', 'Nama']], sortBy, (v) => { sortBy = v; render(); }))));
      const m = new Map();
      for (const x of items) { if (x.v == null) continue; const k = groupBy === 'estate' ? x.estate : x.afd; if (!m.has(k)) m.set(k, []); m.get(k).push(x.v); }
      groups = [...m].map(([name, a]) => ({ name, n: a.length, avg: avg(a), min: Math.min(...a), max: Math.max(...a) }));
      groups.sort(sortBy === 'name' ? (a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }) : sortBy === 'avgasc' ? (a, b) => a.avg - b.avg : (a, b) => b.avg - a.avg);
      const tb = h('table', { class: 'sumtab' }, h('thead', {}, h('tr', {}, ['Wilayah', 'Blok', 'Rata²', 'Min', 'Maks'].map((x) => h('th', {}, x)))),
        h('tbody', {}, groups.map((g) => h('tr', {}, h('td', {}, g.name), h('td', {}, String(g.n)), h('td', {}, h('b', {}, fmt(g.avg))), h('td', {}, fmt(g.min)), h('td', {}, fmt(g.max))))));
      gc.append(h('div', { class: 'tblwrap' }, tb));
      body.append(gc);

      const rc = h('div', { class: 'card' }, h('h3', {}, 'Peringkat blok'));
      rc.append(h('div', { class: 'row' }, h('label', {}, 'Tampilkan'), h('div', { class: 'grow' }, select([[5, '5 blok'], [10, '10 blok'], [20, '20 blok']], topN, (v) => { topN = +v; render(); }))));
      const sorted = items.filter((x) => x.v != null).sort((a, b) => a.v - b.v);
      lows = sorted.slice(0, topN); highs = sorted.slice(-topN).reverse();
      const list = (title, arr) => {
        const box = h('div', {}, h('div', { class: 'rkh' }, title));
        arr.forEach((x, i) => box.append(h('div', { class: 'rk' }, h('span', { class: 'rn' }, String(i + 1)), h('span', { class: 'sw', style: { background: x.color, border: '1px solid var(--line)' } }), h('b', {}, x.code), h('span', { class: 'mut small' }, `${x.estate} · ${x.afd}`), h('span', { class: 'rv' }, fmt(x.v)))));
        return box;
      };
      rc.append(list(`${topN} terendah`, lows), list(`${topN} tertinggi`, highs));
      body.append(rc);
    }

    // rekap Plan vs Act per wilayah (memakai tabel perbandingan di tema)
    recapRows = null;
    const cts = compareTables(t);
    if (cts.length) {
      if (!cts.some((x) => x.id === recapId)) { recapId = cts[0].id; rFrom = cts[0].from || 1; rTo = cts[0].to == null ? 'auto' : cts[0].to; }
      const ct = cts.find((x) => x.id === recapId);
      const rc2 = h('div', { class: 'card' }, h('h3', {}, 'Rekap ' + (groupBy === 'estate' ? 'per Estate' : 'per Afdeling')));
      rc2.append(h('div', { class: 'row' }, h('label', {}, 'Tabel'), h('div', { class: 'grow' }, select(cts.map((x) => [x.id, x.title]), recapId, (v) => { recapId = v; const c = cts.find((x) => x.id === v); rFrom = c.from || 1; rTo = c.to == null ? 'auto' : c.to; render(); }))));
      const mo = MLAB.map((m, i) => [i + 1, m]);
      const blocksAll = items.filter((x) => x.row).map((x) => ({ row: x.row, g: groupBy === 'estate' ? x.estate : x.afd }));
      const toN = rTo === 'auto' ? autoTo(ct, blocksAll) : +rTo;
      rc2.append(h('div', { class: 'perrow' }, h('span', { class: 'mut small' }, 'Periode'), select(mo, rFrom, (v) => { rFrom = +v; render(); }), h('span', { class: 'mut small' }, 's/d'), select(mo, toN, (v) => { rTo = +v; render(); }),
        h('button', { class: 'btn sec sm', onclick: () => { rFrom = ct.from || 1; rTo = ct.to == null ? 'auto' : ct.to; rOl = false; render(); } }, 'Otomatis'),
        outlookSource(ct) && (toN < 12 || rOl) ? h('button', { class: 'btn' + (rOl ? '' : ' sec') + ' sm', onclick: () => { rTo = toN; rOl = !rOl; render(); } }, 'Outlook') : null));
      const gm = new Map();
      for (const x of blocksAll) { if (!gm.has(x.g)) gm.set(x.g, []); gm.get(x.g).push({ row: x.row }); }
      const gl = [...gm].map(([name, blocks]) => ({ name, blocks })).sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
      const olOn = rOl && !!outlookSource(ct);
      const rt = recapTable(ct, gl, rFrom, toN, olOn);
      recapRows = { title: ct.title + (olOn ? ' · Outlook' : ''), per: olOn ? `Act ${MLAB[rFrom - 1]}–${MLAB[toN - 1]} + ${outlookSource(ct).label} sisa bulan` : `${MLAB[rFrom - 1]}–${MLAB[toN - 1]}`, ct: olOn ? { ...ct, right: { ...ct.right, label: 'Outlook' } } : ct, ...rt };
      rc2.append(h('div', { class: 'mut small' }, `Periode ${olOn ? 'Outlook: Act ' + MLAB[rFrom - 1] + '–' + MLAB[toN - 1] + ' + ' + outlookSource(ct).label + ' sisa bulan sampai Des' : MLAB[rFrom - 1] + '–' + MLAB[toN - 1]}. Jumlah blok dijumlahkan dulu, lalu TON/HA, JJG/PKK, dan BJR dihitung ulang dari totalnya (bukan rata-rata antar blok).`), rt.el);
      body.append(rc2);
    }

    // rekap tabel kustom (mis. SPH) per wilayah: jumlahkan dulu, lalu rumus dihitung dari jumlahnya
    {
      const gts = recapGridTables(t);
      if (gts.length) {
        const gm2 = new Map();
        for (const x of items) { if (!x.row) continue; const g = groupBy === 'estate' ? x.estate : x.afd; if (!gm2.has(g)) gm2.set(g, []); gm2.get(g).push({ row: x.row }); }
        const gl2 = [...gm2].map(([name, blocks]) => ({ name, blocks })).sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
        for (const gt of gts) {
          const el = recapGrid(gt, gl2); if (!el) continue;
          body.append(h('div', { class: 'card' }, h('h3', {}, gt.title + ' · ' + (groupBy === 'estate' ? 'per Estate' : 'per Afdeling')),
            h('div', { class: 'mut small' }, 'Angka blok dijumlahkan per wilayah, lalu rumus dihitung dari jumlahnya (bukan rata-rata antar blok).'), el));
        }
      }
    }

    const txt = textReport(t, items, numeric, groupBy, groups, lows, highs, topN, recapRows);
    body.append(h('div', { class: 'btns' },
      h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(txt), target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, 'Kirim WhatsApp'),
      h('button', { class: 'btn sec', onclick: async () => { try { await navigator.clipboard.writeText(txt); toast('Ringkasan disalin'); } catch (e) { toast('Gagal menyalin'); } } }, 'Salin teks')));
  };
  render();
  openSheet('Ringkasan · ' + t.name, body, {});
}
