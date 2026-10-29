// Geometri: proyeksi lokal, parser GeoJSON/KML/CSV titik, utilitas poligon
export const proj = { lon0: 117.4, lat0: 0.7, cos: Math.cos(0.7 * Math.PI / 180) };
export const M_PER_UNIT = 111320; // meter per satuan dunia
export function setOrigin(lon, lat) {
  proj.lon0 = lon; proj.lat0 = lat; proj.cos = Math.cos(lat * Math.PI / 180);
}
export const toWorld = (lon, lat) => [(lon - proj.lon0) * proj.cos, -(lat - proj.lat0)];

function ringToArr(coords) {
  const a = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    const w = toWorld(coords[i][0], coords[i][1]);
    a[2 * i] = w[0]; a[2 * i + 1] = w[1];
  }
  return a;
}
function bboxOfArr(a, bb) {
  for (let i = 0; i < a.length; i += 2) {
    const x = a[i], y = a[i + 1];
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y;
    if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
  }
}

function addGeom(feat, g) {
  if (!g) return;
  const t = g.type;
  if (t === 'GeometryCollection') { (g.geometries || []).forEach((x) => addGeom(feat, x)); return; }
  if (t === 'Polygon' || t === 'MultiPolygon') {
    const polys = t === 'Polygon' ? [g.coordinates] : g.coordinates;
    feat.polys = feat.polys || [];
    for (const p of polys) {
      const rings = p.map(ringToArr).filter((r) => r.length >= 6);
      if (rings.length) { feat.polys.push(rings); bboxOfArr(rings[0], feat.bbox); }
    }
  } else if (t === 'LineString' || t === 'MultiLineString') {
    const ls = t === 'LineString' ? [g.coordinates] : g.coordinates;
    feat.lines = feat.lines || [];
    for (const l of ls) { const a = ringToArr(l); if (a.length >= 4) { feat.lines.push(a); bboxOfArr(a, feat.bbox); } }
  } else if (t === 'Point' || t === 'MultiPoint') {
    const ps = t === 'Point' ? [g.coordinates] : g.coordinates;
    feat.points = feat.points || [];
    for (const p of ps) { const w = toWorld(p[0], p[1]); feat.points.push(w); bboxOfArr(new Float64Array(w), feat.bbox); }
  }
}

function sampleCoord(g) {
  let c = g && g.coordinates;
  if (!c) return null;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return c;
}

export function parseGeoJSON(obj) {
  let feats;
  if (obj.type === 'FeatureCollection') feats = obj.features;
  else if (obj.type === 'Feature') feats = [obj];
  else feats = [{ type: 'Feature', properties: {}, geometry: obj }];
  feats = feats.filter((f) => f && f.geometry);
  // cek derajat
  for (const f of feats.slice(0, 20)) {
    const c = f.geometry.type === 'GeometryCollection' ? sampleCoord(f.geometry.geometries[0]) : sampleCoord(f.geometry);
    if (c && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) throw new Error('Koordinat bukan derajat (WGS84). Ekspor ulang layer ke EPSG:4326.');
  }
  const out = [];
  for (const f of feats) {
    const feat = { props: f.properties || {}, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    addGeom(feat, f.geometry);
    if (feat.bbox[0] !== Infinity) out.push(feat);
  }
  return out;
}

export function geojsonCenter(obj) {
  // pusat bounding box dalam lon/lat, untuk menentukan titik asal proyeksi
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const walk = (x) => {
    if (typeof x[0] === 'number') { a = Math.min(a, x[0]); c = Math.max(c, x[0]); b = Math.min(b, x[1]); d = Math.max(d, x[1]); }
    else x.forEach(walk);
  };
  const feats = obj.type === 'FeatureCollection' ? obj.features : obj.type === 'Feature' ? [obj] : [{ geometry: obj }];
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    if (g.type === 'GeometryCollection') g.geometries.forEach((x) => walk(x.coordinates)); else walk(g.coordinates);
  }
  return isFinite(a) ? [(a + c) / 2, (b + d) / 2] : null;
}

// ---------- KML ----------
export function kmlToGeoJSON(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('File KML tidak valid');
  const feats = [];
  const coordsOf = (el) => el.textContent.trim().split(/\s+/).map((s) => s.split(',').map(Number)).filter((a) => a.length >= 2 && isFinite(a[0]) && isFinite(a[1]));
  const geomOf = (pm) => {
    const gs = [];
    for (const poly of pm.getElementsByTagName('Polygon')) {
      const rings = [];
      const ob = poly.getElementsByTagName('outerBoundaryIs')[0];
      if (ob) rings.push(coordsOf(ob.getElementsByTagName('coordinates')[0]));
      for (const ib of poly.getElementsByTagName('innerBoundaryIs')) rings.push(coordsOf(ib.getElementsByTagName('coordinates')[0]));
      if (rings.length) gs.push({ type: 'Polygon', coordinates: rings });
    }
    for (const ls of pm.getElementsByTagName('LineString')) gs.push({ type: 'LineString', coordinates: coordsOf(ls.getElementsByTagName('coordinates')[0]) });
    for (const pt of pm.getElementsByTagName('Point')) { const c = coordsOf(pt.getElementsByTagName('coordinates')[0]); if (c[0]) gs.push({ type: 'Point', coordinates: c[0] }); }
    return gs;
  };
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const props = {};
    const nm = pm.getElementsByTagName('name')[0]; if (nm) props.name = nm.textContent.trim();
    const ds = pm.getElementsByTagName('description')[0]; if (ds) props.description = ds.textContent.trim();
    for (const d of pm.getElementsByTagName('Data')) { const v = d.getElementsByTagName('value')[0]; props[d.getAttribute('name')] = v ? v.textContent.trim() : ''; }
    for (const d of pm.getElementsByTagName('SimpleData')) props[d.getAttribute('name')] = d.textContent.trim();
    const gs = geomOf(pm);
    if (!gs.length) continue;
    feats.push({ type: 'Feature', properties: props, geometry: gs.length === 1 ? gs[0] : { type: 'GeometryCollection', geometries: gs } });
  }
  return { type: 'FeatureCollection', features: feats };
}

// ---------- CSV ----------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const cands = [';', ',', '\t', '|'];
  let delim = ';', best = -1;
  for (const d of cands) { const n = firstLines.split(d).length - 1; if (n > best) { best = n; delim = d; } }
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!clean.length) throw new Error('CSV kosong');
  const headers = clean[0].map((x, i) => String(x).trim() || 'Kolom' + (i + 1));
  const data = clean.slice(1).map((r) => {
    const o = {};
    headers.forEach((hd, i) => { o[hd] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
  return { headers, rows: data, delimiter: delim };
}

export function csvPointsToFeatures(ds) {
  const find = (names) => ds.headers.find((h) => names.includes(h.toLowerCase()));
  const la = find(['lat', 'latitude', 'y', 'lintang']);
  const lo = find(['lon', 'lng', 'long', 'longitude', 'x', 'bujur']);
  if (!la || !lo) throw new Error('Kolom lat/lon tidak ditemukan di CSV');
  const feats = [];
  for (const r of ds.rows) {
    const x = parseFloat(String(r[lo]).replace(',', '.')), y = parseFloat(String(r[la]).replace(',', '.'));
    if (isFinite(x) && isFinite(y)) feats.push({ type: 'Feature', properties: r, geometry: { type: 'Point', coordinates: [x, y] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

// ---------- geometri poligon ----------
export function ringArea(a) {
  let s = 0; const n = a.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) s += a[2 * j] * a[2 * i + 1] - a[2 * i] * a[2 * j + 1];
  return s / 2;
}

export function pointInRing(x, y, a) {
  let ins = false; const n = a.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// Titik label: garis horizontal melewati titik berat poligon terbesar,
// diambil segmen interior terlebar (cocok untuk blok memanjang).
export function labelAnchor(feat) {
  if (feat._anchor !== undefined) return feat._anchor;
  let best = null, ba = 0;
  for (const p of feat.polys || []) { const a = Math.abs(ringArea(p[0])); if (a > ba) { ba = a; best = p; } }
  if (!best) { feat._anchor = null; return null; }
  const o = best[0], n = o.length / 2;
  let cx = 0, cy = 0, A = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = o[2 * j] * o[2 * i + 1] - o[2 * i] * o[2 * j + 1];
    cx += (o[2 * j] + o[2 * i]) * f; cy += (o[2 * j + 1] + o[2 * i + 1]) * f; A += f;
  }
  let y = A ? cy / (3 * A) : (feat.bbox[1] + feat.bbox[3]) / 2;
  let x = A ? cx / (3 * A) : (feat.bbox[0] + feat.bbox[2]) / 2;
  let bestSeg = null;
  for (const dy of [0, -0.12, 0.12, -0.25, 0.25]) {
    const yy = y + dy * (feat.bbox[3] - feat.bbox[1]);
    const xs = [];
    for (const r of best) {
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const yi = r[2 * i + 1], yj = r[2 * j + 1];
        if ((yi > yy) !== (yj > yy)) xs.push((r[2 * j] - r[2 * i]) * (yy - yi) / (yj - yi) + r[2 * i]);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (!bestSeg || w > bestSeg.w * 1.0001) bestSeg = { x: (xs[k] + xs[k + 1]) / 2, y: yy, w };
    }
    if (bestSeg && dy === 0 && bestSeg.w > (feat.bbox[2] - feat.bbox[0]) * 0.5) break;
  }
  feat._anchor = bestSeg ? { x: bestSeg.x, y: bestSeg.y, w: bestSeg.w, h: feat.bbox[3] - feat.bbox[1] } : { x, y, w: feat.bbox[2] - feat.bbox[0], h: feat.bbox[3] - feat.bbox[1] };
  return feat._anchor;
}

export function featPath(feat) {
  if (feat._path) return feat._path;
  const p = new Path2D();
  for (const rings of feat.polys || []) {
    for (const r of rings) {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    }
  }
  feat._path = p; return p;
}
export function linePath(feat) {
  if (feat._lpath) return feat._lpath;
  const p = new Path2D();
  for (const l of feat.lines || []) {
    p.moveTo(l[0], l[1]);
    for (let i = 2; i < l.length; i += 2) p.lineTo(l[i], l[i + 1]);
  }
  // batas poligon (tanpa isi) untuk layer garis
  feat._lpath = p; return p;
}
export function outlinePath(feat) {
  if (feat._opath) return feat._opath;
  const p = new Path2D();
  for (const l of feat.lines || []) { p.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) p.lineTo(l[i], l[i + 1]); }
  feat._opath = p; return p;
}

export function hitPolygon(feat, x, y) {
  const bb = feat.bbox;
  if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) return false;
  for (const rings of feat.polys || []) {
    if (!pointInRing(x, y, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
