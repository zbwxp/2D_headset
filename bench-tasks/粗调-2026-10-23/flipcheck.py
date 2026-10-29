# far eye 55–75°: what actually shows — eye points right of the side profile (the side sheet hides the rest) and left of
# the far face edge (the part poking out is not drawn). Model as in 转头检视 (侧脸平片 variant): outline keyframes, the
# sheet at its angle, the far eye from a table (φ, ψ).
import json, math, sys
d=json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json')); E=d['eyes']
V0=[n for n in d['variants'] if n.startswith('侧脸平片')][0]; K=d['variants'][V0]; SH=d['sheet'][V0]
lerp=lambda a,b,t:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
def bz(c,t): u=1-t; return [u**3*c[0][i]+3*u*u*t*c[1][i]+3*u*t*t*c[2][i]+t**3*c[3][i] for i in (0,1)]
def model_lines(ay):
    i=0 if ay<=45 else 1; A,B=K[i],K[i+1]; t=(ay-A['yaw'])/(B['yaw']-A['yaw']); P={k:lerp(A['pts'][k],B['pts'][k],t) for k in A['pts']}
    th=math.radians(ay*SH['theta45']/45 if ay<=45 else SH['theta45']+(ay-45)*(90-SH['theta45'])/45)
    for k,(dd,y) in SH['pts'].items(): P[k]=[dd*math.sin(th),y]
    K90=K[-1]; face=[]; side=[]
    for l in A['lines']:
        m=[x for x in B['lines'] if x['a']==l['a'] and x['b']==l['b']][0]; n=[x for x in K90['lines'] if x['a']==l['a'] and x['b']==l['b']][0]
        ha=[n['ha'][0]*math.sin(th),n['ha'][1]] if l['a'] in SH['pts'] else lerp(l['ha'],m['ha'],t); hb=[n['hb'][0]*math.sin(th),n['hb'][1]] if l['b'] in SH['pts'] else lerp(l['hb'],m['hb'],t)
        a,b=P[l['a']],P[l['b']]; c=[a,[a[0]+ha[0],a[1]+ha[1]],[b[0]+hb[0],b[1]+hb[1]],b]; s=[bz(c,j/300) for j in range(301)]
        (side if l.get('side') else face).extend(s)
    return face, side
def eye_pts(phi,psi):
    f,w=math.radians(phi),math.radians(psi); ax=-E['anchor'][0]*math.cos(w)+E['z']*math.sin(w); out=[]
    for c in E['base']:
        for i in range(81):
            p=bz(c,i/80); qx=-(p[0]-E['anchor'][0]); qy=p[1]-E['anchor'][1]
            out.append((ax+math.cos(f)*qx+math.sin(f)*(math.sqrt(max(0,E['r']**2-qx*qx-qy*qy))-E['r']), p[1]))
    return out
def tab(t,ay):
    for k in range(1,len(t)):
        if t[k][0]>=ay: a,b=t[k-1],t[k]; u=(ay-a[0])/(b[0]-a[0]); return a[1]+(b[1]-a[1])*u, a[2]+(b[2]-a[2])*u
def show(table, ay):
    face,side=model_lines(ay); fr=lambda y: max((q[0] for q in face if abs(q[1]-y)<0.4), default=None); pr=lambda y: max((q[0] for q in side if abs(q[1]-y)<0.4), default=None)
    phi,psi=tab(table,ay); pts=eye_pts(phi,psi); vis=[p for p in pts if fr(p[1]) is not None and pr(p[1]) is not None and pr(p[1])<p[0]<fr(p[1])]
    mx=max(p[0]-fr(p[1]) for p in pts if fr(p[1]) is not None)
    return phi,psi,mx,(max(p[0] for p in vis)-min(p[0] for p in vis) if vis else 0.0), len(vis)
if __name__=='__main__':
    table=json.loads(sys.argv[1]) if sys.argv[1:] else E['far']
    for ay in [55,57.5,60,62.5,65,67.5,70,72.5,75]:
        phi,psi,mx,vw,n=show(table,ay); print('%5.1f φ %6.1f ψ %5.1f  eye right − face edge %+.2f   visible width %.2f (%d pts)'%(ay,phi,psi,mx,vw,n))
