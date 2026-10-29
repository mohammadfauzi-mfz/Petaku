package id.bpn.petaku;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Plugin native Petaku:
 *  - getPending(): berkas yang dibuka dari aplikasi lain (WhatsApp, pengelola berkas) -> base64
 *  - installApk(url, token): unduh APK dari GitHub Release lalu buka pemasang Android
 */
@CapacitorPlugin(name = "Petaku")
public class PetakuPlugin extends Plugin {
    static PetakuPlugin instance;
    static JSObject pending;
    static final int MAX_BYTES = 30 * 1024 * 1024;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r;
        synchronized (PetakuPlugin.class) {
            r = pending != null ? pending : new JSObject();
            pending = null;
        }
        call.resolve(r);
    }

    @SuppressWarnings("deprecation")
    public static void handleIntent(final Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;
        intent.setAction(Intent.ACTION_MAIN); // jangan diproses ulang saat activity dibuat ulang
        final Uri u = uri;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String name = null;
                    Cursor c = null;
                    try {
                        c = ctx.getContentResolver().query(u, null, null, null, null);
                        if (c != null && c.moveToFirst()) {
                            int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (i >= 0) name = c.getString(i);
                        }
                    } catch (Exception ignore) {
                    } finally {
                        if (c != null) c.close();
                    }
                    if (name == null) name = u.getLastPathSegment();
                    if (name == null) name = "berkas";
                    InputStream in = ctx.getContentResolver().openInputStream(u);
                    if (in == null) return;
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    int total = 0;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BYTES) {
                            in.close();
                            return;
                        }
                        bo.write(buf, 0, n);
                    }
                    in.close();
                    JSObject o = new JSObject();
                    o.put("id", System.currentTimeMillis() + "-" + name);
                    o.put("name", name);
                    o.put("data", Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                    synchronized (PetakuPlugin.class) {
                        pending = o;
                    }
                    if (instance != null) instance.notifyListeners("fileOpened", o);
                } catch (Exception e) {
                    // abaikan: berkas tidak terbaca
                }
            }
        }).start();
    }

    @PluginMethod
    public void installApk(final PluginCall call) {
        final String url = call.getString("url");
        final String token = call.getString("token");
        if (url == null || url.length() == 0) {
            call.reject("URL APK kosong");
            return;
        }
        final Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(s);
            call.reject("izin pemasangan belum diaktifkan", "NEED_PERMISSION");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File dir = new File(ctx.getCacheDir(), "update");
                    dir.mkdirs();
                    File f = new File(dir, "Petaku.apk");
                    String cur = url;
                    HttpURLConnection c = null;
                    int code = 0;
                    for (int i = 0; i < 6; i++) {
                        URL u = new URL(cur);
                        c = (HttpURLConnection) u.openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(30000);
                        c.setRequestProperty("Accept", "application/octet-stream");
                        c.setRequestProperty("User-Agent", "Petaku");
                        if (token != null && token.length() > 0 && "api.github.com".equals(u.getHost())) {
                            c.setRequestProperty("Authorization", "Bearer " + token);
                        }
                        code = c.getResponseCode();
                        if (code >= 300 && code < 400) {
                            String loc = c.getHeaderField("Location");
                            c.disconnect();
                            if (loc == null) throw new IOException("redirect tanpa lokasi");
                            cur = loc;
                            continue;
                        }
                        break;
                    }
                    if (c == null || code != 200) throw new IOException("Unduhan gagal (HTTP " + code + ")");
                    long total = c.getContentLength();
                    InputStream in = c.getInputStream();
                    OutputStream out = new FileOutputStream(f);
                    byte[] buf = new byte[32768];
                    int n;
                    long done = 0;
                    int lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject p = new JSObject();
                                p.put("pct", pct);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                    out.close();
                    in.close();
                    c.disconnect();
                    Uri apk = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(apk, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "Gagal mengunduh pembaruan" : e.getMessage());
                }
            }
        }).start();
    }
}
