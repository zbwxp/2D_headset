import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotPreview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {addLayer,createCurve,connect} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {evaluatedAffine} from '../domain/drawing/evaluatedAffine';
import {fillGeometry} from '../domain/drawing/appearance';
import {createFill} from '../domain/drawing/paintCommands';
import {ellipse} from '../domain/drawing/commands';
import {strokeFor} from '../domain/drawing/strokes';
import {derivedUses} from '../domain/drawing/roundedJoin';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {applyScenePlacement} from '../domain/recordingScene/tracks';
import type {LandmarkProject} from '../domain/landmarks/model';
const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const id=(raw:string)=>canonicalElementId('$working',raw);
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],9));
function source(){let d=addLayer(emptyDrawing(),'Outline');d=createCurve(d,d.layers[0].id,[[.2,0],[1.6,.25],[-.6,.8],[.8,1]],.02,'Outline','a');return createCurve(d,d.layers[0].id,[[2,0],[2.2,.2],[2.6,.8],[3,1]],.02,'Unrelated','b');}
function harness(drawing:DrawingDocument=source()){
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing});const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('source write');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const old=past.pop();if(old){future.push(project);project=old;}},redo(){const old=future.pop();if(old){past.push(project);project=old;}}});
 const apply=(...commands:SnapshotCommand[])=>value(api.snapshot({commands}));apply({op:'createRecording'});const source=drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!;const pasted=apply({op:'pasteLayers',sourceSnapshotId:source.id}),layerId=pasted.created.find(c=>c.kind==='layer')!.id;
 return {api,apply,layerId,project:()=>project,replace:(p:LandmarkProject)=>{project=p;},evaluate:()=>evaluateRecordingSnapshot(project),recording:()=>project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!};
}
const placement=(change:Partial<ScenePlacementValue>)=>({...identityScenePlacement(),...change});
test('stroke axes retain current shape material through exact zero, JSON, undo and live source edits',()=>{
 const h=harness(),original=h.project().drawing,curveId=id('a');h.apply({op:'moveShapeHandle',layerId:h.layerId,curveId,end:0,position:[2,.4]},{op:'updateSnapshot'});const material=shapeOf(h.evaluate().drawing,curveId),unrelated=shapeOf(h.evaluate().drawing,id('b'));
 const zero=placement({translation:[.7,-.2],scaleX:0,scaleY:2});h.apply({op:'setShapeElementPlacement',curveIds:[curveId],value:zero},{op:'updateSnapshot'});const collapsed=h.evaluate();shapeOf(collapsed.drawing,curveId).forEach(p=>expect(p[0]).toBe(.7));expect(shapeOf(collapsed.preElementPlacementDrawing,curveId)).toEqual(material);expect(shapeOf(collapsed.drawing,id('b'))).toEqual(unrelated);expect(collapsed.placements[h.layerId]).toEqual(identityScenePlacement());expect(h.project().drawing).toBe(original);
 h.replace({...h.project(),recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(h.project().recordingSnapshots)))});expect(h.evaluate().elementPlacements[curveId]).toEqual(zero);
 const live=structuredClone(h.project().drawing!);live.curves.find(c=>c.id==='a')!.handles[0][0]+=.3;h.replace(syncRecordingSnapshotSources({...h.project(),drawing:live}));const fresh=shapeOf(h.evaluate().preElementPlacementDrawing,curveId);expect(fresh[1][0]).toBeCloseTo(material[1][0]+.3,9);
 const restored=placement({scaleX:1.5,scaleY:2});h.apply({op:'setShapeElementPlacement',curveIds:[curveId],value:restored},{op:'updateSnapshot'});shapeOf(h.evaluate().drawing,curveId).forEach((p,i)=>near(p,applyScenePlacement(restored,fresh[i])));value(h.api.undo());expect(h.evaluate().elementPlacements[curveId].scaleX).toBe(0);value(h.api.redo());expect(h.evaluate().elementPlacements[curveId].scaleX).toBe(1.5);
 const tracks=h.recording().tracks.filter(t=>t.channel==='placement');expect(tracks).toHaveLength(1);expect(tracks[0].elementId).toBe(curveId);
});
test('stroke affine composes before nonuniform layer placement, including ARC material and zero recovery',()=>{
 let d=addLayer(emptyDrawing(),'Corner');d=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'A','a');d=createCurve(d,d.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');d=connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.3);
 const h=harness(d),curveIds=[id('a'),id('b')],base=h.evaluate().drawing,stroke=strokeFor(base,curveIds[0]),geometry=derivedUses(base,stroke.segments),layer=placement({rotation:21,scaleX:2,scaleY:.4}),element=placement({translation:[.3,-.2],rotation:-32,scaleX:.3,scaleY:2});expect(geometry.pieces.some(p=>p.joinId)).toBe(true);
 h.apply({op:'setLayerPlacement',layerId:h.layerId,value:layer},{op:'setShapeElementPlacement',curveIds,value:element},{op:'updateSnapshot'});const actual=derivedUses(h.evaluate().drawing,stroke.segments);actual.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(layer,applyScenePlacement(element,geometry.shapes[i][j])))));
 h.apply({op:'setShapeElementPlacement',curveIds,value:placement({scaleX:0,scaleY:0})},{op:'updateSnapshot'});derivedUses(h.evaluate().drawing,stroke.segments).shapes.flat().forEach(p=>expect(p).toEqual([0,0]));h.apply({op:'setShapeElementPlacement',curveIds,value:element},{op:'updateSnapshot'});expect(derivedUses(h.evaluate().drawing,stroke.segments)).toEqual(actual);
 const copied=h.apply({op:'cloneLayers',sourceSnapshotId:h.recording().activeSnapshotId!,layerIds:[h.layerId]}),copyId=copied.idMaps[0].idMap[curveIds[0]],copyDrawing=h.evaluate().drawing,copyStroke=strokeFor(copyDrawing,copyId);derivedUses(copyDrawing,copyStroke.segments).shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,actual.shapes[i][j])));
});
test('native stroke placement rejects unlike linked affines atomically, preserves SMOOTH and supports preview/discard',()=>{
 let d=addLayer(emptyDrawing(),'Smooth');d=createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.7,0],[1,0]],.02,'A','a');d=createCurve(d,d.layers[0].id,[[1,0],[1.3,0],[1.7,.5],[2,1]],.02,'B','b');d=connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');const h=harness(d),curveIds=[id('a'),id('b')],before=h.project(),wanted=placement({scaleX:.2,scaleY:3});
 expect(h.api.snapshot({commands:[{op:'setShapeElementPlacement',curveIds:[curveIds[0]],value:wanted}]})).toMatchObject({ok:false,error:{code:'LINKED_ELEMENT_PLACEMENT'}});expect(h.project()).toBe(before);
 const preview=prepareSnapshotPreview(before,{commands:[{op:'setShapeElementPlacement',curveIds,value:wanted}]});expect(preview.changed).toBe(true);expect(h.project()).toBe(before);
 h.apply({op:'setShapeElementPlacement',curveIds,value:wanted});const e=h.evaluate(),a=shapeOf(e.drawing,curveIds[0]),b=shapeOf(e.drawing,curveIds[1]);near(a[3],b[0]);expect((a[2][0]-a[3][0])*(b[1][1]-b[0][1])-(a[2][1]-a[3][1])*(b[1][0]-b[0][0])).toBeCloseTo(0,12);
 h.apply({op:'discardSelected',layerIds:[h.layerId]});expect(h.evaluate().elementPlacements).toEqual({});
});
test('saved element placement copies across view creation and clone without changing source geometry',()=>{
 const h=harness(),curveId=id('a'),zero=placement({scaleX:0,scaleY:2});h.apply({op:'setShapeElementPlacement',curveIds:[curveId],value:zero},{op:'updateSnapshot'},{op:'createSnapshot',angle:{x:45,y:0}});expect(h.evaluate().elementPlacements[curveId]).toEqual(zero);const snapshotId=h.recording().activeSnapshotId!,result=h.apply({op:'cloneLayers',sourceSnapshotId:snapshotId,layerIds:[h.layerId]}),copy=result.idMaps[0].idMap[curveId];expect(copy).toBeDefined();const drawing=h.evaluate().drawing;shapeOf(drawing,copy).forEach(p=>expect(p[0]).toBe(0));expect(h.project().recordingSnapshots!.library.curves[copy].handles).toEqual(h.project().recordingSnapshots!.library.curves[curveId].handles);
});

test('uniform stroke placement keeps circular ARC representable and affine fills follow their boundary',()=>{
 let d=addLayer(emptyDrawing(),'Corner');d=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'A','a');d=createCurve(d,d.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');d=connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.3);
 const h=harness(d),curveIds=[id('a'),id('b')],base=h.evaluate().drawing,path=strokeFor(base,curveIds[0]),before=derivedUses(base,path.segments),v=placement({translation:[.2,.3],rotation:25,scale:2});h.apply({op:'setShapeElementPlacement',curveIds,value:v},{op:'updateSnapshot'});expect(evaluatedAffine(h.evaluate().drawing,curveIds[0])).toBeUndefined();derivedUses(h.evaluate().drawing,path.segments).shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(v,before.shapes[i][j]))));
 const layer=addLayer(emptyDrawing(),'Closed'),ell=ellipse(layer,layer.layers[0].id,[-1,-1],[1,1],.02),closed=harness(createFill(ell.document,ell.ids,'white')),plain=closed.evaluate(),boundary=plain.drawing.fills[0].boundary.map(use=>use.id),fill=fillGeometry(plain.drawing,plain.drawing.fills[0]),anisotropic=placement({rotation:17,scaleX:0,scaleY:2});closed.apply({op:'setShapeElementPlacement',curveIds:boundary,value:anisotropic},{op:'updateSnapshot'});const after=closed.evaluate().drawing;fillGeometry(after,after.fills[0]).shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(anisotropic,fill.shapes[i][j]))));expect(evaluatedAffine(after,after.fills[0].id)).toBeDefined();
});
test('legacy world delta remains world-space after native stroke axes and parent placement',()=>{
 const h=harness(),curveId=id('a');h.apply({op:'setShapeElementPlacement',curveIds:[curveId],value:placement({rotation:18,scaleX:.4,scaleY:2})},{op:'setLayerPlacement',layerId:h.layerId,value:placement({rotation:-31,scaleX:2,scaleY:.7})},{op:'updateSnapshot'});const before=shapeOf(h.evaluate().drawing,curveId),delta=placement({translation:[.3,-.2],rotation:11,scale:1.2});h.apply({op:'transformShapeElements',curveIds:[curveId],value:delta},{op:'updateSnapshot'});shapeOf(h.evaluate().drawing,curveId).forEach((p,i)=>near(p,applyScenePlacement(delta,before[i])));
});
