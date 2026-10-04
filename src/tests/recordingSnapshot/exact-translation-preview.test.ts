import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {emptyWorkspaceView} from '../../app/workspaceView';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import {shapeOf,type Point2,type Cubic} from '../../domain/drawing/model';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {evaluatedAffineSource} from '../../domain/drawing/evaluatedAffine';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {composePlacementSimilarity} from '../../domain/recordingScene/tracks';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {canPreviewSnapshotTranslation,translationPreviewNeedsCanonicalSnapping} from '../../ui/vectorRecording/snapshotTranslationPreview';

function fixture(inheritedDomain=false){
 const workspace=emptyRecordingSnapshotWorkspace(),snapshot=emptyRecordingSnapshot('view','View'),recording=emptySnapshotRecording('recording');
 workspace.library.nodes={a:{id:'a',position:[-1,0]},b:{id:'b',position:[0,0]},c:{id:'c',position:[0,0]},d:{id:'d',position:[0,1]},e:{id:'e',position:[1,1]}};
 const style={visible:true,locked:false,width:.02};
 workspace.library.curves={first:{...style,id:'first',name:'First',nodes:['a','b'],handles:[[-.7,.1],[-.3,-.1]]},second:{...style,id:'second',name:'Second',nodes:['c','d'],handles:[[.1,.3],[-.1,.7]]},loop:{...style,id:'loop',name:'Loop',nodes:['e','e'],handles:[[1.5,1.5],[.5,1.5]]}};
 workspace.library.fills={fill:{id:'fill',name:'Fill',visible:true,locked:false,boundary:[{id:'loop',reverse:false}],color:'black'}};
 workspace.library.offsets={offset:{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'first',reverse:false}],distance:.1,start:0,end:1,taper:0,width:.03}};
 snapshot.layers=[{kind:'original',id:'left',name:'Left',visible:true,locked:false,items:['first','offset']},{kind:'original',id:'right',name:'Right',visible:true,locked:false,items:['second','loop','fill']}];
 snapshot.relations.endpointLinks={add:[{id:'link',a:{curveId:'first',end:1},b:{curveId:'second',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.12}}]};
 snapshot.relations.displayIntervals={add:[{id:'material',anchor:{id:'first',reverse:false},displayRoute:{seed:{segments:[{id:'first',reverse:false}],closed:false},throughLinkIds:['link']},ranges:[{id:'range',start:.15,end:.85}]}]};
 for(const layer of snapshot.layers)snapshot.deformation.layers[layer.id]={placement:{translation:[.2,-.1],rotation:23,scale:1,scaleX:1.3,scaleY:.7}};
 recording.mode='triangulated';recording.angleGraph=createSnapshotAngleGraph([{snapshotId:snapshot.id,angle:snapshot.angle}]);recording.snapshotIds=[snapshot.id];recording.activeSnapshotId=snapshot.id;workspace.snapshots=[snapshot];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 if(inheritedDomain){const source=structuredClone(snapshot);source.id='source';source.kind='drawing';source.deformation.layerDomains=[{id:'source-affine',kind:'affine',layerIds:source.layers.map(layer=>layer.id),matrix:[1.1,.1,.25,.8,.2,.15]}];snapshot.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));workspace.snapshots.unshift(source);}
 const evaluation=evaluateRecordingSnapshot(workspace,recording.id,{useDraft:true}),project={...createEmptyProject(),recordingSnapshots:workspace};
 return {workspace,snapshot,recording,evaluation,project,ids:snapshot.layers.map(layer=>layer.id)};
}
const close=(a:Point2,b:Point2)=>{expect(a[0]).toBeCloseTo(b[0],9);expect(a[1]).toBeCloseTo(b[1],9);};

describe('exact whole-snapshot translation capability',()=>{
 it('accepts all live layers with retained affine ARC material and leaves inputs untouched',()=>{
  const f=fixture(),before=JSON.stringify(f);expect(evaluatedAffineSource(f.evaluation.drawing)).toBeDefined();expect(canPreviewSnapshotTranslation(f.evaluation,f.snapshot,f.recording,f.ids,true,false)).toBe(true);expect(JSON.stringify(f)).toBe(before);
 });
 it.each(['partial','duplicate','foreign','correction','onion','locked curve','locked paint','locked layer','missing ownership','missing dependency','active domain','post shape','material recipe'])('falls back for %s',reason=>{
  const f=fixture();let basis=true,onion=false,ids=f.ids;
  if(reason==='partial')ids=ids.slice(0,1);
  if(reason==='duplicate')ids=[...ids,ids[0]];
  if(reason==='foreign')ids=['elsewhere',ids[1]];
  if(reason==='correction')basis=false;
  if(reason==='onion')onion=true;
  if(reason==='locked curve')f.evaluation.drawing.curves[0].locked=true;
  if(reason==='locked paint')f.evaluation.drawing.fills[0].locked=true;
  if(reason==='locked layer')f.evaluation.drawing.layers[0].locked=true;
  if(reason==='missing ownership')f.evaluation.drawing.layers[0].items=[];
  if(reason==='missing dependency')f.evaluation.drawing.endpointLinks![0].b.curveId='absent';
  if(reason==='active domain'||reason==='post shape')f.evaluation.state.layerDomains=[{id:'domain',kind:'affine',layerIds:f.ids,matrix:[1,0,0,1,0,0],...(reason==='post shape'?{postShape:{nodes:{a:[.1,0] as Point2},handles:{}}}:{})}];
  if(reason==='material recipe')f.recording.angleGraph={...f.recording.angleGraph!,materialBasisRecipes:{view:{kind:'test'} as never}};
  expect(canPreviewSnapshotTranslation(f.evaluation,f.snapshot,f.recording,ids,basis,onion)).toBe(false);
 });
 it('disabled final domains do not block translation and guide fallback matches the real snap early return',()=>{
  const f=fixture();f.evaluation.state.layerDomains=[{id:'disabled',kind:'affine',enabled:false,layerIds:f.ids,matrix:[2,0,0,2,0,0]}];expect(canPreviewSnapshotTranslation(f.evaluation,f.snapshot,f.recording,f.ids,true,false)).toBe(true);
  const view={...emptyWorkspaceView(),guides:[{id:'x',axis:'x' as const,value:0}]};expect(translationPreviewNeedsCanonicalSnapping(view)).toBe(true);for(const update of [{guidesVisible:false},{snappingEnabled:false},{guides:[]}])expect(translationPreviewNeedsCanonicalSnapping({...view,...update})).toBe(false);
 });
 it.each([false,true])('canonical preview and commit equal one display translation through nonuniform placement, ARC and material cuts, inherited program=%s',inherited=>{
  const f=fixture(inherited),before=JSON.stringify(f.workspace),delta={...identityScenePlacement(),translation:[.37,-.29] as Point2},translate=([x,y]:Point2):Point2=>[x+delta.translation[0],y+delta.translation[1]],commands=f.ids.map(layerId=>({op:'setLayerPlacement' as const,layerId,value:composePlacementSimilarity(f.evaluation.placements[layerId],delta)}));
  expect(canPreviewSnapshotTranslation(f.evaluation,f.snapshot,f.recording,f.ids,true,false)).toBe(true);
  const preview=prepareSnapshotPreview(f.project,{recordingId:f.recording.id,commands}),committed=prepareSnapshotBatch(f.project,{recordingId:f.recording.id,commands});
  for(const workspace of [preview.recordingSnapshots,committed.recordingSnapshots]){
   const result=evaluateRecordingSnapshot(workspace,f.recording.id,{useDraft:true});
   for(const curve of f.evaluation.drawing.curves){shapeOf(result.drawing,curve.id).forEach((point,index)=>close(point,translate(shapeOf(f.evaluation.drawing,curve.id)[index])));expect(result.drawing.curves.find(value=>value.id===curve.id)!.width).toBe(curve.width);}
   const a=displayField(f.evaluation.drawing,displayPath(f.evaluation.drawing,'first')),b=displayField(result.drawing,displayPath(result.drawing,'first'));
   expect(a.geometry.pieces.some(piece=>piece.joinId)).toBe(true);expect(b.geometry.pieces).toHaveLength(a.geometry.pieces.length);expect(b.total).toBeCloseTo(a.total,9);expect(b.mask).toEqual(a.mask);
   b.geometry.pieces.forEach((piece,i)=>{expect(piece.owners).toEqual(a.geometry.pieces[i].owners);(piece.shape as Cubic).forEach((point,j)=>close(point,translate(a.geometry.pieces[i].shape[j])));});
   expect(result.drawing.displayIntervals).toEqual(f.evaluation.drawing.displayIntervals);expect(result.drawing.fills).toEqual(f.evaluation.drawing.fills);expect(result.drawing.offsets).toEqual(f.evaluation.drawing.offsets);expect(result.paintBatches.map(batch=>[batch.layerId,batch.owner,batch.position])).toEqual(f.evaluation.paintBatches.map(batch=>[batch.layerId,batch.owner,batch.position]));
  }
  expect(JSON.stringify(f.workspace)).toBe(before);expect(committed.recordingSnapshots.library).toEqual(f.workspace.library);
 });
});
