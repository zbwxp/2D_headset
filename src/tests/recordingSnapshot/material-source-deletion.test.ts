import {describe,expect,it} from 'vitest';
import {deleteCurves,deleteLayer} from '../../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {pruneSnapshotMaterialPropertyReferences} from '../../domain/recordingSnapshot/materialSourceDeletion';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';

function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),
  nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:[0,1]},{id:'d',position:[1,1]}],
  curves:[{id:'gone',name:'Gone',nodes:['a','b'],handles:[[.3,0],[.7,0]],width:.01,visible:true,locked:false},{id:'live',name:'Live',nodes:['c','d'],handles:[[.3,1],[.7,1]],width:.01,visible:true,locked:false}],
  layers:['gone','live'].map(id=>({id:`${id}-layer`,name:id,items:[id],visible:true,locked:false})),
  displayIntervals:['gone','live'].map(id=>({id:`${id}-interval`,anchor:{id,reverse:false},scope:'CURVE',ranges:[{id:`${id}-range`,start:.1,end:.8}]})),
 };
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'audit',drawing),source=w.snapshots[0],id=(raw:string)=>canonicalElementId('audit',raw);
 const views=['A','B'].map((sid,index)=>{const snapshot=emptyRecordingSnapshot(sid,sid,'view',{x:index*90,y:0});snapshot.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));return snapshot;});w.snapshots.push(...views);
 const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['A','B'];r.activeSnapshotId='A';r.angleGraph=createSnapshotAngleGraph(views.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.recordings=[r];w.activeRecordingId=r.id;
 const fields=['gone','live'].map(raw=>({target:{kind:'interval-endpoint' as const,layerId:id(`${raw}-layer`),sourceTrackId:id(`${raw}-interval`),rangeId:id(`${raw}-range`),end:'end' as const},knots:[[.5,.3] as [number,number]]}));
 r.angleGraph.propertyResponses={edges:{[r.angleGraph.mesh.edges[0].id]:fields},triangles:{}};
 applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0}});
 // Keep a native copy too: retained and native fields must share deletion rules.
 r.angleGraph!.propertyResponses={edges:{[r.angleGraph!.mesh.edges[0].id]:structuredClone(fields)},triangles:{}};
 return {w,drawing,id};
}
const properties=(graph:SnapshotAngleGraph)=>[...Object.values(graph.materialRecipes??{}),...Object.values(graph.materialBasisRecipes??{})].flatMap(recipe=>recipe.terms.flatMap(term=>term.field.properties));

describe('retained material source deletion',()=>{
 it('keeps geometric supports and unrelated fields by identity while pruning both recipe registries',()=>{
  const {w,id}=fixture(),graph=w.recordings[0].angleGraph!,before=JSON.stringify(graph),next=pruneSnapshotMaterialPropertyReferences(graph,target=>target.rangeId!==id('gone-range'));
  expect(pruneSnapshotMaterialPropertyReferences(graph,()=>true)).toBe(graph);
  for(const key of ['materialRecipes','materialBasisRecipes'] as const)for(const [simplex,recipe] of Object.entries(graph[key]!)){
   const kept=next[key]![simplex];expect(kept.terms).toHaveLength(recipe.terms.length);
   for(const [index,term] of recipe.terms.entries()){
    expect(kept.terms[index].bases).toBe(term.bases);expect(kept.terms[index].weight).toBe(term.weight);
    expect(kept.terms[index].field.vertexIds).toBe(term.field.vertexIds);expect(kept.terms[index].field.angles).toBe(term.field.angles);
    const live=term.field.properties.find(property=>property.target.rangeId===id('live-range'));if(live)expect(kept.terms[index].field.properties).toEqual([live]);
    if(!term.field.properties.length)expect(kept.terms[index]).toBe(term);
   }
  }
  expect(properties(next).every(property=>property.target.rangeId===id('live-range'))).toBe(true);expect(JSON.stringify(graph)).toBe(before);
 });

 it.each(['curve','layer','range'] as const)('cleans retained and native property targets on actual source %s deletion',kind=>{
  const {w,drawing,id}=fixture(),before=w.recordings[0].angleGraph!,kept=properties(before).filter(property=>property.target.rangeId===id('live-range'));
  const changed=kind==='curve'?deleteCurves(drawing,['gone']):kind==='layer'?deleteLayer(drawing,'gone-layer'):{...drawing,displayIntervals:drawing.displayIntervals!.map(track=>track.id==='gone-interval'?{...track,ranges:[]}:track)};
  const next=upsertDrawingSource(w,'audit',changed),graph=next.recordings[0].angleGraph!;
  expect(properties(graph)).toEqual(kept);expect(properties(graph).some(property=>property.target.rangeId===id('gone-range'))).toBe(false);
  expect(Object.values(graph.propertyResponses!.edges).flat().map(property=>property.target.rangeId)).toEqual([id('live-range')]);
  for(const key of ['materialRecipes','materialBasisRecipes'] as const)for(const [simplex,recipe] of Object.entries(before[key]!))for(const [index,term] of recipe.terms.entries()){
   const actual=graph[key]![simplex].terms[index];expect(actual.bases).toEqual(term.bases);expect(actual.field.vertexIds).toEqual(term.field.vertexIds);expect(actual.field.angles).toEqual(term.field.angles);
  }
  if(kind==='curve')expect(next.snapshots[0].layers.find(layer=>layer.id===id('gone-layer'))).toMatchObject({kind:'original',items:[]});
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(next)));expect(properties(loaded.recordings[0].angleGraph!)).toEqual(kept);
  for(const x of [0,45,60,90]){
   const drawing=evaluateRecordingSnapshot(loaded,'recording',{angle:{x,y:0},useDraft:false}).drawing;
   expect(drawing.displayIntervals?.flatMap(track=>track.ranges).some(range=>range.id===id('gone-range'))).toBe(false);
   expect(drawing.displayIntervals?.some(track=>track.id===id('live-interval'))).toBe(true);
  }
 });
});
