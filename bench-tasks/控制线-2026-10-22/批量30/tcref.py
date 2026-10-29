# 转头检视 with the new references (bowen 1792668704): each picked candidate placed in the canvas by its own fit
# (canvas = s·image + t) -> ref {src, x, y, w, h} (centre and size in canvas units); the outline keys unchanged
import json, base64, subprocess
src=open('compose.py').read()
exec(src.split("def rd(f):")[0].replace("sel = json.loads(sys.argv[1]); out = sys.argv[2]",""))
TC='/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'
all_=json.load(open(TC)); base=all_['variants']['近2远3 · 对称 · 45° 近侧耳点按旋转（对照）']
def size(f):
    o=subprocess.run(['sips','-g','pixelWidth','-g','pixelHeight',f],capture_output=True,text=True).stdout.split()
    return int(o[o.index('pixelWidth:')+1]), int(o[o.index('pixelHeight:')+1])
def ref(yaw,k):
    f='yaw%02d-%02d.png'%(yaw,k); W,H=size(f); s,tx,ty=fit(yaw,k)
    return {'src':'data:image/png;base64,'+base64.b64encode(open(f,'rb').read()).decode(),'x':tx+s*W/2,'y':ty+s*H/2,'w':s*W,'h':s*H}
def variant(pick):
    out=[]
    for key in base:
        k=dict(key); y=key['yaw']
        if pick.get(y) is not None: k['ref']=ref(y,pick[y])
        out.append(k)
    return out
V1='近2远3 · 新参考（0°-09 / 45°-11 鼓腮版 / 90°-11）'; V2='近2远3 · 新参考（0°-09 / 45° 原版 / 90°-11）'
vs={V1:variant({0:9,45:11,90:11}),V2:variant({0:9,45:None,90:11})}
rest={k:v for k,v in all_['variants'].items() if k not in vs}
all_['variants']={**vs,**rest}; all_['mirror']={**all_.get('mirror',{}),V1:True,V2:True}
json.dump(all_,open(TC,'w')); print('ok', len(json.dumps(all_))//1000000,'MB')
