# Measurement-only injection into git archive snapshots; never run on the working checkout.
from pathlib import Path
import sys
for version in ['045','046']:
 root=Path(sys.argv[1]).resolve()/version
 p=root/'src/ui/windows/ContourPanel.tsx';s=p.read_text()
 s=s.replace("useEffect(()=>{", "useEffect(()=>{\nconst metrics=(window as any).__contourProfile={camera:0,requests:0,completed:0,installed:0,stale:0,uploads:0,bytes:0,prepMs:0,postMs:0,stages:[]};")
 s=s.replace('const request:ContourRequest=', 'const prepStart=performance.now();const request:ContourRequest=')
 s=s.replace('worker.postMessage(request);', "metrics.prepMs+=performance.now()-prepStart;metrics.requests++;metrics.uploads+=request.source?1:0;metrics.bytes+=JSON.stringify(request).length;const postStart=performance.now();worker.postMessage(request);metrics.postMs+=performance.now()-postStart;")
 s=s.replace('orientationKey=key;orientation=q;', 'metrics.camera++;orientationKey=key;orientation=q;')
 s=s.replace('if(!active)return;inflight=false;', 'if(!active)return;metrics.completed++;metrics.stages.push((event.data as any).timing);metrics.stale++;inflight=false;')
 s=s.replace('setResult(event.data);', 'metrics.installed++;metrics.stale--;setResult(event.data);')
 p.write_text(s)
 p=root/'src/ui/windows/contour.worker.ts';s=p.read_text().replace('silhouette,type Orientation','projectMesh,rasterUnion,traceExterior,type Orientation')
 s=s.replace('const result=silhouette(geometry.mesh,request.orientation);', '''const t0=performance.now();const points=projectMesh(geometry.mesh,request.orientation);const t1=performance.now();const mask=rasterUnion(points,geometry.mesh.triangles);const t2=performance.now();const paths=traceExterior(mask,768);const t3=performance.now();const result={paths,resolution:768,coveredPixels:mask.reduce((a,b)=>a+b,0),timing:{projection:t1-t0,raster:t2-t1,trace:t3-t2,total:performance.now()-t0}};''')
 p.write_text(s)
