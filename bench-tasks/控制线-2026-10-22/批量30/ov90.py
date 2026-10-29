import json, struct, subprocess, sys
src=open('compose.py').read()
exec(src.split("def rd(f):")[0].replace("sel = json.loads(sys.argv[1]); out = sys.argv[2]",""))
exec("def rd(f):"+src.split("def rd(f):")[1].split("W,H=1942")[0])
C=json.load(open('c90.json')); names=list(C)
lum=rd('yaw90-11.bmp'); s,tx,ty=fit(90,11)
x0,x1,y0,y1,U=-20,110,-95,80,6.0
w=int((x1-x0)*U); h=int((y1-y0)*U); img=[[None]*w for _ in range(h)]
for j in range(h):
    for i in range(w):
        v=lum(int((x0+i/U-tx)/s),int((y0+j/U-ty)/s)); v=255-(255-v)*2//3; img[j][i]=(v,v,v)
def bez(c,t):
    u=1-t; return [u*u*u*c[0][k]+3*u*u*t*c[1][k]+3*u*t*t*c[2][k]+t*t*t*c[3][k] for k in range(2)]
for name,col in zip(names,[(40,110,255),(230,0,0)]):
    for c in C[name]:
        for q in range(801):
            x,y=bez(c,q/800); i=int((x-x0)*U); j=int((y-y0)*U)
            for dj in (-1,0,1):
                for di in (-1,0,1):
                    if 0<=j+dj<h and 0<=i+di<w: img[j+dj][i+di]=col
r=(w*3+3)//4*4; hdr=b'BM'+struct.pack('<IHHI',54+r*h,0,0,54)+struct.pack('<IiiHHIIiiII',40,w,-h,1,24,0,r*h,0,0,0,0)
open('o90.bmp','wb').write(hdr+b''.join(bytes(c for p in row for c in p[::-1])+b'\0'*(r-3*w) for row in img))
subprocess.run(['sips','-s','format','png','o90.bmp','--out',sys.argv[1]],check=True,capture_output=True); print(names)
