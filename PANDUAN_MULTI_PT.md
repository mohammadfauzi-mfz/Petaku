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

## B. Mendaftarkan PT di aplikasi
Edit di GitHub: `www/js/fbconfig.js`, isi `apiKey` dan `projectId` pada baris PT tersebut, lalu Commit. Build otomatis jalan, rilis baru muncul. Menambah PT baru = tambah satu baris `{ id:'XXX', nama:'PT. XXX', apiKey:'...', projectId:'...' }`.
Catatan: PT pertama (BPN) jangan dipindah urutannya (data lama di HP tetap milik BPN).

## C. Apps Script foto (satu untuk semua PT)
1. Buka Apps Script yang sudah ada -> ganti seluruh isi dengan file `Code.gs` terbaru.
2. Isi baris `BAS` dan `DIL` pada daftar `PTS` (apiKey + projectId, sama dengan fbconfig.js). Baris BPN sudah terisi.
3. **Deploy -> Kelola deployment -> ikon pensil -> Versi: Versi baru -> Deploy**. (URL tetap sama.)
4. URL web-app dimasukkan admin tiap PT di Pengaturan -> Catatan & foto (sekali per PT, tersinkron ke anggota).

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
