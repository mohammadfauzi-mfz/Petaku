import { h, $ } from './util.js';

const stack = [];
export function openSheet(title, body, opts) {
  opts = opts || {};
  const host = $('#sheetHost');
  const close = () => { back.remove(); const i = stack.indexOf(close); if (i >= 0) stack.splice(i, 1); if (opts.onClose) opts.onClose(); };
  const back = h('div', { class: 'back' + (opts.center ? ' mid' : ''), onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'sheet' + (opts.center ? ' center' : '') },
      h('div', { class: 'sh' }, h('span', {}, title), h('button', { class: 'btn sm sec', onclick: close }, 'Tutup')),
      h('div', { class: 'sb' }, body)));
  host.append(back);
  stack.push(close);
  return close;
}
export function closeTopSheet() { const c = stack[stack.length - 1]; if (c) { c(); return true; } return false; }

export function confirmBox(msg, okText) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; close(); res(v); } };
    const body = h('div', {}, h('p', {}, msg), h('div', { class: 'btns' },
      h('button', { class: 'btn red', onclick: () => fin(true) }, okText || 'Ya'),
      h('button', { class: 'btn sec', onclick: () => fin(false) }, 'Batal')));
    const close = openSheet('Konfirmasi', body, { center: true, onClose: () => { if (!done) { done = true; res(false); } } });
  });
}

export const row = (label, ...ctrls) => h('div', { class: 'row' }, label ? h('label', {}, label) : null, h('div', { class: 'grow', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, ...ctrls));

export function textInput(value, onInput, attrs) {
  const el = h('input', { type: 'text', value: value == null ? '' : value, ...(attrs || {}) });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
export function numInput(value, onInput, attrs) {
  const el = h('input', { type: 'text', inputmode: 'decimal', value: value == null ? '' : value, ...(attrs || {}) });
  el.addEventListener('input', () => {
    const s = el.value.trim().replace(',', '.');
    if (s === '' || s === '-') return onInput(null);
    const v = parseFloat(s); if (isFinite(v)) onInput(v);
  });
  return el;
}
export function colorInput(value, onInput) {
  const el = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000' });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
export function textArea(value, onInput, attrs) {
  const el = h('textarea', { ...(attrs || {}) }); el.value = value == null ? '' : value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
export function toggle(checked, onChange) {
  const inp = h('input', { type: 'checkbox', checked: !!checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'sw2' }, inp, h('span'));
}
export function check(checked, onChange, text) {
  const inp = h('input', { type: 'checkbox', checked: !!checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { style: { display: 'flex', gap: '7px', alignItems: 'center', fontSize: '14px' } }, inp, text);
}
