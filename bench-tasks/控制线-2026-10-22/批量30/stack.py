# 叠加平均 (bowen 1792641684): each angle's 10 candidates placed by their own fits into the control frame and averaged —
# lines most of them draw come out dark; the control outline in red on top
import struct, subprocess, json
src=open('compose.py').read()
exec(src.split("def rd(f):")[0].replace("sel = json.loads(sys.argv[1]); out = sys.argv[2]",""))
exec("def rd(f):"+src.split("def rd(f):")[1].split("W,H=1942")[0])
W,H=1942,810; SX=W/4533; K=SX/0.16550333333333334; PW=1511*SX; Y0=-15.491112-945*0.16550333333333334; REFX={0:0,45:13.481686576394216,90:19.065984}
sets={0:[1,2,3,4,5,6,7,9,10],45:list(range(1,11)),90:[1,2,4,5,6,7,8,9,10]}   # 0°-08 has no chin reading, 90°-03 none: left out
imgs={yaw:[(rd('yaw%02d-%02d.bmp'%(yaw,k)),fit(yaw,k)) for k in ks] for yaw,ks in sets.items()}
c=open('../guide3/ctl-small.bmp','rb').read(); coff,=struct.unpack_from('<I',c,10); cW,cH=struct.unpack_from('<ii',c,18); crow=(cW*3+3)//4*4
row=(W*3+3)//4*4; body=bytearray()
for py in range(H):
    line=bytearray()
    for px in range(W):
        j=min(2,int(px//PW)); yaw=[0,45,90][j]; cx=REFX[yaw]-125+(px-j*PW)/K; cy=Y0+py/K
        acc=0; L=imgs[yaw]
        for lum,(s,tx,ty) in L: acc+=255-lum(int((cx-tx)/s),int((cy-ty)/s))
        d=acc/len(L); v=int(max(0,255-d*1.6))
        ci=coff+py*crow+3*px; cb,cg,cr=c[ci],c[ci+1],c[ci+2]
        p=(225,0,0) if (cr<70 and cg<70 and cb<70) else (v,v,v)
        line+=bytes(p[::-1])
    body+=line+b'\0'*(row-3*W)
hdr=b'BM'+struct.pack('<IHHI',54+row*H,0,0,54)+struct.pack('<IiiHHIIiiII',40,W,-H,1,24,0,row*H,0,0,0,0)
open('st.bmp','wb').write(hdr+body); subprocess.run(['sips','-s','format','png','st.bmp','--out','stack.png'],check=True,capture_output=True); print('ok')
