# Peta SBI

Aplikasi Android untuk mewarnai peta blok dari file CSV (offline).

## Cara build APK (tanpa Android Studio)
1. Buat repository baru di GitHub, lalu upload **seluruh isi folder ini** (termasuk folder `.github`, `www`, `keystore`).
2. Buka tab **Actions** > **Build APK** > **Run workflow** (otomatis jalan juga setiap push).
3. Setelah selesai, unduh `PetaSBI-apk` dari bagian *Artifacts*, ekstrak, lalu install `PetaSBI.apk` di HP.
4. Keystore di folder `keystore/` dipakai tetap, jadi versi baru bisa langsung menimpa versi lama tanpa uninstall.
   Untuk rilis bernomor: buat tag `v1.0.1` dan APK muncul di halaman *Releases*.

## Cara pakai singkat
- **Data**: impor CSV (pemisah `;` `,` atau tab terdeteksi otomatis), pilih kolom kunci blok.
- **Tema**: tiap jenis peta = kolom data + kelas warna (rentang angka atau kategori) + aturan khusus (arsiran) + judul + label.
  Salin tema untuk membuat jenis peta baru. Tema bisa diekspor/diimpor sebagai file JSON.
- **Layer**: tambah layer dari HP (GeoJSON, KML, CSV titik), atur warna/garis/label, urutan, dan legenda.
- **Ekspor**: PDF/PNG dengan judul, legenda, skala, panah utara, indeks peta, lalu bagikan ke WhatsApp.

Folder `tools/` hanya skrip persiapan data (tidak ikut aplikasi).
