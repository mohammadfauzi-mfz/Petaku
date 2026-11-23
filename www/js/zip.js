// ZIP minimal (tanpa pustaka): tulis & baca berkas zip memakai CompressionStream (deflate-raw)
const T = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function pipe(bytes, stream) {
  const r = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(r).arrayBuffer());
}
const deflate = (b) => pipe(b, new CompressionStream('deflate-raw'));
const inflate = (b) => pipe(b, new DecompressionStream('deflate-raw'));
const u16 = (v, o, x) => { v.setUint16(o, x, true); };
const u32 = (v, o, x) => { v.setUint32(o, x >>> 0, true); };

// files: [{ name, data: Uint8Array | string }] -> Uint8Array
export async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw); let comp = await deflate(raw), method = 8;
    if (comp.length >= raw.length) { comp = raw; method = 0; }
    const lh = new Uint8Array(30 + nm.length), lv = new DataView(lh.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, method); u16(lv, 10, 0); u16(lv, 12, 0x21);
    u32(lv, 14, crc); u32(lv, 18, comp.length); u32(lv, 22, raw.length); u16(lv, 26, nm.length); u16(lv, 28, 0); lh.set(nm, 30);
    parts.push(lh, comp);
    const ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, method); u16(cv, 12, 0); u16(cv, 14, 0x21);
    u32(cv, 16, crc); u32(cv, 20, comp.length); u32(cv, 24, raw.length); u16(cv, 28, nm.length); u32(cv, 42, off); ch.set(nm, 46);
    cen.push(ch); off += lh.length + comp.length;
  }
  const cs = cen.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length); u16(ev, 10, files.length); u32(ev, 12, cs); u32(ev, 16, off);
  const all = new Uint8Array(off + cs + 22); let p = 0;
  for (const b of [...parts, ...cen, end]) { all.set(b, p); p += b.length; }
  return all;
}
export const isZip = (b) => b && b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
// -> [{ name, bytes() }]
export function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('bukan berkas zip yang valid');
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
  const dec = new TextDecoder(), out = [];
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip rusak');
    const method = v.getUint16(p + 10, true), csz = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    out.push({ name, bytes: async () => {
      const ln = v.getUint16(lo + 26, true), lx = v.getUint16(lo + 28, true), st = lo + 30 + ln + lx, c = bytes.subarray(st, st + csz);
      if (method === 0) return c;
      if (method === 8) return inflate(c);
      throw new Error('metode kompresi zip tidak didukung');
    } });
    p += 46 + nl + xl + cl;
  }
  return out;
}
