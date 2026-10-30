import { S, theme, onChange, bump, computeStats, getField, labelLines, alphaOf } from './model.js';
import { renderMap, dataBounds, fitView } from './render.js';
import { hitPolygon, distToFeat, toWorld, M_PER_UNIT } from './geo.js';
import { $, h, toast, normKey, hexA } from './util.js';
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
  drawGps();
}

// ---------------- lokasi saya (GPS) ----------------
const gps = { on: false, id: null, pos: null, sheetClose: null };
function drawGps() {
  if (!gps.on || !gps.pos) return;
  const [wx, wy] = toWorld(gps.pos.lon, gps.pos.lat);
  const sx = (wx - view.cx) * view.scale + view.w / 2, sy = (wy - view.cy) * view.scale + view.h / 2;
  const r = Math.max(8, (gps.pos.acc || 0) / M_PER_UNIT * view.scale);
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fillStyle = 'rgba(30,136,229,.16)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(30,136,229,.55)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 7); ctx.fillStyle = '#1e88e5'; ctx.fill();
  ctx.restore();
}
function gpsCenter(first) {
  if (!gps.pos) return;
  const [wx, wy] = toWorld(gps.pos.lon, gps.pos.lat);
  view.cx = wx; view.cy = wy;
  const want = view.w / (700 / M_PER_UNIT);      // lebar layar ~700 m
  if (first || view.scale < want * 0.25) view.scale = Math.max(view.scale, want);
  requestDraw();
}
function gpsStop() {
  if (gps.id != null && navigator.geolocation) navigator.geolocation.clearWatch(gps.id);
  gps.on = false; gps.id = null; gps.pos = null;
  $('#bGps').classList.remove('on'); requestDraw();
}
function gpsStart() {
  if (!navigator.geolocation) { toast('GPS tidak tersedia di perangkat ini', 3500); return; }
  gps.on = true; $('#bGps').classList.add('on');
  toast('Mencari lokasi…', 2500);
  let first = true;
  gps.id = navigator.geolocation.watchPosition((p) => {
    gps.pos = { lon: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy, t: p.timestamp };
    if (first) { first = false; gpsCenter(true); } else requestDraw();
    if (gps.refresh) gps.refresh();
  }, (err) => {
    const m = { 1: 'Izin lokasi ditolak — aktifkan izin lokasi untuk Petaku di pengaturan HP', 2: 'Lokasi tidak tersedia (cek GPS aktif)', 3: 'Waktu mencari lokasi habis, coba di tempat terbuka' }[err.code] || 'Gagal mendapat lokasi';
    toast(m, 5000);
    if (err.code === 1) gpsStop();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 });
}
function blockAt(lon, lat) {
  const [x, y] = toWorld(lon, lat);
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    if (!l.visible || !l.themed) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    for (const f of rt.feats) if (f.polys && hitPolygon(f, x, y)) return { layer: l, feat: f };
  }
  return null;
}
function gpsSheet() {
  const body = h('div', {});
  const out = h('div', {});
  const render = () => {
    out.innerHTML = '';
    const p = gps.pos;
    if (!p) { out.append(h('div', { class: 'mut' }, 'Menunggu sinyal GPS…')); return; }
    const txt = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
    const kv = h('div', { class: 'kv' });
    const add = (k, v) => kv.append(h('b', {}, k), h('span', {}, v == null || v === '' ? '–' : String(v)));
    add('Koordinat (lat, lon)', txt);
    add('Akurasi', '± ' + Math.round(p.acc) + ' m');
    const hit = blockAt(p.lon, p.lat);
    if (hit) {
      const th = theme();
      add('Blok', getProp(hit.feat.props, hit.layer.keyField));
      if (hit.feat._style) {
        const s = hit.feat._style; let cl = 'Tanpa data';
        if (s.rule) { const r = (th.rules || []).find((x) => x.id === s.rule); cl = r ? (r.legendLabel || 'Aturan khusus') : 'Aturan khusus'; } else if (s.ci >= 0) cl = th.classes[s.ci].label;
        add('Kelas peta', cl);
      }
      if (hit.feat._row) for (const [k, v] of Object.entries(hit.feat._row)) add(k, v);
      for (const k of ['Estate', 'Afdeling']) if (hit.feat.props && hit.feat.props[k] != null) add(k, hit.feat.props[k]);
    } else add('Blok', 'di luar blok yang dimuat');
    out.append(kv, h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => { copyText(txt); } }, 'Salin koordinat'),
      h('a', { class: 'btn sec', href: `https://www.google.com/maps?q=${txt.replace(' ', '')}`, target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, 'Buka di Maps')));
  };
  body.append(out, h('div', { class: 'btns' },
    h('button', { class: 'btn sec', onclick: () => { gpsCenter(false); } }, 'Pusatkan peta'),
    h('button', { class: 'btn red', onclick: () => { gpsStop(); close(); } }, 'Matikan GPS')));
  gps.refresh = render; render();
  const close = openSheet('Lokasi saya', body, { onClose: () => { gps.refresh = null; } });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Koordinat disalin'); }
  catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Koordinat disalin'); } catch (e2) { toast(t, 5000); }
    ta.remove();
  }
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
  let themedHit = false;
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    if (!l.visible) continue;
    const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
    for (const f of rt.feats) {
      if (f.polys && hitPolygon(f, x, y)) { hits.push({ layer: l, feat: f }); if (l.themed) { themedHit = true; break; } }
    }
  }
  // ketukan jatuh di garis batas / celah antar blok: ambil blok terdekat dalam ~18 px
  if (!themedHit) {
    const tol = 18 / view.scale;
    let best = null, bd = Infinity;
    for (let i = S.layers.length - 1; i >= 0; i--) {
      const l = S.layers[i];
      if (!l.visible || !l.themed) continue;
      const rt = S.rt.get(l.id); if (!rt || !rt.feats) continue;
      for (const f of rt.feats) {
        if (!f.polys) continue;
        const d = distToFeat(f, x, y, tol);
        if (d < bd && d <= tol) { bd = d; best = { layer: l, feat: f }; }
      }
    }
    if (best) hits.unshift(best);
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
      if (feat._row) { for (const [k, v] of Object.entries(feat._row)) add((S.ds ? S.ds.name.replace(/\.[^.]+$/, '') : 'CSV') + ' · ' + k, v); }
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
    const sw = h('span', { class: 'sw', style: { background: c.color ? hexA(c.color, alphaOf(th, c)) : 'transparent' } });
    if (c.pattern && c.pattern !== 'none') sw.style.backgroundImage = `url(${makePatternTile(c.pattern, c.pc || '#000', 7).toDataURL()})`;
    bd.append(h('div', { class: 'it' }, sw, h('span', {}, c.label + ' '), h('span', { class: 'mut' }, `(${st.classCounts[i] || 0})`)));
  });
  for (const r of th.rules || []) {
    if (r.enabled === false || !r.legendShow || !st.ruleCounts[r.id]) continue;
    const sw = h('span', { class: 'sw', style: { background: r.fill && !r.noFill ? hexA(r.fill, alphaOf(th, r)) : 'transparent' } });
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
    if (pts.size === 0 && moved < 14 && Date.now() - t0 < 900 && e.type === 'pointerup') {
      const hits = hitTest(e.offsetX, e.offsetY);
      highlight = hits.find((x) => x.layer.themed) ? hits.find((x) => x.layer.themed).feat : null;
      requestDraw();
      if (hits.length) showInfo(hits, e.offsetX, e.offsetY); else toast('Tidak ada blok di titik ini', 1200);
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
  $('#bGps').onclick = () => { if (!gps.on) gpsStart(); else gpsSheet(); };
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
