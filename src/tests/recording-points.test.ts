import {test,expect} from 'vitest';
import {createRecordedPoint,createSemanticCurve,editRecordedPoint,evaluatePoint,deleteRecordedPoint,displayPoint,reorderRecordedPoint} from '../domain/recording/points';
import {emptyRecording,parseRecording,displayShape} from '../domain/recording/model';
import {evaluateRecording,bindEndpoints} from '../domain/recording/junctions';
import {editShape,editEndpoint,duplicate,mirrorEdit,createRecorded,updateCurve,reorderRecordedCurve} from '../domain/recording/commands';
import {smoothGeometry,setSmoothMode} from '../domain/recording/smooth';
import {recordingPointSnapTargets,recordingSnapTargets} from '../domain/recording/snapping';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
const front={yaw:0,pitch:0},side={yaw:30,pitch:0};
function setup(){
 let r=emptyRecording();
 for(const [id,x,y] of [['a',-.5,.5],['b',0,-.5],['c',.5,.5]] as const){
  r=createRecordedPoint(r,front,id,id,[x,y]);r=editRecordedPoint(r,id,side,[x+.1,y+.2]);
 }
 r=createSemanticCurve(r,front,'ab','AB','a','b');
 r=createSemanticCurve(r,front,'bc','BC','b','c');
 return r;
}
test('point field mirrors and interpolates independently, with frozen references outside coverage',()=>{
 const r=setup(),p=r.points![0],before=JSON.stringify(r);
 expect(evaluatePoint(p,{yaw:15,pitch:0}).position).toEqual([-.45,.6]);
 expect(evaluatePoint(p,{yaw:15,pitch:0}).status).toBe('interpolation');
 expect(evaluatePoint(p,{yaw:60,pitch:0}).status).toBe('frozen');
 const view={yaw:-15,pitch:0},next=editRecordedPoint(r,'a',view,[.2,.4]),e=evaluatePoint(next.points![0],view);
 expect(e.position).toEqual([-.2,.4]);expect(displayPoint(e.position,view)).toEqual([.2,.4]);
 expect(next.points![0].keys).toHaveLength(3);expect(next.curves).toBe(r.curves);
 expect(JSON.stringify(r)).toBe(before);
});
test('moving a shared point moves every attached endpoint/adjacent handle without curve keys',()=>{
 const r=setup(),view={yaw:15,pitch:0},before=evaluateRecording(r,view);
 const next=editRecordedPoint(r,'b',view,[.2,-.8]),after=evaluateRecording(next,view);
 expect(next.curves).toBe(r.curves);
 for(const [id,end,h] of [['ab',3,2],['bc',0,1]] as const){
  expect(after.get(id)!.shape[end]).toEqual([.2,-.8]);
  for(const d of [0,1])expect(after.get(id)!.shape[h][d]-after.get(id)!.shape[end][d]).toBeCloseTo(before.get(id)!.shape[h][d]-before.get(id)!.shape[end][d],12);
 }
 expect(editEndpoint(r,'ab',3,view,[.2,-.8])).toEqual(next);
 expect(editEndpoint(r,'bc',0,view,[.2,-.8])).toEqual(next);
});
test('handle Auto-Key inverse-translates and mirrors while leaving point keys and endpoints untouched',()=>{
 const r=setup(),view={yaw:-15,pitch:0},prior=displayShape(evaluateRecording(r,view).get('ab')!.shape,view);
 const next=editShape(r,'ab',view,s=>{s[1][0]+=.3;s[1][1]-=.1;return s;});
 const after=displayShape(evaluateRecording(next,view).get('ab')!.shape,view);
 expect(next.points).toBe(r.points);expect(next.curves[0].keys).toHaveLength(2);
 expect(after[0]).toEqual(prior[0]);expect(after[3]).toEqual(prior[3]);
 expect(after[1][0]-prior[1][0]).toBeCloseTo(.3,12);expect(after[1][1]-prior[1][1]).toBeCloseTo(-.1,12);
 // The new handle vector follows later edits of the shared point without drift.
 const moved=editRecordedPoint(next,'a',view,[.8,.9]);
 const final=displayShape(evaluateRecording(moved,view).get('ab')!.shape,view);
 for(const d of [0,1])expect(final[1][d]-final[0][d]).toBeCloseTo(after[1][d]-after[0][d],12);
});
test('marker hiding does not hide/move connected geometry; locking a point permits handle edits only',()=>{
 const r=setup(),point=r.points![1];
 const hidden={...r,points:r.points!.map(p=>p===point?{...p,visible:false,locked:true}:p)};
 expect(evaluateRecording(hidden,front)).toEqual(evaluateRecording(r,front));
 expect(editRecordedPoint(hidden,'b',front,[1,1])).toBe(hidden);
 expect(editEndpoint(hidden,'ab',3,front,[1,1])).toBe(hidden);
 expect(editShape(hidden,'ab',front,s=>{s[2][0]+=.1;return s;})).not.toBe(hidden);
});
test('curve coverage remains independent and missing point coverage freezes derived geometry',()=>{
 const r=setup();expect(evaluateRecording(r,side).get('ab')!.status).toBe('frozen');
 const keyed=editShape(r,'ab',side,s=>{s[1][0]+=.1;return s;});
 expect(evaluateRecording(keyed,side).get('ab')!.status).toBe('key');
 const short={...keyed,points:keyed.points!.map(p=>p.id==='a'?{...p,keys:[p.keys[0]]}:p)};
 expect(evaluateRecording(short,side).get('ab')!.status).toBe('frozen');
});
test('semantic duplicate preserves point references; Mirror edits handles without taking endpoint ownership',()=>{
 const r=setup(),copy=duplicate(r,'ab',front,'copy',[.1,.1]);
 expect(copy.curves[2].semantic).toEqual(r.curves[0].semantic);
 expect(evaluateRecording(copy,front).get('copy')!.shape).toEqual(evaluateRecording(r,front).get('ab')!.shape);
 const mirrored=mirrorEdit(r,'bc','ab',front),e=evaluateRecording(mirrored,front).get('ab')!;
 expect(mirrored.points).toBe(r.points);expect(e.shape[0]).toEqual(r.points![0].keys[0].position);expect(e.shape[3]).toEqual(r.points![1].keys[0].position);
});
test('point Mirror reads interpolation, keys only the target and updates every attached curve in both yaw directions',()=>{
 for(const yaw of [15,-15]){
  const view={yaw,pitch:0},r=setup(),source=r.points![0];
  const before=JSON.stringify(r),displayed=displayPoint(evaluatePoint(source,view).position,view);
  const next=mirrorEdit(r,'a','b',view),p=next.points![1],position=displayPoint(evaluatePoint(p,view).position,view);
  expect(position).toEqual([-displayed[0],displayed[1]]);
  expect(p.keys).toHaveLength(3);expect(p.keys.at(-1)!.yaw).toBe(15);
  expect(next.points![0]).toBe(source);expect(next.points![2]).toBe(r.points![2]);expect(next.curves).toBe(r.curves);
  const geometry=evaluateRecording(next,view);
  expect(geometry.get('ab')!.shape[3]).toEqual(evaluatePoint(p,view).position);
  expect(geometry.get('bc')!.shape[0]).toEqual(evaluatePoint(p,view).position);
  expect(JSON.stringify(r)).toBe(before);expect(parseRecording(next)).toEqual(next);
 }
});
test('point Mirror keys matching frozen targets, honors locks/type and rejects frozen or identical sources',()=>{
 let r=createRecordedPoint(emptyRecording(),front,'source','Source',[-.4,.5]);
 r=createRecordedPoint(r,side,'target','Target',[.4,.5]);
 expect(evaluatePoint(r.points![1],front).status).toBe('frozen');
 const next=mirrorEdit(r,'source','target',front);
 expect(next.points![1].keys).toHaveLength(2);
 expect(evaluatePoint(next.points![1],front).status).toBe('key');
 expect(mirrorEdit(next,'source','target',front)).toBe(next);
 expect(mirrorEdit(r,'source','target',side)).toBe(r);
 expect(mirrorEdit(r,'source','source',front)).toBe(r);
 const locked={...r,points:r.points!.map(p=>p.id==='target'?{...p,locked:true}:p)};
 expect(mirrorEdit(locked,'source','target',front)).toBe(locked);
 const lockedSource={...r,points:r.points!.map(p=>p.id==='source'?{...p,locked:true}:p)};
 expect(mirrorEdit(lockedSource,'source','target',front).points![1].keys).toHaveLength(2);
 const mixed=createRecorded(r,front,'free','Free');
 expect(mirrorEdit(mixed,'source','free',front)).toBe(mixed);
 expect(mirrorEdit(mixed,'free','source',front)).toBe(mixed);
});
test('shared-point Smooth works; conflicting Bind rejects instead of overriding a semantic endpoint',()=>{
 let r=setup();r=bindEndpoints(r,{id:'ab',end:3},{id:'bc',end:0},front,'j');
 expect(r.junctions).toHaveLength(1);
 r=setSmoothMode(r,'j',front,true);expect(smoothGeometry(r,front).transitions).toHaveLength(1);
 let other=createRecorded(setup(),front,'free','Free');
 expect(bindEndpoints(other,{id:'free',end:3},{id:'ab',end:0},front,'bad')).toBe(other);
 other=bindEndpoints(other,{id:'ab',end:3},{id:'free',end:0},front,'ok');
 const moved=editEndpoint(other,'free',0,front,[.1,-.8]);
 expect(moved.curves).toBe(other.curves);
 expect(evaluateRecording(moved,front).get('free')!.shape[0]).toEqual([.1,-.8]);
});
test('point deletion is guarded and save/load validates point references and legacy projects',()=>{
 const r=setup();expect(deleteRecordedPoint(r,'b')).toBe(r);
 const solo=createRecordedPoint(r,front,'solo','Standalone',[.1,.2]);
 expect(deleteRecordedPoint(solo,'solo').points).toHaveLength(3);
 const p=createLandmarkProject();expect(parseLandmarks(JSON.stringify({...p,recording:r})).recording).toEqual(r);
 expect(parseRecording({version:1,curves:[]})).toEqual(emptyRecording());
 for(const bad of [
  {...r,points:[{...r.points![0],keys:[]}]},
  {...r,points:[...r.points!,r.points![0]]},
  {...r,points:r.points!.map(p=>p.id==='a'?{...p,keys:[{...front,position:[NaN,0]}]}:p)},
  updateCurve(r,'ab',c=>({...c,semantic:{startPointId:'missing',endPointId:'b'}})),
 ])expect(()=>parseRecording(bad)).toThrow();
});
test('point snapping excludes every curve it drives, retaining independent targets',()=>{
 const r=createRecorded(setup(),front,'free','Free');
 expect(recordingPointSnapTargets(r,front,'b').map(t=>t.id)).toEqual(['free']);
 expect(recordingSnapTargets(r,front,{id:'ab',end:3}).map(t=>t.id)).toEqual(['free']);
});
test('point reorder changes only saved list order, including locked/hidden points, without changing geometry',()=>{
 const base=setup(),r={...base,points:base.points!.map(p=>p.id==='b'?{...p,locked:true,visible:false}:p)};
 const next=reorderRecordedPoint(r,'b','c',true);
 expect(next.points!.map(p=>p.id)).toEqual(['a','c','b']);expect(next.curves).toBe(r.curves);
 expect(next.points![2]).toBe(r.points![1]);expect(evaluateRecording(next,side)).toEqual(evaluateRecording(r,side));
 expect(parseRecording(next)).toEqual(next);
 expect(reorderRecordedPoint(next,'b','a',false).points!.map(p=>p.id)).toEqual(['b','a','c']);
 expect(reorderRecordedPoint(r,'b','a',true)).toBe(r);
 expect(reorderRecordedPoint(r,'b','b',true)).toBe(r);
 expect(reorderRecordedPoint(r,'missing','a',false)).toBe(r);
 expect(reorderRecordedPoint(r,'a','missing',false)).toBe(r);
});
test('curve reorder supports semantic, ordinary and guide rows without changing point ownership or junctions',()=>{
 let r=bindEndpoints(setup(),{id:'ab',end:3},{id:'bc',end:0},front,'j');
 r=createRecorded(r,front,'guide','Guide',undefined,true);r=createRecorded(r,front,'free','Free');
 const next=reorderRecordedCurve(r,'ab','guide',true);
 expect(next.curves.map(c=>c.id)).toEqual(['bc','guide','ab','free']);expect(next.points).toBe(r.points);expect(next.junctions).toBe(r.junctions);
 expect(next.curves[2]).toBe(r.curves[0]);expect(evaluateRecording(next,front)).toEqual(evaluateRecording(r,front));
 expect(parseRecording(next)).toEqual(next);
 expect(reorderRecordedCurve(next,'free','bc',false).curves.map(c=>c.id)).toEqual(['free','bc','guide','ab']);
 expect(reorderRecordedCurve(r,'ab','bc',false)).toBe(r);
 expect(reorderRecordedCurve(r,'ab','ab',true)).toBe(r);
 expect(reorderRecordedCurve(r,'missing','ab',false)).toBe(r);
});
