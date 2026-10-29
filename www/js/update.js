// Pembaruan aplikasi: ambil APK dari Release terbaru di GitHub
import { S } from './model.js';
import { BUILD } from './version.js';
import { petaku } from './native.js';

export { BUILD };

export async function checkUpdate() {
  const c = S.sync;
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) throw new Error('Isi nama repo di Pengaturan');
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (c.token) h.Authorization = 'Bearer ' + c.token;
  const r = await fetch(`https://api.github.com/repos/${c.repo}/releases/latest?_=${Date.now()}`, { headers: h, cache: 'no-store' });
  if (r.status === 404) return { available: false, none: true };
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const j = await r.json();
  const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
  const m = String(j.tag_name || '').match(/(\d+)\s*$/);
  const n = m ? parseInt(m[1], 10) : 0;
  c.lastUpdateCheck = Date.now();
  return { available: !!apk && n > BUILD, tag: j.tag_name, name: j.name, n, apk, notes: j.body || '', published: j.published_at };
}

export async function installUpdate(info, onProgress) {
  const P = petaku();
  const c = S.sync;
  if (!P) { window.open(info.apk.browser_download_url, '_blank'); return 'browser'; }
  let off;
  try {
    if (P.addListener && onProgress) off = await P.addListener('progress', (e) => onProgress(e.pct));
    await P.installApk({ url: c.token ? info.apk.url : info.apk.browser_download_url, token: c.token || '' });
    return 'ok';
  } finally { if (off && off.remove) off.remove(); }
}
