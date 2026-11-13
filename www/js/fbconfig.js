// Konfigurasi Firebase. Isi dua nilai ini dari Firebase Console -> Project settings -> General -> Your apps (Web app).
// Nilai ini BUKAN rahasia (keamanan dijaga oleh Authentication + aturan Firestore). Kosongkan untuk memakai sinkron GitHub.
export const FB = {
  apiKey: '',        // mis. 'AIzaSy...'
  projectId: '',     // mis. 'petaku-bpn'
  collection: 'sync',
};
