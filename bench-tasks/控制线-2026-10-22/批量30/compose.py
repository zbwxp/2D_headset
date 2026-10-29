# place chosen candidates into the control frame (three panels ±125 around each reference centre) by their own fits
# (control = s·image + t), render at the small sheet size, overlay the control sheet
import struct, sys, subprocess, json
sel = json.loads(sys.argv[1]); out = sys.argv[2]
L0 = {1:(636.5,760,835,(700,958)),3:(637.5,765,832,(682,948)),2:(742.5,875,955,(560,1085)),4:(760,897,980,(572,1103)),5:(741,875,953,(570,1080)),
      7:(761,898,978,(557,1102)),10:(755,882,960,(572,1088)),6:(690,818,897,(620,1025)),9:(700,835,908,(612,1032))}
L45 = {11:(695,908,(810,1045)),1:(795,1010,(770,1130)),2:(760,968,(767,1065)),3:(758,978,(779,1095)),4:(758,977,(756,1085)),5:(755,973,(768,1090)),6:(760,970,(765,1085)),7:(752,963,(762,1075)),8:(765,977,(774,1090)),9:(752,968,(761,1085)),10:(770,985,(763,1105))}
L90 = {1:(655,(1068,760),848,(988,935)),2:(655,(1062,740),835,(992,925)),4:(635,(1132,708),815,(1074,900)),5:(640,(1047,760),842,(968,935)),6:(645,(1060,745),842,(987,925)),
       7:(640,(1062,745),848,(989,950)),8:(665,(1047,760),838,(965,925)),9:(670,(1010,735),825,(932,910)),10:(700,(1060,800),875,(994,975)),11:(700,(1005,780),882,(905,988))}
def lsq(rows):
    n=3; A=[[sum(r[i]*r[j] for r in rows) for j in range(n)] for i in range(n)]; b=[sum(r[i]*r[3] for r in rows) for i in range(n)]
    for i in range(n):
        p=max(range(i,n),key=lambda r:abs(A[r][i])); A[i],A[p]=A[p],A[i]; b[i],b[p]=b[p],b[i]
        for r in range(n):
            if r!=i: f=A[r][i]/A[i][i]; A[r]=[a-f*c for a,c in zip(A[r],A[i])]; b[r]-=f*b[i]
    return [b[i]/A[i][i] for i in range(n)]
def fit(yaw,k):
    if yaw==0: e,n,m,c=L0[k]; rows=[(e,0,1,-0.2),(n,0,1,24.4),(m,0,1,38.8),(c[1],0,1,62.3),(c[0],1,0,0.0)]
    elif yaw==45: e,m,c=L45[k]; rows=[(e,0,1,-0.1),(m,0,1,38.8),(c[1],0,1,62.3),(c[0],1,0,50.45)]
    else: e,n,m,c=L90[k]; rows=[(e,0,1,-0.2),(n[0],1,0,90.8),(n[1],0,1,24.4),(m,0,1,38.8),(c[0],1,0,72.4),(c[1],0,1,62.3)]
    return lsq(rows)
def rd(f):
    b=open(f,'rb').read(); off,=struct.unpack_from('<I',b,10); W,H=struct.unpack_from('<ii',b,18); bpp,=struct.unpack_from('<H',b,28); row=((W*bpp+31)//32)*4; Hs=H; H=abs(H)
    def lum(x,y):
        if not(0<=x<W and 0<=y<H): return 255
        yy=y if Hs<0 else H-1-y; i=off+yy*row+x*bpp//8; return (b[i]+b[i+1]+b[i+2])//3
    return lum
W,H=1942,810; SX=W/4533; K=SX/0.16550333333333334; PW=1511*SX; Y0=-15.491112-945*0.16550333333333334; REFX={0:0,45:13.481686576394216,90:19.065984}
imgs={yaw:(rd('yaw%02d-%02d.bmp'%(yaw,k)),fit(yaw,k)) for yaw,k in sel.items() for yaw in [int(yaw)]}
c=open('../guide3/ctl-small.bmp','rb').read(); coff,=struct.unpack_from('<I',c,10); cW,cH=struct.unpack_from('<ii',c,18); crow=(cW*3+3)//4*4
row=(W*3+3)//4*4; body=bytearray()
for py in range(H):
    line=bytearray()
    for px in range(W):
        j=min(2,int(px//PW)); yaw=[0,45,90][j]; cx=REFX[yaw]-125+(px-j*PW)/K; cy=Y0+py/K
        lum,(s,tx,ty)=imgs[yaw]; v=lum(int((cx-tx)/s),int((cy-ty)/s)); v=255-(255-v)*2//3
        ci=coff+py*crow+3*px; cb,cg,cr=c[ci],c[ci+1],c[ci+2]
        if cr<70 and cg<70 and cb<70: p=(230,0,0)
        elif cr+cg+cb<600 and max(cr,cg,cb)-min(cr,cg,cb)>40: p=(cr,cg,cb)
        else: p=(v,v,v)
        line+=bytes(p[::-1])
    body+=line+b'\0'*(row-3*W)
hdr=b'BM'+struct.pack('<IHHI',54+row*H,0,0,54)+struct.pack('<IiiHHIIiiII',40,W,-H,1,24,0,row*H,0,0,0,0)
open('c.bmp','wb').write(hdr+body); subprocess.run(['sips','-s','format','png','c.bmp','--out',out],check=True,capture_output=True)
print({y:[round(v,3) for v in f] for y,(l,f) in imgs.items()})
