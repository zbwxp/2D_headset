import {expect,test,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {emptyPoseRecording,recordSnapshot,changePose,parsePoseRecording} from '../domain/recording/poses';
import {evaluatePoses,poseCoverage} from '../domain/recording/poseEvaluation';
import {blendInterval,blendPoseIntervals} from '../domain/recording/poseIntervals';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {serializeProject} from '../app/autosave';
import {fillGeometry,strokeInk} from '../domain/drawing/appearance';
import {strokes,strokePaths,strokeFor} from '../domain/drawing/strokes';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';

const view=(yaw:number,pitch=0)=>({yaw,pitch});
function fixture(){let d=addLayer(emptyDrawing(),'Face');return createCurve(d,d.layers[0].id,[[0,0],[.2,.3],[.7,.3],[1,0]],.01,'Chin','chin');}
function snap(d=fixture(),name='Front'){return saveDrawingSnapshot({drawing:d},name).drawingSnapshots!.items[0];}
test('pose capture is immutable; replacing the source retains angle/offset; duplicate views reject',()=>{
 const s=snap(),r=recordSnapshot(emptyPoseRecording(),s,view(0)),id=r.poses[0].id;
 s.drawing.nodes[0].position=[9,8];expect(r.poses[0].drawing.nodes[0].position).toEqual([0,0]);
 const moved=changePose(r,id,{offset:[.4,-.2]}),refreshed=recordSnapshot(moved,s,view(0),id);
 expect(refreshed.poses[0].offset).toEqual([.4,-.2]);expect(refreshed.poses[0].drawing.nodes[0].position).toEqual([9,8]);
 expect(()=>recordSnapshot(r,s,view(0))).toThrow();expect(()=>changePose(r,id,{yaw:200})).toThrow();
 expect(parsePoseRecording(JSON.parse(JSON.stringify(refreshed)))).toEqual(refreshed);
});
test('shared geometry and placement blend; a one-pose element stays frozen at its placed position',()=>{
 const a=snap(),b=structuredClone(a);b.id='side';b.name='Side';b.drawing.nodes=b.drawing.nodes.map(n=>({...n,position:[n.position[0]+.2,n.position[1]]}));
 b.drawing=createCurve(b.drawing,b.drawing.layers[0].id,[[.3,.7],[.4,.7],[.4,.5],[.4,.3]],.01,'Hair','hair');
 let r=recordSnapshot(recordSnapshot(emptyPoseRecording(),a,view(0)),b,view(30));r=changePose(r,r.poses[1].id,{offset:[.2,-.1]});
 const at=evaluatePoses(r,view(30)),half=evaluatePoses(r,view(15)),front=evaluatePoses(r,view(0));
 expect(half.status.get('chin')).toBe('interpolation');expect(shapeOf(half.drawing,'chin')[0]).toEqual([.2,-.05]);
 expect(half.status.get('hair')).toBe('frozen');expect(half.opacity.get('hair')).toBe(0);expect(at.opacity.get('hair')).toBe(1);
 expect(shapeOf(front.drawing,'hair')).toEqual(shapeOf(at.drawing,'hair'));expect(shapeOf(half.drawing,'hair')).toEqual(shapeOf(at.drawing,'hair'));
 expect(poseCoverage(r,'hair')!.points).toEqual([[30,0]]);
 expect(evaluatePoses(r,view(-15)).status.get('chin')).toBe('frozen');
 expect(evaluatePoses(r,view(15,1)).status.get('chin')).toBe('frozen');
});
test('signed yaw and pitch use two-dimensional coverage without mirroring authored geometry',()=>{
 const s=snap();let r=emptyPoseRecording();for(const v of [view(-30),view(30),view(0,30)])r=recordSnapshot(r,s,v);
 const e=evaluatePoses(r,view(-10,10));expect(e.status.get('chin')).toBe('interpolation');expect(shapeOf(e.drawing,'chin')[3][0]).toBeCloseTo(1);
 expect(evaluatePoses(r,view(0,40)).status.get('chin')).toBe('frozen');
});
test('visibility is sampled independently from geometry; no-ink stays no-ink',()=>{
 const a=snap(),b=structuredClone(a);b.drawing.curves[0].visible=false;
 const r=recordSnapshot(recordSnapshot(emptyPoseRecording(),a,view(0)),b,view(30));
 expect(evaluatePoses(r,view(15)).opacity.get('chin')).toBe(.5);expect(evaluatePoses(r,view(30)).opacity.get('chin')).toBe(0);
 a.drawing.curves[0].inkVisible=false;b.drawing.curves[0].inkVisible=false;
 const noInk=recordSnapshot(recordSnapshot(emptyPoseRecording(),a,view(0)),b,view(30));expect(evaluatePoses(noInk,view(15)).opacity.get('chin')).toBe(0);
});
test('closed intervals cross the seam by the short path; full and empty loops remain distinct',()=>{
 const range=(start:number,end:number)=>({id:'r',start,end});
 const r=blendInterval([{range:range(.04,.33),weight:.5,width:.01},{range:range(.96,.33),weight:.5,width:.01}],true);
 expect(Math.min(r.start,1-r.start)).toBeLessThan(1e-8);expect(r.end).toBeCloseTo(.33);
 expect(blendInterval([{range:range(0,1),weight:1,width:.01}],true)).toMatchObject({start:0,end:1});
 expect(blendInterval([{range:range(.5,.5),weight:1,width:.01}],true)).toMatchObject({start:.5,end:.5});
});
test('a new split track opens a central hidden gap rather than hiding the entire mouth',()=>{
 const a=fixture(),b=structuredClone(a);b.displayIntervals=[{id:'mouth',anchor:{id:'chin',reverse:false},ranges:[{id:'l',start:0,end:.3},{id:'r',start:.5,end:1}]}];
 const d={...a,displayIntervals:blendPoseIntervals(a,[{drawing:a,weight:.5},{drawing:b,weight:.5}])},field=displayField(d,displayPath(d,'chin')),mask=field.mask!;
 const [lo,hi]=[.35,.45].map(s=>field.native(d.displayIntervals[0],s)).sort((a,b)=>a-b);
 expect(mask).toHaveLength(2);expect(mask[0][1]).toBeCloseTo(lo);expect(mask[1][0]).toBeCloseTo(hi);
});
test('adding/removing ranges preserves existing IDs and grows only the added span',()=>{
 const a=fixture();a.displayIntervals=[{id:'track',anchor:{id:'chin',reverse:false},ranges:[{id:'kept',start:.1,end:.3}]}];
 const b=structuredClone(a);b.displayIntervals![0].ranges.push({id:'new',start:.6,end:.8});
 const middle=blendPoseIntervals(a,[{drawing:a,weight:.5},{drawing:b,weight:.5}])[0];
 expect(middle.ranges.find(r=>r.id==='kept')).toMatchObject({start:.1,end:.3});
 expect(middle.ranges.find(r=>r.id==='new')!.start).toBeCloseTo(.65);expect(middle.ranges.find(r=>r.id==='new')!.end).toBeCloseTo(.75);
 expect(blendPoseIntervals(a,[{drawing:b,weight:.5},{drawing:a,weight:.5}])[0].ranges).toEqual(middle.ranges);
});
test('save/load keeps new recordings, discards all legacy recording data, and validates new fields',()=>{
 const poseRecording=recordSnapshot(emptyPoseRecording(),snap(),view(0));
 const project={...createLandmarkProject(),poseRecording,recording:{bogus:'old data'}};
 expect(parseLandmarks(JSON.stringify(project)).recording).toBeUndefined();
 expect(parseLandmarks(JSON.stringify(project)).poseRecording).toEqual(poseRecording);
 expect(JSON.parse(serializeProject(project as any)).recording).toBeUndefined();
 const bad=structuredClone(poseRecording);bad.poses[0].offset=[Infinity,0];expect(()=>parsePoseRecording(bad)).toThrow();
 const dup=structuredClone(poseRecording);dup.poses.push({...dup.poses[0],id:'second'});expect(()=>parsePoseRecording(dup)).toThrow();
 const scaled={...poseRecording,referenceScale:1.7};
 expect(parseLandmarks(JSON.stringify({...project,poseRecording:scaled})).poseRecording).toEqual(scaled);
 expect(evaluatePoses(scaled,view(0)).drawing).toEqual(evaluatePoses(poseRecording,view(0)).drawing);
 for(const referenceScale of [0,-1,Infinity,5.1])expect(()=>parsePoseRecording({...poseRecording,referenceScale})).toThrow();
});
test('capture/placement/delete and Undo/Redo are complete atomic transactions',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{const {useEditor}=await import('../app/store');const s=()=>useEditor.getState();s().load(createLandmarkProject());
  const commit=(r:ReturnType<typeof emptyPoseRecording>)=>{s().beginEdit();s().setPoseRecording(r);s().endEdit();};
  const initial=s().project;commit(recordSnapshot(emptyPoseRecording(),snap(),view(0)));const captured=s().project;
  commit(changePose(captured.poseRecording!,captured.poseRecording!.poses[0].id,{offset:[.3,.2]}));const moved=s().project;
  s().undo();expect(s().project).toBe(captured);s().undo();expect(s().project).toBe(initial);s().redo();s().redo();expect(s().project).toBe(moved);
  s().beginEdit(true);for(const referenceScale of [1.2,1.4,1.8])s().setPoseRecording({...s().project.poseRecording!,referenceScale});s().endEdit();const resized=s().project;
  s().undo();expect(s().project).toBe(moved);s().redo();expect(s().project).toBe(resized);s().undo();
  commit(emptyPoseRecording());s().undo();expect(s().project).toBe(moved);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
// The user's complete face is a read-only local integration fixture, optional on CI.
const face='/Users/bowen/Desktop/基础脸模·正面·微侧.json';
test.skipIf(!existsSync(face))('full face poses keep fills/occlusion and the extra hair frozen across the interval',()=>{
 const p=JSON.parse(readFileSync(face,'utf8')),a=p.drawingSnapshots.items[0],b=p.drawingSnapshots.items[1];
 const r=recordSnapshot(recordSnapshot(emptyPoseRecording(),a,view(0)),b,view(15)),before=JSON.stringify(r);
 const newId=b.drawing.curves.find((c:any)=>!a.drawing.curves.some((x:any)=>x.id===c.id)).id;
 const at=evaluatePoses(r,view(15));
 for(const yaw of [0,3.75,7.5,11.25,15]){
  const e=evaluatePoses(r,view(yaw));expect(e.drawing.curves).toHaveLength(209);expect(e.drawing.fills).toHaveLength(25);
  expect(e.drawing.layers.map(l=>l.id)).toEqual(a.drawing.layers.map((l:any)=>l.id));
  expect(shapeOf(e.drawing,newId)).toEqual(shapeOf(at.drawing,newId));expect(e.status.get(newId)).toBe(yaw===15?'key':'frozen');
  for(const fill of e.drawing.fills)expect(fillGeometry(e.drawing,fill).error).toBeUndefined();
  for(const layer of e.drawing.layers)for(const stroke of strokes(e.drawing,layer.id))for(const path of strokePaths(stroke))expect(()=>strokeInk(e.drawing,{...path,id:stroke.id})).not.toThrow();
 }
 expect(JSON.stringify(r)).toBe(before);
});

test('recording follows saved snapshots atomically; drafts stay drafts, all references update, placement and custom names survive',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../app/store'),{commitDrawing,commitDrawingSnapshot}=await import('../ui/drawing/edit');
  const {deleteDrawingSnapshot,restoreDrawingSnapshot}=await import('../domain/drawing/snapshots');
  const s=()=>useEditor.getState(),state=saveDrawingSnapshot({drawing:fixture()},'Front'),source=state.drawingSnapshots!.items[0];
  let r=recordSnapshot(recordSnapshot(emptyPoseRecording(),source,view(0)),source,view(30));
  r=changePose(r,r.poses[1].id,{offset:[.3,-.4],name:'Custom',pitch:8});r.referenceScale=1.4;
  s().load({...createLandmarkProject(),...state,poseRecording:r});
  const initial=s().project,doc={...initial.drawing!,curves:initial.drawing!.curves.map(c=>({...c,inkVisible:false})),nodes:initial.drawing!.nodes.map(n=>({...n,position:[n.position[0]+.4,n.position[1]] as [number,number]}))};
  commitDrawing(doc);const draft=s().project;expect(draft.poseRecording).toBe(initial.poseRecording);
  const count=s().past.length;commitDrawingSnapshot(x=>saveDrawingSnapshot(x,'Front',source.id));const saved=s().project;
  expect(s().past).toHaveLength(count+1);expect(saved.poseRecording!.referenceScale).toBe(1.4);
  for(const p of saved.poseRecording!.poses){expect(p.drawing.nodes).toEqual(doc.nodes);expect(p.drawing.curves[0].inkVisible).toBe(false);}
  expect(saved.poseRecording!.poses[1]).toMatchObject({name:'Custom',yaw:30,pitch:8,offset:[.3,-.4]});
  expect(evaluatePoses(saved.poseRecording!,view(30,8)).opacity.get('chin')).toBe(0);
  s().undo();expect(s().project).toBe(draft);expect(s().project.poseRecording!.poses[0].drawing.curves[0].inkVisible).toBeUndefined();s().redo();expect(s().project).toBe(saved);
  const loaded=parseLandmarks(serializeProject(saved));expect(loaded.poseRecording!.poses[0].drawing).toEqual(loaded.drawingSnapshots!.items[0].drawing);
  commitDrawingSnapshot(x=>saveDrawingSnapshot(x,'Independent'));expect(s().project.poseRecording).toBe(saved.poseRecording);
  commitDrawingSnapshot(x=>restoreDrawingSnapshot(x,source.id));expect(s().project.poseRecording).toBe(saved.poseRecording);
  commitDrawingSnapshot(x=>deleteDrawingSnapshot(x,source.id));expect(s().project.poseRecording).toBe(saved.poseRecording);s().undo();expect(s().project.drawingSnapshots!.items.some(x=>x.id===source.id)).toBe(true);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});

test('load and save resolve stale pose copies from source snapshots, retaining orphaned poses',()=>{
 const state=saveDrawingSnapshot({drawing:fixture()},'Front'),source=state.drawingSnapshots!.items[0];
 const r=recordSnapshot(emptyPoseRecording(),source,view(0));r.poses[0].drawing.curves[0].inkVisible=false;
 const orphan=recordSnapshot(r,{...source,id:'deleted'},view(30));orphan.poses[1].drawing.curves[0].width=.08;
 const project={...createLandmarkProject(),...state,poseRecording:orphan};
 const loaded=parseLandmarks(JSON.stringify(project)),saved=JSON.parse(serializeProject(project));
 for(const p of [loaded,saved]){expect(p.poseRecording.poses[0].drawing).toEqual(source.drawing);expect(p.poseRecording.poses[1].drawing.curves[0].width).toBe(.08);}
 expect(project.poseRecording.poses[0].drawing.curves[0].inkVisible).toBe(false);
});

test('interval endpoints blend actual taper distances across width-scaled and px styles, including explicit zero',()=>{
 const a={id:'r',start:.2,end:.8,inkEnds:[{taperWidthScale:20,extension:.01},{taperWidthScale:10}] as any},b={...a,inkEnds:[{taper:0,extension:.03},{taper:.12}] as any};
 for(const t of [.000001,.25,.5,.999999]){
  const n=blendInterval([{range:a,width:.01,weight:1-t},{range:b,width:.02,weight:t}],false);
  expect(n.inkEnds![0].taper).toBeCloseTo(.2*(1-t),8);expect(n.inkEnds![1].taper).toBeCloseTo(.1*(1-t)+.12*t,8);expect(n.inkEnds![0].extension).toBeCloseTo(.01*(1-t)+.03*t,8);expect(n.inkEnds![0].taperWidthScale).toBeUndefined();
 }
 const scale=blendInterval([{range:a,width:.01,weight:.5},{range:a,width:.02,weight:.5}],false);expect(scale.inkEnds![0].taper).toBeCloseTo(.3);
});

test('evaluated interval tips retain taper and extension, including new ranges growing from zero',()=>{
 const a=fixture();a.displayIntervals=[{id:'t',anchor:{id:'chin',reverse:false},ranges:[{id:'r',start:.2,end:.8,inkEnds:[{taperWidthScale:20,extension:.02},{taperWidthScale:20}]}]}];
 const b=structuredClone(a);b.displayIntervals![0].ranges[0].inkEnds=[{taper:0,extension:.06},{taper:.1}];b.displayIntervals![0].ranges.push({id:'new',start:.88,end:.98,inkEnds:[{taper:.02},{taper:.02}]});
 const s=snap(a),other={...snap(b),id:'side'},r=recordSnapshot(recordSnapshot(emptyPoseRecording(),s,view(0)),other,view(30));
 const evaluated=evaluatePoses(r,view(15)).drawing,ranges=evaluated.displayIntervals![0].ranges;
 expect(ranges[0].inkEnds).toEqual([{taper:.1,extension:.04},{taper:.15000000000000002}]);
 expect(ranges[1].start).toBeCloseTo(.905);expect(ranges[1].end).toBeCloseTo(.955);expect(ranges[1].inkEnds).toEqual([{taper:.02},{taper:.02}]);
 const rendered=strokeInk(evaluated,{...strokePaths(strokes(evaluated,evaluated.layers[0].id)[0])[0],id:'test'});
 expect(rendered.every(r=>!r.uniform)).toBe(true);expect(rendered.flatMap(r=>r.extensions??[])).toHaveLength(1);
 const noTips={...evaluated,displayIntervals:evaluated.displayIntervals!.map(t=>({...t,ranges:t.ranges.map(r=>({...r,inkEnds:[{},{}] as any}))}))};
 expect(strokeInk(noTips,{...strokePaths(strokes(noTips,noTips.layers[0].id)[0])[0],id:'test'})).not.toEqual(rendered);
});

test('full-ink source preserves its real outer tips as a new interval is introduced',()=>{
 const a=fixture();a.curves[0].inkEnds=[{taperWidthScale:10,extension:.02},{taper:.06}];const b=structuredClone(a);
 b.displayIntervals=[{id:'t',anchor:{id:'chin',reverse:false},ranges:[{id:'r',start:.15,end:.85,inkEnds:[{taper:.03,extension:.04},{taper:.02}]}]}];
 const n=blendPoseIntervals(a,[{drawing:a,weight:.5},{drawing:b,weight:.5}])[0].ranges[0];
 expect(n.inkEnds).toEqual([{taper:.065,extension:.03},{taper:.04}]);
});

test('closed interval interpolation carries its two tips through the seam without tapering the seam or fill',()=>{
 const d=addLayer(emptyDrawing(),'Loop'),loop=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.025),a=loop.document,id=loop.ids[0];
 a.displayIntervals=[{id:'t',anchor:{id,reverse:false},ranges:[{id:'r',start:.83,end:.13,inkEnds:[{taperWidthScale:4},{taperWidthScale:6}]}]}];
 const b=structuredClone(a);b.displayIntervals![0].ranges[0]={id:'r',start:.93,end:.23,inkEnds:[{taper:.2},{taper:.25}]};
 const r=recordSnapshot(recordSnapshot(emptyPoseRecording(),snap(a),view(0)),snap(b),view(30)),e=evaluatePoses(r,view(15)).drawing;
 const range=e.displayIntervals![0].ranges[0];expect(range.start).toBeCloseTo(.88);expect(range.end).toBeCloseTo(.18);expect(range.inkEnds![0].taper).toBeCloseTo(.15);expect(range.inkEnds![1].taper).toBeCloseTo(.2);
 const runs=strokeInk(e,strokeFor(e,id));expect(runs).toHaveLength(1);expect(runs[0].uniform).toBe(false);
 const seam=displayField(e,displayPath(e,id)).at(0).p,near=runs[0].outline.filter(p=>Math.hypot(p[0]-seam[0],p[1]-seam[1])<.025);expect(near.length).toBeGreaterThan(0);for(const p of near)expect(Math.hypot(p[0]-seam[0],p[1]-seam[1])).toBeGreaterThan(.01);
 expect(r.poses[0].drawing.displayIntervals![0].ranges[0].inkEnds![0]).toEqual({taperWidthScale:4});
});
