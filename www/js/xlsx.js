// Penulis .xlsx minimal (tanpa pustaka): ZIP tanpa kompresi + XML lembar kerja
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zip(files) {          // files: [{name, data(Uint8Array)}]
  const parts = []; const cen = []; let off = 0;
  const u16 = (v) => new Uint8Array([v & 255, v >> 8 & 255]);
  const u32 = (v) => new Uint8Array([v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]);
  const cat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(nm.length), u16(0), nm);
    parts.push(lh, f.data);
    cen.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), nm));
    off += lh.length + sz;
  }
  const cd = cat(...cen);
  parts.push(cd, cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0)));
  return cat(...parts);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const hex6 = (c) => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '').toUpperCase() : null);

// sheets: [{ name, cols:[lebar], rows:[[sel]] }]; sel = nilai | { v, b(bold), bg, fg, al(left|center|right), fmt('0%'|'#,##0'|'0.00'), bd(true=garis) }
export function buildXlsx(sheets) {
  const fonts = [{ b: 0, fg: null }], fills = [null, 'gray'], xfs = [{ f: 0, fi: 0, bd: 0, al: null, fmt: 0 }];
  const fmts = {}; let nextFmt = 164;
  const xfKey = new Map([['0|0|0||0', 0]]);
  const fontId = (b, fg) => { const k = `${b ? 1 : 0}|${fg || ''}`; let i = fonts.findIndex((x) => `${x.b}|${x.fg || ''}` === k); if (i < 0) { fonts.push({ b: b ? 1 : 0, fg }); i = fonts.length - 1; } return i; };
  const fillId = (bg) => { if (!bg) return 0; let i = fills.indexOf(bg); if (i < 0) { fills.push(bg); i = fills.length - 1; } return i; };
  const fmtId = (f) => { if (!f) return 0; if (f === '0%') return 9; if (f === '#,##0') return 3; if (f === '0.00') return 2; if (!fmts[f]) fmts[f] = nextFmt++; return fmts[f]; };
  const styleOf = (c) => {
    const fo = fontId(c.b, hex6(c.fg)), fi = fillId(hex6(c.bg)), bd = c.bd ? 1 : 0, al = c.al || '', fm = fmtId(c.fmt);
    const k = `${fo}|${fi}|${bd}|${al}|${fm}`;
    if (!xfKey.has(k)) { xfs.push({ f: fo, fi, bd, al, fmt: fm }); xfKey.set(k, xfs.length - 1); }
    return xfKey.get(k);
  };
  const used = new Set();
  const sheetXml = sheets.map((sh) => {
    let rowsXml = '';
    sh.rows.forEach((r, ri) => {
      let cells = '';
      r.forEach((c, ci) => {
        if (c == null || c === '') { if (!(c && c.bg)) return; }
        const o = (c !== null && typeof c === 'object') ? c : { v: c };
        if (o.v == null && !o.bg) return;
        const ref = colName(ci) + (ri + 1), s = styleOf(o), st = s ? ` s="${s}"` : '';
        if (typeof o.v === 'number' && isFinite(o.v)) cells += `<c r="${ref}"${st}><v>${o.v}</v></c>`;
        else if (o.v == null || o.v === '') cells += `<c r="${ref}"${st}/>`;
        else cells += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
      });
      rowsXml += `<row r="${ri + 1}">${cells}</row>`;
    });
    const cols = (sh.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData></worksheet>`;
  });
  const names = sheets.map((s, i) => {
    let n = String(s.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1);
    let k = n, j = 2; while (used.has(k.toLowerCase())) k = n.slice(0, 28) + ' ' + j++;
    used.add(k.toLowerCase()); return k;
  });
  const fmtXml = Object.entries(fmts).map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('');
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmtXml ? `<numFmts count="${Object.keys(fmts).length}">${fmtXml}</numFmts>` : ''}`
    + `<fonts count="${fonts.length}">${fonts.map((f) => `<font>${f.b ? '<b/>' : ''}<sz val="11"/>${f.fg ? `<color rgb="FF${f.fg}"/>` : ''}<name val="Calibri"/></font>`).join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.map((f, i) => i === 0 ? '<fill><patternFill patternType="none"/></fill>' : f === 'gray' ? '<fill><patternFill patternType="gray125"/></fill>' : `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.map((x) => `<xf numFmtId="${x.fmt}" fontId="${x.f}" fillId="${x.fi}" borderId="${x.bd}" xfId="0"${x.fmt ? ' applyNumberFormat="1"' : ''}${x.f ? ' applyFont="1"' : ''}${x.fi ? ' applyFill="1"' : ''}${x.bd ? ' applyBorder="1"' : ''}${x.al ? ' applyAlignment="1"' : ''}>${x.al ? `<alignment horizontal="${x.al}" vertical="center"/>` : ''}</xf>`).join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((n, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(ct) }, { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) }, { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) }, { name: 'xl/styles.xml', data: enc.encode(styles) },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(x) })),
  ];
  return zip(files);
}
