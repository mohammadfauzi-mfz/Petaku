// Penggambar peta (dipakai layar dan ekspor)
import { S, theme, ensureStyles, ensurePass, filterActive, filterHides, filterDims, labelLines, getProp } from './model.js';
import { featPath, linePath, labelAnchor } from './geo.js';

const patCache = new Map();
const lblCache = { key: '', map: new Map() };
export function makePatternTile(type, color, n) {
  n = Math.max(4, Math.round(n));
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(0.8, n / 9);
  if (type === 'dots') {
    const r = Math.max(0.9, n * 0.11);
    for (const [x, y] of [[n / 4, n / 4], [3 * n / 4, 3 * n / 4]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  } else if (type === 'diag') {
    g.beginPath();
    g.moveTo(0, n); g.lineTo(n, 0); g.moveTo(-n / 2, n / 2); g.lineTo(n / 2, -n / 2); g.moveTo(n / 2, n * 1.5); g.lineTo(n * 1.5, n / 2);
    g.stroke();
  } else if (type === 'cross') {
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(n, n); g.moveTo(n, 0); g.lineTo(0, n); g.stroke();
  } else if (type === 'hline') {
    g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.stroke();
  } else if (type === 'vline') {
    g.beginPath(); g.moveTo(n / 2, 0); g.lineTo(n / 2, n); g.stroke();
  }
  return c;
}
function getPattern(ctx, type, color, n, s) {
  const key = type + '|' + color + '|' + Math.round(n);
  let p = patCache.get(key);
  if (!p) { p = ctx.createPattern(makePatternTile(type, color, n), 'repeat'); patCache.set(key, p); }
  try { p.setTransform(new DOMMatrix([1 / s, 0, 0, 1 / s, 0, 0])); } catch (e) { /* abaikan */ }
  return p;
}
export const PATTERNS = [['none', 'Polos'], ['dots', 'Titik'], ['diag', 'Garis miring'], ['cross', 'Silang'], ['hline', 'Garis datar'], ['vline', 'Garis tegak']];

function dashArr(s, k) {
  if (!s) return [];
  const a = String(s).split(/[\s,]+/).map(Number).filter((x) => x > 0);
  return a.length ? a.map((x) => x * k) : [];
}
// ---- peta layar mode gelap: warna sangat gelap -> terang, sangat terang (putih) -> abu gelap; warna tema tidak berubah ----
function lum(c) {
  const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
}
function darkMap(c) {
  if (!c) return c;
  const l = lum(c);
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (l < 0.25) return '#d3dcd7';
  if (l > 0.93) return '#2a3530';
  return c;
}
const withAlpha = (ctx, a, fn) => { const o = ctx.globalAlpha; ctx.globalAlpha = o * a; fn(); ctx.globalAlpha = o; };

// view: {cx, cy, scale, w, h}; o: {unit, ptPx, screen, highlight, labels}
export function renderMap(ctx, v, o) {
  const s = v.scale, unit = o.unit || 1;
  const tx = v.w / 2 - v.cx * s, ty = v.h / 2 - v.cy * s;
  const x0 = v.cx - v.w / 2 / s, x1 = v.cx + v.w / 2 / s, y0 = v.cy - v.h / 2 / s, y1 = v.cy + v.h / 2 / s;
  const th = theme();
  const tile = 4.5 * unit;
  const DKM = !!o.screen && document.documentElement.dataset.theme === 'dark';
  const dk = DKM ? darkMap : (c) => c;
  const FH = filterHides(th), FD = filterDims(th);
  ctx.save();
  ctx.translate(tx, ty); ctx.scale(s, s);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const meta of S.layers) {
    if (!meta.visible) continue;
    const rt = S.rt.get(meta.id);
    if (!rt || !rt.feats) continue;
    const st = meta.style || {};
    if (meta.themed) ensureStyles(meta, rt.feats); else ensurePass(meta, rt.feats);
    const lw = (st.strokeWidth == null ? 0.5 : st.strokeWidth) * unit / s;
    const hasStroke = st.stroke && lw > 0;
    for (const f of rt.feats) {
      const b = f.bbox;
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      if (FH && f._pass === false) continue;
      const dim = FD && meta.themed && f._pass === false;
      if (f.polys) {
        const path = featPath(f);
        let fill = st.fill, pat = 'none', pc = '#000', alpha = st.fillOpacity == null ? 1 : st.fillOpacity;
        if (meta.themed && f._style) { fill = f._style.fill; pat = f._style.pattern; pc = f._style.pc; alpha = f._style.alpha == null ? 1 : f._style.alpha; }
        if (dim) { fill = DKM ? '#3a4540' : '#e3e3e3'; pat = 'none'; alpha = 1; }
        fill = dk(fill); pc = dk(pc);
        if (fill) { ctx.fillStyle = fill; withAlpha(ctx, alpha, () => ctx.fill(path, 'evenodd')); }
        if (pat !== 'none') { ctx.fillStyle = getPattern(ctx, pat, dk(pc || '#000'), tile, s); withAlpha(ctx, meta.themed ? alpha : 1, () => ctx.fill(path, 'evenodd')); }
        if (!dim && meta.themed && f._style && f._style.over) for (const o of f._style.over) { ctx.fillStyle = getPattern(ctx, o.pattern, dk(o.pc), tile, s); withAlpha(ctx, o.alpha, () => ctx.fill(path, 'evenodd')); }
        if (hasStroke) { ctx.lineWidth = lw; ctx.strokeStyle = dk(st.stroke); ctx.setLineDash(dashArr(st.dash, unit / s)); ctx.stroke(path); }
      }
      if (f.lines) {
        if (hasStroke) { ctx.lineWidth = lw; ctx.strokeStyle = dk(st.stroke); ctx.setLineDash(dashArr(st.dash, unit / s)); ctx.stroke(linePath(f)); }
      }
      if (f.points && st.pointRadius > 0) {
        ctx.fillStyle = dk(st.pointColor || '#d32f2f');
        const r = st.pointRadius * unit / s;
        for (const p of f.points) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); if (hasStroke) { ctx.lineWidth = lw; ctx.strokeStyle = dk(st.stroke); ctx.stroke(); } }
      }
    }
    ctx.setLineDash([]);
  }
  ctx.restore();

  // sorotan
  if (o.highlight && o.highlight.polys) {
    ctx.save(); ctx.translate(tx, ty); ctx.scale(s, s);
    ctx.lineWidth = 3 / s; ctx.strokeStyle = '#ff00ff'; ctx.setLineDash([]);
    ctx.stroke(featPath(o.highlight)); ctx.restore();
  }

  // label (koordinat piksel)
  if (o.labels === false) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const FF = 'Tahoma, "Segoe UI", Roboto, Arial, sans-serif';
  for (const meta of S.layers) {
    if (!meta.visible) continue;
    const rt = S.rt.get(meta.id);
    if (!rt || !rt.feats) continue;
    const st = meta.style || {};
    if (meta.themed) {
      const L = th.label || {};
      if (L.show === false) continue;
      const fpx = o.screen ? (L.sizePx || 10) : (L.sizePt || 3) * o.ptPx;
      ctx.font = `${fpx}px ${FF}`;
      ctx.fillStyle = '#000';
      const lh = fpx * 1.12;
      const ck = th.id + '|' + S.ver + '|' + (L.template || '');
      if (lblCache.key !== ck) { lblCache.key = ck; lblCache.map = new Map(); }
      const cache = lblCache.map;
      for (const f of rt.feats) {
        if (!f.polys) continue;
        if (!f._row && !L.unmatched) continue;
        if (f._pass === false) continue;
        const b = f.bbox;
        if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
        if (!L.force && (b[2] - b[0]) * s < fpx * 1.3) continue;
        let lines = cache.get(f);
        if (!lines) { lines = labelLines(th, f._row, f.props); cache.set(f, lines); }
        if (!lines.length) continue;
        const a = labelAnchor(f);
        if (!a) continue;
        if (!L.force) {
          let tw = 0; for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
          if (a.w * s < tw * 1.0 || a.h * s < lines.length * lh * 0.9) continue;
        }
        const sx = a.x * s + tx, sy = a.y * s + ty;
        const top = sy - (lines.length - 1) * lh / 2;
        if (DKM) {
          const bg = f._style && f._style.fill ? dk(f._style.fill) : null;
          const al = f._style && f._style.alpha != null ? f._style.alpha : 1;
          ctx.fillStyle = (!bg || al < 0.55 || f._pass === false || lum(bg) < 0.45) ? '#f2f6f4' : '#000';
        }
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], sx, top + i * lh);
      }
    } else if (st.labelField) {
      const fpx = o.screen ? Math.max(9, (st.labelSizePt || 4) * 1.7) : (st.labelSizePt || 4) * o.ptPx;
      ctx.font = `${st.labelBold ? 'bold ' : ''}${fpx}px ${FF}`;
      ctx.fillStyle = dk(st.labelColor || '#000');
      for (const f of rt.feats) {
        const b = f.bbox;
        if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
        if (FH && f._pass === false) continue;
        const val = getProp(f.props, st.labelField);
        if (val == null || String(val).trim() === '') continue;
        let ax, ay;
        if (f.points) { ax = f.points[0][0]; ay = f.points[0][1]; }
        else if (f.polys) { const a = labelAnchor(f); ax = a.x; ay = a.y; }
        else { ax = (b[0] + b[2]) / 2; ay = (b[1] + b[3]) / 2; }
        const sx = ax * s + tx, sy = ay * s + ty;
        if (st.labelHalo !== false) { ctx.lineWidth = Math.max(1.5, fpx * 0.22); ctx.strokeStyle = DKM ? 'rgba(15,21,18,.9)' : 'rgba(255,255,255,.9)'; ctx.lineJoin = 'round'; ctx.strokeText(String(val), sx, sy); }
        ctx.fillText(String(val), sx, sy);
      }
    }
  }
  ctx.restore();
}

// batas gabungan: layer bertema bila ada, kalau tidak semua layer terlihat
export function dataBounds() {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (k) => { if (k[0] < b[0]) b[0] = k[0]; if (k[1] < b[1]) b[1] = k[1]; if (k[2] > b[2]) b[2] = k[2]; if (k[3] > b[3]) b[3] = k[3]; };
  const fa = filterActive();
  const pick = (themedOnly) => {
    for (const l of S.layers) {
      if (!l.visible || (themedOnly && !l.themed)) continue;
      const rt = S.rt.get(l.id); if (!rt || !rt.bbox) continue;
      if (fa && l.themed && rt.feats) {
        ensureStyles(l, rt.feats);
        let any = false;
        for (const f of rt.feats) if (f.polys && f._pass !== false) { add(f.bbox); any = true; }
        if (any) continue;
      }
      add(rt.bbox);
    }
  };
  pick(true);
  if (!isFinite(b[0])) pick(false);
  return isFinite(b[0]) ? b : null;
}
export function fitView(bb, w, h, pad) {
  pad = pad == null ? 0.04 : pad;
  const bw = Math.max(bb[2] - bb[0], 1e-9), bh = Math.max(bb[3] - bb[1], 1e-9);
  const s = Math.min(w * (1 - 2 * pad) / bw, h * (1 - 2 * pad) / bh);
  return { cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2, scale: s, w, h };
}
