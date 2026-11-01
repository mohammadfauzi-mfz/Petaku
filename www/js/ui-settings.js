import { S, saveNow, VERSION } from './model.js';
import { h, toast, select, uiMode, setUiMode } from './util.js';
import { openSheet, row, textInput, check } from './ui-common.js';
import { push, pull, checkRemote, checkConfig } from './sync.js';
import { checkUpdate, installUpdate, BUILD } from './update.js';
import { petaku } from './native.js';

const fmtTime = (ms) => { if (!ms) return '–'; try { return new Date(Number(ms)).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(ms); } };

export function openSettings() {
  const c = S.sync;
  const body = h('div', {});

  // ---------- sinkron ----------
  const sc = h('div', { class: 'card' }, h('h3', {}, 'Sinkron data (GitHub)'));
  sc.append(h('div', { class: 'mut small' }, 'Data (CSV, tema, layer tambahan) disimpan di folder “sync” pada repo GitHub, sehingga pengguna lain bisa menarik data terbaru. Yang menarik data cukup mengisi nama repo (repo publik tanpa token).'));
  sc.append(row('Repo', textInput(c.repo, (v) => { c.repo = v.trim(); saveNow(); }, { placeholder: 'pemilik/nama-repo', autocapitalize: 'none' })));
  const tok = textInput(c.token, (v) => { c.token = v.trim(); saveNow(); }, { placeholder: 'ghp_… / github_pat_… (untuk mengirim)', type: 'password', autocapitalize: 'none' });
  sc.append(row('Token', tok));
  sc.append(h('div', { class: 'mut small' }, 'Token hanya perlu untuk MENGIRIM data (atau bila repo privat): GitHub → Settings → Developer settings → Fine-grained tokens → pilih repo ini → Permissions: Contents = Read and write. Token disimpan hanya di HP ini dan tidak ikut tersinkron.'));
  const sc2 = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '8px 0' } },
    check(c.scope.data, (v) => { c.scope.data = v; saveNow(); }, 'Data CSV'),
    check(c.scope.themes, (v) => { c.scope.themes = v; saveNow(); }, 'Tema'),
    check(c.scope.layers, (v) => { c.scope.layers = v; saveNow(); }, 'Layer'),
    check(c.scope.cfg, (v) => { c.scope.cfg = v; saveNow(); }, 'Pengaturan ekspor'));
  sc.append(sc2);
  const status = h('div', { class: 'mut small', style: { minHeight: '1.4em' } }, `Terakhir tarik/kirim: ${fmtTime(c.lastPull)}`);
  const busy = (btns, on) => btns.forEach((b) => { b.disabled = on; });
  const bPull = h('button', { class: 'btn' }, 'Tarik data terbaru');
  const bPush = h('button', { class: 'btn sec' }, 'Kirim data saya');
  const bCheck = h('button', { class: 'btn sec' }, 'Cek ada data baru');
  const run = async (btn, fn) => {
    busy([bPull, bPush, bCheck], true);
    try { await fn(); } catch (e) { console.error(e); status.textContent = '⚠ ' + (e.message || e); status.style.color = 'var(--warn)'; toast(String(e.message || e), 5000); }
    busy([bPull, bPush, bCheck], false);
  };
  const say = (t) => { status.style.color = ''; status.textContent = t; };
  bPull.onclick = () => run(bPull, async () => {
    checkConfig(false);
    const r = await pull(c.scope, say);
    say(`✔ Ditarik: ${r.done.join(', ') || 'tidak ada perubahan'} (data per ${fmtTime(r.manifest.updatedAt)})`);
    toast('Data terbaru sudah ditarik');
  });
  bPush.onclick = () => run(bPush, async () => {
    const m = await push(c.scope, say);
    say(`✔ Terkirim: ${m.files.join(', ')} (${fmtTime(m.updatedAt)})`);
    toast('Data terkirim ke GitHub');
  });
  bCheck.onclick = () => run(bCheck, async () => {
    say('Memeriksa…');
    const r = await checkRemote();
    if (!r.manifest) say('Belum ada data sinkron di repo.');
    else say(r.newer ? `● Ada data baru (dikirim ${fmtTime(r.manifest.updatedAt)}). Tekan “Tarik data terbaru”.` : `✔ Sudah yang terbaru (data per ${fmtTime(r.manifest.updatedAt)})`);
  });
  sc.append(h('div', { class: 'btns' }, bPull, bPush, bCheck));
  sc.append(status);
  body.append(sc);
  body.append(h('div', { class: 'card' }, h('h3', {}, 'Tampilan aplikasi'),
    row('Mode', select([['auto', 'Ikuti HP (otomatis)'], ['light', 'Terang'], ['dark', 'Gelap']], uiMode(), (v) => setUiMode(v))),
    h('div', { class: 'mut small' }, 'Hanya mengubah tampilan aplikasi. Peta dan hasil ekspor tetap berlatar putih.')));

  // ---------- pembaruan ----------
  const uc = h('div', { class: 'card' }, h('h3', {}, 'Pembaruan aplikasi'));
  uc.append(h('div', { class: 'mut small' }, `Terpasang: Petaku ${VERSION} (build ${BUILD || '–'}). Pembaruan diambil dari Release terbaru di repo ${c.repo}.`));
  const us = h('div', { class: 'mut small', style: { minHeight: '1.4em', margin: '6px 0' } });
  const ub = h('button', { class: 'btn' }, 'Periksa pembaruan');
  const act = h('div', { class: 'btns' }, ub);
  ub.onclick = async () => {
    ub.disabled = true; us.style.color = ''; us.textContent = 'Memeriksa…';
    try {
      const r = await checkUpdate();
      act.innerHTML = ''; act.append(ub);
      if (r.none) us.textContent = 'Belum ada Release di repo.';
      else if (!r.available) us.textContent = `✔ Sudah versi terbaru (${r.tag}).`;
      else {
        us.textContent = `● Tersedia: ${r.name || r.tag}${r.apk && r.apk.size ? ' · ' + (r.apk.size / 1048576).toFixed(1) + ' MB' : ''}`;
        const ib = h('button', { class: 'btn' }, petaku() ? 'Unduh & pasang' : 'Unduh APK');
        ib.onclick = async () => {
          ib.disabled = true;
          try {
            const res = await installUpdate(r, (p) => { us.textContent = `Mengunduh… ${p}%`; });
            us.textContent = res === 'ok' ? 'Unduhan selesai — ikuti layar pemasangan Android.' : 'APK dibuka di browser.';
          } catch (e) {
            us.style.color = 'var(--warn)';
            us.textContent = String(e && e.code) === 'NEED_PERMISSION' || /izin/i.test(e && e.message || '')
              ? 'Aktifkan “Izinkan dari sumber ini” untuk Petaku di layar yang terbuka, lalu tekan tombol ini lagi.'
              : 'Gagal: ' + (e && e.message || e);
          }
          ib.disabled = false;
        };
        act.append(ib);
      }
    } catch (e) { us.style.color = 'var(--warn)'; us.textContent = '⚠ ' + (e.message || e); }
    ub.disabled = false;
  };
  uc.append(us, act);
  body.append(uc);

  // ---------- tentang ----------
  const wa = '6285252390543';
  body.append(h('div', { class: 'card' },
    h('h3', {}, 'Tentang aplikasi'),
    h('p', {}, h('b', {}, 'Petaku'), ' — pewarna peta blok dari CSV. Impor CSV (boleh banyak), pilih jenis peta, atur warna & layer, lalu ekspor PDF/PNG. CSV dari WhatsApp bisa dibuka langsung: ketuk berkasnya → pilih Petaku.'),
    h('p', { class: 'mut' }, 'Kiat: buat jenis peta baru di tab Tema (Salin tema lalu ubah kolom, kelas, dan judul). Layer tambahan (GeoJSON/KML/CSV titik) diimpor dari tab Layer.'),
    h('p', {}, 'Create By Mohammad Fauzi'),
    h('p', {}, 'Contact Me for Suggestion & Feedback ', h('a', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', style: { textDecoration: 'none', fontSize: '20px' }, 'aria-label': 'WhatsApp' }, '💬')),
    h('p', { class: 'mut', style: { textAlign: 'center', marginTop: '22px' } }, 'Versi Aplikasi ' + VERSION + (BUILD ? ' (build ' + BUILD + ')' : ''))));
  openSheet('Pengaturan', body);
}
