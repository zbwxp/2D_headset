# grid crops of candidates for reading landmarks: x0..x1, y0..y1 image pixels; grid every 20 (red every 100)
import struct, sys, subprocess
names=sys.argv[1].split(','); x0,x1,y0,y1=map(int,sys.argv[2:6]); out=sys.argv[6]
def rd(f):
    b=open(f,'rb').read(); off,=struct.unpack_from('<I',b,10); W,H=struct.unpack_from('<ii',b,18); bpp,=struct.unpack_from('<H',b,28); row=((W*bpp+31)//32)*4; Hs=H; H=abs(H)
    def px(x,y):
        yy=y if Hs<0 else H-1-y; i=off+yy*row+x*bpp//8; return (b[i+2],b[i+1],b[i])
    return px
w=x1-x0; h=y1-y0; OW=len(names)*(w+8); r=(OW*3+3)//4*4; rows=[]
P=[rd(n) for n in names]
for y in range(y0,y1):
    line=bytearray()
    for j,px in enumerate(P):
        for x in range(x0,x1):
            p=px(x,y)
            if sum(p)>600:
                if y%100==0 or x%100==0: p=(255,0,0)
                elif y%20==0 or x%20==0: p=(190,215,255)
            line+=bytes(p[::-1])
        line+=b'\x60'*24
    rows.append(bytes(line)+b'\0'*(r-len(line)))
hdr=b'BM'+struct.pack('<IHHI',54+r*h,0,0,54)+struct.pack('<IiiHHIIiiII',40,OW,-h,1,24,0,r*h,0,0,0,0)
open('s.bmp','wb').write(hdr+b''.join(rows)); subprocess.run(['sips','-s','format','png','s.bmp','--out',out],check=True,capture_output=True)
