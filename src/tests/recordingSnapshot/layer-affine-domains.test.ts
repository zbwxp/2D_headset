import {expect,test} from 'vitest';
import {composeAffine2D,inverseAffine2D,applyAffine2D,affine2DMaxScale,type Affine2D} from '../../domain/geometry/affine2d';
import {layerDomainMatrices,mergeLayerDomains,remapLayerDomains,type SnapshotLayerAffineDomain} from '../../domain/recordingSnapshot/layerDomains';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotDeformationState,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {mergeSnapshotDeformation} from '../../domain/recordingSnapshot/tracks';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../../domain/drawing/affineDrawing';
import {addLayer,createCurve,connect} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Cubic} from '../../domain/drawing/model';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {strokeFor} from '../../domain/drawing/strokes';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {prepareSnapshotDrawingTopologyEdit} from '../../domain/recordingSnapshot/drawingTopology';

const near=(a:readonly number[],b:readonly number[])=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],11));
const stage=(id:string,matrix:Affine2D,layerIds=['layer']):SnapshotLayerAffineDomain=>({id,layerIds,matrix});
test('authored affine order preserves shear/reflection and exact singular matrices without pseudo-inversion',()=>{
 const a:Affine2D=[1.3,.2,.7,-.8,.4,.1],b:Affine2D=[0,1,-1,0,2,-1],point:[number,number]=[.2,.7];
 near(applyAffine2D(composeAffine2D(b,a),point),applyAffine2D(b,applyAffine2D(a,point)));near(applyAffine2D(inverseAffine2D(a)!,applyAffine2D(a,point)),point);
 expect(inverseAffine2D([0,0,0,2,3,4])).toBeNull();expect(inverseAffine2D([0,0,0,0,3,4])).toBeNull();expect(affine2DMaxScale([0,0,0,2,3,4])).toBe(2);expect(affine2DMaxScale([0,0,0,0,3,4])).toBe(0);
 near(layerDomainMatrices([stage('first',a),stage('second',b)]).layer,composeAffine2D(b,a));
});
test('domain merge replaces by stable ID without reordering and disabling true zero restores retained input',()=>{
 const shift=stage('shift',[1,0,0,1,.3,.2]),zero=stage('zero',[0,0,0,2,0,0]),own=stage('rotate',[0,1,-1,0,0,0]);
 const merged=mergeLayerDomains([shift,zero],[{...zero,enabled:false},own]);expect(merged.map(domain=>domain.id)).toEqual(['shift','zero','rotate']);expect(merged[1].matrix).toEqual(zero.matrix);
 near(layerDomainMatrices(merged).layer,composeAffine2D(own.matrix,shift.matrix));expect(layerDomainMatrices([shift,zero]).layer[0]).toBe(0);expect(zero.enabled).toBeUndefined();
 const fallback={...emptySnapshotDeformationState(),layerDomains:[shift,zero]},state=mergeSnapshotDeformation(fallback,{...emptySnapshotDeformationState(),layerDomains:[{...zero,enabled:false},own]});expect(state.layerDomains).toEqual(merged);
});
test('scope remaps layer and operation IDs, keeps ordered empty-layer domains, and removes only deleted layer scopes',()=>{
 const domains=[stage('one',[1,0,.2,1,0,0],['a','b']),stage('empty',[1,0,0,1,3,4],['empty-layer'])],copy=remapLayerDomains(domains,id=>'copy:'+id,id=>id!=='b');
 expect(copy.map(domain=>[domain.id,domain.layerIds])).toEqual([['copy:one',['copy:a']],['copy:empty',['copy:empty-layer']]]);expect(copy[0].matrix).toEqual(domains[0].matrix);expect(copy[0].matrix).not.toBe(domains[0].matrix);
 expect(layerDomainMatrices(copy,['copy:empty-layer'])).toEqual({'copy:empty-layer':[1,0,0,1,3,4]});
});
test('persistence retains exact authored matrices and rejects malformed or duplicate domain operations',()=>{
 const workspace=emptyRecordingSnapshotWorkspace(),snapshot=emptyRecordingSnapshot('snapshot');workspace.snapshots=[snapshot];snapshot.layers=[{kind:'original',id:'layer',name:'Empty',visible:true,locked:false,items:[]}];snapshot.deformation.layerDomains=[stage('shear',[1,0,.5,1,.2,.3]),stage('zero',[0,0,0,-2,.7,.9])];
 const serialized=JSON.stringify(workspace);expect(parseRecordingSnapshots(JSON.parse(serialized))).toEqual(workspace);
 for(const patch of [{matrix:[1,0,0,1,0]},{matrix:[1,0,0,1,0,Infinity]},{layerIds:[]},{layerIds:['layer','layer']},{enabled:1},{bakedCurves:[]}]){const invalid=JSON.parse(serialized);Object.assign(invalid.snapshots[0].deformation.layerDomains[0],patch);expect(()=>parseRecordingSnapshots(invalid)).toThrow();}
 const invalid=JSON.parse(serialized);invalid.snapshots[0].deformation.layerDomains[1].id='shear';expect(()=>parseRecordingSnapshots(invalid)).toThrow();
});
test.each([{matrix:[1,.3,.7,-1,.2,.4] as Affine2D},{matrix:[0,0,0,2,.2,.4] as Affine2D},{matrix:[0,0,0,0,.2,.4] as Affine2D}])('shared affine material application keeps ARC as its affine image at $matrix, with fixed ink width',({matrix})=>{
 let drawing=addLayer(emptyDrawing(),'Corner');const layer=drawing.layers[0].id;drawing=createCurve(drawing,layer,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'First','a');drawing=createCurve(drawing,layer,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'Second','b');drawing=connect(drawing,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 const source=JSON.stringify(drawing),path=strokeFor(drawing,'a'),before=derivedUses(drawing,path.segments),owners=drawingLayerObjectOwners(drawing),after=placeDrawingAffines(drawing,{[layer]:matrix},id=>owners.get(id)),geometry=derivedUses(after,path.segments);
 expect(geometry.shapes).toHaveLength(before.shapes.length);geometry.shapes.forEach((shape,i)=>shape.forEach((point,j)=>near(point,applyAffine2D(matrix,before.shapes[i][j]))));expect(after.curves.map(curve=>curve.width)).toEqual(drawing.curves.map(curve=>curve.width));expect(JSON.stringify(drawing)).toBe(source);
});

const cid=(id:string)=>canonicalElementId('source',id);
function fixture(){
 const drawing=createCurve({...emptyDrawing(),layers:[{id:'layer',name:'Source',items:[],visible:true,locked:false}]},'layer',[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Curve','curve'),w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=w.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=[{kind:'reference',id:'slot',name:'Source',baseSnapshotId:source.id,baseLayerId:cid('layer')}];side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.snapshots.push(view,side);w.recordings=[recording];w.activeRecordingId=recording.id;return {drawing,w,source,view};
}
test('independent layer cloning remaps operation/scope IDs and preserves the live affine evaluation',()=>{
 const {w,view}=fixture();view.deformation.layerDomains=[stage('domain',[1,.3,.6,-1,.4,.2],['slot'])];const before=resolveSnapshot(w,view.id).drawing,effects=applySnapshotCommand(w,{op:'cloneLayers',sourceSnapshotId:view.id,layerIds:['slot']}),map=effects.idMap!,copy=w.snapshots.find(snapshot=>snapshot.id===map[view.id])!;
 expect(copy.deformation.layerDomains).toEqual([{id:map.domain,layerIds:[map.slot],matrix:[1,.3,.6,-1,.4,.2]}]);expect(map.domain).not.toBe('domain');const actual=resolveSnapshot(w,copy.id).drawing;shapeOf(actual,map[cid('curve')]).forEach((point,i)=>near(point,shapeOf(before,cid('curve'))[i]));expect(()=>parseRecordingSnapshots(w)).not.toThrow();
});
test('new topology and real-basis direct controls invert the same full affine chain; zero rejects atomically',()=>{
 const {w,view}=fixture();view.deformation.layerDomains=[stage('domain',[1,.3,.6,-1,.4,.2],['slot'])];
 const beforeDrawing=resolveSnapshot(w,view.id).drawing,wanted:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],drawing=createCurve(beforeDrawing,'slot',wanted,.02,'New','new'),edited=prepareSnapshotDrawingTopologyEdit(w,{recordingId:'recording',snapshotId:view.id,angle:{x:0,y:0},beforeDrawing,drawing}).workspace;
 shapeOf(resolveSnapshot(edited,view.id).drawing,'new').forEach((point,i)=>near(point,wanted[i]));expect(edited.library.curves.new.handles).not.toEqual(drawing.curves.find(curve=>curve.id==='new')!.handles);
 applySnapshotCommand(edited,{op:'moveShapeHandle',layerId:'slot',curveId:'new',end:0,position:[.2,.8]});near(resolveSnapshot(edited,view.id).drawing.curves.find(curve=>curve.id==='new')!.handles[0],[.2,.8]);
 const zero=structuredClone(w);zero.snapshots.find(snapshot=>snapshot.id===view.id)!.deformation.layerDomains![0].matrix=[0,0,0,1,0,0];const baseline=JSON.stringify(zero),base=resolveSnapshot(zero,view.id).drawing;
 expect(()=>prepareSnapshotDrawingTopologyEdit(zero,{recordingId:'recording',snapshotId:view.id,angle:{x:0,y:0},beforeDrawing:base,drawing:createCurve(base,'slot',wanted,.02,'Invalid','invalid')})).toThrow(/collapsed placement axis/);expect(JSON.stringify(zero)).toBe(baseline);
});
test('source removal retains empty-layer domains and removes the scope only when its source layer is deleted',()=>{
 const {w,view,drawing}=fixture(),matrix:Affine2D=[2,.2,.3,-1,.4,.5];view.deformation.layerDomains=[stage('domain',matrix,['slot'])];
 const empty=upsertDrawingSource(w,'source',{...drawing,nodes:[],curves:[],layers:[{...drawing.layers[0],items:[]}]}),emptyView=empty.snapshots.find(snapshot=>snapshot.id===view.id)!;expect(emptyView.deformation.layerDomains).toEqual(view.deformation.layerDomains);expect(resolveSnapshot(empty,view.id).drawing.curves).toEqual([]);
 const shape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],fresh=createCurve({...drawing,nodes:[],curves:[],layers:[{...drawing.layers[0],items:[]}]},'layer',shape,.02,'New','new'),live=upsertDrawingSource(empty,'source',fresh);shapeOf(resolveSnapshot(live,view.id).drawing,cid('new')).forEach((point,i)=>near(point,applyAffine2D(matrix,shape[i])));
 const deleted=upsertDrawingSource(live,'source',emptyDrawing());expect(deleted.snapshots.find(snapshot=>snapshot.id===view.id)!.deformation.layerDomains).toEqual([]);expect(resolveSnapshot(deleted,view.id).drawing.curves).toEqual([]);
});
