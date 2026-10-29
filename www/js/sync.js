// Sinkron data antar pengguna lewat repo GitHub (folder sync/) memakai GitHub Contents API
import { S, saveNow, bump, emit, buildDs, putDataset, slimDs, loadLayer } from './model.js';
import { dbGet, dbSet, dbDel, bytesToBase64 } from './util.js';
import { BUILD } from './version.js';

const API = 'https://api.github.com';
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const cfg = () => S.sync;

function headers(raw) {
  const t = cfg().token;
  const h = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}
async function fail(r, what) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch (e) { /* abaikan */ }
  if (r.status === 401) throw new Error('Token GitHub ditolak (401). Periksa token di Pengaturan.');
  if (r.status === 403) throw new Error('Akses ditolak / batas permintaan GitHub (403). ' + msg);
  if (r.status === 404) throw new Error(what + ' tidak ditemukan (404). Cek nama repo / hak akses token.');
  throw new Error(`GitHub ${r.status}: ${msg || what}`);
}
function repoPath(p) { return `${API}/repos/${cfg().repo}/contents/${enc(cfg().folder + '/' + p)}`; }

async function getText(p) {
  const r = await fetch(`${repoPath(p)}?ref=${encodeURIComponent(cfg().branch)}&_=${Date.now()}`, { headers: headers(true), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) await fail(r, p);
  return r.text();
}
async function getSha(p) {
  const r = await fetch(`${repoPath(p)}?ref=${encodeURIComponent(cfg().branch)}&_=${Date.now()}`, { headers: headers(false), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) await fail(r, p);
  const j = await r.json();
  return j && j.sha ? j.sha : null;
}
async function putText(p, text, message) {
  const content = bytesToBase64(new TextEncoder().encode(text));
  for (let attempt = 0; attempt < 2; attempt++) {
    const sha = await getSha(p);
    const body = { message, content, branch: cfg().branch };
    if (sha) body.sha = sha;
    const r = await fetch(repoPath(p), { method: 'PUT', headers: { ...headers(false), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return;
    if ((r.status === 409 || r.status === 422) && attempt === 0) continue;
    await fail(r, p);
  }
}

export function checkConfig(needToken) {
  const c = cfg();
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) throw new Error('Isi nama repo dengan format pemilik/nama, mis. mohammadfauzi-mfz/Petaku');
  if (needToken && !c.token) throw new Error('Mengirim data butuh token GitHub (lihat petunjuk di Pengaturan).');
}

const stripLayer = (l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('_')));

// ---------- kirim ----------
export async function push(scope, progress) {
  checkConfig(true);
  const say = progress || (() => {});
  const files = [];
  if (scope.data) {
    files.push(['datasets.json', JSON.stringify({
      active: S.dsActive,
      datasets: S.dsList.map((d) => { const s = slimDs(d); return { id: s.id, name: s.name, headers: s.headers, delimiter: s.delimiter, keyCol: s.keyCol, updatedAt: s.updatedAt, rows: s.rows.map((r) => s.headers.map((h) => r[h])) }; }),
    })]);
  }
  if (scope.themes) files.push(['themes.json', JSON.stringify({ themes: S.themes, themeId: S.themeId })]);
  if (scope.layers) {
    files.push(['layers.json', JSON.stringify({ layers: S.layers.map(stripLayer) })]);
    for (const l of S.layers) {
      if (l.src !== 'idb') continue;
      const g = await dbGet('geo:' + l.id);
      if (g) files.push(['layer-' + l.id + '.geojson', JSON.stringify(g)]);
    }
  }
  if (scope.cfg) files.push(['config.json', JSON.stringify(S.cfg)]);
  if (!files.length) throw new Error('Pilih minimal satu jenis data');
  let i = 0;
  for (const [name, text] of files) {
    say(`Mengirim ${name} (${++i}/${files.length})…`);
    await putText(name, text, 'Petaku: sinkron ' + name);
  }
  const manifest = { updatedAt: Date.now(), updatedISO: new Date().toISOString(), build: BUILD, scope: Object.keys(scope).filter((k) => scope[k]), files: files.map((f) => f[0]) };
  say('Menulis manifest…');
  await putText('manifest.json', JSON.stringify(manifest), 'Petaku: manifest sinkron');
  cfg().lastManifest = String(manifest.updatedAt); cfg().lastPull = Date.now();
  await saveNow();
  return manifest;
}

// ---------- cek & tarik ----------
export async function remoteManifest() {
  checkConfig(false);
  const t = await getText('manifest.json');
  return t ? JSON.parse(t) : null;
}
export async function checkRemote() {
  const m = await remoteManifest();
  if (!m) return { newer: false, manifest: null };
  return { newer: String(m.updatedAt) !== String(cfg().lastManifest || ''), manifest: m };
}

export async function pull(scope, progress) {
  const say = progress || (() => {});
  say('Membaca manifest…');
  const m = await remoteManifest();
  if (!m) throw new Error('Belum ada data sinkron di repo (folder ' + cfg().folder + '/). Kirim dulu dari HP yang punya data.');
  const done = [];
  if (scope.data) {
    say('Mengunduh data CSV…');
    const t = await getText('datasets.json');
    if (t) {
      const j = JSON.parse(t);
      for (const d of j.datasets || []) {
        const rows = d.rows.map((a) => { const o = {}; d.headers.forEach((h, k) => { o[h] = a[k] == null ? '' : a[k]; }); return o; });
        const ds = buildDs({ headers: d.headers, rows, delimiter: d.delimiter }, d.name, d.keyCol, d.id, d.updatedAt);
        const i = S.dsList.findIndex((x) => x.id === ds.id || x.name.toLowerCase() === ds.name.toLowerCase());
        if (i >= 0) { ds.id = S.dsList[i].id; S.dsList[i] = ds; } else S.dsList.push(ds);
      }
      if (j.active && S.dsList.some((d) => d.id === j.active)) S.dsActive = j.active;
      done.push(`${(j.datasets || []).length} CSV`);
    }
  }
  if (scope.themes) {
    say('Mengunduh tema…');
    const t = await getText('themes.json');
    if (t) {
      const j = JSON.parse(t);
      for (const th of j.themes || []) { const i = S.themes.findIndex((x) => x.id === th.id); if (i >= 0) S.themes[i] = th; else S.themes.push(th); }
      if (j.themeId && S.themes.some((x) => x.id === j.themeId)) S.themeId = j.themeId;
      done.push(`${(j.themes || []).length} tema`);
    }
  }
  if (scope.layers) {
    say('Mengunduh layer…');
    const t = await getText('layers.json');
    if (t) {
      const j = JSON.parse(t);
      const remote = j.layers || [];
      const merged = [];
      for (const rl of remote) {
        const local = S.layers.find((x) => x.id === rl.id);
        if (rl.src === 'idb') {
          const g = await getText('layer-' + rl.id + '.geojson');
          if (g) { await dbSet('geo:' + rl.id, JSON.parse(g)); S.rt.delete(rl.id); }
          else if (!local) continue;
        }
        const meta = local ? Object.assign(local, rl) : rl;
        merged.push(meta);
      }
      const ids = new Set(merged.map((x) => x.id));
      for (const l of S.layers) if (!ids.has(l.id)) merged.push(l);
      S.layers = merged;
      for (const l of S.layers) if (l.visible && !(S.rt.get(l.id) && S.rt.get(l.id).feats)) { try { await loadLayer(l); } catch (e) { l.visible = false; } }
      done.push(`${remote.length} layer`);
    }
  }
  if (scope.cfg) {
    say('Mengunduh pengaturan ekspor…');
    const t = await getText('config.json');
    if (t) { S.cfg = { ...S.cfg, ...JSON.parse(t) }; done.push('pengaturan ekspor'); }
  }
  cfg().lastManifest = String(m.updatedAt); cfg().lastPull = Date.now();
  S.ver++; emit('layers'); bump('data');
  await saveNow();
  return { manifest: m, done };
}
