import {test,expect} from 'vitest';
import {isDerived} from '../domain/curves/model';
import {depthSteps,visibilitySteps,localEdges,tangentLines,projection,type ScreenPoint} from '../domain/contour/visible';
import {silhouette,type ContourMesh} from '../domain/contour/silhouette';
import {contourSource} from '../domain/contour/source';
import {smoothFixture} from './smooth-fixture';
function finish<T>(g:Generator<void,T>):T{let n=g.next();while(!n.done)n=g.next();return n.value;}
const screen:ScreenPoint[]=[[10,10,0],[90,10,0],[90,90,0],[10,90,0]];
const mesh:ContourMesh={vertices:screen,triangles:[{indices:[0,1,2],patchId:'head',triangleId:0},{indices:[0,2,3],patchId:'head',triangleId:1}]};
test('one shared depth clips exposed/buried parts for either candidate kind; rear side hidden',()=>{
 const depth=finish(depthSteps(screen,mesh,100)),line:ScreenPoint[]=[[20,50,.3],[80,50,-.3]],paths=finish(visibilitySteps([line],depth,1e-5));expect(paths).toHaveLength(1);expect(paths[0][0][0]).toBe(20);expect(paths[0].at(-1)![0]).toBeCloseTo(50,0);
 expect(finish(visibilitySteps([[[20,50,-.1],[80,50,-.1]]],depth,1e-5))).toEqual([]);
});
test('shared mesh front/back transition is a candidate; a single incident edge is not tangent',()=>{
 const m:ContourMesh={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,1,1]],triangles:[{indices:[0,1,2],patchId:'x',triangleId:0},{indices:[1,0,3],patchId:'x',triangleId:1}]};m.edges=localEdges(m);expect(tangentLines(m,m.vertices)).toHaveLength(1);
});
test('coincident chart vertices do not introduce artificial open seams',()=>{
 const m:ContourMesh={vertices:[[0,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]],triangles:[{indices:[0,1,2],patchId:'region',triangleId:0},{indices:[3,4,5],patchId:'region',triangleId:1}]};expect(localEdges(m).filter(e=>e.faces.length===1)).toHaveLength(4);expect(localEdges(m).filter(e=>e.faces.length===2)).toHaveLength(1);
});
test('semantic shared Patch boundary excluded; exact curves supply only exposed sides',()=>{
 const p=smoothFixture(0),m=contourSource(p).mesh;expect(m.boundaries).toHaveLength(6);expect(m.boundaries!.every(b=>b.length===257)).toBe(true);
});
test('depth orientation is orthographic, scales epsilon with scene; old outer pass unchanged',()=>{
 const m:ContourMesh={...mesh,vertices:[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]]},q:[number,number,number,number]=[0,0,0,1];const a=silhouette(m,q,128);const projected=projection(m,q,128);finish(depthSteps(projected.points,m,128));expect(silhouette(m,q,128)).toEqual(a);
 const scaled={...m,vertices:m.vertices.map(v=>v.map(x=>x*20) as [number,number,number])};expect(projection(scaled,q).epsilon/projection(m,q).epsilon).toBeCloseTo(20);expect(projection(m,q,128,[[0,0,1]]).points[0][2]).toBe(1);
});
test('sloping depth is compared at candidate XY, without a permissive slope bias',()=>{
 const p=screen.map(v=>[v[0],v[1],v[0]*3] as ScreenPoint),d=finish(depthSteps(p,mesh,100));
 expect(finish(visibilitySteps([[[20.1,50,60.3-.01],[80.1,50,240.3-.01]]],d,1e-5))).toEqual([]);
 expect(finish(visibilitySteps([[[20.1,50,60.3],[80.1,50,240.3]]],d,1e-5))).toHaveLength(1);
});
test('closed head plus ordinary auxiliary Quad: exposed front boundary, buried portion, hidden rear',()=>{
 const p=smoothFixture(0,0);p.patches=p.patches!.slice(0,1);
 // The Quad upper edge slopes into the head. All objects remain ordinary source curves/points.
 p.landmarks=p.landmarks.map((l,i)=>({...l,placement:{kind:'WORLD' as const,position:([[-.6,-.3,.5],[.6,-.3,1.1],[-.6,-.6,.6],[.6,-.6,.6]][i]??[0,0,0]) as [number,number,number]}}));
 const m=contourSource(p).mesh,offset=m.vertices.length;
 const n=64,r=32;
 for(let j=0;j<=r;j++)for(let i=0;i<n;i++){const a=i/n*Math.PI*2,b=j/r*Math.PI;m.vertices.push([Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)]);}
 for(let j=0;j<r;j++)for(let i=0;i<n;i++){const a=offset+j*n+i,b=offset+j*n+(i+1)%n,c=a+n,d=b+n;for(const indices of [[a,c,b],[b,c,d]] as [number,number,number][])m.triangles.push({indices,patchId:'head',triangleId:m.triangles.length});}
 const line=m.boundaries![0];
 const q:[number,number,number,number]=[0,0,0,1],front=projection(m,q,256),depth=finish(depthSteps(front.points,m,256));
 const visibleFront=finish(visibilitySteps([projection(m,q,256,line).points],depth,front.epsilon));
 expect(visibleFront.length).toBeGreaterThan(0);
 const projectedLine=projection(m,q,256,line).points;expect(visibleFront[0][0][0]).toBeGreaterThan(projectedLine[0][0]+5);
 const rearQ:[number,number,number,number]=[0,1,0,0],rear=projection(m,rearQ,256);
 expect(finish(visibilitySteps([projection(m,rearQ,256,line).points],finish(depthSteps(rear.points,m,256)),rear.epsilon))).toEqual([]);
});
test('shared ON_CURVE span is excluded by semantic identity',()=>{
 const p=smoothFixture(0,0);
 p.landmarks.push({id:'v6',name:'host start',type:'FREE',placement:{kind:'WORLD',position:[0,-1,1]},viewLocks:{}},{id:'v7',name:'host end',type:'FREE',placement:{kind:'WORLD',position:[0,1,1]},viewLocks:{}});
 p.curves=p.curves.map(c=>c.id==='seam'&&c.role==='canonical'&&!isDerived(c)?{...c,startLandmarkId:'v6',endLandmarkId:'v7'}:c);
 p.landmarks=p.landmarks.map(l=>l.id==='v0'||l.id==='v1'?{...l,placement:{kind:'ON_CURVE',role:'canonical',hostCurveId:'seam',s:l.id==='v0'?.25:.75}}:l);
 const m=contourSource(p).mesh;expect(m.boundaries).toHaveLength(6);
 expect(m.boundaries!.some(line=>line.every(v=>Math.abs(v[0])<1e-10))).toBe(false);
});
test('closed concave shell: internal tangent contours survive depth; periodic seams are not boundaries',()=>{
 const m:ContourMesh={vertices:[],triangles:[]},n=64,k=32;
 for(let i=0;i<n;i++)for(let j=0;j<k;j++){const u=i/n*2*Math.PI,v=j/k*2*Math.PI,r=.6+.25*Math.cos(v);m.vertices.push([r*Math.cos(u),r*Math.sin(u),.3*Math.sin(v)]);}
 for(let i=0;i<n;i++)for(let j=0;j<k;j++){const a=i*k+j,b=((i+1)%n)*k+j,c=i*k+(j+1)%k,d=((i+1)%n)*k+(j+1)%k;for(const indices of [[a,b,c],[b,d,c]] as [number,number,number][])m.triangles.push({indices,patchId:'closed',triangleId:m.triangles.length});}
 m.edges=localEdges(m);expect(m.edges.every(e=>e.faces.length===2)).toBe(true);
 const p=projection(m,[0,0,0,1],256),lines=tangentLines(m,p.points),paths=finish(visibilitySteps(lines,finish(depthSteps(p.points,m,256)),p.epsilon));
 const center=projection(m,[0,0,0,1],256,[[0,0,0]]).points[0];
 expect(paths.some(path=>path.every(v=>Math.hypot(v[0]-center[0],v[1]-center[1])<65))).toBe(true);
 expect(m.boundaries).toBeUndefined();
});
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,toRelative} from '../domain/head/frame';
import {createSection,sectionFromAngles} from '../domain/curves/section';
import {addCap} from '../domain/head/caps';
import {regionCandidates} from '../domain/head/regions';
test('Cap uses one analytic closed perimeter per disk, without fan spokes or parameter seam',()=>{
 let p=migrateHeadFrame(createLandmarkProject());p={...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]};
 const s=createSection(p);p=addCap(s.project,s.selectedId);const m=contourSource(p).mesh;
 expect(m.boundaries).toHaveLength(2);expect(m.boundaries!.every(line=>line.length===257)).toBe(true);
 for(const line of m.boundaries!)expect(Math.hypot(...line[0].map((x,i)=>x-line.at(-1)![i]))).toBeLessThan(1e-12);
});
test('Region soup recovery emits only actual Section cut perimeter, no triangulation edges',()=>{
 let p=migrateHeadFrame(createLandmarkProject());p={...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]};const ids:string[]=[];
 for(const [x,y] of [[0,0],[0,90],[90,0]]){const s=createSection(p);p=s.project;const c=p.curves.find(c=>c.id===s.selectedId)!;if(c.role==='canonical'&&'section' in c)c.section=sectionFromAngles(x,y,0);ids.push(s.selectedId);}
 const r=regionCandidates(p,ids)[0];p.loomisRegions=[{id:'region',name:'region',cuts:r.cuts,seed:r.seed}];
 const m=contourSource(p).mesh;expect(m.boundaries!.length).toBeGreaterThan(0);
 // Default frame may be anisotropic. These center-passing cuts remain axis planes.
 for(const line of m.boundaries!)expect([0,1,2].some(k=>line.every(v=>Math.abs(toRelative(p,v)[k])<1e-9))).toBe(true);
});
test('pixel-center winner cannot occlude outside its triangle; subpixel occluders still count',()=>{
 const pts:ScreenPoint[]=[[10,10,1],[11,10,1],[10,11,1],[10.7,10.7,.5],[10.95,10.7,.5],[10.7,10.95,.5]];
 const m:ContourMesh={vertices:pts,triangles:[{indices:[0,1,2],patchId:'a',triangleId:0},{indices:[3,4,5],patchId:'b',triangleId:1}]};
 const d=finish(depthSteps(pts,m,32));
 const line:ScreenPoint[]=[[10.75,10.75,.6],[10.8,10.75,.6]];
 expect(finish(visibilitySteps([line],d,1e-5))).toHaveLength(1);
 expect(finish(visibilitySteps([line.map(p=>[p[0],p[1],.4] as ScreenPoint)],d,1e-5))).toHaveLength(0);
});
