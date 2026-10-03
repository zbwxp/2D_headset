import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {applyCurveSplitIntent,createCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {deleteCurves} from '../../domain/drawing/commands';
const cid=(id:string)=>canonicalElementId('$working',id);
const at=(w:RecordingSnapshotWorkspace,x:number,useDraft=false)=>evaluateRecordingSnapshot(w,'recording',{angle:{x,y:0},useDraft,diagnostics:'preview'});
function fixture(kind:'open'|'closed'|'route'='open',reverse=false,nonAnchor=false){
 const d:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:kind==='closed'?[.5,1]:[1.4,1]}],curves:[{id:'first',name:'First',nodes:['a','b'],handles:[[.3,.2],[.7,-.15]],visible:true,locked:false,width:.01},{id:'second',name:'Second',nodes:['b','c'],handles:[[1.1,.2],[1.3,.7]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',items:['first','second'],visible:true,locked:false}],displayIntervals:[{id:'material',anchor:{id:'first',reverse},ranges:[{id:'gap',mode:'HIDE',start:0,end:0,inkEnds:[{taper:.04},{taper:.06}]}]}]};
 if(kind==='closed'){d.curves.push({id:'third',name:'Third',nodes:['c','a'],handles:[[.2,.9],[-.2,.3]],visible:true,locked:false,width:.01});d.layers[0].items.push('third');}
 if(kind==='route'){d.nodes.push({id:'bb',position:[1,0]});d.curves[1].nodes[0]='bb';d.layers=[{id:'layer',name:'Layer',items:['first'],visible:true,locked:false},{id:'other',name:'Other',items:['second'],visible:true,locked:false}];d.endpointLinks=[{id:'arc-link',a:{curveId:'first',end:1},b:{curveId:'second',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.12}}];d.displayIntervals![0].displayRoute={seed:{segments:[{id:'first',reverse:false}],closed:false},throughLinkIds:['arc-link']};d.displayIntervals![0].anchor.reverse=false;}
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing:d}),w=project.recordingSnapshots,source=drawingSnapshotForArtwork(w,'$working')!,front=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});front.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));side.layers=structuredClone(front.layers);w.snapshots.push(front,side);
 const appearance=structuredClone(resolveSnapshot(w,front.id).source.displayIntervals![0]);appearance.ranges[0].end=.8;side.deformation.layers[cid('layer')]={shape:{nodes:{[cid('a')]:[.1,.2],[cid('b')]:[.3,.1]},handles:{[cid('first')]:[[.1,.15],[.1,-.1]]}},intervals:{[cid('material')]:{appearance,enabled:{}}}};if(kind==='route')side.deformation.layers[cid('other')]={shape:{nodes:{[cid('bb')]:[.3,.1],[cid('c')]:[-.1,.2]},handles:{[cid('second')]:[[.1,.1],[-.1,.05]]}}};
 const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['front','side'];r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph([front,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));r.angleGraph.propertyResponses={edges:{[r.angleGraph.mesh.edges[0].id]:[{target:{kind:'interval-endpoint',layerId:cid('layer'),sourceTrackId:cid('material'),rangeId:cid('gap'),end:'end'},knots:[[1/3,0]]}]},triangles:{}};w.recordings=[r];w.activeRecordingId=r.id;
 let next=0;const intent=createCurveSplitIntent(d,nonAnchor?'second':'first',.4,{allocateId:()=>`path-split-${++next}`});return {project,w,d,intent,canonical:mapCurveSplitIntent(intent,cid)};
}
const commit=(f:ReturnType<typeof fixture>)=>prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.d,f.intent).document,intent:f.intent}).project;
const expectSplit=(before:DrawingDocument,after:DrawingDocument,intent:ReturnType<typeof fixture>['canonical'])=>{const expected=applyCurveSplitIntent(before,intent,{propagate:true}).document;for(const track of expected.displayIntervals??[]){const actual=after.displayIntervals!.find(value=>value.id===track.id)!;expect(actual).toBeDefined();for(const range of track.ranges)for(const end of ['start','end'] as const)expect(actual.ranges.find(value=>value.id===range.id)![end]).toBeCloseTo(range[end],9);}};

describe('unscoped and explicit-route property fields retain their logical path measurement',()=>{
 it.each([['open',false,false],['open',true,false],['open',false,true],['closed',false,false],['closed',true,false],['route',false,false],['route',false,true]] as const)('preserves %s reverse=%s nonAnchor=%s through split and JSON', (kind,reverse,nonAnchor)=>{
  const f=fixture(kind,reverse,nonAnchor),angles=[0,1,15,29.99,30,31,45,60,75,89,90],before=angles.map(x=>at(f.w,x).drawing),original=JSON.stringify(f.w),fields=structuredClone(f.w.recordings[0].angleGraph!.propertyResponses),after=commit(f).recordingSnapshots!,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(after)));
  expect(JSON.stringify(f.w)).toBe(original);expect(loaded.recordings[0].angleGraph!.propertyResponses).toEqual(fields);expect(loaded.recordings[0].angleGraph!.materialPathLineages).toHaveLength(1);expect(loaded.recordings[0].angleGraph!.mesh).toEqual(f.w.recordings[0].angleGraph!.mesh);
  for(let i=0;i<angles.length;i++)expectSplit(before[i],at(loaded,angles[i]).drawing,f.canonical);
  for(const x of [0,15,30]){const range=at(loaded,x).drawing.displayIntervals![0].ranges[0];expect(range.start).toBe(range.end);}
 });
 it.each([false,true])('preserves insertion recipes when insertBefore=%s and allows later path endpoint correction',insertBefore=>{
  const f=fixture('open');if(insertBefore)applySnapshotCommand(f.w,{op:'createSnapshot',angle:{x:60,y:0}});const angles=[15,30,45,60,75],before=angles.map(x=>at(f.w,x).drawing),after=commit(f).recordingSnapshots!;if(!insertBefore)applySnapshotCommand(after,{op:'createSnapshot',angle:{x:60,y:0}});
  for(let i=0;i<angles.length;i++)expectSplit(before[i],at(after,angles[i]).drawing,f.canonical);
  applySnapshotCommand(after,{op:'setAngle',angle:{x:45,y:0}});const geometry=at(after,45).drawing;applySnapshotCommand(after,{op:'changeInterval',layerId:cid('layer'),sourceTrackId:cid('material'),rangeId:cid('gap'),end:.63});applySnapshotCommand(after,{op:'updateEndpointCorrection'});const edited=at(after,45).drawing;expect(edited.displayIntervals![0].ranges[0].end).toBeCloseTo(.63,11);expect(edited.nodes).toEqual(geometry.nodes);expect(edited.curves).toEqual(geometry.curves);
 });
 it('retains real numeric edits, source changes, deletion archive and current IDs without storing old geometry',()=>{
  const f=fixture('open'),project=commit(f),w=project.recordingSnapshots!;applySnapshotCommand(w,{op:'setAngle',angle:{x:90,y:0}});applySnapshotCommand(w,{op:'changeInterval',layerId:cid('layer'),sourceTrackId:cid('material'),rangeId:cid('gap'),end:.7});applySnapshotCommand(w,{op:'saveSelected',layerIds:[cid('layer')]});expect(at(w,90).drawing.displayIntervals![0].ranges[0].end).toBeCloseTo(.7,10);
  const changed=structuredClone(project.drawing!);changed.curves.find(curve=>curve.id===f.intent.childCurveIds[0])!.handles[0][1]+=.15;const next=upsertDrawingSource(w,'$working',changed);expect(at(next,45).drawing.curves).not.toEqual(at(w,45).drawing.curves);expect(JSON.stringify(next.recordings[0].angleGraph!.materialPathLineages)).not.toMatch(/"handles"|"nodes"|"drawing"|"position"/);
  const deleted=upsertDrawingSource(next,'$working',deleteCurves(changed,[f.intent.childCurveIds[1]])),graph=deleted.recordings[0].angleGraph!;expect(graph.materialPathLineages).toEqual([]);expect(graph.orphanedResponses!.at(-1)!.materialPathLineages).toHaveLength(1);expect(()=>parseRecordingSnapshots(JSON.parse(JSON.stringify(deleted)))).not.toThrow();
 });
 it('keeps legacy closed full-span 0/1 as full instead of collapsing modulo one',()=>{
  const f=fixture('closed');for(const snapshot of f.w.snapshots){for(const track of snapshot.relations.displayIntervals?.add??[])track.ranges[0]={...track.ranges[0],mode:'SHOW',start:0,end:1};for(const layer of Object.values(snapshot.deformation.layers))for(const value of Object.values(layer.intervals??{}))if(value.appearance)value.appearance.ranges[0]={...value.appearance.ranges[0],mode:'SHOW',start:0,end:1};}f.d.displayIntervals![0].ranges[0]={...f.d.displayIntervals![0].ranges[0],mode:'SHOW',start:0,end:1};delete f.w.recordings[0].angleGraph!.propertyResponses;
  const after=commit(f).recordingSnapshots!;applySnapshotCommand(after,{op:'createSnapshot',angle:{x:60,y:0}});for(const x of [0,15,30,45,60,75,90])expect(at(after,x).drawing.displayIntervals![0].ranges[0]).toMatchObject({start:0,end:1});
 });
 it.each(['open','route'] as const)('retains the current %s measurement when an independently edited child is split again',kind=>{
  const f=fixture(kind),first=commit(f),changed=structuredClone(first.drawing!);changed.curves.find(curve=>curve.id===f.intent.childCurveIds[0])!.handles[0][1]+=.23;
  const project={...first,drawing:changed,recordingSnapshots:upsertDrawingSource(first.recordingSnapshots!,'$working',changed)},angles=[0,15,30,45,60,75,90],before=angles.map(x=>at(project.recordingSnapshots,x).drawing);let next=0;
  const intent=createCurveSplitIntent(changed,f.intent.childCurveIds[0],.6,{allocateId:()=>`edited-path-${++next}`}),canonical=mapCurveSplitIntent(intent,cid),after=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(changed,intent).document,intent}).project.recordingSnapshots!;
  for(let i=0;i<angles.length;i++)expectSplit(before[i],at(after,angles[i]).drawing,canonical);
 });
});
