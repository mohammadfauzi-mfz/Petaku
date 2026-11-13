# Sinkron lewat Firebase (Petaku)

Kosongkan `www/js/fbconfig.js` = pakai GitHub seperti biasa. Isi `apiKey` dan `projectId` = aplikasi memakai Firebase.

## 1. Buat project
1. https://console.firebase.google.com → **Add project** (Analytics boleh dimatikan).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** (lokasi terdekat, mis. `asia-southeast2`, mode *production*).
4. **Project settings (ikon roda) → General → Your apps → ikon Web `</>`** → daftarkan app (nama bebas, tanpa Hosting). Salin `apiKey` dan `projectId`.
5. Edit `www/js/fbconfig.js` di repo GitHub: isi `apiKey` dan `projectId`, lalu commit → build otomatis.

## 2. Aturan akses (Firestore → Rules → ganti semuanya → Publish)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() {
      return signedIn() && request.auth.token.email in
        get(/databases/$(database)/documents/config/roles).data.admins;
    }
    match /sync/{doc} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
    match /config/roles {
      allow read: if signedIn();
      allow write: if false;
    }
  }
}
```

## 3. Tentukan Admin
Firestore → **Start collection** → ID koleksi `config` → ID dokumen `roles` → tambah field:
- `admins` bertipe **array**, isi string email Admin (huruf kecil), mis. `mohammad.fauzi@dsngroup.co.id`.

## 4. Buat akun pengguna
**Authentication → Users → Add user** (email + password). Tidak ada pendaftaran bebas: hanya akun yang Anda buat yang bisa masuk. Nonaktifkan / hapus akun di sini untuk mencabut akses.

## 5. Pakai
- Admin: masuk dengan email Admin → Pengaturan (⚙) → **Kirim data saya**.
- Pengguna: data terbaru otomatis diunduh saat aplikasi dibuka (ada internet), atau Pengaturan → **Tarik data terbaru**.
- Data unduhan menggantikan unduhan lama dan tidak tampil di tab Data (kecuali untuk Admin). CSV yang diimpor pengguna sendiri tidak tersentuh.
