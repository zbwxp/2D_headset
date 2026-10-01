import {expect,test,vi} from 'vitest';
import fixture from './fixtures/inference-three-poses.json';
import {inferPoseCurves,resolvePoseInferences,applyPoseInference,discardPoseInference,layerTrend,deletePose,upgradeAppliedInferenceInk} from '../domain/recording/poseInference';
import {parsePoseRecording,syncPoseSnapshots} from '../domain/recording/poses';
import {evaluatePoses,poseCoverage} from '../domain/recording/poseEvaluation';
import {parseDrawing,curveById,shapeOf,nodeAt,emptyDrawing,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {displayField,displayPath,addDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokeInk} from '../domain/drawing/appearance';
import {resolvedCurveInkEnds} from '../domain/recording/poseInkEnds';
import {subcurve} from '../domain/drawing/roundedJoin';
import {strokeFor} from '../domain/drawing/strokes';
import {addLayer,createCurve,ellipse,splitCurve} from '../domain/drawing/commands';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {serializeProject} from '../app/autosave';
const extra=['20b69467-8d1a-4d2b-a139-268a80dc5405','7ee706ca-8959-4079-bc6b-161714a977e7'];
const source=()=>parsePoseRecording(fixture);
function inferred(from:0|1=0){let r=source();for(const id of extra)r=inferPoseCurves(r,id,r.poses[2].id,[r.poses[0].id,r.poses[1].id],from);return r;}
const field=(d:Doc,id:string)=>displayField(d,displayPath(d,id));
const coverage=(d:Doc,id:string)=>{const f=field(d,id),track={id:'test',scope:'CURVE' as const,anchor:{id,reverse:false},ranges:[]},bounds=[f.native(track,0),f.native(track,1)].sort((a,b)=>a-b),size=bounds[1]-bounds[0];return (f.mask??[[0,1]]).reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,bounds[1])-Math.max(a,bounds[0])),0)/size;};

test('actual two new curves infer into 0/10 degrees without changing source data, authored geometry, layer ordering or IDs',()=>{
 const raw=source(),saved=JSON.stringify(raw),r=inferred(),resolved=resolvePoseInferences(r);
 expect(r.inferences).toHaveLength(4);expect(resolvePoseInferences(r)).toBe(resolved);
 for(const p of resolved.poses.slice(0,2)){
  expect(()=>parseDrawing(p.drawing)).not.toThrow();const before=raw.poses.find(s=>s.id===p.id)!.drawing;
  for(const c of before.curves)expect(shapeOf(p.drawing,c.id)).toEqual(shapeOf(before,c.id));
  for(const l of before.layers)expect(p.drawing.layers.find(x=>x.id===l.id)!.items.filter(id=>!extra.includes(id))).toEqual(l.items);
  for(const id of extra)expect(coverage(p.drawing,id)).toBeCloseTo(0,8);
  const c=curveById(p.drawing,extra[1]),neighbor=curveById(p.drawing,'84b654f8-f033-4ed8-8075-724e7d48d718');expect(c.nodes[0]).toBe(neighbor.nodes[0]);
 }
 expect(resolved.poses[2]).toBe(r.poses[2]);expect(JSON.stringify(raw)).toBe(saved);
 for(const id of extra)expect(poseCoverage(r,id)!.points).toHaveLength(3);
});
test('curve-local full gaps reveal monotonically from the chosen physical end and never hide neighboring strands',()=>{
 for(const from of [0,1] as const){const r=inferred(from);let previous=[0,0];
  for(const yaw of [0,5,10,10.1,11,12,14.9,15.1,17,19,19.99,20]){
   const e=evaluatePoses(r,{yaw,pitch:0});
   extra.forEach((id,i)=>{const v=coverage(e.drawing,id);expect(v).toBeGreaterThanOrEqual(previous[i]-1e-7);previous[i]=v;expect(e.status.get(id)).not.toBe('frozen');
    const f=field(e.drawing,id),track=e.drawing.displayIntervals?.find(t=>t.anchor.id===id&&t.scope==='CURVE');
    if(yaw>10&&yaw<20){expect(track).toBeDefined();const q=f.native(track!,from===0?.001:.999);expect(f.mask!.some(([a,b])=>q>=a&&q<=b)).toBe(true);expect(track!.ranges[0].inkEnds![0].taper).toBeCloseTo(resolvedCurveInkEnds(r.poses[2].drawing,id)[1].taper!);}
    expect(strokeInk(e.drawing,strokeFor(e.drawing,id)).every(run=>run.outline.every(p=>p.every(Number.isFinite)))).toBe(true);
   });
   for(const id of ['dfe61aac-f7b3-4c78-b834-3e8e899ac584','84b654f8-f033-4ed8-8075-724e7d48d718'])if(yaw>=10)expect(coverage(e.drawing,id)).toBeCloseTo(1,7);
  }
  expect(previous).toEqual([1,1]);
 }
});
test('inferring only the 10-degree target keeps every curve owned before interval evaluation across all yaw regions',()=>{
 let r=source();
 for(const id of extra)r=inferPoseCurves(r,id,r.poses[2].id,[r.poses[1].id],0);
 const saved=JSON.stringify(r);
 for(const yaw of [-1,0,.1,2,4.99,5,5.01,9.99,10,10.01,14.99,15.01,19.99,20,21]){
  const e=evaluatePoses(r,{yaw,pitch:0});
  for(const c of e.drawing.curves){
   expect(e.drawing.layers.filter(l=>l.items.includes(c.id))).toHaveLength(1);
   expect(displayPath(e.drawing,c.id)).toBeDefined();
  }
  for(const id of extra){
   expect(e.status.get(id)).toBe(yaw<10||yaw>20?'frozen':yaw===10||yaw===20?'key':'interpolation');
   const runs=strokeInk(e.drawing,strokeFor(e.drawing,id));
   expect(runs.every(run=>run.outline.every(p=>p.every(Number.isFinite)))).toBe(true);
   if(yaw===10)expect(coverage(e.drawing,id)).toBeCloseTo(0,8);
   if(yaw===20)expect(coverage(e.drawing,id)).toBeCloseTo(1,8);
  }
 }
 expect(JSON.stringify(r)).toBe(saved);
});
test('affine trend transforms all control points, falls back on collinear data, and ignores recording placement',()=>{
 let a=addLayer(emptyDrawing(),'Layer');a=createCurve(a,a.layers[0].id,[[0,0],[.2,.6],[.6,.4],[1,0]],.01,'Guide','guide');
 const transform=([x,y]:Point2):Point2=>[.7*x+.2*y+3,-.3*x+1.2*y-2];
 const b=structuredClone(a);b.nodes.forEach(n=>n.position=transform(n.position));b.curves[0].handles=b.curves[0].handles.map(transform) as [Point2,Point2];
 const fit=layerTrend(a,b,a.layers[0].id);for(const q of [[0,0],[2,1],[-1,3]] as Point2[])fit.map(q).forEach((v,i)=>expect(v).toBeCloseTo(transform(q)[i],8));
 const c=structuredClone(a);c.curves[0].handles=[[.3,0],[.7,0]];expect(layerTrend(c,c,c.layers[0].id).map([3,2])).toEqual([3,2]);
 const raw=source(),moved=structuredClone(raw);moved.poses.forEach((p,i)=>p.offset=[i*5,-i*3]);
 const run=(r:typeof raw)=>inferPoseCurves(r,extra[0],r.poses[2].id,[r.poses[1].id],0).inferences![0].shape;
 expect(run(moved)).toEqual(run(raw));
});
test('drafts survive save/load and snapshot sync; Apply patches only the target snapshot and active draft, with atomic Undo',async()=>{
 const r=inferred(),items=r.poses.map(p=>({id:p.sourceSnapshotId,name:p.name,drawing:p.drawing})),library={version:1 as const,activeId:items[1].id,items,images:[]};
 const project={...createLandmarkProject(),drawing:structuredClone(items[1].drawing),drawingSnapshots:library,poseRecording:r};
 const item=r.inferences!.find(i=>i.curve.id===extra[1]&&i.targetPoseId===r.poses[1].id)!;
 const synced=syncPoseSnapshots(r,{...library,items:items.map(s=>({...s,drawing:structuredClone(s.drawing)}))});expect(synced.inferences).toEqual(r.inferences);expect(curveById(resolvePoseInferences(synced).poses[1].drawing,extra[1])).toBeDefined();
 expect(parseLandmarks(serializeProject(project)).poseRecording?.inferences).toEqual(r.inferences);
 project.drawing.curves[0].name='Unsaved name';
 const applied=applyPoseInference(project,item.id);expect(applied.drawing.curves[0].name).toBe('Unsaved name');expect(applied.drawingSnapshots.items[0]).toBe(items[0]);expect(applied.drawingSnapshots.items[2]).toBe(items[2]);
 expect(curveById(applied.drawingSnapshots.items[1].drawing,extra[1])).toBeDefined();expect(applied.poseRecording.inferences).toHaveLength(3);expect(coverage(applied.drawing,extra[1])).toBeCloseTo(0);
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{const {useEditor}=await import('../app/store'),s=()=>useEditor.getState();s().load(project);const initial=s().project;s().beginEdit();s().setDrawingSnapshotState(applied);s().setPoseRecording(applied.poseRecording);s().endEdit();const final=s().project;
  s().undo();expect(s().project).toBe(initial);s().redo();expect(s().project).toBe(final);expect(parseLandmarks(serializeProject(final)).poseRecording!.inferences).toHaveLength(3);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
 expect(discardPoseInference(r,item.id).inferences).toHaveLength(3);expect(deletePose(r,r.poses[2].id).inferences).toHaveLength(0);
});
test('curve scopes are unordered, survive closed paths, and ordinary Add Interval still creates a whole-stroke track',()=>{
 const base=addLayer(emptyDrawing(),'Loop'),e=ellipse(base,base.layers[0].id,[-1,-1],[1,1],.01),d=e.document,id=e.ids[0];
 d.displayIntervals=[{id:'scope',scope:'CURVE',anchor:{id,reverse:false},ranges:[{id:'gap',mode:'HIDE',start:1,end:0}]}];
 expect(coverage(d,id)).toBeCloseTo(0);for(const other of e.ids.slice(1))expect(coverage(d,other)).toBeCloseTo(1);
 const n=addDisplayInterval(d,id,'HIDE');expect(n.displayIntervals).toHaveLength(2);expect(n.displayIntervals![1].scope).toBeUndefined();
 expect(parseDrawing(d)).toEqual(d);
});


test('curve-local masks survive precise split with forward/reverse anchors, SHOW/HIDE, and boundary ink',()=>{
 for(const mode of ['SHOW','HIDE'] as const)for(const reverse of [false,true])for(const range of [[0,1],[.2,.8],[0,.1]] as const){
  let d=addLayer(emptyDrawing(),'Layer');d=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.01,'Line','line');
  d.displayIntervals=[{id:'local',scope:'CURVE',anchor:{id:'line',reverse},ranges:[{id:'range',mode,start:range[0],end:range[1],inkEnds:[{taper:.03},{taper:.04}]}]}];
  const before=field(d,'line'),after=splitCurve(d,'line',.4).document,result=field(after,'line');
  expect(()=>parseDrawing(after)).not.toThrow();expect(result.inkSpans).toHaveLength(before.inkSpans!.length);
  result.inkSpans!.forEach((span,i)=>{expect(span.start).toBeCloseTo(before.inkSpans![i].start,10);expect(span.end).toBeCloseTo(before.inkSpans![i].end,10);expect(span.ends).toEqual(before.inkSpans![i].ends);});
 }
});

test('joining an inferred segment preserves the neighboring stroke display mask',()=>{
 let r=source();const target=r.poses[1],neighbor='84b654f8-f033-4ed8-8075-724e7d48d718';
 target.drawing=addDisplayInterval(target.drawing,neighbor,'HIDE');
 const path=displayPath(target.drawing,neighbor),before=new Map(path.segments.map(s=>[s.id,coverage(target.drawing,s.id)]));
 r=inferPoseCurves(r,extra[1],r.poses[2].id,[target.id],0);const d=resolvePoseInferences(r).poses[1].drawing;
 expect(()=>parseDrawing(d)).not.toThrow();for(const [id,value] of before)expect(coverage(d,id)).toBeCloseTo(value,8);
 expect(coverage(d,extra[1])).toBeCloseTo(0,8);
});

test('pitch targets participate in coverage and failed multi-target inference is atomic',()=>{
 const r=source(),pitched={...structuredClone(r.poses[1]),id:'pitched',sourceSnapshotId:'pitched-snapshot',pitch:15};r.poses.push(pitched);
 const before=JSON.stringify(r);expect(()=>inferPoseCurves(r,extra[0],r.poses[2].id,[pitched.id,r.poses[2].id])).toThrow('已有该曲线');expect(JSON.stringify(r)).toBe(before);
 const n=inferPoseCurves(r,extra[0],r.poses[2].id,[r.poses[1].id,pitched.id],1);
 expect(poseCoverage(n,extra[0])!.points).toHaveLength(3);
 const e=evaluatePoses(n,{yaw:15,pitch:5});expect(e.status.get(extra[0])).toBe('interpolation');expect(coverage(e.drawing,extra[0])).toBeGreaterThan(0);expect(coverage(e.drawing,extra[0])).toBeLessThan(1);
 expect(parsePoseRecording(JSON.parse(JSON.stringify(n))).inferences).toEqual(n.inferences);
});


test('inferred interval ink inherits physical source A/B, zero tips and short-line fitting rather than 20x defaults',()=>{
 const r=inferred(),ends=extra.map(id=>resolvedCurveInkEnds(r.poses[2].drawing,id));
 expect(ends[0][0].taper).toBeLessThan(.16);expect(ends[1]).toEqual([{taper:0,extension:0},{taper:0,extension:0}]);
 const d=resolvePoseInferences(r).poses[1].drawing;
 extra.forEach((id,i)=>{
  expect(curveById(d,id).inkEnds).toEqual(curveById(r.poses[2].drawing,id).inkEnds);
  const track=d.displayIntervals!.find(t=>t.id===`inferred-ink:${id}`)!;expect(track.inferenceInkVersion).toBe(1);expect(track.ranges[0].inkEnds).toEqual([ends[i][1],ends[i][0]]);
 });
});

function asymmetricInference(from:0|1){
 let target=addLayer(emptyDrawing(),'Layer');const layer=target.layers[0].id;
 target=createCurve(target,layer,[[2,1],[2.4,1.2],[2.8,1.4],[3,1]],.02,'Guide','guide');
 const source=createCurve(target,layer,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'New','new');
 curveById(source,'new').inkEnds=[{taper:.1,extension:.04},{taper:.3,extension:.06}];
 return inferPoseCurves({version:1,poses:[{id:'a',sourceSnapshotId:'a',name:'a',yaw:0,pitch:0,offset:[0,0],drawing:target},{id:'b',sourceSnapshotId:'b',name:'b',yaw:10,pitch:0,offset:[0,0],drawing:source}]},'new','b',['a'],from);
}
const outlineArea=(ps:Point2[])=>Math.abs(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
test('the moving reveal end replaces the original taper once, with asymmetric ink and extension in both directions',()=>{
 for(const from of [0,1] as const){const r=asymmetricInference(from),raw=r.poses[1].drawing;
  const source=shapeOf(raw,'new'),styles=resolvedCurveInkEnds(raw,'new');
  for(const yaw of [2,5,8,9.99]){
   const progress=yaw/10,visible=subcurve(source,from===0?0:1-progress,from===0?progress:1),result=evaluatePoses(r,{yaw,pitch:0}).drawing;
   let expected=addLayer(emptyDrawing(),'Expected');expected=createCurve(expected,expected.layers[0].id,visible,.02,'Expected','expected');curveById(expected,'expected').inkEnds=styles;
   const actual=strokeInk(result,strokeFor(result,'new')),want=strokeInk(expected,strokeFor(expected,'expected'));
   const points=actual.flatMap(r=>r.outline),expectedPoints=want.flatMap(r=>r.outline);
   expect(Math.min(...points.map(p=>p[0]))).toBeCloseTo(Math.min(...expectedPoints.map(p=>p[0])),8);
   expect(Math.max(...points.map(p=>p[0]))).toBeCloseTo(Math.max(...expectedPoints.map(p=>p[0])),8);
   expect(actual.reduce((n,r)=>n+outlineArea(r.outline),0)).toBeCloseTo(want.reduce((n,r)=>n+outlineArea(r.outline),0),5);
  }
  expect(evaluatePoses(r,{yaw:10,pitch:0}).drawing.curves.find(c=>c.id==='new')!.inkEnds).toEqual(curveById(raw,'new').inkEnds);
 }
});

test('legacy drafts and already-applied generated defaults upgrade, preserving manual interval edits and geometry',()=>{
 const fresh=inferred(),legacy=structuredClone(fresh);legacy.inferences!.forEach(i=>delete i.sourceInkEnds);
 const loaded=parsePoseRecording(legacy);expect(loaded.inferences).toEqual(fresh.inferences);expect(resolvePoseInferences(legacy).poses).toEqual(resolvePoseInferences(fresh).poses);
 const poses=resolvePoseInferences(fresh).poses.map(p=>structuredClone(p));
 for(const p of poses.slice(0,2))for(const t of p.drawing.displayIntervals??[])if(t.id.startsWith('inferred-ink:')){delete t.inferenceInkVersion;t.ranges[0].inkEnds=[{taperWidthScale:20},{taperWidthScale:20}];}
 const edited=poses[0].drawing.displayIntervals!.find(t=>t.anchor.id===extra[0])!;edited.ranges[0].start=.25;edited.ranges[0].inkEnds=[{taper:.021},{taperWidthScale:4}];
 const library={version:1 as const,activeId:poses[1].sourceSnapshotId,items:poses.map(p=>({id:p.sourceSnapshotId,name:p.name,drawing:p.drawing})),images:[]};
 const state={...createLandmarkProject(),poseRecording:{...fresh,poses,inferences:[]},drawing:poses[1].drawing,drawingSnapshots:library};
 const saved=JSON.stringify(state),up=upgradeAppliedInferenceInk(state);expect(JSON.stringify(state)).toBe(saved);
 const track=up.drawing.displayIntervals!.find(t=>t.anchor.id===extra[1])!;expect(track.ranges[0].inkEnds).toEqual([{taper:0,extension:0},{taper:0,extension:0}]);
 expect(up.drawingSnapshots.items[0].drawing.displayIntervals!.find(t=>t.id===edited.id)!.ranges).toEqual(edited.ranges);
 for(const c of state.drawing.curves)expect(shapeOf(up.drawing,c.id)).toEqual(shapeOf(state.drawing,c.id));
 expect(upgradeAppliedInferenceInk(up)).toEqual(up);expect(parseLandmarks(serializeProject(state)).drawing).toEqual(up.drawing);
 const changed=structuredClone(up);track.ranges[0].inkEnds=[{taperWidthScale:20},{taperWidthScale:20}];expect(upgradeAppliedInferenceInk(up).drawing).toEqual(up.drawing);expect(changed.drawing.curves).toEqual(up.drawing.curves);
});
