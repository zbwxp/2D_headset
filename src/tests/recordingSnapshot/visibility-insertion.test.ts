import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {deleteCurves,deleteLayer} from '../../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {createSnapshotAngleGraph,validateSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';

function fixture(triangle=false){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:['one','two'].map(id=>({id,name:id,nodes:['a','b'],handles:[[.3,.2],[.7,.2]],width:.01,visible:true,locked:false})),fills:[{id:'fill',name:'Fill',visible:true,locked:false,color:'black',boundary:[{id:'one',reverse:false},{id:'two',reverse:true}]}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['one','two','fill']}],displayIntervals:[{id:'interval',anchor:{id:'one',reverse:false},scope:'CURVE',ranges:[{id:'range',start:.1,end:.6}]}]};
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'audit',drawing),source=w.snapshots[0],id=(raw:string)=>canonicalElementId('audit',raw);
 const views=['front','side',...triangle?['up']:[]].map((sid,index)=>{const s=emptyRecordingSnapshot(sid,sid,'view',{x:index===1?-90:0,y:index===2?90:0});s.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));if(index)s.deformation.layers[id('layer')]={placement:{translation:[index*.1,index*.2],rotation:0,scale:1},visibility:{[id('one')]:false,[id('fill')]:false}};return s;});w.snapshots.push(...views);
 const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=views.map(v=>v.id);r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph(views.map(s=>({snapshotId:s.id,angle:s.angle})));w.recordings=[r];w.activeRecordingId=r.id;
 return {w,r,drawing,id};
}
const evaluate=(w:RecordingSnapshotWorkspace,x:number,y=0,useDraft=false)=>evaluateRecordingSnapshot(w,'recording',{angle:{x,y},useDraft,diagnostics:'preview'});
const flags=(drawing:DrawingDocument)=>Object.fromEntries([...drawing.curves,...drawing.fills,...drawing.offsets].map(item=>[item.id,item.visible]));
const insert=(w:RecordingSnapshotWorkspace,x:number,y=0)=>applySnapshotCommand(w,{op:'createSnapshot',angle:{x,y}});
const angles=[0,-.001,-15,-29.999,-30,-30.001,-44.999,-45,-45.001,-59.999,-60,-60.001,-74.999,-75,-75.001,-90];
const edit=(w:RecordingSnapshotWorkspace,layerId:string,objectId:string|undefined,visible:boolean|null)=>{applySnapshotCommand(w,{op:'setVisibility',layerId,objectId,visible});applySnapshotCommand(w,{op:'saveSelected',layerIds:[layerId]});};
const compare=(a:DrawingDocument,b:DrawingDocument)=>{expect(flags(a)).toEqual(flags(b));expect(a.nodes.map(n=>n.id)).toEqual(b.nodes.map(n=>n.id));for(const n of a.nodes)for(const axis of [0,1])expect(n.position[axis]).toBeCloseTo(b.nodes.find(v=>v.id===n.id)!.position[axis],12);for(const c of a.curves)for(const end of [0,1])for(const axis of [0,1])expect(c.handles[end][axis]).toBeCloseTo(b.curves.find(v=>v.id===c.id)!.handles[end][axis],12);for(const t of a.displayIntervals??[])for(const r of t.ranges)for(const end of ['start','end'] as const)expect(r[end]).toBeCloseTo(b.displayIntervals!.find(v=>v.id===t.id)!.ranges.find(v=>v.id===r.id)![end],12);};

describe('original visibility supports survive true real-view insertion',()=>{
 it('preserves the original -45 switch, exact ties, geometry and material after -60, repeated insertion and JSON reload',()=>{
  const {w,id}=fixture(),before=angles.map(x=>evaluate(w,x).drawing),original=JSON.stringify(w.snapshots),library=JSON.stringify(w.library);
  expect(flags(before[angles.indexOf(-30)])[id('one')]).toBe(true);expect(flags(before[angles.indexOf(-45)])[id('one')]).toBe(false);
  insert(w,-60);insert(w,-15);const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));
  expect(JSON.stringify(w.snapshots.slice(0,3))).toBe(original);expect(JSON.stringify(w.library)).toBe(library);expect(w.recordings[0].tracks).toEqual([]);
  for(const snapshot of w.snapshots.slice(3))expect(Object.values(snapshot.deformation.layers).flatMap(layer=>Object.keys(layer.visibility??{}))).toEqual([]);
  for(const [index,x] of angles.entries())compare(evaluate(loaded,x).drawing,before[index]);
  expect(JSON.stringify(w.recordings[0].angleGraph!.visibilityRecipes)).not.toMatch(/"visible"|"drawing"|"nodes"|"handles"|"deformation"|"ranges"/);
 });
 it('overlays only the later explicit target on the original child selector and null resets to live inheritance',()=>{
  const {w,id}=fixture();insert(w,-60);const inherited=angles.map(x=>evaluate(w,x).drawing),owner=w.recordings[0].activeSnapshotId!;
  edit(w,id('layer'),id('one'),true);
  for(const [index,x] of angles.entries()){const d=evaluate(w,x).drawing;expect(flags(d)[id('fill')]).toBe(flags(inherited[index])[id('fill')]);expect(flags(d)[id('two')]).toBe(true);}
  expect(flags(evaluate(w,-45).drawing)[id('one')]).toBe(true);expect(flags(evaluate(w,-75).drawing)[id('one')]).toBe(false);
  const before=angles.map(x=>evaluate(w,x).drawing);insert(w,-30);for(const [index,x] of angles.entries())compare(evaluate(w,x).drawing,before[index]);
  applySnapshotCommand(w,{op:'selectSnapshot',snapshotId:owner});edit(w,id('layer'),id('one'),null);for(const [index,x] of angles.entries())compare(evaluate(w,x).drawing,inherited[index]);
  edit(w,id('layer'),id('one'),false);expect(flags(evaluate(w,-30).drawing)[id('one')]).toBe(false);expect(flags(evaluate(w,-29.999).drawing)[id('one')]).toBe(true);
 });
 it('keeps local layer false as a gate and local layer true from reviving hidden source members',()=>{
  const {w,id}=fixture();insert(w,-60);edit(w,id('layer'),undefined,true);expect(flags(evaluate(w,-60).drawing)).toEqual({[id('one')]:false,[id('two')]:true,[id('fill')]:false});
  edit(w,id('layer'),id('one'),true);edit(w,id('layer'),undefined,false);expect(Object.values(flags(evaluate(w,-60).drawing))).toEqual([false,false,false]);
  edit(w,id('layer'),undefined,null);expect(flags(evaluate(w,-60).drawing)).toEqual({[id('one')]:true,[id('two')]:true,[id('fill')]:false});
 });
 it('reads saved and active draft source flags live without importing inactive drafts',()=>{
  const {w,id}=fixture();insert(w,-60);const inserted=w.recordings[0].activeSnapshotId!;
  applySnapshotCommand(w,{op:'selectSnapshot',snapshotId:'side'});applySnapshotCommand(w,{op:'setVisibility',layerId:id('layer'),objectId:id('one'),visible:true});
  expect(flags(evaluate(w,-60,0,true).drawing)[id('one')]).toBe(true);expect(flags(evaluate(w,-45,0,true).drawing)[id('one')]).toBe(true);expect(flags(evaluate(w,-60).drawing)[id('one')]).toBe(false);
  expect(flags(resolveSnapshot(w,inserted,{useDraft:true}).drawing)[id('one')]).toBe(true);
  applySnapshotCommand(w,{op:'selectSnapshot',snapshotId:'front'});expect(flags(evaluate(w,-60,0,true).drawing)[id('one')]).toBe(false);
  applySnapshotCommand(w,{op:'selectSnapshot',snapshotId:'side'});applySnapshotCommand(w,{op:'saveSelected',layerIds:[id('layer')]});expect(flags(evaluate(w,-60).drawing)[id('one')]).toBe(true);
 });
 it('retains triangular selectors and pitch/yaw ties through repeated insertion',()=>{
  const {w}=fixture(true),points=[[-30,30],[-45,0],[0,45],[-20,20],[-15,60],[-60,15],[-10,5],[-5,10]],before=points.map(([x,y])=>evaluate(w,x,y).drawing);
  insert(w,-20,20);insert(w,-10,10);for(const [index,[x,y]] of points.entries())compare(evaluate(w,x,y).drawing,before[index]);
 });
 it.each(['curve','layer'] as const)('cleans actual source %s deletion and restores exactly from one immutable before-state',kind=>{
  const {w,drawing,id}=fixture();insert(w,-60);edit(w,id('layer'),id('one'),true);const project={...createEmptyProject(),recordingSnapshots:w},before=JSON.stringify(project);
  const next=upsertDrawingSource(w,'audit',kind==='curve'?deleteCurves(drawing,['one']):deleteLayer(drawing,'layer')),loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(next)));
  for(const x of angles){expect(evaluate(loaded,x).drawing.curves.some(c=>c.id===id('one'))).toBe(false);expect(evaluate(loaded,x).drawing.fills).toEqual([]);}
  expect(JSON.stringify(loaded.snapshots.map(snapshot=>snapshot.deformation))).not.toContain(`"${id('one')}"`);expect(JSON.stringify(project)).toBe(before);
  const undo=parseRecordingSnapshots(JSON.parse(before).recordingSnapshots);for(const x of angles)compare(evaluate(undo,x).drawing,evaluate(w,x).drawing);
 });
 it('prepares insertion atomically and rejects missing, cyclic or cached-value recipe payloads',()=>{
  const {w}=fixture(),project={...createEmptyProject(),recordingSnapshots:w},before=JSON.stringify(project),planned=prepareSnapshotBatch(project,{commands:[{op:'createSnapshot',angle:{x:-60,y:0}}]});expect(JSON.stringify(project)).toBe(before);expect(planned.recordingSnapshots.snapshots).toHaveLength(4);
  for(const mode of ['missing','cycle','cached']){const graph=structuredClone(planned.recordingSnapshots.recordings[0].angleGraph!),[owner,recipe]=Object.entries(graph.visibilityBasisRecipes!)[0];if(mode==='cached')Object.assign(recipe,{visible:false});else recipe.source.snapshotIds[0]=mode==='cycle'?owner:'missing';expect(()=>validateSnapshotAngleGraph(graph)).toThrow(/visibility/);}
 });
});
