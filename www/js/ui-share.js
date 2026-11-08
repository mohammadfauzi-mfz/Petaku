// Bagikan info lokasi: Teks (WhatsApp), PDF, Excel, Gambar. PDF/gambar sama persis dengan tampilan info lokasi.
import { S, theme, getField, getProp } from './model.js';
import { h, num, toast, shareFile } from './util.js';
import { openSheet } from './ui-common.js';
import { buildXlsx } from './xlsx.js';
import { canvasToBytes } from './export.js';
import { buildBlockCard, summaryText } from './ui-info.js';

const W = 420, SC = 2;
const PROPS = ['display', 'position', 'top', 'left', 'right', 'bottom', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'border-collapse', 'background-color', 'background-image', 'color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration', 'white-space', 'vertical-align', 'overflow', 'box-sizing', 'z-index', 'list-style', 'table-layout'];

function inlineStyles(src, dst) {
  const cs = getComputedStyle(src);
  let css = '';
  for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) css += p + ':' + v + ';'; }
  dst.setAttribute('style', css);
  const a = src.children, b = dst.children;
  for (let i = 0; i < a.length; i++) inlineStyles(a[i], b[i]);
}

// bangun kartu info di luar layar (selalu tema terang) lalu ubah jadi kanvas
async function capture(layer, feat) {
  const root = document.documentElement, prev = root.dataset.theme;
  root.dataset.theme = 'light';
  const box = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: W + 'px', padding: '12px', background: '#fff', boxSizing: 'border-box', fontFamily: getComputedStyle(document.body).fontFamily, color: '#17211c' } });
  const card = buildBlockCard(layer, feat);
  const act = card.querySelector('.ic-act'); if (act) act.remove();
  card.querySelectorAll('.perrow').forEach((x) => x.remove());
  card.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  box.append(card);
  document.body.append(box);
  let svg, hgt, tops;
  try {
    const bw = box.offsetWidth, bh = box.scrollHeight;
    hgt = bh;
    const br = box.getBoundingClientRect();
    tops = [...card.children].map((c) => Math.round(c.getBoundingClientRect().top - br.top));
    const clone = box.cloneNode(true);
    inlineStyles(box, clone);
    clone.style.left = '0'; clone.style.top = '0'; clone.style.position = 'static';
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const xml = new XMLSerializer().serializeToString(clone);
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw * SC}" height="${bh * SC}" viewBox="0 0 ${bw} ${bh}"><foreignObject x="0" y="0" width="${bw}" height="${bh}">${xml}</foreignObject></svg>`;
  } finally { box.remove(); root.dataset.theme = prev; }
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Gagal merender tampilan')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = hgt * SC;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return { cv, tops, hgt };
}

// ---- PDF A4 beberapa halaman dari potongan kanvas (dipotong di batas bagian) ----
function pdfPages(pages) {          // pages: [{jpeg, wPx, hPx, wPt, hPt}]
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = (b) => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
  const n = pages.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (i, body) => { offs[i] = len; push(`${i} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, im = pg + 1, ct = pg + 2;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pw.toFixed(2)} ${p.ph.toFixed(2)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    offs[im] = len;
    push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); push('\nendstream\nendobj\n');
    const c = `q ${p.dw.toFixed(2)} 0 0 ${p.dh.toFixed(2)} ${p.dx.toFixed(2)} ${(p.ph - p.dy - p.dh).toFixed(2)} cm /Im0 Do Q`;
    obj(ct, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  const total = 2 + n * 3, xref = len;
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
async function makePdf({ cv, tops, hgt }) {
  const PW = 595.28, PH = 841.89, M = 28;
  const dw = PW - 2 * M, k = dw / W;              // pt per px tampilan
  const pageH = Math.floor((PH - 2 * M) / k);     // tinggi halaman dalam px tampilan
  const cuts = [0]; let start = 0;
  while (start + pageH < hgt) {
    let cut = start + pageH;
    const ok = tops.filter((t) => t > start + pageH * 0.35 && t <= start + pageH);
    if (ok.length) cut = ok[ok.length - 1];
    cuts.push(cut); start = cut;
  }
  cuts.push(hgt);
  const pages = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const y0 = cuts[i], y1 = cuts[i + 1], hh = y1 - y0;
    const part = document.createElement('canvas'); part.width = W * SC; part.height = Math.max(1, Math.round(hh * SC));
    const c2 = part.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, part.width, part.height);
    c2.drawImage(cv, 0, y0 * SC, W * SC, hh * SC, 0, 0, W * SC, hh * SC);
    const jpeg = await canvasToBytes(part, 'image/jpeg', 0.92);
    pages.push({ jpeg, wPx: part.width, hPx: part.height, pw: PW, ph: PH, dw, dh: hh * k, dx: M, dy: M });
  }
  return pdfPages(pages);
}

// ---- Excel dari isi kartu ----
const rgb2hex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || ''); if (!m || (m[4] !== undefined && +m[4] === 0)) return null; return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join(''); };
function cellVal(text) {
  const t = String(text == null ? '' : text).trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { v: parseFloat(t.replace(/,/g, '')), fmt: t.includes('.') ? '0.00' : '#,##0' };
  if (/^-?\d+(\.\d+)?%$/.test(t)) return { v: parseFloat(t) / 100, fmt: '0%' };
  if (/^-?\d+\.\d+$/.test(t)) return { v: parseFloat(t), fmt: '0.00' };
  if (/^-?\d+$/.test(t) && t.length < 12) return { v: parseInt(t, 10) };
  return { v: t };
}
function rawVal(s) {
  const t = String(s == null ? '' : s).trim();
  if (t === '') return { v: '' };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { v: parseFloat(t.replace(/,/g, '')) };
  if (/%$/.test(t)) { const n = num(t); if (n != null) return { v: n / 100, fmt: '0%' }; }
  const n = num(t); return n != null && !/^0\d/.test(t) ? { v: n } : { v: t };
}
function buildExcel(layer, feat) {
  const root = document.documentElement, prev = root.dataset.theme; root.dataset.theme = 'light';
  const box = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: W + 'px' } });
  const card = buildBlockCard(layer, feat);
  card.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  box.append(card); document.body.append(box);
  const th = theme(), sheets = [];
  try {
    const code = (card.querySelector('.ic-code') || {}).textContent || '';
    const rows = [[{ v: `Blok ${code}`, b: 1 }], [{ v: th.name, b: 0 }], []];
    const chips = [...card.querySelectorAll('.ic-badges .bdg')].map((x) => x.textContent).join(' · ');
    if (chips) rows.push([{ v: 'Wilayah / status', b: 1 }, chips]);
    const cls = card.querySelector('.ic-class');
    if (cls) { const bg = rgb2hex(getComputedStyle(cls).backgroundColor), fg = rgb2hex(getComputedStyle(cls).color); rows.push([{ v: cls.querySelector('small').textContent, b: 1 }, { v: cls.querySelector('b').textContent, b: 1, bg, fg, bd: 1 }]); }
    rows.push([]);
    for (const t of card.querySelectorAll('.ic-grid .mt')) {
      const cs = getComputedStyle(t), bg = rgb2hex(cs.backgroundColor), fg = rgb2hex(cs.color), val = cellVal(t.querySelector('b').textContent);
      rows.push([{ v: t.querySelector('small').textContent, b: 1, bd: 1 }, { ...val, bg, fg, bd: 1, al: 'right', b: 1 }]);
    }
    sheets.push({ name: 'Info blok', cols: [26, 34], rows });
    // tabel di info lokasi -> satu lembar per tabel (warna sel ikut)
    for (const sec of card.querySelectorAll('details.ic-sec')) {
      const tb = sec.querySelector('table.itab'); if (!tb) continue;
      const name = (sec.querySelector('summary') || {}).textContent || 'Tabel';
      const rws = [[{ v: name, b: 1 }], []];
      let ncol = 0;
      for (const tr of tb.querySelectorAll('tr')) {
        const r = [];
        for (const c of tr.children) {
          const cs = getComputedStyle(c), bg = rgb2hex(cs.backgroundColor), fg = rgb2hex(cs.color), isH = c.tagName === 'TH';
          const val = isH ? { v: c.textContent } : cellVal(c.textContent);
          const left = c.classList.contains('lft');
          r.push({ ...val, bg: bg && bg !== '#ffffff' ? bg : null, fg: bg && bg !== '#ffffff' ? fg : null, b: isH || (cs.fontWeight >= 600), bd: 1, al: isH ? 'center' : left ? 'left' : 'center' });
        }
        ncol = Math.max(ncol, r.length); rws.push(r);
      }
      sheets.push({ name, cols: [20, ...new Array(Math.max(0, ncol - 1)).fill(14)], rows: rws });
    }
    // seluruh data blok dari CSV
    const all = [[{ v: 'Kolom', b: 1, bg: '#0b5d3b', fg: '#ffffff', bd: 1 }, { v: 'Nilai', b: 1, bg: '#0b5d3b', fg: '#ffffff', bd: 1 }]];
    if (S.ds && feat._row) for (const hd of S.ds.headers) { const v = getField(feat._row, hd); if (String(v == null ? '' : v).trim() === '') continue; all.push([{ v: hd, bd: 1 }, { ...rawVal(v), bd: 1, al: 'right' }]); }
    sheets.push({ name: 'Semua data', cols: [28, 18], rows: all });
  } finally { box.remove(); root.dataset.theme = prev; }
  return buildXlsx(sheets);
}

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
export function openShare(layer, feat) {
  const blok = getProp(feat.props || {}, layer.keyField) || 'blok';
  const base = `Petaku_${safe(blok)}_${safe(theme().name)}`;
  const txt = summaryText(layer, feat);
  const busy = { v: false };
  const run = async (btn, fn) => {
    if (busy.v) return; busy.v = true; const old = btn.textContent; btn.textContent = 'Menyiapkan…'; btn.disabled = true;
    try { await fn(); } catch (e) { console.error(e); toast('Gagal: ' + (e.message || e), 4500); } finally { busy.v = false; btn.textContent = old; btn.disabled = false; }
  };
  const opt = (title, sub, fn) => { const b = h('button', { class: 'shopt' }, h('b', {}, title), h('small', {}, sub)); b.onclick = () => run(b, fn); return b; };
  const body = h('div', { class: 'shlist' },
    opt('PDF', 'Sama dengan tampilan info lokasi', async () => { const c = await capture(layer, feat); await shareFile(base + '.pdf', await makePdf(c), 'application/pdf', base); }),
    opt('Excel (.xlsx)', 'Angka, tabel berwarna, dan seluruh data blok', async () => { await shareFile(base + '.xlsx', buildExcel(layer, feat), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base); }),
    opt('Gambar (PNG)', 'Tampilan info lokasi sebagai gambar', async () => { const c = await capture(layer, feat); await shareFile(base + '.png', await canvasToBytes(c.cv, 'image/png'), 'image/png', base); }),
    h('a', { class: 'shopt', href: 'https://wa.me/?text=' + encodeURIComponent(txt), target: '_blank', rel: 'noopener' }, h('b', {}, 'Teks WhatsApp'), h('small', {}, 'Ringkasan angka sebagai pesan')),
    h('div', { class: 'mut small' }, 'PDF, Excel, dan Gambar dibagikan lewat menu bagikan HP — pilih WhatsApp lalu kontak/grup tujuan.'));
  openSheet('Bagikan info blok ' + blok, body, { center: true });
}
