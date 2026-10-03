import fullFace from '../../assets/hairless-symmetric-two-face-mirror.json';
import {parseDrawing} from '../../domain/drawing/model';
import {fitDeformedCubic} from '../../domain/deformation/cubicDeformation';
import {layerCageDomainProjection} from '../../domain/recordingSnapshot/layerCageDomain';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';
import {writeLayerDomainOperation} from '../../app/layerDomainOperation';
import {createLayerAffineIntent} from '../../domain/drawing/layerDomainIntent';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../../domain/drawing/affineDrawing';
import {applyLayerCageDomain} from '../../domain/recordingSnapshot/layerCageEvaluation';
import {describe,expect,it} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2,type Cubic} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../../domain/drawing/displayRoutes';
import {displayRouteInk} from '../../domain/drawing/displayRouteInk';
import {fillGeometry,offsetGeometry,strokeInk} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {evaluatedMaterialSource} from '../../domain/drawing/evaluatedDeformation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import type {SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {retainSnapshotAffines} from '../../domain/recordingSnapshot/elementPlacement';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {createVectorEditingApi,type VectorResult} from '../../app/vectorEditingApi';
import {createEmptyProject} from '../../app/emptyProject';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Affine2D} from '../../domain/geometry/affine2d';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function near(a:unknown,b:unknown):void {
 if(typeof a==='number'&&typeof b==='number'){expect(a).toBeCloseTo(b,8);return;}
 if(Array.isArray(a)&&Array.isArray(b)){expect(a).toHaveLength(b.length);a.forEach((value,index)=>near(value,b[index]));return;}
 if(a&&b&&typeof a==='object'&&typeof b==='object'){const keys=(value:object)=>Object.keys(value).filter(key=>(value as Record<string,unknown>)[key]!==undefined).sort();expect(keys(a)).toEqual(keys(b));for(const key of keys(a))near((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]);return;}
 expect(a).toEqual(b);
}
function cage(id:string,layerIds:string[]):SnapshotLayerCageDomain {
 const bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.13;bend.handles[0][1][1]=-.05;
 return {kind:'h-coons',id,layerIds,restRect:{min:[-2,-2],max:[2,2]},quad:[[-2,-2],[1.8,-1.9],[1.7,2],[-1.9,1.8]],bend};
}
function fixture(){
 const w=emptyRecordingSnapshotWorkspace(),d=emptyDrawing(),source=emptyRecordingSnapshot('source','Source','drawing'),view=emptyRecordingSnapshot('view'),target=emptyRecordingSnapshot('target'),recording=emptySnapshotRecording('recording');
 const add=(id:string,a:Point2,b:Point2,nodes:[string,string],layerId:string)=>{const shape=line(a,b);for(const [end,node] of nodes.entries())if(!d.nodes.some(n=>n.id===node))d.nodes.push({id:node,position:shape[end?3:0]});d.curves.push({id,name:id,nodes,handles:[shape[1],shape[2]],visible:true,locked:false,width:.017,profile:'UNIFORM',inkEnds:[{taper:.014},{extension:.005}]});let layer=d.layers.find(layer=>layer.id===layerId);if(!layer){layer={id:layerId,name:layerId,visible:true,locked:false,items:[]};d.layers.push(layer);}layer.items.push(id);};
 add('a',[-.9,-.7],[0,-.7],['a0','a1'],'shape');add('b',[0,-.7],[0,.3],['a1','a2'],'shape');add('c',[0,.3],[-.9,-.7],['a2','a0'],'shape');
 d.joins=[{id:'arc',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'ARC',radius:.17}];
 d.fills=[{id:'fill',name:'Fill',visible:true,locked:false,color:'black',boundary:['a','b','c'].map(id=>({id,reverse:false}))}];d.layers[0].items.push('fill');
 d.groups=[{id:'group',name:'Owned relation',visible:true,locked:false,curveIds:['a','b','c']}];
 add('route-a',[.4,-.5],[1.2,-.5],['r0','r1'],'route-left');add('route-b',[1.2,-.5],[1.2,.5],['r2','r3'],'route-right');
 d.endpointLinks=[{id:'link',a:{curveId:'route-a',end:1},b:{curveId:'route-b',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.13}}];
 d.offsets=[{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'route-a',reverse:false}],distance:.03,start:.1,end:.85,taper:.12,width:.009,translation:[.025,-.04]}];d.layers[1].items.push('offset');
 d.displayIntervals=[{id:'interval',anchor:{id:'a',reverse:false},ranges:[{id:'show',start:.12,end:.92,inkEnds:[{taper:.03},{extension:.01}]},{id:'hide',mode:'HIDE',start:.45,end:.55}]},{id:'route-interval',anchor:{id:'route-a',reverse:false},displayRoute:{seed:{segments:[{id:'route-a',reverse:false}],closed:false},throughLinkIds:['link']},ranges:[{id:'route-show',start:.13,end:.89,inkEnds:[{taper:.02},{taper:.05}]}]}];
 for(const kind of ['nodes','curves','fills','offsets'] as const)Object.assign(w.library[kind],Object.fromEntries(d[kind].map(value=>[value.id,value])));
 source.layers=d.layers.map(layer=>({...layer,kind:'original'}));source.relations={joins:{add:d.joins},endpointLinks:{add:d.endpointLinks},groups:{add:d.groups},displayIntervals:{add:d.displayIntervals}};
 view.layers=source.layers.map(layer=>({kind:'reference',id:'slot:'+layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
 recording.snapshotIds=[target.id];recording.activeSnapshotId=target.id;w.snapshots=[source,view,target];w.recordings=[recording];w.activeRecordingId=recording.id;
 return {w,d,source,view,target,recording};
}
function harness(w:RecordingSnapshotWorkspace){
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:w};const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source write');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};return {api,project:()=>project,past,value};
}
function appearance(before:DrawingDocument,after:DrawingDocument,map:Record<string,string>){
 const inverse=new Map(Object.entries(map).map(([a,b])=>[b,a])),unmap=(id:string):string=>inverse.get(id)??(id.startsWith('display-join:')?'display-join:'+unmap(id.slice(13)):id),actual=remapDrawingIdentities(after,unmap);
 for(const kind of ['nodes','curves','fills','offsets','joins','endpointLinks','groups','displayIntervals'] as const){if(kind==='nodes')near([...actual.nodes].sort((a,b)=>a.id.localeCompare(b.id)),[...before.nodes].sort((a,b)=>a.id.localeCompare(b.id)));else near(actual[kind],before[kind]);}
 for(const curve of before.curves){
  near(shapeOf(after,map[curve.id]),shapeOf(before,curve.id));const a=displayField(before,displayPath(before,curve.id)),b=displayField(after,displayPath(after,map[curve.id]));near(b.geometry.shapes,a.geometry.shapes);near(b.inkSpans,a.inkSpans);expect(b.total).toBeCloseTo(a.total,10);
  for(const s of [0,.13,.25,.5,.75,.89,1]){near(b.at(s).p,a.at(s).p);near(b.at(s).t,a.at(s).t);}
  near(strokeInk(after,strokeFor(after,map[curve.id])).map(run=>({shapes:run.shapes,outline:run.outline,tips:run.tips,closed:run.closed})),strokeInk(before,strokeFor(before,curve.id)).map(run=>({shapes:run.shapes,outline:run.outline,tips:run.tips,closed:run.closed})));
 }
 for(const fill of before.fills)near(fillGeometry(after,after.fills.find(value=>value.id===map[fill.id])!).shapes,fillGeometry(before,fill).shapes);
 for(const offset of before.offsets)near(offsetGeometry(after,after.offsets.find(value=>value.id===map[offset.id])!),offsetGeometry(before,offset));
 for(const track of before.displayIntervals??[]){if(!track.displayRoute)continue;const route=after.displayIntervals!.find(value=>value.id===map[track.id])!.displayRoute!,a=createDisplayRouteField(before,track.displayRoute),b=createDisplayRouteField(after,route);near(b.geometry.shapes,a.geometry.shapes);for(const s of [.13,.5,.89]){const original=a.materialAt(s),copy=b.materialAt(s);near(JSON.parse(JSON.stringify(copy),(key,value)=>typeof value==='string'?unmap(value):value),original);}const inks=(drawing:DrawingDocument,route:typeof track.displayRoute)=>[...displayRouteInk(drawing,route!,new Map(drawing.curves.map((curve,index)=>[curve.id,index]))).runs].map(([id,runs])=>[unmap(id),runs]);near(JSON.parse(JSON.stringify(inks(after,route)),(key,value)=>typeof value==='string'?unmap(value):value),inks(before,track.displayRoute));}
}

describe('independent owned Coons programs',()=>{
 it.each([1,2])('copies %i ordered cages, sparse A corrections, later affine, ARC, route, fill, offset and ink through JSON and one Undo',count=>{
  const {w,source,view,target}=fixture();source.deformation.layerDomains=[cage('first',source.layers.map(layer=>layer.id))];
  source.deformation.layerDomains[0].postShape={nodes:{},handles:{a:[[.013,-.021],[.023,.011]],'route-a':[[.006,.002],[.009,-.004]]}};
  const slots=view.layers.map(layer=>layer.id);view.deformation.layerDomains=count===2?[{...cage('second',slots),postShape:{nodes:{},handles:{b:[[.009,-.004],[-.013,.012]]}}}]:[];
  view.deformation.layerDomains.push({id:'later',layerIds:slots,matrix:[1,.15,.21,.82,.07,-.03]});
  const before=resolveSnapshot(w,view.id,{useDraft:false}).drawing,material=evaluatedMaterialSource(before),bytes=JSON.stringify(w),h=harness(w),result=h.value(h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]})),map=result.idMaps[0].idMap;
  const current=h.project().recordingSnapshots!,copy=current.snapshots.find(snapshot=>snapshot.id===map[view.id])!;expect(JSON.stringify(w)).toBe(bytes);expect(current.snapshots).toHaveLength(w.snapshots.length+1);expect(copy.parentSnapshotId).toBeUndefined();expect(copy.inheritedState).toBeUndefined();expect(copy.inputMirror).toBeUndefined();expect(copy.source).toBeUndefined();expect(copy.layers.every(layer=>layer.kind==='original')).toBe(true);expect(copy.deformation.warps).toEqual([]);expect(copy.deformation.bindings).toEqual([]);expect(copy.deformation.layerDomains).toHaveLength(count+1);
  for(const curve of material.curves)near(current.library.curves[map[curve.id]].handles,curve.handles);expect(current.library.curves[map.a].handles).not.toEqual(before.curves.find(curve=>curve.id==='a')!.handles);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(current)));appearance(before,resolveSnapshot(loaded,target.id).drawing,map);expect(h.past).toHaveLength(1);h.value(h.api.undo());expect(JSON.stringify(h.project().recordingSnapshots)).toBe(bytes);h.value(h.api.redo());appearance(before,resolveSnapshot(h.project().recordingSnapshots!,target.id).drawing,map);
  const detached=structuredClone(loaded);detached.library.nodes.a0.position=[8,7];detached.library.curves.a.width=.6;detached.snapshots.find(snapshot=>snapshot.id===source.id)!.deformation.layerDomains![0].enabled=false;detached.snapshots.find(snapshot=>snapshot.id===view.id)!.deformation.layerDomains=[];appearance(before,resolveSnapshot(detached,target.id).drawing,map);
  detached.snapshots=detached.snapshots.filter(snapshot=>snapshot.id!==source.id&&snapshot.id!==view.id);appearance(before,resolveSnapshot(detached,target.id).drawing,map);
 },30000);
 it('retains different native per-curve affine prefixes before a shared cage without double deformation',()=>{
  const {w,source,view,target}=fixture();source.layers=source.layers.filter(layer=>layer.id==='shape');source.relations.endpointLinks={add:[]};source.relations.displayIntervals!.add=source.relations.displayIntervals!.add!.filter(track=>!track.displayRoute);view.layers=view.layers.filter(layer=>layer.id==='slot:shape');
  w.library.nodes.extra0={id:'extra0',position:[.5,.5]};w.library.nodes.extra1={id:'extra1',position:[.9,.8]};w.library.curves.extra={id:'extra',name:'Extra',nodes:['extra0','extra1'],handles:[[.6,.6],[.8,.7]],visible:true,locked:false,width:.012};const layer=source.layers[0];if(layer.kind==='original')layer.items.push('extra');
  view.deformation.layers['slot:shape']={elementPlacements:Object.fromEntries(['a','b','c','extra'].map(id=>[id,{translation:[.03,-.01],rotation:0,scale:1,scaleX:id==='extra'?.9:.8,scaleY:id==='extra'?1.1:1.2}]))};view.deformation.layerDomains=[cage('cage',['slot:shape'])];
  const before=resolveSnapshot(w,view.id).drawing,result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]}),map=result.idMaps[0].idMap,copy=result.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===map[view.id])!;
  expect(Object.keys(copy.deformation.layers[map['slot:shape']].elementPlacements!)).toHaveLength(4);expect(copy.deformation.layerDomains).toHaveLength(1);appearance(before,resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),target.id).drawing,map);
 });
 it('copies an independent layer subset with its own filtered corrections after a shared nonuniform affine and cage',()=>{
  const {w,source,view,target}=fixture(),layers=source.layers.map(layer=>layer.id);
  source.deformation.layerDomains=[{id:'before',layerIds:layers,matrix:[1,.1,.14,.9,.02,.01]},{...cage('cage',layers),postShape:{nodes:{},handles:{a:[[.01,.02],[.03,-.01]],'route-a':[[.02,0],[0,0]]}}}];
  const full=resolveSnapshot(w,view.id).drawing,before=retainSnapshotAffines({...full,layers:full.layers.filter(layer=>layer.id==='slot:shape'),curves:full.curves.filter(curve=>['a','b','c'].includes(curve.id)),nodes:full.nodes.filter(node=>['a0','a1','a2'].includes(node.id)),offsets:[],endpointLinks:[],displayIntervals:full.displayIntervals!.filter(track=>track.id==='interval')},[full]);
  const result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id,layerIds:['slot:shape']}]}),map=result.idMaps[0].idMap,copy=result.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===map[view.id])!;
  expect(copy.deformation.layerDomains).toHaveLength(2);expect(Object.keys(copy.deformation.layerDomains![1].postShape!.handles)).toEqual([map.a]);expect(map['route-a']).toBeUndefined();expect(map['route-left']).toBeUndefined();appearance(before,resolveSnapshot(result.recordingSnapshots,target.id).drawing,map);
 });
 it('keeps consecutive inherited and own sparse A corrections in their original material frames',()=>{
  const {w,source,view,target}=fixture();source.deformation.layerDomains=[{...cage('cage',source.layers.map(layer=>layer.id)),postShape:{nodes:{},handles:{a:[[.01,-.02],[.02,.01]]}}}];view.deformation.layers['slot:shape']={shape:{nodes:{},handles:{a:[[.015,.01],[-.01,.02]]}}};
  const before=resolveSnapshot(w,view.id).drawing,result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]}),map=result.idMaps[0].idMap,copy=result.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===map[view.id])!;
  expect(copy.deformation.layerDomains).toHaveLength(2);expect(copy.deformation.layerDomains!.every(domain=>domain.postShape)).toBe(true);expect(copy.deformation.layers).toEqual({});appearance(before,resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),target.id).drawing,map);
 });
 it('retains reference paste as live and rejects partial route dependency copies atomically',()=>{
  const {w,source,view,target}=fixture();source.deformation.layerDomains=[cage('cage',source.layers.map(layer=>layer.id))];const h=harness(w),bytes=JSON.stringify(w),result=h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:view.id,layerIds:['slot:route-left']}]});expect(result).toMatchObject({ok:false,error:{code:'LAYER_DEPENDENCIES'}});expect(h.past).toHaveLength(0);expect(JSON.stringify(w)).toBe(bytes);
  const pasted=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'pasteLayers',sourceSnapshotId:view.id}]}),current=pasted.recordingSnapshots;expect(Object.keys(current.library.curves)).toEqual(Object.keys(w.library.curves));expect(current.snapshots).toHaveLength(w.snapshots.length);const before=resolveSnapshot(current,target.id).drawing;current.library.curves.a.handles[0][1]+=.2;expect(shapeOf(resolveSnapshot(current,target.id).drawing,'a')).not.toEqual(shapeOf(before,'a'));
 });

 it.each([0,.3])('copies mirrored nonlinear material at axis %s through current appearance, JSON, Undo, and source deletion',axisX=>{
  const {w,source,view,target}=fixture();for(const layer of source.layers)source.deformation.layers[layer.id]={placement:{translation:[.02,0],rotation:0,scale:1,scaleX:1.15,scaleY:.9}};source.deformation.layerDomains=[{...cage('cage',source.layers.map(layer=>layer.id)),postShape:{nodes:{},handles:{a:[[.03,-.02],[.01,.04]],'route-a':[[.015,.009],[0,0]]}}}];view.parentSnapshotId=source.id;view.inputMirror={axisX,curvePairs:[]};view.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));view.deformation.layerDomains=[{id:'later',layerIds:view.layers.map(layer=>layer.id),matrix:[1,.13,.08,.9,.01,-.02]}];
  const h=harness(w),bytes=JSON.stringify(w),before=resolveSnapshot(w,view.id).drawing,result=h.value(h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]})),map=result.idMaps[0].idMap,current=h.project().recordingSnapshots!,copy=current.snapshots.find(snapshot=>snapshot.id===map[view.id])!;
  expect(current.snapshots).toHaveLength(w.snapshots.length+1);expect(copy.parentSnapshotId).toBeUndefined();expect(copy.inputMirror).toBeUndefined();expect(copy.layers.every(layer=>layer.kind==='original')).toBe(true);expect(copy.deformation.layerDomains).toHaveLength(1);expect(copy.deformation.layerDomains![0]).toHaveProperty('materialProgram');expect(JSON.stringify(w)).toBe(bytes);
  appearance(before,resolveSnapshot(current,target.id).drawing,map);const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(current)));appearance(before,resolveSnapshot(loaded,target.id).drawing,map);h.value(h.api.undo());expect(JSON.stringify(h.project().recordingSnapshots)).toBe(bytes);h.value(h.api.redo());appearance(before,resolveSnapshot(h.project().recordingSnapshots!,target.id).drawing,map);
  loaded.snapshots=loaded.snapshots.filter(snapshot=>snapshot.id!==source.id&&snapshot.id!==view.id);loaded.library.nodes.a0.position=[8,9];appearance(before,resolveSnapshot(loaded,target.id).drawing,map);
  const owned=loaded.snapshots.find(snapshot=>snapshot.id===copy.id)!,domain=owned.deformation.layerDomains![0],program=JSON.stringify('materialProgram' in domain?domain.materialProgram:undefined);
  owned.deformation.layerDomains=writeLayerDomainOperation(owned.deformation.layerDomains,owned.deformation.layerDomains!,createLayerAffineIntent(domain.layerIds,[1,0,0,1,.2,-.1],{operationId:domain.id,replace:true}));expect(JSON.stringify('materialProgram' in owned.deformation.layerDomains[0]?owned.deformation.layerDomains[0].materialProgram:undefined)).toBe(program);
  const moved=resolveSnapshot(loaded,target.id).drawing,field=displayField(before,displayPath(before,'a')),translated=displayField(moved,displayPath(moved,map.a));near(translated.geometry.shapes,field.geometry.shapes.map(shape=>shape.map(([x,y])=>[x+.2,y-.1])));
  owned.deformation.layerDomains=writeLayerDomainOperation(owned.deformation.layerDomains,owned.deformation.layerDomains,createLayerAffineIntent(domain.layerIds,[1,0,0,1,0,0],{operationId:domain.id,replace:true,enabled:false}));const disabled=resolveSnapshot(loaded,target.id).drawing;near(shapeOf(disabled,map.a),[loaded.library.nodes[loaded.library.curves[map.a].nodes[0]].position,...loaded.library.curves[map.a].handles,loaded.library.nodes[loaded.library.curves[map.a].nodes[1]].position]);
  owned.deformation.layerDomains=writeLayerDomainOperation(owned.deformation.layerDomains,owned.deformation.layerDomains,createLayerAffineIntent(domain.layerIds,[1,0,0,1,0,0],{operationId:domain.id,replace:true,enabled:true}));appearance(before,resolveSnapshot(loaded,target.id).drawing,map);
 });

 it('copies reversed mirror pairs with owned endpoint parity and deforms a new unpaired member in the same live field',()=>{
  const {w,d,source,view,target}=fixture(),twin=remapDrawingIdentities(d,id=>'twin:'+id),shift=([x,y]:Point2):Point2=>[x+.2,y+.1],flip=(value:{curveId:string;end:0|1})=>({...value,end:(1-value.end) as 0|1}),use=(value:{id:string;reverse:boolean})=>({...value,reverse:!value.reverse});
  twin.nodes=twin.nodes.map(node=>({...node,position:shift(node.position)}));twin.curves=twin.curves.map(curve=>({...curve,nodes:[curve.nodes[1],curve.nodes[0]],handles:[shift(curve.handles[1]),shift(curve.handles[0])],inkEnds:curve.inkEnds?[curve.inkEnds[1],curve.inkEnds[0]]:undefined,width:.023}));twin.joins=twin.joins.map(join=>({...join,a:flip(join.a),b:flip(join.b)}));twin.endpointLinks=twin.endpointLinks?.map(link=>({...link,a:flip(link.a),b:flip(link.b)}));twin.fills=twin.fills.map(fill=>({...fill,boundary:fill.boundary.map(use)}));twin.offsets=twin.offsets.map(offset=>({...offset,source:offset.source.map(use)}));twin.displayIntervals=twin.displayIntervals?.map(track=>({...track,anchor:use(track.anchor),...(track.displayRoute?{displayRoute:{...track.displayRoute,seed:{...track.displayRoute.seed,segments:track.displayRoute.seed.segments.map(use)}}}:{})}));
  for(const kind of ['nodes','curves','fills','offsets'] as const)Object.assign(w.library[kind],Object.fromEntries(twin[kind].map(value=>[value.id,value])));source.layers.push(...twin.layers.map(layer=>({...layer,kind:'original' as const})));source.relations.joins!.add!.push(...twin.joins);source.relations.endpointLinks!.add!.push(...twin.endpointLinks!);source.relations.groups!.add!.push(...twin.groups!);source.relations.displayIntervals!.add!.push(...twin.displayIntervals!);
  const domain=cage('cage',source.layers.map(layer=>layer.id));source.deformation.layerDomains=[{...domain,postShape:{nodes:{},handles:{a:[[.02,.01],[-.01,.03]],'route-a':[[.006,.012],[0,0]]}}}];view.parentSnapshotId=source.id;view.inputMirror={axisX:.17,curvePairs:d.curves.map(curve=>({id:'pair:'+curve.id,a:curve.id,b:'twin:'+curve.id,reverse:true}))};view.layers=mirrorSnapshotDrawing(resolveSnapshot(w,source.id).drawing,view.inputMirror).drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
  const before=resolveSnapshot(w,view.id).drawing,result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),copy=loaded.snapshots.find(snapshot=>snapshot.id===map[view.id])!;appearance(before,resolveSnapshot(loaded,target.id).drawing,map);expect(copy.layers).toHaveLength(source.layers.length);expect(copy.deformation.layerDomains).toHaveLength(1);
  const owned=copy.layers[0];if(owned.kind!=='original')throw Error('Owned layer required');const shape=line([.05,.15],[.2,.25]),curveId='new-owned-member',nodeIds=['new-owned-start','new-owned-end'] as [string,string];owned.items.push(curveId);nodeIds.forEach((id,end)=>loaded.library.nodes[id]={id,position:shape[end?3:0]});loaded.library.curves[curveId]={id:curveId,name:'New member',nodes:nodeIds,handles:[shape[1],shape[2]],visible:true,locked:false,width:.015};
  const reflected=(p:Point2):Point2=>[.34-p[0],p[1]],expected=fitDeformedCubic(shape.map(reflected) as Cubic,layerCageDomainProjection(domain)).shape.map(reflected),after=resolveSnapshot(loaded,target.id).drawing;near(shapeOf(after,curveId),expected);expect(shapeOf(after,curveId)).not.toEqual(shape);
  const program=copy.deformation.layerDomains![0];if('materialProgram' in program){const frame=program.materialProgram![0];expect(frame.kind).toBe('reflected');if(frame.kind==='reflected'){expect(frame.reverseCurveIds).not.toContain(curveId);expect(frame.reverseCurveIds).toContain(map.a);expect(frame.reverseCurveIds).toContain(map['twin:a']);}}
  loaded.snapshots=loaded.snapshots.filter(snapshot=>snapshot.id!==source.id&&snapshot.id!==view.id);near(shapeOf(resolveSnapshot(loaded,target.id).drawing,curveId),expected);
 },30000);
 it('replays nested double reflection without ancestor snapshots and validates the bounded pure descriptor',()=>{
  const {w,source,view,target}=fixture();source.deformation.layerDomains=[{...cage('cage',source.layers.map(layer=>layer.id)),postShape:{nodes:{},handles:{a:[[.025,-.013],[.006,.018]]}}}];view.parentSnapshotId=source.id;view.inputMirror={axisX:.23,curvePairs:[]};view.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
  const back=emptyRecordingSnapshot('double-mirror');back.parentSnapshotId=view.id;back.inputMirror={axisX:.23,curvePairs:[]};back.layers=view.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:view.id,baseLayerId:layer.id}));w.snapshots.push(back);
  const original=resolveSnapshot(w,source.id).drawing,before=resolveSnapshot(w,back.id).drawing;for(const curve of original.curves){near(shapeOf(before,curve.id),shapeOf(original,curve.id));near(displayField(before,displayPath(before,curve.id)).geometry.shapes,displayField(original,displayPath(original,curve.id)).geometry.shapes);}
  const result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:back.id}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots)));appearance(before,resolveSnapshot(loaded,target.id).drawing,map);const copy=loaded.snapshots.find(snapshot=>snapshot.id===map[back.id])!,domain=copy.deformation.layerDomains![0];expect(domain).toHaveProperty('materialProgram');
  for(const patch of [{sourceSnapshotId:source.id},{axisX:Infinity},{reverseCurveIds:[map.a,map.a]},{steps:[{kind:'cached-geometry',curves:[]}]}]){const invalid=structuredClone(loaded),saved=invalid.snapshots.find(snapshot=>snapshot.id===copy.id)!.deformation.layerDomains![0];if('materialProgram' in saved)Object.assign(saved.materialProgram![0],patch);expect(()=>parseRecordingSnapshots(invalid)).toThrow();}
  loaded.snapshots=loaded.snapshots.filter(snapshot=>![source.id,view.id,back.id].includes(snapshot.id));appearance(before,resolveSnapshot(loaded,target.id).drawing,map);
 },30000);

 it('copies the real 121-curve face with mixed mirror parity, retained cage, sparse A, native ARC and material',()=>{
  const {w,source,view,target}=fixture(),drawing=parseDrawing(fullFace);
  for(const kind of ['nodes','curves','fills','offsets'] as const)(w.library[kind] as Record<string,{id:string}>)=Object.fromEntries(drawing[kind].map(value=>[value.id,value]));source.layers=drawing.layers.map(layer=>({...layer,kind:'original'}));source.relations={joins:{add:drawing.joins},endpointLinks:{add:drawing.endpointLinks??[]},groups:{add:drawing.groups??[]},displayIntervals:{add:drawing.displayIntervals??[]}};
  source.deformation.layerDomains=[{...cage('full-cage',source.layers.map(layer=>layer.id)),postShape:{nodes:{},handles:{[drawing.curves[0].id]:[[.002,.001],[0,0]]}}}];view.parentSnapshotId=source.id;view.inputMirror={axisX:drawing.mirrorAxisX!,curvePairs:drawing.mirrorEditing!.curvePairs,axisNodeIds:drawing.mirrorEditing!.axisNodeIds};view.layers=mirrorSnapshotDrawing(resolveSnapshot(w,source.id).drawing,view.inputMirror).drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
  const before=resolveSnapshot(w,view.id).drawing,bytes=JSON.stringify(w),result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),after=resolveSnapshot(loaded,target.id).drawing;
  expect(before.curves).toHaveLength(121);expect(view.inputMirror.curvePairs.filter(pair=>pair.reverse)).toHaveLength(1);expect(after.curves).toHaveLength(121);appearance(before,after,map);expect(JSON.stringify(w)).toBe(bytes);loaded.snapshots=loaded.snapshots.filter(snapshot=>snapshot.id!==source.id&&snapshot.id!==view.id);appearance(before,resolveSnapshot(loaded,target.id).drawing,map);
 },60000);
 it.each([{matrix:[0,0,0,0,.1,.2] as Affine2D},{matrix:[-1,0,.1,.9,.1,.2] as Affine2D}])('retains collapsed and reflected affine outputs after the nonlinear program: $matrix',({matrix})=>{
  const {w,view,target}=fixture();delete w.library.offsets.offset;const layer=w.snapshots[0].layers.find(layer=>layer.id==='route-left')!;if(layer.kind==='original')layer.items=layer.items.filter(id=>id!=='offset');view.deformation.layerDomains=[cage('cage',view.layers.map(layer=>layer.id)),{id:'affine',layerIds:view.layers.map(layer=>layer.id),matrix}];const before=resolveSnapshot(w,view.id).drawing,result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:view.id}]}),map=result.idMaps[0].idMap;appearance(before,resolveSnapshot(result.recordingSnapshots,target.id).drawing,map);
 });
 it('self-copy preserves every original layer with two affine groups, an existing program, and an untouched plain layer',()=>{
  const {w,source,view,recording}=fixture();recording.snapshotIds=[view.id];recording.activeSnapshotId=view.id;
  w.library.nodes.unselected0={id:'unselected0',position:[-.2,.6]};w.library.nodes.unselected1={id:'unselected1',position:[.3,.7]};w.library.curves.unselected={id:'unselected',name:'Untouched',nodes:['unselected0','unselected1'],handles:[[0,.8],[.2,.5]],visible:true,locked:false,width:.024,inkEnds:[{taper:.025},{extension:.009}]};
  source.layers.push({kind:'original',id:'unselected-layer',name:'Unselected',visible:true,locked:false,items:['unselected']});view.layers.push({kind:'reference',id:'unselected-slot',name:'Unselected',baseSnapshotId:source.id,baseLayerId:'unselected-layer'});
  view.deformation.layers['slot:shape']={placement:{translation:[.03,-.01],rotation:0,scale:1,scaleX:1.5}};
  for(const id of ['slot:route-left','slot:route-right'])view.deformation.layers[id]={placement:{translation:[-.02,.04],rotation:0,scale:1,scaleX:1.2,scaleY:.8}};
  view.deformation.layerDomains=[{...cage('original-cage',['slot:shape']),postShape:{nodes:{},handles:{a:[[.015,.012],[0,0]]}}}];
  const bytes=JSON.stringify(w),before=resolveSnapshot(w,view.id).drawing,layerIds=new Set(before.layers.map(layer=>layer.id)),curveIds=new Set(before.curves.map(curve=>curve.id)),nodeIds=new Set(before.nodes.map(node=>node.id)),identity=Object.fromEntries([...layerIds,...curveIds,...nodeIds,...before.fills.map(fill=>fill.id),...before.offsets.map(offset=>offset.id),...before.joins.map(join=>join.id),...before.endpointLinks!.map(link=>link.id),...before.groups!.map(group=>group.id),...before.displayIntervals!.flatMap(track=>[track.id,...track.ranges.map(range=>range.id)])].map(id=>[id,id]));
  const originals=(drawing:DrawingDocument)=>retainSnapshotAffines({...drawing,layers:drawing.layers.filter(layer=>layerIds.has(layer.id)),curves:drawing.curves.filter(curve=>curveIds.has(curve.id)),nodes:drawing.nodes.filter(node=>nodeIds.has(node.id)),fills:drawing.fills.filter(fill=>Object.hasOwn(identity,fill.id)),offsets:drawing.offsets.filter(offset=>Object.hasOwn(identity,offset.id)),joins:drawing.joins.filter(join=>Object.hasOwn(identity,join.id)),endpointLinks:drawing.endpointLinks?.filter(link=>Object.hasOwn(identity,link.id)),groups:drawing.groups?.filter(group=>Object.hasOwn(identity,group.id)),displayIntervals:drawing.displayIntervals?.filter(track=>Object.hasOwn(identity,track.id))},[drawing]);
  const h=harness(w),result=h.value(h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:view.id,layerIds:['slot:shape']}]})),map=result.idMaps[0].idMap,current=h.project().recordingSnapshots!;
  expect(JSON.stringify(w)).toBe(bytes);expect(current.snapshots.find(snapshot=>snapshot.id===view.id)!.deformation).toEqual(view.deformation);expect(current.snapshots.find(snapshot=>snapshot.id===source.id)).toEqual(source);
  for(const kind of ['nodes','curves','fills','offsets'] as const)for(const [id,value] of Object.entries(w.library[kind]))expect(current.library[kind][id]).toEqual(value);
  const sameObject=resolveSnapshot(current,view.id).drawing;appearance(before,originals(sameObject),identity);appearance(before,originals(resolveSnapshot(current,view.id).drawing),identity);appearance(before,resolveSnapshot(w,view.id).drawing,identity);
  const cold=parseRecordingSnapshots(JSON.parse(JSON.stringify(current)));appearance(before,originals(resolveSnapshot(cold,view.id).drawing),identity);
  const originalField=displayField(before,displayPath(before,'a')),copyField=displayField(sameObject,displayPath(sameObject,map.a));near(copyField.geometry.shapes,originalField.geometry.shapes);near(strokeInk(sameObject,strokeFor(sameObject,map.a)),strokeInk(before,strokeFor(before,'a')));
  expect(h.past).toHaveLength(1);h.value(h.api.undo());expect(JSON.stringify(h.project().recordingSnapshots)).toBe(bytes);h.value(h.api.redo());appearance(before,originals(resolveSnapshot(h.project().recordingSnapshots!,view.id).drawing),identity);
 });

 it('retains affine translation on an offset-only layer beside retained cage material',()=>{
  const {d}=fixture(),deformed=applyLayerCageDomain(d,cage('cage',d.layers.map(layer=>layer.id))),offset=deformed.offsets[0],input={...deformed,layers:[...deformed.layers.map(layer=>({...layer,items:layer.items.filter(id=>id!==offset.id)})),{id:'offset-only',name:'Offset only',visible:true,locked:false,items:[offset.id]}]},owners=drawingLayerObjectOwners(input),before=offsetGeometry(input,offset),after=placeDrawingAffines(input,{'offset-only':[2,0,.2,3,.1,-.1]},id=>owners.get(id));
  expect(after).not.toBe(input);expect(after.nodes).toBe(input.nodes);expect(after.curves).toBe(input.curves);expect(after.offsets[0].translation).toEqual([.042,-.12]);expect(input.offsets[0].translation).toEqual([.025,-.04]);
  const moved=offsetGeometry(after,after.offsets[0]);near(moved.shapes,before.shapes.map(shape=>shape.map(([x,y])=>[x+.017,y-.08])));near(displayField(after,displayPath(after,'a')).geometry.shapes,displayField(input,displayPath(input,'a')).geometry.shapes);
 });

});
