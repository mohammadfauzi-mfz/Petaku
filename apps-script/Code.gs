// ===== Petaku – server foto catatan (Google Apps Script) =====
// Foto disimpan di folder Google Drive milik akun yang men-deploy script ini.
// Setiap permintaan wajib membawa token login Firebase; hanya Admin/anggota Petaku yang dilayani.

// ISI 2 BARIS INI (sama dengan fbconfig.js di aplikasi):
const API_KEY = 'ISI_API_KEY_FIREBASE';
const PROJECT_ID = 'ISI_PROJECT_ID_FIREBASE';

const FOLDER_NAME = 'Petaku Foto';
const MAX_B64 = 400000; // batas ukuran foto (karakter base64) ~ 300 KB

function doGet() { return out_({ ok: true, msg: 'Server foto Petaku aktif' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    verify_(req.token);
    if (req.a === 'ping') return out_({ ok: true });
    if (req.a === 'put') {
      const mime = /^image\/(jpeg|png|webp)$/.test(req.mime || '') ? req.mime : 'image/jpeg';
      if (!req.data || req.data.length > MAX_B64) throw new Error('Foto kosong atau terlalu besar');
      const blob = Utilities.newBlob(Utilities.base64Decode(req.data), mime, String(req.name || 'foto.jpg').replace(/[^\w.\-]/g, '_').slice(0, 120));
      const file = folder_().createFile(blob);
      return out_({ ok: true, id: file.getId() });
    }
    if (req.a === 'get') {
      const f = file_(req.id);
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

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* dibuat ulang */ } }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FID', f.getId());
  return f;
}
// hanya berkas di dalam folder Petaku Foto yang boleh dibaca/dihapus (bukan berkas Drive lain)
function file_(id) {
  if (!id || !/^[\w-]{10,}$/.test(id)) throw new Error('ID foto tidak valid');
  const f = DriveApp.getFileById(id), fid = folder_().getId(), ps = f.getParents();
  while (ps.hasNext()) if (ps.next().getId() === fid) return f;
  throw new Error('Foto tidak ditemukan');
}

// memeriksa token login Firebase, lalu memastikan akunnya Admin atau anggota terdaftar
function verify_(token) {
  if (!token) throw new Error('Belum login');
  const cache = CacheService.getScriptCache();
  const ck = 'v' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  if (cache.get(ck)) return cache.get(ck);
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Token login tidak valid');
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u || !u.email) throw new Error('Token login tidak valid');
  const email = u.email.toLowerCase();
  const base = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/';
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
