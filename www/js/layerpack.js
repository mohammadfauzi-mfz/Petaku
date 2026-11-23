// Paket layer (.zip): peta/poligon/garis/titik beserta pengaturan layer (tanpa CSV dan tanpa tema)
import { S, addImportedLayer, loadLayer, saveSoon, emit } from './model.js';
import { dbGet, dbSet, shareFile } from './util.js';
import { makeZip, readZip, isZip } from './zip.js';
import { activePT } from './pt.js';

const FMT = 'petaku-layers';
const META = ['name', 'keyField', 'themed', 'visible', 'style', 'legend'];
export const packable = () => S.layers.filter((l) => l.src === 'idb');

export async function buildLayerPack(layers) {
  const files = [], man = { format: FMT, v: 1, pt: activePT().id, at: Date.now(), layers: [] };
  let i = 0;
  for (const l of layers) {
    const g = await dbGet('geo:' + l.id); if (!g) continue;
    const file = 'layer' + (++i) + '.geojson';
    files.push({ name: file, data: JSON.stringify(g) });
    const meta = {}; for (const k of META) if (l[k] !== undefined) meta[k] = JSON.parse(JSON.stringify(l[k]));
    man.layers.push({ file, meta });
  }
  if (!man.layers.length) throw new Error('Tidak ada layer yang bisa dikemas');
  files.unshift({ name: 'petaku-layers.json', data: JSON.stringify(man) });
  return makeZip(files);
}
export async function shareLayerPack(layers) {
  const z = await buildLayerPack(layers);
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return shareFile(`PaketLayer_${activePT().id}_${ymd}.zip`, z, 'application/zip', 'Paket layer Petaku');
}
// impor: layer dengan nama sama diganti (geometri + pengaturan), yang belum ada ditambahkan
export async function importLayerPack(bytes) {
  if (!isZip(bytes)) throw new Error('Berkas ini bukan zip');
  const ents = readZip(bytes), mf = ents.find((e) => e.name === 'petaku-layers.json');
  if (!mf) throw new Error('Zip ini bukan paket layer Petaku');
  const man = JSON.parse(new TextDecoder().decode(await mf.bytes()));
  if (man.format !== FMT) throw new Error('Format paket tidak dikenal');
  let added = 0, replaced = 0;
  for (const it of man.layers || []) {
    const ent = ents.find((e) => e.name === it.file); if (!ent) continue;
    const gj = JSON.parse(new TextDecoder().decode(await ent.bytes()));
    if (!gj || !Array.isArray(gj.features) || !gj.features.length) continue;
    const m = it.meta || {};
    const cur = S.layers.find((l) => l.src === 'idb' && l.name === m.name);
    if (cur) {
      await dbSet('geo:' + cur.id, gj); S.rt.delete(cur.id);
      for (const k of META) if (m[k] !== undefined) cur[k] = m[k];
      await loadLayer(cur); replaced++;
    } else {
      const extra = {}; for (const k of META) if (m[k] !== undefined && k !== 'name') extra[k] = m[k];
      await addImportedLayer(m.name || 'Layer', gj, extra); added++;
    }
  }
  S.ver++; saveSoon(); emit('layers');
  return { added, replaced, pt: man.pt || '' };
}
