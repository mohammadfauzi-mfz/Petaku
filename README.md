# Petaku

Aplikasi Android untuk mewarnai peta blok dari file CSV (offline).

## Cara build APK (tanpa Android Studio)
1. Upload **seluruh isi folder ini** ke repo GitHub (`mohammadfauzi-mfz/Petaku`), termasuk `.github`, `www`, `keystore`, `android-patch`, `tools`.
2. Tab **Actions** > **Build APK** berjalan otomatis (atau *Run workflow*).
3. Setiap build membuat **Release** baru (`v1.0.<nomor>`) berisi `Petaku.apk`. Unduh APK dari halaman Releases lalu install.
4. Keystore di `keystore/` dipakai tetap, jadi APK baru langsung menimpa versi lama tanpa uninstall.

## Pembaruan dari dalam aplikasi
Pengaturan (ikon ⚙) > **Periksa pembaruan**: aplikasi membaca Release terbaru di GitHub, mengunduh `Petaku.apk`, lalu membuka pemasang Android.
Saat pertama kali Android meminta izin “Pasang aplikasi tidak dikenal” untuk Petaku — aktifkan, lalu tekan tombolnya lagi.
Repo privat: isi token GitHub di Pengaturan (hak baca Contents).

## Sinkron data antar pengguna
Pengaturan (⚙) > **Sinkron data (GitHub)**:
- **Kirim data saya**: mengunggah CSV, tema, layer tambahan (dan opsional pengaturan ekspor) ke folder `sync/` di repo. Butuh token GitHub (Fine-grained, repo ini, Contents = Read and write).
- **Tarik data terbaru**: pengguna lain mengunduh data itu. Repo publik cukup tanpa token.
- Pengiriman data tidak memicu build ulang (folder `sync/` diabaikan workflow).

## Buka CSV dari WhatsApp
Ketuk berkas CSV di WhatsApp > pilih **Petaku** (atau Bagikan > Petaku). Berkas GeoJSON/KML juga bisa dibuka sebagai layer.

## Cara pakai singkat
- **Data**: impor satu atau banyak CSV (pemisah `;` `,` atau tab otomatis).
- **Tema**: tiap jenis peta = sumber CSV + kolom data + kelas warna (rentang/kategori, opasitas) + aturan arsiran + judul + label.
- **Layer**: tambah layer dari HP (GeoJSON, KML, CSV titik), atur warna/garis/label/urutan.
- **Ekspor**: PDF/PNG lengkap dengan legenda, skala, panah utara, lalu bagikan.

Folder `tools/` berisi skrip persiapan data dan patch Android (tidak ikut aplikasi).
