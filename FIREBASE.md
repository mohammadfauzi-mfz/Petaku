# Sinkron lewat Firebase (Petaku)

Kosongkan `www/js/fbconfig.js` = pakai GitHub seperti biasa. Isi `apiKey` dan `projectId` = aplikasi memakai Firebase.

## 1. Buat project
1. https://console.firebase.google.com → **Add project** (Analytics boleh dimatikan).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** (lokasi terdekat, mis. `asia-southeast2`, mode *production*).
4. **Project settings (ikon roda) → General → Your apps → ikon Web `</>`** → daftarkan app (nama bebas, tanpa Hosting). Salin `apiKey` dan `projectId`.
5. Edit `www/js/fbconfig.js` di repo GitHub: isi `apiKey` dan `projectId`, lalu commit → build otomatis.

## 2. Aturan akses (Firestore → Rules → ganti semuanya → Publish)
Tempel isi berkas `firestore.rules`.

## 3. Tentukan Admin
Firestore → **Start collection** → ID koleksi `config` → ID dokumen `roles` → tambah field:
- `admins` bertipe **array**, isi string email Admin (huruf kecil), mis. `mohammad.fauzi@dsngroup.co.id`.

## 4. Buat akun pengguna (dari aplikasi)
Masuk sebagai Admin → Pengaturan (⚙) → **Kelola akun** → isi email, nama, password awal → **Tambah pengguna**. Akun login dibuat otomatis dan didaftarkan sebagai anggota. Fitur ini membutuhkan **Authentication → Settings → User actions → Enable create (sign-up)** dalam keadaan aktif (bawaan Firebase).
Orang yang membuat akun sendiri di luar daftar ini tidak bisa membaca data, karena aturan akses hanya mengizinkan Admin dan anggota terdaftar.
Cabut akses: tombol **Cabut** di Kelola akun. Lupa password: tombol **Reset password** (email dikirim oleh Firebase).

## 5. Pakai
- Admin: masuk dengan email Admin → Pengaturan (⚙) → **Kirim data saya**.
- Pengguna: data terbaru otomatis diunduh saat aplikasi dibuka (ada internet), atau Pengaturan → **Tarik data terbaru**.
- Data unduhan menggantikan unduhan lama dan tidak tampil di tab Data (kecuali untuk Admin). CSV yang diimpor pengguna sendiri tidak tersentuh.
