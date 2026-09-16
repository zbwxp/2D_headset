import type {LandmarkProject} from '../domain/landmarks/model';
import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createCurve} from '../domain/curves/management';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {addPatch} from '../domain/patches/model';
import {followEndpoints,controls} from '../domain/curves/geometry';
import {pointPosition} from '../domain/geometry/evaluation';
import {dirtyDescendants} from '../domain/geometry/dependencies';
import {tessellate} from '../domain/patches/geometry';
import {surfaceInputKey} from '../domain/geometry/revisions';
import {solveKey} from '../domain/smooth/evaluation';
import {diagnostics} from '../domain/geometry/diagnostics';
import {createAutosave,serializeProject} from '../app/autosave';
import {screenIndex,frontLayers} from '../domain/geometry/screenIndex';
function fixture(){let p=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));outer:for(let i=0;i<p.curves.length;i++)for(let j=i+1;j<p.curves.length;j++)for(let k=j+1;k<p.curves.length;k++){try{p=addPatch(p,[p.curves[i].id,p.curves[j].id,p.curves[k].id]);if(p.patches!.length>=4)break outer;}catch{}}
 const host=p.curves.find(c=>c.role==='canonical')!,a=addOnCurvePoint(p,host.id);return {p:a.project as LandmarkProject,a:a.selectedId,host};}
const counts=()=>diagnostics.snapshot().counters;
it('isolated locator: no host LUT, Patch, or surface revision work after warmup',()=>{
 const {p,a,host}=fixture();pointPosition(p,a);const meshes=p.patches!.map(x=>tessellate(p,x,6)),surface=surfaceInputKey(p),smooth=solveKey(p);diagnostics.reset();
 const q=followEndpoints(p,setOnCurveS(p,a,.643));const dirty=dirtyDescendants(p,q);expect(dirty.curves.size).toBe(0);expect(dirty.patches.size).toBe(0);expect(q.curves.every((c,i)=>c===p.curves[i])).toBe(true);
 expect(pointPosition(q,a)).not.toEqual(pointPosition(p,a));expect(controls(q,host)).toBe(controls(p,host));expect(surfaceInputKey(q)).toBe(surface);expect(solveKey(q)).toBe(smooth);
 q.patches!.forEach((x,i)=>expect(tessellate(q,x,6)).toBe(meshes[i]));for(const name of ['arcLengthLUTBuilds','patchEvaluations','patchTessellations'])expect(counts()[name]??0).toBe(0);
});
it('local endpoint dependency rebuilds only the two mirror patches; exact Undo cache reuse',()=>{
 let {p,a}=fixture();const side=p.landmarks.find(x=>x.id===a)!.type;const ids=p.landmarks.filter(l=>l.type===side&&l.placement.kind!=='ON_CURVE').slice(2,4).map(l=>l.id);const edges:string[]=[];
 for(const [x,y] of [[a,ids[0]],[ids[0],ids[1]],[ids[1],a]]){const r=createCurve(p,x,y,p.views[0],'local');p=r.project;edges.push(r.selectedId);}p=addPatch(p,edges);pointPosition(p,a);const before=p.patches!.map(x=>tessellate(p,x,6));diagnostics.reset();const q=followEndpoints(p,setOnCurveS(p,a,.673));const dirty=dirtyDescendants(p,q);expect(dirty.patches.size).toBe(2);
 for(let i=0;i<q.patches!.length;i++){const x=q.patches![i],m=tessellate(q,x,6);if(dirty.patches.has(x.id))expect(m).not.toBe(before[i]);else expect(m).toBe(before[i]);}
 expect(counts().patchEvaluations).toBe(1); // Canonical evaluator is reused by the mirror.
expect(counts().patchTessellations).toBe(2);expect(counts().arcLengthLUTBuilds??0).toBe(0);p.patches!.forEach((x,i)=>expect(tessellate(p,x,6)).toBe(before[i]));
});
it('100 s values share the unchanged host arc-length table',()=>{const {p,a}=fixture();diagnostics.reset();pointPosition(p,a);const initial=counts().arcLengthLUTBuilds??0;for(let i=0;i<100;i++)pointPosition(setOnCurveS(p,a,(i+1)/101),a);expect(counts().arcLengthLUTBuilds??0).toBe(initial);});
it('one continuous session produces exactly one autosave, regardless of duration; stable views serialize once',()=>{vi.useFakeTimers();const {p,a}=fixture(),write=vi.fn(),save=createAutosave(write);save.begin();for(let i=0;i<100;i++){save.request(setOnCurveS(p,a,i/100));vi.advanceTimersByTime(100);}expect(write).not.toHaveBeenCalled();save.end();vi.advanceTimersByTime(500);expect(write).toHaveBeenCalledTimes(1);expect(JSON.parse(serializeProject(p))).toEqual(JSON.parse(JSON.stringify(p)));save.cancel();vi.useRealTimers();});
it('screen bins preserve inclusive candidates and sharply reduce brute force checks',()=>{
 const triangles=Array.from({length:1000},(_,i)=>({minX:(i%40)*10,maxX:(i%40)*10+8,minY:Math.floor(i/40)*10,maxY:Math.floor(i/40)*10+8}));const index=screenIndex(triangles);let checks=0;
 for(let i=0;i<2000;i++){const x=(i*13)%410,y=(i*17)%260,hit=(t:typeof triangles[number])=>x>=t.minX&&x<=t.maxX&&y>=t.minY&&y<=t.maxY;const candidates=index.query(x,y);checks+=candidates.length;expect(candidates.filter(hit)).toEqual(triangles.filter(hit));}
 expect(checks).toBeLessThan(2000*triangles.length/20);
});

it('indexed depth and multiple-patch attenuation equal brute force for every opacity',()=>{
 const triangles=Array.from({length:300},(_,i)=>{const x=i%20*3,y=Math.floor(i/20)*3,z=i%4;return {patch:String(i%30),pts:[[x,y,z],[x+5,y,z+.1],[x,y+5,z-.1]],minX:x,maxX:x+5,minY:y,maxY:y+5};});const index=screenIndex(triangles);
 for(let i=0;i<1000;i++){const x=i*1.731%65,y=i*.781%50,z=i*.39%5;const brute=frontLayers(triangles,x,y,z),indexed=frontLayers(index.query(x,y),x,y,z);for(const opacity of [0,.3,.7,.9,1])expect(Math.pow(1-opacity,indexed)).toBe(Math.pow(1-opacity,brute));}
});
it('persistent Smooth worker rejects stale results and queues only latest surface',async()=>{
 vi.useFakeTimers();const requests:any[]=[];let instance:any;
 class WorkerMock{onmessage:any;onerror:any;constructor(){instance=this;}postMessage(p:any){requests.push(p);}terminate(){}}
 vi.stubGlobal('Worker',WorkerMock);
 const {ensureSmooth}=await import('../domain/smooth/service'),{getSmoothResult}=await import('../domain/smooth/evaluation');
 const {p:source}=fixture(),p={...source,surfaceSmooth:{enabled:true,strength:1,edgeInfluenceOverrides:{}}},q={...p,patches:p.patches!.map(x=>x.canonicalId?x:{...x,fullness:.27})};
 ensureSmooth(p);vi.advanceTimersByTime(60);expect(requests).toHaveLength(1);const worker=instance;ensureSmooth(q);vi.advanceTimersByTime(60);expect(requests).toHaveLength(1);
 const result={fields:{},diagnostics:{before:0,after:0,maxDisplacement:0,averageDisplacement:0,iterations:0,relativeResidual:0,variables:0,seamSamples:0,warnings:[]}};
 worker.onmessage({data:result});expect(getSmoothResult(p)).toBeUndefined();expect(requests).toHaveLength(2);expect(instance).toBe(worker);worker.onmessage({data:result});expect(getSmoothResult(q)).toEqual(result);ensureSmooth({...q,surfaceSmooth:{...q.surfaceSmooth,enabled:false}});vi.unstubAllGlobals();vi.useRealTimers();
});
