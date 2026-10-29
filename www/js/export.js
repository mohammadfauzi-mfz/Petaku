// Layout halaman peta: peta + panel kanan (judul, legenda, skala, indeks) -> kanvas -> PNG/JPG/PDF
import { S, theme, computeStats, alphaOf } from './model.js';
import { renderMap, dataBounds, fitView, makePatternTile } from './render.js';
import { M_PER_UNIT } from './geo.js';

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
const FF = 'Tahoma, "Segoe UI", Roboto, Arial, sans-serif';

const imgCache = new Map();
export function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src);
  const url = src.startsWith('asset:') ? src.slice(6) : src;
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = url;
  });
  imgCache.set(src, p);
  return p;
}

function pageSize(cfg) {
  const [a, b] = PAPERS[cfg.paper] || PAPERS.A4;
  return cfg.orient === 'portrait' ? [b, a] : [a, b];
}

export function fitLines(ctx, lines, maxW, maxH, weight, maxPx) {
  let px = maxPx;
  for (let i = 0; i < 40; i++) {
    ctx.font = `${weight} ${px}px ${FF}`;
    let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    if (w <= maxW && lines.length * px * 1.22 <= maxH) break;
    px *= 0.93;
  }
  return px;
}
function drawLines(ctx, lines, cx, cy, px, weight, color) {
  ctx.font = `${weight} ${px}px ${FF}`; ctx.fillStyle = color || '#000';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = px * 1.22, top = cy - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lh));
}

function legendSymbol(meta) {
  if (meta.legend && meta.legend.symbol) return meta.legend.symbol;
  const k = meta._kind;
  return k === 'poly' ? 'box' : k === 'point' ? 'dot' : 'line';
}

function collectLegend(cfg) {
  const groups = new Map();
  const add = (g, item) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(item); };
  if (cfg.showLegendLayers) {
    for (const meta of [...S.layers].reverse()) {
      if (!meta.visible || !meta.legend || !meta.legend.show) continue;
      add(meta.legend.group || 'Lapisan', { kind: 'layer', meta, text: meta.legend.label || meta.name });
    }
  }
  const th = theme();
  const st = computeStats();
  const seen = new Set();
  for (const r of th.rules || []) {
    if (r.enabled === false || !r.legendShow) continue;
    const key = (r.legendGroup || '') + '|' + r.legendLabel;
    add(r.legendGroup || 'Lainnya', { kind: 'rule', rule: r, text: r.legendLabel || 'Aturan' });
    seen.add(key);
  }
  const order = ['Perairan', 'Batas Area'];
  const names = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const rows = [];
  for (const g of names) {
    rows.push({ t: 'h', text: g });
    for (const it of groups.get(g)) rows.push({ t: 'i', ...it });
  }
  rows.push({ t: 'h', text: th.legendTitle || 'Keterangan', theme: true });
  th.classes.forEach((c, i) => {
    let text = c.label || '';
    if (th.showCounts) text += `  (${st.classCounts[i]})`;
    rows.push({ t: 'i', kind: 'class', cls: c, text });
  });
  return rows;
}

function drawSwatch(ctx, row, x, y, w, h, unit) {
  ctx.save();
  ctx.lineWidth = 0.7 * unit;
  if (row.kind === 'class' || row.kind === 'rule') {
    const o = row.kind === 'class' ? row.cls : row.rule;
    const fill = row.kind === 'class' ? o.color : o.fill;
    const al = row.kind === 'class' ? alphaOf(theme(), o) : 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
    if (fill) { ctx.globalAlpha = al; ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
    if (o.pattern && o.pattern !== 'none') {
      const pat = ctx.createPattern(makePatternTile(o.pattern, o.pc || '#000', 4.5 * unit), 'repeat');
      ctx.globalAlpha = al; ctx.fillStyle = pat; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
  } else {
    const m = row.meta, st = m.style || {}, sym = legendSymbol(m);
    const dash = st.dash ? String(st.dash).split(/[\s,]+/).map(Number).filter((n) => n > 0).map((n) => n * unit) : [];
    if (sym === 'line') {
      ctx.strokeStyle = st.stroke || '#000'; ctx.lineWidth = Math.max(1, (st.strokeWidth || 1) * unit);
      ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
    } else if (sym === 'dot') {
      ctx.fillStyle = st.pointColor || '#d32f2f'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(h, w) * 0.28, 0, 7); ctx.fill();
    } else {
      if (st.fill) { ctx.globalAlpha = st.fillOpacity == null ? 1 : st.fillOpacity; ctx.fillStyle = st.fill; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); }
      if (st.stroke) { ctx.strokeStyle = st.stroke; ctx.lineWidth = Math.max(1, (st.strokeWidth || 1) * unit); ctx.setLineDash(dash); ctx.strokeRect(x, y, w, h); }
    }
  }
  ctx.restore();
}

function drawNorth(ctx, cx, cy, r, unit) {
  ctx.save();
  ctx.lineWidth = 0.8 * unit; ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.18, r * 0.62, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx - r * 0.42, cy + r * 0.62); ctx.lineTo(cx, cy + r * 0.28); ctx.closePath();
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.42, cy + r * 0.62); ctx.lineTo(cx, cy + r * 0.28); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  ctx.restore();
}

function niceLen(maxM) {
  const c = [100, 200, 400, 1000, 2000, 4000, 10000, 20000, 40000, 100000];
  let best = c[0]; for (const v of c) if (v <= maxM) best = v;
  return best;
}

export async function renderPage(cfg, opts) {
  opts = opts || {};
  const [wMm, hMm] = pageSize(cfg);
  let dpi = opts.dpi || cfg.dpi || 200;
  const maxSide = opts.maxSide || 5200;
  let W = Math.round(wMm / 25.4 * dpi), H = Math.round(hMm / 25.4 * dpi);
  const k = Math.min(1, maxSide / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
  const unit = W / (wMm / 25.4 * 72); // px per pt kertas
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const th = theme();
  const portrait = cfg.orient === 'portrait';
  const m = 0.006 * Math.max(W, H);
  const Wi = W - 2 * m, Hi = H - 2 * m;
  const pw = Math.round(Wi * (portrait ? 0.30 : 0.193));
  const mapW = Wi - pw, mapH = Hi, mapX = m, mapY = m;
  const px0 = m + mapW; // panel x
  ctx.lineWidth = 1.2 * unit; ctx.strokeStyle = '#000';

  // ---- peta ----
  let view;
  const bb = dataBounds();
  if (cfg.fit === 'view' && opts.view) {
    const wW = opts.view.w / opts.view.scale, wH = opts.view.h / opts.view.scale;
    view = { cx: opts.view.cx, cy: opts.view.cy, scale: Math.min(mapW / wW, mapH / wH), w: mapW, h: mapH };
  } else view = bb ? fitView(bb, mapW, mapH, 0.025) : { cx: 0, cy: 0, scale: 1000, w: mapW, h: mapH };
  ctx.save();
  ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
  ctx.translate(mapX, mapY);
  renderMap(ctx, view, { unit, ptPx: unit, screen: false });
  ctx.restore();
  ctx.lineWidth = 1.2 * unit; ctx.strokeStyle = '#000';
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // ---- panel ----
  const P = { x: px0, y: m, w: pw, h: Hi };
  const box = (y, h) => { ctx.lineWidth = 1.0 * unit; ctx.strokeRect(P.x, y, P.w, h); };
  let y = P.y;
  // judul
  const titleH = Hi * (portrait ? 0.07 : 0.095);
  const titleLines = String(th.title || '').split('\n').filter(Boolean);
  box(y, titleH);
  if (titleLines.length) {
    const px = fitLines(ctx, titleLines, P.w * 0.9, titleH * 0.82, 'bold', titleH * 0.3);
    drawLines(ctx, titleLines, P.x + P.w / 2, y + titleH / 2, px, 'bold');
  }
  y += titleH;
  // perusahaan
  const compH = Hi * 0.052;
  const cLines = String(cfg.company || '').split('\n').filter(Boolean);
  box(y, compH);
  if (cLines.length) {
    const px = fitLines(ctx, cLines, P.w * 0.94, compH * 0.8, 'normal', compH * 0.3);
    ctx.font = `bold ${px}px ${FF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = px * 1.25, top = y + compH / 2 - (cLines.length - 1) * lh / 2;
    cLines.forEach((l, i) => { ctx.font = `${i === 0 ? 'bold' : 'normal'} ${px}px ${FF}`; ctx.fillStyle = '#000'; ctx.fillText(l, P.x + P.w / 2, top + i * lh); });
  }
  y += compH;
  // utara + skala
  const nsH = Hi * 0.072;
  box(y, nsH);
  if (cfg.showNorth) drawNorth(ctx, P.x + P.w / 2, y + nsH * 0.34, nsH * 0.27, unit);
  if (cfg.showScale) {
    const pxPerM = view.scale / M_PER_UNIT;
    const L = niceLen(P.w * 0.62 / pxPerM);
    const barW = L * pxPerM, bx = P.x + (P.w - barW) / 2, by = y + nsH * 0.78, bh = nsH * 0.09;
    const seg = 2;
    for (let i = 0; i < seg; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#000'; ctx.fillRect(bx + barW / seg * i, by, barW / seg, bh); }
    ctx.lineWidth = 0.6 * unit; ctx.strokeStyle = '#000'; ctx.strokeRect(bx, by, barW, bh);
    const fs = nsH * 0.13;
    ctx.fillStyle = '#000'; ctx.font = `${fs}px ${FF}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
    const fmt = (m) => (m / 1000).toString().replace('.', ',');
    ctx.fillText('0', bx, by - fs * 0.35);
    ctx.fillText(fmt(L / 2), bx + barW / 2, by - fs * 0.35);
    ctx.fillText(fmt(L) + ' km', bx + barW, by - fs * 0.35);
  }
  y += nsH;
  // header keterangan
  const kH = Hi * 0.03;
  box(y, kH);
  drawLines(ctx, [cfg.legendHeader || 'KETERANGAN'], P.x + P.w / 2, y + kH / 2, kH * 0.55, 'bold');
  y += kH;
  // area bawah
  const footH = Hi * 0.062;
  const idxImg = cfg.index ? await loadImg(cfg.index) : null;
  const logo = cfg.logo ? await loadImg(cfg.logo) : null;
  const legImg = th.legendImage ? await loadImg(th.legendImage) : null;
  let idxBlockH = 0;
  if (idxImg) {
    const ih = Math.min(P.w * 0.92 * idxImg.height / idxImg.width, Hi * 0.2);
    idxBlockH = Hi * 0.03 + ih + P.w * 0.04;
  }
  const bottomY = P.y + P.h - footH - idxBlockH;
  let legImgH = 0;
  if (legImg) legImgH = Math.min(P.w * 0.94 * legImg.height / legImg.width, Hi * 0.2) + P.w * 0.03;
  const legTop = y, legAvail = bottomY - legTop - legImgH;
  box(legTop, bottomY - legTop);
  // baris legenda
  const rows = collectLegend(cfg);
  const wts = rows.map((r, i) => (r.t === 'h' ? 1.0 + (i ? 0.45 : 0.2) : 1.0));
  const total = wts.reduce((a, b) => a + b, 0) + 0.4;
  let rowH = Math.min(Hi * 0.027, legAvail / total);
  const fs = rowH * 0.5;
  let ly = legTop + rowH * 0.3;
  rows.forEach((r, i) => {
    const wt = wts[i];
    if (r.t === 'h') {
      ly += (i ? 0.45 : 0.2) * rowH;
      ctx.font = `bold ${fs * 1.02}px ${FF}`; ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(r.text, P.x + P.w * 0.07, ly + rowH / 2);
    } else {
      ctx.font = `${fs}px ${FF}`; ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const sw = P.w * 0.26, sx = P.x + P.w * 0.93 - sw;
      let txt = r.text; const maxT = sx - (P.x + P.w * 0.07) - 4 * unit;
      while (ctx.measureText(txt).width > maxT && txt.length > 3) txt = txt.slice(0, -1);
      ctx.fillText(txt === r.text ? txt : txt + '…', P.x + P.w * 0.07, ly + rowH / 2);
      drawSwatch(ctx, r, sx, ly + rowH * 0.1, sw, rowH * 0.8, unit);
    }
    ly += (r.t === 'h' ? 1.0 : 1.0) * rowH;
  });
  if (legImg) {
    const iw = P.w * 0.94, ih = iw * legImg.height / legImg.width;
    ctx.drawImage(legImg, P.x + (P.w - iw) / 2, bottomY - ih - P.w * 0.015, iw, ih);
  }
  // indeks peta
  let yy = bottomY;
  if (idxImg) {
    box(yy, idxBlockH);
    drawLines(ctx, [cfg.indexTitle || 'INDEKS PETA'], P.x + P.w / 2, yy + Hi * 0.015, Hi * 0.017, 'bold');
    const ih = idxBlockH - Hi * 0.03 - P.w * 0.04, iw = ih * idxImg.width / idxImg.height;
    ctx.drawImage(idxImg, P.x + (P.w - iw) / 2, yy + Hi * 0.03, iw, ih);
    yy += idxBlockH;
  }
  // footer
  box(yy, footH);
  const fLines = String(cfg.footer || '').split('\n').filter(Boolean);
  let tx0 = P.x + P.w * 0.04;
  if (logo) {
    const lh = footH * 0.7, lw = Math.min(P.w * 0.2, lh * logo.width / logo.height), lhh = lw * logo.height / logo.width;
    ctx.drawImage(logo, tx0, yy + (footH - lhh) / 2, lw, lhh);
    tx0 += lw + P.w * 0.03;
  }
  if (fLines.length) {
    const maxW = P.x + P.w - tx0 - P.w * 0.02;
    const px = fitLines(ctx, fLines, maxW, footH * 0.86, 'normal', footH * 0.2);
    ctx.font = `${px}px ${FF}`; ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const lh = px * 1.25, top = yy + footH / 2 - (fLines.length - 1) * lh / 2;
    fLines.forEach((l, i) => { ctx.font = `${i === 0 ? 'bold' : 'normal'} ${px}px ${FF}`; ctx.fillText(l, tx0, top + i * lh); });
  }
  // bingkai luar
  ctx.lineWidth = 1.8 * unit; ctx.strokeStyle = '#000';
  ctx.strokeRect(m, m, Wi, Hi);
  return { canvas: cv, W, H, wMm, hMm };
}

// ---------- PDF minimal berisi satu gambar JPEG ----------
export function jpegToPdf(jpeg, wPx, hPx, wMm, hMm) {
  const enc = new TextEncoder();
  const wPt = (wMm / 25.4 * 72).toFixed(2), hPt = (hMm / 25.4 * 72).toFixed(2);
  const parts = []; const offs = []; let len = 0;
  const push = (b) => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offs[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg); push('\nendstream\nendobj\n');
  const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

export const canvasToBytes = (cv, type, q) => new Promise((res, rej) => cv.toBlob((b) => b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('Gagal membuat gambar')), type, q));

export async function buildFile(cfg, fmt, view) {
  const r = await renderPage(cfg, { view });
  if (fmt === 'png') return { bytes: await canvasToBytes(r.canvas, 'image/png'), mime: 'image/png', ext: 'png' };
  const jpg = await canvasToBytes(r.canvas, 'image/jpeg', 0.95);
  if (fmt === 'jpg') return { bytes: jpg, mime: 'image/jpeg', ext: 'jpg' };
  return { bytes: jpegToPdf(jpg, r.W, r.H, r.wMm, r.hMm), mime: 'application/pdf', ext: 'pdf' };
}
