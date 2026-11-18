# Catatan per blok + foto di Google Drive — panduan Admin

Catatan disimpan di Firebase (teks, kecil). Foto disimpan di **Google Drive Anda**, lewat satu Apps Script. Lakukan sekali saja.

## 1. Tempel aturan Firestore yang baru
Firebase Console → **Firestore Database** → tab **Rules** → hapus isinya, tempel isi file `firestore.rules` (versi baru) → **Publish**.
Aturan baru menambah: koleksi `notes` (semua anggota membaca; hanya penulis atau Admin yang mengubah), dokumen `config/categories` dan `config/app` (anggota membaca, hanya Admin menulis).

## 2. Buat server foto (Apps Script)
1. Buka https://script.google.com (login dengan akun Google yang Drive-nya dipakai untuk foto) → **Proyek baru**.
2. Hapus isi `Code.gs`, tempel seluruh isi file `Code.gs` dari saya.
3. Ganti dua baris di atas:
   - `API_KEY` = nilai `apiKey` di `fbconfig.js`
   - `PROJECT_ID` = nilai `projectId` di `fbconfig.js`
4. Klik **Deploy → Deployment baru → ikon roda gigi → Aplikasi web**.
   - **Jalankan sebagai: Saya**
   - **Yang memiliki akses: Siapa saja**
   - Klik **Deploy**, lalu **Beri akses**. Jika muncul peringatan "Google belum memverifikasi aplikasi ini": **Lanjutan → Buka … (tidak aman) → Izinkan**. Ini normal untuk script buatan sendiri.
5. Salin **URL aplikasi web** (berakhiran `/exec`).

Foto akan masuk ke folder **Petaku Foto** di Drive Anda (dibuat otomatis). Foto tidak dibuat publik; hanya bisa diambil lewat script dengan login anggota Petaku.

Bila nanti Anda mengubah kode script: **Deploy → Kelola deployment → ✏ → Versi: Versi baru → Deploy** (URL tetap sama).

## 3. Isi alamat di aplikasi (HP Admin)
Pengaturan (⚙) → kartu **Catatan & foto** → tempel URL di **Server foto** → **Simpan alamat**. Pengguna menerimanya otomatis saat sinkron/tarik data.
Tombol **Kelola kategori** untuk menambah/mengubah kategori dan sub kategori (berlaku untuk semua pengguna).

## 4. Pakai
Ketuk blok di peta → tab **Catatan** → **+ Catatan** → pilih kategori/sub kategori, tulis catatan, ambil foto/galeri (otomatis dikompres ke ±100–150 KB) → Simpan. Catatan tetap tersimpan tanpa sinyal dan terkirim saat online. Blok yang punya catatan diberi titik di peta (oranye = ada yang terbuka, hijau = selesai semua).

## Fitur lain
- **Volume & progres:** isi Volume + satuan (mis. 100 m). Tombol **Progres** memperbarui realisasi, bar progres berubah, dan status otomatis Selesai saat 100%.
- **Koordinat:** catatan yang dibuat dengan **Ambil foto** otomatis menyimpan koordinat HP; titiknya muncul di peta sesuai koordinat itu. Ketuk titik di peta untuk melihat **jarak dan arah** dari posisi Anda (panah mengikuti kompas HP bila tersedia).
- **Sinkron catatan** ada di tab **Data** (kartu "Catatan blok"). **Pilih area** untuk mengunduh/menampilkan catatan Estate/Afdeling tertentu saja.
- **Tes server foto** di Pengaturan → Catatan & foto: memastikan HP bisa menghubungi Apps Script. Bila gagal, pesannya menyebut penyebabnya.

## Tips
- Nama penulis diambil dari nama akun. Agar nama Admin tampil (bukan potongan email), tambahkan email Admin sendiri lewat **Kelola akun → Tambah** dengan nama lengkap (akun yang sudah ada tidak diubah passwordnya).
- **Arsip foto:** foto di Drive tidak pernah dihapus oleh aplikasi, walau catatannya dihapus atau fotonya dibuang dari catatan. Nama berkas: `<kode>_<Blok>_<Kategori>_<SubKategori>.jpg` (contoh `nmwm4olekji53a_H32_Infrastruktur_Titipanen.jpg`).
- Kuota Drive terpakai di akun pemilik script. Foto 150 KB ≈ 6.500 foto per 1 GB.
