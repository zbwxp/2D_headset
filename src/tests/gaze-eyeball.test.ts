import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {createEyeScaffold} from '../domain/eyes/scaffold';
import {irisGeometry,irisMeshes,irisRims} from '../domain/eyes/gaze';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {contourSource} from '../domain/contour/source';
import {projection} from '../domain/contour/visible';
import {clipPerspective} from '../domain/contour/perspective';
const setup=()=>({...createEyeScaffold(migrateHeadFrame(createLandmarkProject())),gazeEyeball:{version:1 as const,leftId:crypto.randomUUID(),rightId:crypto.randomUUID(),irisScale:.45,recessDepth:.12,tracking:true}});
test('rim is an exact ellipsoid section, cap shares perimeter and recedes inward',()=>{
 const p=setup(),q=p.eyeScaffold!.parameters,f=p.headFrame!,R=f.radiusX;
 for(const side of ['left','right'] as const){const g=irisGeometry(p,side)!,m=irisMeshes(p).find(x=>x.side===side)!;
 for(let i=0;i<96;i++){const v=g.rim(i*2*Math.PI/96),local=v.map((x,k)=>(x-f.center[k])/R-[side==='left'?-q.x:q.x,q.y,q.z][k]);expect((local[0]/q.ballX)**2+(local[1]/q.ballY)**2+(local[2]/q.ballZ)**2).toBeCloseTo(1,12);expect(g.evaluate(1,i*2*Math.PI/96)).toEqual(v);expect(m.rim[i]).toBe(m.vertices[1+15*96+i]);}
 expect(g.rim(0)[2]-g.evaluate(0,0)[2]).toBeCloseTo(R*q.ballZ*p.gazeEyeball.recessDepth,12);
 expect(m.triangles.every(t=>t.every(i=>i<m.vertices.length))).toBe(true);
 }
});
test('follows shared center, nonuniform eyeball scale, head frame and roundtrips',()=>{
 const p=setup(),g=irisGeometry(p,'right')!,next={...p,eyeScaffold:{...p.eyeScaffold!,parameters:{...p.eyeScaffold!.parameters,x:.8,y:.2,z:1.1,ballX:.36,ballY:.18}}},m=irisMeshes(next);
 const a=irisGeometry(next,'right')!,b=irisGeometry(next,'left')!;expect(a.rim(0)).not.toEqual(g.rim(0));expect(a.rim(Math.PI)[0]+b.rim(0)[0]).toBeCloseTo(2*p.headFrame!.center[0]);
 const loaded=parseLandmarks(JSON.stringify(next));expect(loaded.gazeEyeball).toEqual(p.gazeEyeball);expect(irisMeshes(loaded)).toEqual(m);
 expect(()=>parseLandmarks(JSON.stringify({...p,gazeEyeball:{...p.gazeEyeball,irisScale:2}}))).toThrow();
});
test('Contour carries only always-visible rims; dish contributes no triangles or boundary candidates',()=>{
 const p=setup(),base=contourSource({...p,gazeEyeball:undefined}).mesh,mesh=contourSource(p).mesh;
 expect(mesh.triangles).toEqual(base.triangles);expect(mesh.boundaries).toEqual(base.boundaries);expect(mesh.alwaysLines).toEqual(irisRims(p));expect(mesh.alwaysLines).toHaveLength(2);
 for(const yaw of [0,75,90,135,180]){const h=yaw*Math.PI/360,q:[number,number,number,number]=[0,Math.sin(h),0,Math.cos(h)];expect(projection(mesh,q,768,mesh.alwaysLines!.flat()).points.every(p=>p.every(Number.isFinite))).toBe(true);}
 const perspective={position:[0,.2,5] as [number,number,number],fov:34},clipped=clipPerspective(mesh,[0,0,0,1],perspective);expect(clipped.alwaysLines!.length).toBeGreaterThan(0);
});
test('eyeball offset moves both balls and iris inward while leaving cylinders fixed; persists and defaults old saves to zero',()=>{
 const p=setup(),s=p.eyeScaffold!,next={...p,eyeScaffold:{...s,parameters:{...s.parameters,ballOffsetX:-.1}}};
 for(const side of ['left','right'] as const){const a=irisGeometry(p,side)!,b=irisGeometry(next,side)!,sign=side==='left'?1:-1;for(const r of [0,.4,1]){const av=a.evaluate(r,.7),bv=b.evaluate(r,.7);expect(bv[0]-av[0]).toBeCloseTo(sign*.1*p.headFrame!.radiusX);expect(bv.slice(1)).toEqual(av.slice(1));}}
 const loaded=parseLandmarks(JSON.stringify(next));expect(loaded.eyeScaffold!.parameters.ballOffsetX).toBe(0);expect(loaded.eyeScaffold!.parameters.x).toBeCloseTo(s.parameters.x-.1);
 for(const side of ['left','right'] as const)for(let i=0;i<23;i++){const id=s[side].pointIds[i],a=p.landmarks.find(l=>l.id===id)!,b=loaded.landmarks.find(l=>l.id===id)!;if(i<8){expect(b).toBeUndefined();continue;}if(i>=20){expect(b).toBeDefined();continue;}else{expect(b.placement.kind).toBe('FRAME_RELATIVE');if(b.placement.kind==='FRAME_RELATIVE'&&a.placement.kind==='FRAME_RELATIVE')expect(b.placement.position[0]-a.placement.position[0]).toBeCloseTo(side==='left'?.1:-.1);}}
 const old=JSON.parse(JSON.stringify(p));delete old.eyeScaffold.parameters.ballOffsetX;expect(parseLandmarks(JSON.stringify(old)).eyeScaffold!.parameters.ballOffsetX).toBe(0);
});
