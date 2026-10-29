import { S, theme, onChange, bump, computeStats, getField, labelLines } from './model.js';
import { renderMap, dataBounds, fitView } from './render.js';
import { hitPolygon } from './geo.js';
import { $, h, toast, normKey } from './util.js';
import { openSheet } from './ui-common.js';
import { getProp } from './model.js';
import { makePatternTile } from './render.js';

export const view = { cx: 0, cy: 0, scale: 1, w: 0, h: 0 };
let cv, ctx, dpr = 1, raf = 0, highlight = null, fitted = false;

export function getView() { return { ...view }; }
export function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }

function resize() {
  const r = cv.parentElement.getBoundingClientRect();
  if (r.width < 2) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.round(r.width), hh = Math.round(r.height);
  if (w === view.w && hh === view.h && cv.width === Math.round(w * dpr)) return;
  // pertahankan pusat saat ukuran berubah
  view.w = w; view.h = hh;
  cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
  if (!fitted) doFit();
  requestDraw();
}

export function doFit() {
  const bb = dataBounds();
  if (!bb || !view.w) return;
  const v = fitView(bb, view.w, view.h, 0.03);
  view.cx = v.cx; view.cy = v.cy; view.scale = v.scale; fitted = true;
  requestDraw();
}
export function zoomToBBox(bb, pad) {
  const v = fitView(bb, view.w, view.h, pad == null ? 0.18 : pad);
  view.cx = v.cx; view.cy = v.cy; view.scale = Math.min(v.scale, 4e6); requestDraw();
}

function draw() {
  raf = 0;
  if (!ctx || !view.w) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, view.w, view.h);
  try { renderMap(ctx, view, { unit: 1, ptPx: 1, screen: true, highlight }); } catch (e) { console.error(e); }
}

function zoomAt(px, py, k) {
  const wx = (px - view.w / 2) / view.scale + view.cx, wy = (py - view.h / 2) / view.scale + view.cy;
  view.scale = Math.max(1, Math.min(view.scale * k, 5e7));
  view.cx = wx - (px - view.w / 2) / view.scale; view.cy = wy - (py - view.h / 2) / view.scale;
  requestDraw();
}
const toWorldXY = (px, py) => [(px - view.w / 2) / view.scale + view.cx, (py - view.h / 2) / view.scale + view.cy];

function hitTest(px, py) {
  const [x, y] = toWorldXY(px, py);
  const hits = [];
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    if (!l.visible) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    for (const f of rt.feats) {
      if (f.polys && hitPolygon(f, x, y)) { hits.push({ layer: l, feat: f }); if (l.themed) break; }
    }
  }
  return hits;
}

function showInfo(hits, px, py) {
  const body = h('div', {});
  const th = theme();
  hits.forEach((hit, idx) => {
    const { layer, feat } = hit;
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, layer.themed ? (getProp(feat.props, layer.keyField) || layer.name) : layer.name));
    const kv = h('div', { class: 'kv' });
    const add = (k, v) => { kv.append(h('b', {}, k), h('span', {}, v == null || v === '' ? '–' : String(v))); };
    if (layer.themed) {
      const s = feat._style;
      if (s) {
        let cl = 'Tanpa data';
        if (s.rule) { const r = (th.rules || []).find((x) => x.id === s.rule); cl = r ? (r.legendLabel || 'Aturan khusus') : 'Aturan khusus'; }
        else if (s.ci >= 0) cl = th.classes[s.ci].label;
        add('Kelas peta', cl);
      }
      if (feat._row) { for (const [k, v] of Object.entries(feat._row)) add('CSV · ' + k, v); }
      else add('Data CSV', S.ds ? 'tidak ada baris untuk blok ini' : 'belum ada CSV diimpor');
    }
    for (const [k, v] of Object.entries(feat.props || {})) add(k, v);
    card.append(kv);
    body.append(card);
  });
  openSheet(hits.length ? 'Info lokasi' : 'Info', body);
}

function renderLegendChip() {
  const el = $('#legendChip');
  const th = theme();
  const st = computeStats();
  el.innerHTML = '';
  const hd = h('div', { class: 'hd' }, h('span', {}, th.legendTitle || th.name), h('span', { class: 'mut' }, el.dataset.open === '0' ? '▲' : '▼'));
  hd.addEventListener('click', () => { el.dataset.open = el.dataset.open === '0' ? '1' : '0'; renderLegendChip(); });
  el.append(hd);
  if (el.dataset.open === '0') return;
  const bd = h('div', { class: 'bd' });
  th.classes.forEach((c, i) => {
    const sw = h('span', { class: 'sw', style: { background: c.color || 'transparent' } });
    if (c.pattern && c.pattern !== 'none') sw.style.backgroundImage = `url(${makePatternTile(c.pattern, c.pc || '#000', 7).toDataURL()})`;
    bd.append(h('div', { class: 'it' }, sw, h('span', {}, c.label + ' '), h('span', { class: 'mut' }, `(${st.classCounts[i] || 0})`)));
  });
  for (const r of th.rules || []) {
    if (r.enabled === false || !st.ruleCounts[r.id]) continue;
    const sw = h('span', { class: 'sw', style: { background: r.fill || 'transparent' } });
    if (r.pattern && r.pattern !== 'none') sw.style.backgroundImage = `url(${makePatternTile(r.pattern, r.pc || '#000', 7).toDataURL()})`;
    bd.append(h('div', { class: 'it' }, sw, h('span', {}, (r.legendLabel || 'Aturan') + ' '), h('span', { class: 'mut' }, `(${st.ruleCounts[r.id]})`)));
  }
  if (st.nodata) bd.append(h('div', { class: 'it' }, h('span', { class: 'sw', style: { background: '#fff' } }), h('span', {}, 'Tanpa data '), h('span', { class: 'mut' }, `(${st.nodata})`)));
  el.append(bd);
}

function renderStatus() {
  const el = $('#mapStatus');
  if (!S.ds) { el.textContent = 'CSV belum diimpor → tab Data'; return; }
  const st = computeStats();
  el.textContent = `${S.ds.name} · ${st.matchedPolys}/${S.ds.map.size} baris cocok`;
}

function findBlock() {
  const inp = h('input', { type: 'text', placeholder: 'Kode blok, mis. M28', autocapitalize: 'characters' });
  const out = h('div', { class: 'mut', style: { marginTop: '8px' } });
  const go = () => {
    const q = normKey(inp.value); if (!q) return;
    for (const l of S.layers) {
      if (!l.visible || !l.themed) continue;
      const rt = S.rt.get(l.id); if (!rt) continue;
      const f = rt.feats.find((x) => normKey(getProp(x.props, l.keyField)) === q);
      if (f) { highlight = f; zoomToBBox(f.bbox, 0.35); close(); setTimeout(() => showInfo([{ layer: l, feat: f }]), 120); return; }
    }
    out.textContent = 'Blok tidak ditemukan';
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const close = openSheet('Cari blok', h('div', {}, inp, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: go }, 'Cari & zoom'), h('button', { class: 'btn sec', onclick: () => { highlight = null; requestDraw(); close(); } }, 'Hapus sorotan')), out), {});
  setTimeout(() => inp.focus(), 50);
}

export function initMap() {
  cv = $('#cv'); ctx = cv.getContext('2d');
  new ResizeObserver(resize).observe(cv.parentElement);
  const pts = new Map();
  let last = null, moved = 0, t0 = 0, pinch = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pts.size === 1) { last = { x: e.offsetX, y: e.offsetY }; moved = 0; t0 = Date.now(); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; moved = 99; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      view.cx -= (cx - pinch.cx) / view.scale; view.cy -= (cy - pinch.cy) / view.scale;
      if (pinch.d > 0) zoomAt(cx, cy, d / pinch.d);
      pinch = { d, cx, cy }; requestDraw();
    } else if (pts.size === 1 && last) {
      const dx = e.offsetX - last.x, dy = e.offsetY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      view.cx -= dx / view.scale; view.cy -= dy / view.scale;
      last = { x: e.offsetX, y: e.offsetY }; requestDraw();
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0 && moved < 8 && Date.now() - t0 < 500 && e.type === 'pointerup') {
      const hits = hitTest(e.offsetX, e.offsetY);
      highlight = hits.find((x) => x.layer.themed) ? hits.find((x) => x.layer.themed).feat : null;
      requestDraw();
      if (hits.length) showInfo(hits, e.offsetX, e.offsetY);
    }
    if (pts.size === 1) { const p = [...pts.values()][0]; last = { x: p.x, y: p.y }; }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  cv.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 2));
  $('#bFit').onclick = doFit;
  $('#bZi').onclick = () => zoomAt(view.w / 2, view.h / 2, 1.6);
  $('#bZo').onclick = () => zoomAt(view.w / 2, view.h / 2, 1 / 1.6);
  $('#bFind').onclick = findBlock;
  const lb = $('#bLbl');
  const syncLbl = () => lb.classList.toggle('on', theme().label.show !== false);
  lb.onclick = () => { const t = theme(); t.label.show = t.label.show === false; syncLbl(); bump('style'); };
  const refresh = () => { syncLbl(); renderLegendChip(); renderStatus(); requestDraw(); };
  onChange((k) => { if (k === 'layers') doFitIfNeeded(); refresh(); });
  refresh();
}
function doFitIfNeeded() { if (!fitted) doFit(); }
export function refitIfNeeded() { fitted = false; doFit(); }
export function mapShown() { resize(); requestDraw(); }
export function clearHighlight() { highlight = null; }
