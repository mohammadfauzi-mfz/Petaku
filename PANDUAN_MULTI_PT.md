# Panduan Multi-PT Petaku

Satu aplikasi (APK) untuk beberapa PT. Tiap PT punya **proyek Firebase sendiri** (data, login, catatan terpisah).
Foto semua PT memakai **satu Apps Script**, disimpan di Google Drive: `Petaku Foto/<PT>/`.

## A. Membuat Firebase untuk PT baru (ulangi untuk BAS, DIL, dst.)
1. https://console.firebase.google.com -> **Add project** (mis. `petaku-bas`). Google Analytics boleh dimatikan.
2. **Build -> Authentication -> Get started -> Sign-in method -> Email/Password -> Enable**.
3. **Build -> Firestore Database -> Create database** (mode production, lokasi `asia-southeast2` Jakarta).
4. Tab **Rules** -> hapus isi -> tempel isi file `firestore.rules` (sama untuk semua PT) -> **Publish**.
5. **Authentication -> Users -> Add user**: buat akun admin PT (email + password).
6. **Firestore -> Start collection** `config` -> Document ID `roles` -> field `admins` (tipe **array**) -> isi item string: email admin tadi.
7. **Project settings (ikon roda) -> General -> Your apps -> Web (</>)** -> daftarkan app -> salin `apiKey` dan `projectId`.

## B. Mendaftarkan PT di aplikasi (tanpa APK baru)
Edit file `pt-list.json` di root repo GitHub (ikon pensil -> Commit). Contoh:
```
{ "pts": [
  { "id": "BAS", "nama": "PT. BAS", "apiKey": "AIza...", "projectId": "petaku-bas" },
  { "id": "DIL", "nama": "PT. DIL", "apiKey": "", "projectId": "" }
] }
```
- `id` 2-8 huruf/angka (dipakai untuk nama folder foto dan database lokal). `apiKey` dan `projectId` kosong = tampil "belum disiapkan".
- Aplikasi membaca daftar ini saat dibuka (butuh internet, hasilnya disimpan di HP) dan lewat tombol Pengaturan -> PT aktif -> **Perbarui daftar PT**.
- Mengubah file ini **tidak memicu build**. Yang berhak mengubah = pemilik/kolaborator repo.
- BPN tetap bawaan APK (jangan dihapus dari `fbconfig.js`).

## C. Apps Script foto (satu untuk semua PT)
1. Tempel `Code.gs` terbaru (isi apiKey/projectId BPN sudah ada) -> **Deploy -> Kelola deployment -> Versi baru**.
2. PT lain **otomatis** dibaca script dari `pt-list.json` (cache 10 menit). Tidak perlu edit script lagi untuk PT baru.
3. URL web-app dimasukkan admin tiap PT di Pengaturan -> Catatan & foto (sekali per PT).

## C2. Peran
- **Admin**: email di `config/roles` (diatur manual di Firebase). Kelola akun, kategori, URL foto, kirim data.
- **Superuser (PIC)**: PIC tiap PT. Dibuat Admin di Pengaturan -> Kelola akun (pilih "Superuser / PIC" saat tambah pengguna, atau tombol **Jadi PIC** pada pengguna yang ada). PIC boleh **mengirim data CSV, tema, dan layer**, tetapi tidak bisa mengelola akun/kategori.
- **User**: hanya membaca. 
- Setelah rules baru dipasang (file `firestore.rules`), PIC bisa kirim data. Dokumen `members/<email>` memuat field `role`.

## D. Memakai di aplikasi
- Pilihan PT muncul di layar login dan di Pengaturan -> **Ganti PT** (untuk staf lintas PT; login tiap PT tersimpan).
- Peta BPN bawaan hanya tampil bila PT = BPN.
- Anggota: Admin PT menambahkan email di Firestore `members/<email>` (seperti BPN).

## E. Layer awal PT baru (paket layer .zip)
1. Satu orang mengimpor peta di menu **Layer** (GeoJSON/SHP) di HP-nya.
2. Layer -> **Bagikan paket layer** -> kirim lewat WhatsApp.
3. Penerima cukup **ketuk file .zip di WhatsApp -> pilih Petaku**: terimpor langsung tanpa disimpan dulu.
   Atau Layer -> **Impor paket layer**.
- Paket hanya berisi peta/poligon dan gayanya. Tema dan CSV tetap lewat upload data admin.
- Mengimpor paket yang sama lagi = mengganti, tidak dobel.
