import {describe,it,expect} from 'vitest';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {validateRecordingSnapshots} from '../../domain/recordingSnapshot/validation';
import {snapshotAuthoredKeyCount} from '../../domain/recordingSnapshot/tracks';
import {createWarpGrid} from '../../domain/vectorWarp/model';
import {drawingSignature} from '../../domain/vectorRecording/model';
import {materializeOriginalSnapshot} from '../../domain/recordingSnapshot/sources';
import {identityScenePlacement} from '../../domain/recordingScene/model';

function fixture():RecordingSnapshotWorkspace {
 const w=emptyRecordingSnapshotWorkspace(),source=emptyRecordingSnapshot('source','Source','drawing'),view=emptyRecordingSnapshot('view','View');
 w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 w.library.curves={c:{id:'c',name:'Curve',nodes:['a','b'],handles:[[1/3,0],[2/3,0]],visible:true,locked:false,width:.01}};
 source.layers=[{kind:'original',id:'original-layer',name:'Layer',visible:true,locked:false,items:['c']}];view.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:'source',baseLayerId:'original-layer'}];
 const r=emptySnapshotRecording('recording');r.snapshotIds=['view'];r.activeSnapshotId='view';w.snapshots=[source,view];w.recordings=[r];w.activeRecordingId=r.id;return w;
}
const tx=(x:number)=>({...identityScenePlacement(),translation:[x,0] as [number,number]});

describe('native recording snapshot ownership',()=>{
 it('keeps canonical IDs and follows source edits with existing direct offsets',()=>{
  const w=fixture(),view=w.snapshots[1];view.deformation.layers.layer={shape:{nodes:{a:[0,.2]},handles:{}}};
  expect(resolveSnapshot(w,'view').drawing.nodes.find(n=>n.id==='a')!.position).toEqual([0,.2]);
  w.library.nodes.a.position=[.4,.1];const result=resolveSnapshot(w,'view');
  expect(result.drawing.curves[0].id).toBe('c');expect(result.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(.4);expect(result.drawing.nodes.find(n=>n.id==='a')!.position[1]).toBeCloseTo(.3);expect(w.library.nodes.a.position).toEqual([.4,.1]);
 });
 it('new live members have zero direct offsets and follow an existing layer domain',()=>{
  const w=fixture();w.snapshots[1].deformation.layers.layer={placement:tx(2),shape:{nodes:{a:[0,.2]},handles:{}}};const restGrid=createWarpGrid({min:[-1,-1],max:[2,2]},1,1),grid=structuredClone(restGrid);for(const node of grid.nodes)for(const field of ['position','handleU','handleV'] as const){node[field][0]+=.2;node[field][1]+=.3;}w.snapshots[1].deformation.warps=[{id:'warp',name:'Warp',restGrid,grid}];w.snapshots[1].deformation.bindings=[{layerId:'layer',warpId:'warp'}];
  w.library.nodes.d={id:'d',position:[0,1]};w.library.nodes.e={id:'e',position:[1,1]};w.library.curves.f={...structuredClone(w.library.curves.c),id:'f',nodes:['d','e'],handles:[[1/3,1],[2/3,1]]};
  const layer=w.snapshots[0].layers[0];if(layer.kind==='original')layer.items.push('f');
  const result=resolveSnapshot(w,'view');expect(result.drawing.curves.map(c=>c.id)).toEqual(['c','f']);expect(result.drawing.nodes.find(n=>n.id==='d')!.position[0]).toBeCloseTo(2.2);expect(result.drawing.nodes.find(n=>n.id==='d')!.position[1]).toBeCloseTo(1.3);
 });
 it('inherited fallback is not an authored key',()=>{
  const w=fixture(),r=w.recordings[0];r.tracks=[{id:'placement',channel:'placement',targetId:'layer',keys:[{id:'k',angle:{x:90,y:0},value:tx(3)}]}];
  const result=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}),created=structuredClone(w.snapshots[1]);created.id='next';created.angle={x:45,y:0};created.inheritedState=result.state;created.authored=[];w.snapshots.push(created);r.snapshotIds.push(created.id);
  expect(snapshotAuthoredKeyCount(r)).toBe(1);expect(resolveSnapshot(w,'next').drawing.nodes[0].position[0]).toBeCloseTo(1.5);expect(snapshotAuthoredKeyCount(r)).toBe(1);
 });
 it('evaluates a parent at its saved angle and never applies one track twice',()=>{
  const w=fixture(),r=w.recordings[0];w.snapshots[1].angle={x:45,y:0};r.tracks=[{id:'placement',channel:'placement',targetId:'layer',keys:[{id:'k',angle:{x:90,y:0},value:tx(2)}]}];
  const child=emptyRecordingSnapshot('child');child.angle={x:90,y:0};child.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:'view',baseLayerId:'layer'}];w.snapshots.push(child);r.snapshotIds.push(child.id);
  expect(resolveSnapshot(w,'child').drawing.nodes[0].position[0]).toBeCloseTo(1);
 });
 it('selects exact or nearest structural state independently of active history',()=>{
  const w=fixture(),r=w.recordings[0],empty=emptyRecordingSnapshot('empty');empty.angle={x:90,y:0};w.snapshots.push(empty);r.snapshotIds.push(empty.id);
  r.activeSnapshotId='empty';expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:0,y:0}}).drawing.curves).toHaveLength(1);
  r.activeSnapshotId='view';expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:90,y:0}}).drawing.curves).toHaveLength(0);
  expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).snapshotId).toBe('view');
 });
 it('rejects parent cycles and ambiguous duplicate canonical branches',()=>{
  const w=fixture();w.snapshots[1].layers.push({kind:'reference',id:'second',name:'Second',baseSnapshotId:'source',baseLayerId:'original-layer'});
  expect(()=>resolveSnapshot(w,'view')).toThrow(/more than one layer branch/);
  w.snapshots[1].layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:'view',baseLayerId:'layer'}];expect(()=>validateRecordingSnapshots(w)).toThrow(/cycle/);
 });
 it('resolves element depth offsets in original source sibling context',()=>{
  const w=fixture(),source=w.snapshots[0],view=w.snapshots[1];
  w.library.nodes.d={id:'d',position:[0,1]};w.library.nodes.e={id:'e',position:[1,1]};w.library.curves.f={...structuredClone(w.library.curves.c),id:'f',nodes:['d','e'],handles:[[1/3,1],[2/3,1]],depthOffset:100,depthScope:'LAYER'};
  source.layers.push({kind:'original',id:'back',name:'Back',visible:true,locked:false,items:['f']});view.layers.push({kind:'reference',id:'back-slot',name:'Back',baseSnapshotId:'source',baseLayerId:'back'});
  const other=emptyRecordingSnapshot('other','Other','drawing');w.library.nodes.h={id:'h',position:[0,2]};w.library.nodes.i={id:'i',position:[1,2]};w.library.curves.g={...structuredClone(w.library.curves.c),id:'g',nodes:['h','i'],handles:[[1/3,2],[2/3,2]]};other.layers=[{kind:'original',id:'other-layer',name:'Other',visible:true,locked:false,items:['g']}];w.snapshots.push(other);view.layers.unshift({kind:'reference',id:'other-slot',name:'Other',baseSnapshotId:'other',baseLayerId:'other-layer'});
  const result=resolveSnapshot(w,'view');expect(result.paintBatches.map(batch=>batch.owner??batch.item.id)).toEqual(['g','f','c']);
 });
 it('inherits relationships until an explicit disable, and rejects near-duplicate keys',()=>{
  const w=fixture(),r=w.recordings[0];w.snapshots[0].relations.groups={add:[{id:'group',name:'Group',visible:true,locked:false,curveIds:['c']}]};
  expect(resolveSnapshot(w,'view').drawing.groups?.map(g=>g.id)).toEqual(['group']);w.snapshots[1].relations.groups={update:[]};expect(resolveSnapshot(w,'view').drawing.groups?.map(g=>g.id)).toEqual(['group']);w.snapshots[1].relations.groups={disable:['group']};expect(resolveSnapshot(w,'view').drawing.groups).toEqual([]);
  r.tracks=[{id:'p',channel:'placement',targetId:'layer',keys:[{id:'a',angle:{x:0,y:0},value:tx(0)},{id:'b',angle:{x:1e-6,y:0},value:tx(1)}]}];expect(()=>validateRecordingSnapshots(w)).toThrow(/duplicate key angle/);
 });
 it('suspends only a failed interval channel and reconnects its exact source baseline',()=>{
  const w=fixture(),source=w.snapshots[0],recording=w.recordings[0],interval={id:'interval',anchor:{id:'c',reverse:false},ranges:[{id:'range',start:.1,end:.9}]};source.relations.displayIntervals={add:[interval]};
  const signature=drawingSignature(materializeOriginalSnapshot(w,source.id)!);recording.tracks=[{id:'material',channel:'interval',targetId:'layer',sourceTrackId:'interval',materialIssue:{sourceSnapshotId:source.id,sourceSignature:signature,message:'Material migration is suspended.'},keys:[{id:'key',angle:{x:90,y:0},value:{appearance:{...interval,ranges:[{id:'range',start:.2,end:.8}]},enabled:{}}}]}];
  let result=evaluateRecordingSnapshot(w,recording.id,{angle:{x:90,y:0}});expect(result.drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.2);
  w.library.nodes.a.position=[.1,0];result=evaluateRecordingSnapshot(w,recording.id,{angle:{x:90,y:0}});expect(result.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBe(.1);expect(result.drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.1);expect(result.diagnostics.some(d=>d.code==='SOURCE_MATERIAL')).toBe(true);expect(recording.tracks[0].keys).toHaveLength(1);
  w.library.nodes.a.position=[0,0];result=evaluateRecordingSnapshot(w,recording.id,{angle:{x:90,y:0}});expect(result.drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.2);expect(result.diagnostics.some(d=>d.code==='SOURCE_MATERIAL')).toBe(false);
  recording.tracks=[];w.snapshots[1].relations.displayIntervals={update:[{...interval,ranges:[{id:'range',start:.3,end:.7}]}]};w.snapshots[1].deformation.intervalMaterialIssues={interval:{sourceSnapshotId:source.id,sourceSignature:signature,message:'Static patch migration suspended.'}};w.library.nodes.a.position=[.1,0];result=evaluateRecordingSnapshot(w,recording.id,{angle:{x:90,y:0}});expect(result.drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.1);w.library.nodes.a.position=[0,0];expect(evaluateRecordingSnapshot(w,recording.id,{angle:{x:90,y:0}}).drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.3);
 });
 it('reuses immutable frames while invalidating live originals, authored keys, and current drafts',()=>{
  const w=fixture(),r=w.recordings[0];r.tracks=[{id:'placement',channel:'placement',targetId:'layer',keys:[{id:'key',angle:{x:90,y:0},value:tx(1)}]}];const options={angle:{x:90,y:0},useDraft:false,immutableInputs:true};
  const first=evaluateRecordingSnapshot(w,r.id,options);expect(evaluateRecordingSnapshot(w,r.id,options)).toBe(first);
  const changed={...w,library:{...w.library,nodes:{...w.library.nodes,a:{...w.library.nodes.a,position:[.2,0] as [number,number]}}}};expect(evaluateRecordingSnapshot(changed,r.id,options).drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(1.2);
  const draft={...w,recordings:[{...r,tracks:r.tracks.map(track=>({...track,draft:{angle:{x:90,y:0},value:tx(3)}}))}]} as RecordingSnapshotWorkspace;expect(evaluateRecordingSnapshot(draft,r.id,options).drawing).toBe(first.drawing);expect(evaluateRecordingSnapshot(draft,r.id,{...options,useDraft:true}).drawing.nodes[0].position[0]).toBe(3);
  const keyed={...w,recordings:[{...r,tracks:r.tracks.map(track=>({...track,keys:[{id:'key',angle:{x:90,y:0},value:tx(2)}]}))}]} as RecordingSnapshotWorkspace;expect(evaluateRecordingSnapshot(keyed,r.id,options).drawing.nodes[0].position[0]).toBe(2);
 });
 it('keeps exact zero domain scale and restores from original geometry',()=>{
  const w=fixture();w.snapshots[1].deformation.layers.layer={placement:{...tx(2),scaleX:0}};let result=resolveSnapshot(w,'view');expect(result.drawing.nodes.map(n=>n.position[0])).toEqual([2,2]);
  w.snapshots[1].deformation.layers.layer.placement!.scaleX=1;result=resolveSnapshot(w,'view');expect(result.drawing.nodes.map(n=>n.position[0])).toEqual([2,3]);
 });
});
