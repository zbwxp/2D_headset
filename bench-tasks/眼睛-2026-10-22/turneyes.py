# 转头检视 eyes (bowen 1792682066): an eye = the 0° eye (bowen's two 0° eyes, control points mirror-averaged, as the near
# eye x < 0) moved along its track (its centre A at depth z turning about the axis: x = A.x·cos ψ + z·sin ψ, height kept) and
# shaped by the bench sphere frame (yaw φ, radius r). Table per eye: head yaw → (φ, ψ), from bowen's tuned 45 / 90 (fits at
# r 40, sphere2.py) and his 95° for the far eye at 90 (provisional); linear in between.
import json, math
d=json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/眼睛-2026-10-22/bowen-2153.json'))
def ctrl(view, eye, mirror=False):
    v=d[view]; pts=v['pts']; out=[]
    for l in sorted(v['lines'], key=lambda l: l['id']):
        if not l['id'].startswith(f'ley-{eye}-'): continue
        a=pts[l['a']]; b=pts[l['b']]; c=[a,[a[0]+l['ha'][0],a[1]+l['ha'][1]],[b[0]+l['hb'][0],b[1]+l['hb'][1]],b]
        if mirror: c=[[-p[0],p[1]] for p in c]
        out.append(c)
    return out
R0=ctrl('0','R'); L0=ctrl('0','L',True)
base=[[[ (R0[i][j][0]+L0[i][j][0])/2, (R0[i][j][1]+L0[i][j][1])/2 ] for j in range(4)] for i in range(3)]
def bz(c,t): u=1-t; return [u*u*u*c[0][i]+3*u*u*t*c[1][i]+3*u*t*t*c[2][i]+t*t*t*c[3][i] for i in (0,1)]
S=[bz(c,i/30) for c in base for i in range(31)]
A=((min(p[0] for p in S)+max(p[0] for p in S))/2,(min(p[1] for p in S)+max(p[1] for p in S))/2)
fit=json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/眼睛-2026-10-22/sphere-fit.json'))
# anchors at r 40 (re-fit to read the offsets)
import subprocess
r=40
def anchor_of(v):  # centre of the fitted sphere-frame curve minus the shape's own shift: refit quickly
    import importlib.util
    return None
# from sphere2.py r 40 run: anchors 45: 24.09, 90: 65.34, −45 (far mirrored): −64.62; φ 16.0 / 46.0 / 63.8
z=65.34; ax=A[0]
def psi(x, x0):  # x0·cos ψ + z·sin ψ = x
    amp=math.hypot(x0,z); ph=math.atan2(x0,z); return math.degrees(math.asin(x/amp)-ph)
near45=psi(24.09, ax); far45=psi(64.62, -ax)
eyes={'base':base,'anchor':A,'z':z,'r':r,'near':[[0,0,0],[45,16.0,round(near45,2)],[90,46.0,90]],'far':[[0,0,0],[45,63.8,round(far45,2)],[90,95.0,90]]}
print(json.dumps({k:eyes[k] for k in ('anchor','z','r','near','far')}))
T='/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'
all=json.load(open(T)); all['eyes']=eyes; json.dump(all,open(T,'w'),ensure_ascii=False)
