# the new references with the turning axis drawn in (bowen 1792671397: a plain guide line, no interaction): a dashed
# vertical line at canvas x = 0 in each picture's own pixels (canvas = s·image + t); writes refs.json for the archives
import json, struct, subprocess, base64
src=open('../batch/compose.py').read()
exec(src.split("def rd(f):")[0].replace("sel = json.loads(sys.argv[1]); out = sys.argv[2]",""))
out={}
for yaw,k in ((0,9),(45,11),(90,11)):
    f='../batch/yaw%02d-%02d'%(yaw,k)
    b=bytearray(open(f+'.bmp','rb').read()); off,=struct.unpack_from('<I',b,10); W,H=struct.unpack_from('<ii',b,18); bpp,=struct.unpack_from('<H',b,28); Hs=H; H=abs(H); row=((W*bpp+31)//32)*4
    s,tx,ty=fit(yaw,k); ax=(0-tx)/s
    for y in range(H):
        if (y//14)%2: continue
        yy=y if Hs<0 else H-1-y
        for x in range(int(ax)-1,int(ax)+2):
            if 0<=x<W: i=off+yy*row+x*bpp//8; b[i:i+3]=bytes((230,140,40))   # BGR: a blue line
    open('ax%d.bmp'%yaw,'wb').write(b); subprocess.run(['sips','-s','format','png','ax%d.bmp'%yaw,'--out','ax%d.png'%yaw],check=True,capture_output=True)
    out[yaw]={'png':'ax%d.png'%yaw,'W':W,'H':H,'s':s,'cx':tx+s*W/2,'cy':ty+s*H/2,'name':'生成参考 yaw%d-%02d + 转轴（蓝虚线 x=0）'%(yaw,k)}
    print(yaw,'axis at image x %.1f'%ax)
json.dump(out,open('refs.json','w'),ensure_ascii=False)
