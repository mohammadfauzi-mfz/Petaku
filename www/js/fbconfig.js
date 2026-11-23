// Daftar PT. Tiap PT punya proyek Firebase sendiri (Project settings -> General -> Your apps -> Web app).
// Nilai apiKey/projectId BUKAN rahasia (keamanan dijaga oleh Authentication + aturan Firestore).
// - PT pertama dalam daftar memakai data lokal yang sudah ada di HP (jangan diurutkan ulang).
// - petaBawaan: true = peta yang tertanam di APK (folder www/data) hanya tampil untuk PT ini.
// - PT yang apiKey/projectId-nya masih kosong tampil di daftar dengan tanda "belum disiapkan".
export const PTS = [
  { id: 'BPN', nama: 'PT. Bima Palma Nugraha', apiKey: 'AIzaSyAa4x2pDxVt7JktjCPmljsUtpjGm8Qv6zU', projectId: 'petaku-9ed39', petaBawaan: true },
  { id: 'BAS', nama: 'PT. BAS', apiKey: '', projectId: '' },
  { id: 'DIL', nama: 'PT. DIL', apiKey: '', projectId: '' },
];
