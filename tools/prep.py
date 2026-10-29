import json,math,os,collections
import numpy as np, cv2
A='/mnt/user-data/attachments/16ebdb73-0b77-5bf0-b907-f17bdb15ce4d/'
OUT='/home/claude/petasbi/www/data/'; os.makedirs(OUT,exist_ok=True)
def rnd(c,n=6):
    if isinstance(c[0],(int,float)): return [round(c[0],n),round(c[1],n)]
    return [rnd(x,n) for x in c]
def dump(name,feats,keepprops=None):
    out={'type':'FeatureCollection','features':[]}
    for f in feats:
        p=f['properties']
        if keepprops is not None: p={k:p.get(k) for k in keepprops}
        out['features'].append({'type':'Feature','properties':p,'geometry':{'type':f['geometry']['type'],'coordinates':rnd(f['geometry']['coordinates'])}})
    s=json.dumps(out,ensure_ascii=False,separators=(',',':'))
    open(OUT+name,'w').write(s); print(name,len(out['features']),round(len(s)/1e6,2),'MB')
peta=json.load(open(A+'54666efb-peta.geojson'))
dump('blok.geojson',peta['features'],['Estate','Afdeling','Blok'])
rend=json.load(open(A+'f0ec3d32-Areal_Rendahan.geojson'))
dump('rendahan.geojson',rend['features'],['Estate','Afdeling','Blok','Ktgri_08Me'])
sg=json.load(open(A+'1e1df7a1-sungai.geojson'))
dump('sungai.geojson',sg['features'],['Kelas','Keterangan'])
# batas estate / afdeling via raster
allpts=[]
def rings(geom):
    for poly in geom['coordinates']:
        for i,r in enumerate(poly): yield i,r
lon0=min(p[0] for f in peta['features'] for _,r in rings(f['geometry']) for p in r)
lon1=max(p[0] for f in peta['features'] for _,r in rings(f['geometry']) for p in r)
lat0=min(p[1] for f in peta['features'] for _,r in rings(f['geometry']) for p in r)
lat1=max(p[1] for f in peta['features'] for _,r in rings(f['geometry']) for p in r)
latm=(lat0+lat1)/2; kx=111320*math.cos(math.radians(latm)); ky=110574
PX=3.0
W=int((lon1-lon0)*kx/PX)+40; H=int((lat1-lat0)*ky/PX)+40
print('raster',W,H)
def topx(p): return [int((p[0]-lon0)*kx/PX)+20, int((lat1-p[1])*ky/PX)+20]
def frompx(x,y): return [lon0+(x-20)*PX/kx, lat1-(y-20)*ky_inv*PX] 
ky_inv=1/ky
def build(field,fname,kind,close=7):
    groups=collections.defaultdict(list)
    for f in peta['features']: groups[f['properties'][field]].append(f)
    feats=[]
    for name,fs in sorted(groups.items()):
        m=np.zeros((H,W),np.uint8)
        for f in fs:
            for poly in f['geometry']['coordinates']:
                outer=np.array([topx(p) for p in poly[0]],np.int32)
                cv2.fillPoly(m,[outer],255)
                for h in poly[1:]:
                    cv2.fillPoly(m,[np.array([topx(p) for p in h],np.int32)],0)
        k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(close,close))
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,k)
        cs,hier=cv2.findContours(m,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)
        lines=[]
        for c in cs:
            if cv2.contourArea(c)<150: continue
            c=cv2.approxPolyDP(c,1.0,True)[:,0,:]
            pts=[frompx(x,y) for x,y in c]; pts.append(pts[0]); lines.append(pts)
        feats.append({'type':'Feature','properties':{field:name},'geometry':{'type':'MultiLineString','coordinates':lines}})
    dump(fname,feats)
build('Estate','batas_estate.geojson','e')
build('Afdeling','batas_afdeling.geojson','a')

# titik label estate/afdeling per komponen terhubung
def labels(field,fname):
    groups=collections.defaultdict(list)
    for f in peta['features']: groups[f['properties'][field]].append(f)
    feats=[]
    for name,fs in sorted(groups.items()):
        m=np.zeros((H,W),np.uint8)
        for f in fs:
            for poly in f['geometry']['coordinates']:
                cv2.fillPoly(m,[np.array([topx(p) for p in poly[0]],np.int32)],255)
        k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,k)
        n,lab,stats,_=cv2.connectedComponentsWithStats(m,8)
        for i in range(1,n):
            if stats[i,cv2.CC_STAT_AREA]<2500: continue
            cm=(lab==i).astype(np.uint8)
            dt=cv2.distanceTransform(cm,cv2.DIST_L2,5)
            y,x=np.unravel_index(np.argmax(dt),dt.shape)
            if field=='Estate':
                ys,xs=np.nonzero(cm); cy=int(ys.mean())
                rowx=np.nonzero(cm[cy])[0]
                if len(rowx): x=int(rowx.max())+22; y=cy
            feats.append({'type':'Feature','properties':{'Nama':name},'geometry':{'type':'Point','coordinates':frompx(x,y)}})
    dump(fname,feats)
labels('Estate','label_estate.geojson')
labels('Afdeling','label_afdeling.geojson')
