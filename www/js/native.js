// Jembatan ke plugin native Android (Capacitor). Di browser semuanya null.
export const plugins = () => {
  const c = window.Capacitor;
  return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins ? c.Plugins : null;
};
export const petaku = () => { const p = plugins(); return p && p.Petaku ? p.Petaku : null; };
