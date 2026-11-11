// Ketuk grafik -> tampil layar penuh; cubit untuk zoom, geser, ketuk dua kali = reset, tombol putar = mendatar.
import { h } from './util.js';

const SKIP = 'summary,select,button,input,a,.perrow,.yrpanel,.yrchip,.zhint';
export function zoomable(el) {
  if (!el || el._zoomable) return el; el._zoomable = true;
  el.classList.add('zoomable');
  el.addEventListener('click', (ev) => {
    if (ev.target.closest(SKIP)) return;
    if (!ev.target.closest('.ic-sec > *') && ev.target !== el) return;
    openZoom(el);
  });
  return el;
}

export function openZoom(src) {
  const title = (src.querySelector('summary') || {}).textContent || 'Grafik';
  const clone = src.cloneNode(true);
  clone.querySelectorAll('summary,.perrow,.yrpanel,.zhint,select,button').forEach((x) => x.remove());
  clone.open = true; clone.classList.remove('zoomable');
  const pan = h('div', { class: 'zv-pan' }, clone);
  const stage = h('div', { class: 'zv-stage' }, pan);
  let rot = false, sc = 1, tx = 0, ty = 0, base = 1;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const bRot = h('button', { class: 'btn sec sm', onclick: () => { rot = !rot; layout(); } }, '⟲ Putar');
  const bRes = h('button', { class: 'btn sec sm', onclick: () => fit() }, 'Reset');
  const ov = h('div', { class: 'zv' },
    h('div', { class: 'zv-bar' }, h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title), bRot, bRes, h('button', { class: 'btn sm', onclick: close }, 'Tutup')),
    h('div', { class: 'zv-body' }, stage),
    h('div', { class: 'zv-hint' }, 'Cubit untuk zoom · geser untuk menggeser · ketuk dua kali untuk reset'));
  document.body.append(ov); document.addEventListener('keydown', onKey);
  const body = ov.querySelector('.zv-body');
  const apply = () => { pan.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
  const sz = () => (rot ? { w: body.clientHeight, h: body.clientWidth } : { w: body.clientWidth, h: body.clientHeight });
  function layout() {
    const s = sz();
    stage.style.cssText = rot
      ? `position:absolute;top:0;left:${body.clientWidth}px;width:${s.w}px;height:${s.h}px;transform-origin:0 0;transform:rotate(90deg)`
      : 'position:absolute;inset:0';
    fit();
  }
  function fit() {
    const s = sz(); pan.style.transform = 'none';
    const cw = pan.scrollWidth || 1, ch = pan.scrollHeight || 1;
    base = Math.min(s.w / cw, s.h / ch); sc = base;
    tx = (s.w - cw * sc) / 2; ty = Math.max(0, (s.h - ch * sc) / 2); apply();
  }
  const clampSc = (v) => Math.max(base * 0.8, Math.min(base * 8, v));
  const zoomAt = (px, py, ns) => { ns = clampSc(ns); tx = px - (px - tx) * (ns / sc); ty = py - (py - ty) * (ns / sc); sc = ns; apply(); };
  // koordinat layar -> koordinat stage (memperhitungkan putaran)
  const toStage = (cx, cy) => { const r = body.getBoundingClientRect(); const x = cx - r.left, y = cy - r.top; return rot ? { x: y, y: r.width - x } : { x, y }; };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  let t0 = null, lastTap = 0;
  body.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) t0 = { d: dist(e.touches[0], e.touches[1]), sc, mx: (e.touches[0].clientX + e.touches[1].clientX) / 2, my: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    else if (e.touches.length === 1) { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, pan: true }; const n = Date.now(); if (n - lastTap < 300) fit(); lastTap = n; }
  }, { passive: false });
  body.addEventListener('touchmove', (e) => {
    e.preventDefault(); if (!t0) return;
    if (e.touches.length === 2 && t0.d) { const p = toStage(t0.mx, t0.my); zoomAt(p.x, p.y, t0.sc * dist(e.touches[0], e.touches[1]) / t0.d); }
    else if (e.touches.length === 1 && t0.pan) {
      const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y; t0.x = e.touches[0].clientX; t0.y = e.touches[0].clientY;
      if (rot) { tx += dy; ty -= dx; } else { tx += dx; ty += dy; } apply();
    }
  }, { passive: false });
  body.addEventListener('touchend', (e) => { if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, pan: true }; else if (!e.touches.length) t0 = null; });
  // mouse (uji di komputer)
  body.addEventListener('wheel', (e) => { e.preventDefault(); const p = toStage(e.clientX, e.clientY); zoomAt(p.x, p.y, sc * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  let md = null;
  body.addEventListener('mousedown', (e) => { md = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mousemove', (e) => { if (!md || !ov.isConnected) return; const dx = e.clientX - md.x, dy = e.clientY - md.y; md = { x: e.clientX, y: e.clientY }; if (rot) { tx += dy; ty -= dx; } else { tx += dx; ty += dy; } apply(); });
  window.addEventListener('mouseup', () => { md = null; });
  body.addEventListener('dblclick', fit);
  layout();
}
