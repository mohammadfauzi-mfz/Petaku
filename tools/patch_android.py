"""Dijalankan oleh GitHub Actions setelah `npx cap add android`:
 - menambah intent-filter (buka CSV/GeoJSON/KML dari WhatsApp & pengelola berkas)
 - izin pasang APK untuk fitur pembaruan
 - memasang plugin native Petaku + MainActivity
 - memastikan FileProvider bisa membaca folder cache."""
import json, os, re, sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'
cfg = json.load(open(os.path.join(root, 'capacitor.config.json')))
pkg = cfg['appId']
base = os.path.join(root, 'android', 'app', 'src', 'main')

mf = os.path.join(base, 'AndroidManifest.xml')
x = open(mf, encoding='utf-8').read()
MIMES = ['text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'application/csv', 'text/plain',
         'application/vnd.ms-excel', 'application/octet-stream', 'application/json', 'application/geo+json',
         'application/vnd.google-earth.kml+xml']
mime_xml = '\n'.join(f'                <data android:mimeType="{m}" />' for m in MIMES)
filters = f'''
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
{mime_xml}
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
{mime_xml}
            </intent-filter>
'''
if 'android.intent.action.SEND' not in x:
    i = x.index('</activity>')
    x = x[:i] + filters + '        ' + x[i:]
if 'ACCESS_FINE_LOCATION' not in x:
    x = x.replace('</manifest>', '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>')
if 'REQUEST_INSTALL_PACKAGES' not in x:
    x = x.replace('</manifest>', '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n</manifest>')
open(mf, 'w', encoding='utf-8').write(x)

jdir = os.path.join(base, 'java', *pkg.split('.'))
os.makedirs(jdir, exist_ok=True)
for f in ('MainActivity.java', 'PetakuPlugin.java'):
    src = open(os.path.join(root, 'android-patch', f), encoding='utf-8').read()
    src = re.sub(r'^package\s+[\w.]+;', f'package {pkg};', src, count=1, flags=re.M)
    open(os.path.join(jdir, f), 'w', encoding='utf-8').write(src)

xmldir = os.path.join(base, 'res', 'xml')
os.makedirs(xmldir, exist_ok=True)
open(os.path.join(xmldir, 'file_paths.xml'), 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
    <files-path name="my_files" path="." />
</paths>
''')
print('patch OK untuk', pkg)

# ---- ikon aplikasi (peta) ----
import shutil
icons = os.path.join(root, 'android-patch', 'icons')
res = os.path.join(base, 'res')
if os.path.isdir(icons):
    for d in os.listdir(icons):
        src = os.path.join(icons, d)
        if os.path.isdir(src) and d.startswith('mipmap-'):
            dst = os.path.join(res, d); os.makedirs(dst, exist_ok=True)
            for f in os.listdir(src):
                shutil.copy(os.path.join(src, f), os.path.join(dst, f))
    vdir = os.path.join(res, 'values'); os.makedirs(vdir, exist_ok=True)
    open(os.path.join(vdir, 'ic_launcher_background.xml'), 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B5D3B</color>\n</resources>\n')
    # pastikan ikon adaptif memakai foreground PNG yang baru
    any26 = os.path.join(res, 'mipmap-anydpi-v26')
    os.makedirs(any26, exist_ok=True)
    adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
    for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        open(os.path.join(any26, n), 'w').write(adaptive)
    # hapus foreground vektor bawaan Capacitor bila ada
    for d in ('drawable-v24', 'drawable'):
        p = os.path.join(res, d, 'ic_launcher_foreground.xml')
        if os.path.exists(p): os.remove(p)
    print('ikon peta terpasang')

# ---- penandatanganan tetap + versionCode naik tiap build ----
gr = os.path.join(root, 'android', 'app', 'build.gradle')
if os.path.exists(gr):
    g = open(gr, encoding='utf-8').read()
    run = os.environ.get('RUN_NUMBER', '1')
    g = re.sub(r'versionCode\s+\d+', f'versionCode {run}', g, count=1)
    g = re.sub(r'versionName\s+"[^"]*"', f'versionName "1.0.{run}"', g, count=1)
    ks = os.path.abspath(os.path.join(root, 'keystore', 'debug.keystore')).replace('\\', '/')
    block = f'''    signingConfigs {{
        debug {{
            storeFile file("{ks}")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }}
    }}
'''
    if 'keystore/debug.keystore' not in g:
        g = re.sub(r'(\n\s*buildTypes\s*\{)', '\n' + block + r'\1', g, count=1)
    open(gr, 'w', encoding='utf-8').write(g)
    print('build.gradle: versionCode', run, '+ keystore tetap')
