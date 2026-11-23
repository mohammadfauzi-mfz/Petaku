// ===== Petaku – server foto catatan (Google Apps Script) =====
// Foto disimpan di folder Google Drive milik akun yang men-deploy script ini.
// Setiap permintaan wajib membawa token login Firebase; hanya Admin/anggota Petaku yang dilayani.

// ISI DAFTAR PT (nilai apiKey & projectId sama dengan fbconfig.js di aplikasi).
// Foto tiap PT masuk ke folder terpisah: Petaku Foto/<id PT>/
// PT pertama juga boleh membaca foto lama yang ada langsung di folder "Petaku Foto" (sebelum multi-PT).
// Menambah PT baru: tambahkan satu baris, lalu Deploy -> Kelola deployment -> Versi baru.
const PTS = {
  BPN: { apiKey: 'ISI_API_KEY_BPN', projectId: 'ISI_PROJECT_ID_BPN' },
  BAS: { apiKey: 'ISI_API_KEY_BAS', projectId: 'ISI_PROJECT_ID_BAS' },
  DIL: { apiKey: 'ISI_API_KEY_DIL', projectId: 'ISI_PROJECT_ID_DIL' },
};
const FIRST_PT = 'BPN';
const FOLDER_NAME = 'Petaku Foto';
const MAX_B64 = 400000; // batas ukuran foto (karakter base64) ~ 300 KB

function doGet() { return out_({ ok: true, msg: 'Server foto Petaku aktif' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const pt = String(req.pt || FIRST_PT);          // aplikasi lama (tanpa PT) dianggap PT pertama
    if (!PTS[pt]) throw new Error('PT tidak dikenal: ' + pt);
    verify_(req.token, pt);
    if (req.a === 'ping') return out_({ ok: true });
    if (req.a === 'put') {
      const mime = /^image\/(jpeg|png|webp)$/.test(req.mime || '') ? req.mime : 'image/jpeg';
      if (!req.data || req.data.length > MAX_B64) throw new Error('Foto kosong atau terlalu besar');
      const blob = Utilities.newBlob(Utilities.base64Decode(req.data), mime, String(req.name || 'foto.jpg').replace(/[^\w.\-]/g, '_').slice(0, 120));
      const file = folder_(pt).createFile(blob);
      return out_({ ok: true, id: file.getId() });
    }
    if (req.a === 'get') {
      const f = file_(req.id, pt);
      return out_({ ok: true, mime: f.getMimeType(), data: Utilities.base64Encode(f.getBlob().getBytes()) });
    }
    if (req.a === 'del') {
      // ARSIP: foto tidak pernah dihapus dari Drive, walau catatannya dihapus di aplikasi
      return out_({ ok: true, kept: true });
    }
    throw new Error('Perintah tidak dikenal');
  } catch (err) {
    return out_({ ok: false, err: String(err && err.message || err) });
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function root_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* dibuat ulang */ } }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FID', f.getId());
  return f;
}
// folder per PT di dalam "Petaku Foto"
function folder_(pt) {
  const props = PropertiesService.getScriptProperties(), key = 'FID_' + pt;
  const id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* dibuat ulang */ } }
  const root = root_(), it = root.getFoldersByName(pt);
  const f = it.hasNext() ? it.next() : root.createFolder(pt);
  props.setProperty(key, f.getId());
  return f;
}
// hanya berkas di folder PT itu (atau folder lama untuk PT pertama) yang boleh dibaca
function file_(id, pt) {
  if (!id || !/^[\w-]{10,}$/.test(id)) throw new Error('ID foto tidak valid');
  const f = DriveApp.getFileById(id), ok = {};
  ok[folder_(pt).getId()] = 1;
  if (pt === FIRST_PT) ok[root_().getId()] = 1;
  const ps = f.getParents();
  while (ps.hasNext()) if (ok[ps.next().getId()]) return f;
  throw new Error('Foto tidak ditemukan');
}

// memeriksa token login Firebase, lalu memastikan akunnya Admin atau anggota terdaftar
function verify_(token, pt) {
  const cfg = PTS[pt];
  if (!token) throw new Error('Belum login');
  const cache = CacheService.getScriptCache();
  const ck = 'v' + pt + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  if (cache.get(ck)) return cache.get(ck);
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + cfg.apiKey, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Token login tidak valid');
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u || !u.email) throw new Error('Token login tidak valid');
  const email = u.email.toLowerCase();
  const base = 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/(default)/documents/';
  const H = { Authorization: 'Bearer ' + token };
  let ok = false;
  const rr = UrlFetchApp.fetch(base + 'config/roles', { headers: H, muteHttpExceptions: true });
  if (rr.getResponseCode() === 200) {
    const vals = ((((JSON.parse(rr.getContentText()).fields || {}).admins || {}).arrayValue || {}).values) || [];
    ok = vals.some(function (v) { return String(v.stringValue || '').toLowerCase() === email; });
  }
  if (!ok) { const mr = UrlFetchApp.fetch(base + 'members/' + encodeURIComponent(email), { headers: H, muteHttpExceptions: true }); ok = mr.getResponseCode() === 200; }
  if (!ok) throw new Error('Akun bukan anggota Petaku');
  cache.put(ck, email, 300);
  return email;
}
