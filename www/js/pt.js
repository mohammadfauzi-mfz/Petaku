// Daftar PT dan PT aktif. Tiap PT punya Firebase sendiri dan database lokal sendiri di HP.
import { PTS } from './fbconfig.js';
const KEY = 'petaku-pt';
export const ptList = () => PTS;
export const ptReady = (p) => !!(p && p.apiKey && p.projectId);
// aplikasi memakai mode Firebase bila ada minimal satu PT yang sudah diisi
export const ptMode = () => PTS.some(ptReady);
export function activePT() {
  let id = '';
  try { id = localStorage.getItem(KEY) || ''; } catch (e) { /* abaikan */ }
  return PTS.find((p) => p.id === id) || PTS[0];
}
export function setPT(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* abaikan */ } }
// PT pertama memakai database lama ('petasbi') supaya data yang sudah ada di HP otomatis menjadi data PT tersebut
export function dbName() { const p = activePT(); return p.id === PTS[0].id ? 'petasbi' : 'petasbi-' + p.id; }
export const FB = {
  get apiKey() { return activePT().apiKey || ''; },
  get projectId() { return activePT().projectId || ''; },
  collection: 'sync',
};
