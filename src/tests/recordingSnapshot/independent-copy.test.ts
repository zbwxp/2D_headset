import {describe,expect,it} from 'vitest';
import fullFace from '../../assets/hairless-symmetric-two-face-mirror.json';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {fillGeometry,strokeInk} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {drawingIdentityIds} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {createVectorEditingApi,type VectorResult} from '../../app/vectorEditingApi';
import {createEmptyProject} from '../../app/emptyProject';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Affine2D} from '../../domain/geometry/affine2d';

const near=(a:unknown,b:unknown):void=>{
 if(typeof a==='number'&&typeof b==='number'){expect(a).toBeCloseTo(b,8);return;}
 if(Array.isArray(a)&&Array.isArray(b)){expect(a).toHaveLength(b.length);a.forEach((v,i)=>near(v,b[i]));return;}
 if(a&&b&&typeof a==='object'&&typeof b==='object'){expect(Object.keys(a)).toEqual(Object.keys(b));for(const key of Object.keys(a))near((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]);return;}
 expect(a).toEqual(b);
};
function fixture(){
 const w=emptyRecordingSnapshotWorkspace(),drawing=emptyDrawing();
 for(const side of ['left','right']){
  const points:Point2[]=side==='left'?[[-2,0],[-1,0],[-1,1]]:[[1.3,.2],[2.5,.2],[2.5,1.5]],layer=`${side}-layer`,width=side==='left'?.025:.011;
  drawing.layers.push({id:layer,name:side,visible:true,locked:false,items:[`${side}-a`,`${side}-b`,`${side}-c`,`${side}-fill`]});
  points.forEach((position,i)=>drawing.nodes.push({id:`${side}-${i}`,position}));
  for(const [i,suffix] of ['a','b','c'].entries()){
   const a=points[i],b=points[(i+1)%3],mix=(t:number):Point2=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
   drawing.curves.push({id:`${side}-${suffix}`,name:`${side} ${suffix}`,nodes:[`${side}-${i}`,`${side}-${(i+1)%3}`],handles:[mix(1/3),mix(2/3)],visible:true,locked:false,width,inkEnds:[{taper:.015},{extension:.005}],profile:'UNIFORM'});
  }
  drawing.joins.push({id:`${side}-arc`,a:{curveId:`${side}-a`,end:1},b:{curveId:`${side}-b`,end:0},mode:'ARC',radius:side==='left'?.2:.1});
  drawing.fills.push({id:`${side}-fill`,name:`${side} fill`,visible:true,locked:false,color:side==='left'?'black':'white',boundary:['a','b','c'].map(suffix=>({id:`${side}-${suffix}`,reverse:false}))});
  (drawing.groups??=[]).push({id:`${side}-group`,name:side,visible:true,locked:false,curveIds:['a','b','c'].map(suffix=>`${side}-${suffix}`)});
  (drawing.displayIntervals??=[]).push({id:`${side}-interval`,anchor:{id:`${side}-a`,reverse:false},ranges:[{id:`${side}-show`,mode:'SHOW',start:.05,end:.95,inkEnds:[{taper:.015},{extension:.005}]},{id:`${side}-hide`,mode:'HIDE',start:.4,end:.55,enabled:side==='left'}]});
 }
 const source=emptyRecordingSnapshot('source','Original','drawing');source.layers=drawing.layers.map(layer=>({...layer,kind:'original'}));source.relations={joins:{add:drawing.joins},groups:{add:drawing.groups},displayIntervals:{add:drawing.displayIntervals}};
 for(const kind of ['nodes','curves','fills','offsets'] as const)Object.assign(w.library[kind],Object.fromEntries(drawing[kind].map(value=>[value.id,value])));
 const mirror=emptyRecordingSnapshot('mirror','Mirrored','view',{x:90,y:0});mirror.parentSnapshotId=source.id;mirror.parentLayers={};mirror.inputMirror={axisX:0,curvePairs:['a','b','c'].map(suffix=>({id:`pair-${suffix}`,a:`left-${suffix}`,b:`right-${suffix}`,reverse:false}))};mirror.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
 const target=emptyRecordingSnapshot('destination','Destination'),recording=emptySnapshotRecording('target-recording');recording.snapshotIds=[target.id];recording.activeSnapshotId=target.id;w.snapshots=[source,mirror,target];w.recordings=[recording];w.activeRecordingId=recording.id;
 return {w,source,mirror,target,drawing};
}
function harness(w:RecordingSnapshotWorkspace){
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:w};const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source write');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
 return {api,project:()=>project,past,value};
}
function assertAppearance(before:DrawingDocument,after:DrawingDocument,map:Record<string,string>,curveId='right-a'){
 const copy=map[curveId];near(shapeOf(after,copy),shapeOf(before,curveId));
 const field=displayField(before,displayPath(before,curveId)),copied=displayField(after,displayPath(after,copy));near(copied.geometry.shapes,field.geometry.shapes);near(copied.inkSpans,field.inkSpans);
 for(const s of [0,.1,.25,.4,.5,.75,1])near(copied.at(s).p,field.at(s).p);
 const ink=(drawing:DrawingDocument,id:string)=>strokeInk(drawing,strokeFor(drawing,id)).map(run=>({shapes:run.shapes,outline:run.outline,closed:run.closed}));near(ink(after,copy),ink(before,curveId));
 const fill=before.fills.find(fill=>fill.id==='right-fill');if(fill){const copied=after.fills.find(value=>value.id===map[fill.id])!;expect(copied.color).toBe(fill.color);near(fillGeometry(after,copied).shapes,fillGeometry(before,fill).shapes);}
}

describe('current-shape independent layer copies',()=>{
 it('copies the evaluated mirrored partner, material, paint and local identities through public API, JSON and Undo',()=>{
  const {w,source,mirror,target}=fixture(),before=resolveSnapshot(w,mirror.id,{useDraft:false}).drawing,bytes=JSON.stringify(w),h=harness(w);
  const result=h.value(h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id,layerIds:['right-layer']}]})),map=result.idMaps[0].idMap,current=h.project().recordingSnapshots!,copied=current.snapshots.find(snapshot=>snapshot.id===map[mirror.id])!;
  expect(JSON.stringify(w)).toBe(bytes);expect(current.snapshots).toHaveLength(w.snapshots.length+1);expect(copied.parentSnapshotId).toBeUndefined();expect(copied.inputMirror).toBeUndefined();expect(copied.parentLayers).toBeUndefined();expect(copied.layers[0].kind).toBe('original');expect(copied.deformation.warps).toEqual([]);expect(copied.deformation.layers).toEqual({});
  const rightIds=drawingIdentityIds({...before,layers:before.layers.filter(layer=>layer.id==='right-layer'),curves:before.curves.filter(curve=>curve.id.startsWith('right-')),nodes:before.nodes.filter(node=>node.id.startsWith('right-')),fills:before.fills.filter(fill=>fill.id==='right-fill'),joins:before.joins.filter(join=>join.id==='right-arc'),groups:before.groups?.filter(group=>group.id==='right-group'),displayIntervals:before.displayIntervals?.filter(track=>track.id==='right-interval')});
  for(const id of rightIds){expect(map[id],id).toBeDefined();expect(map[id]).not.toBe(id);}expect(map['left-a']).toBeUndefined();
  const evaluated=resolveSnapshot(current,target.id,{useDraft:false}).drawing;assertAppearance(before,evaluated,map);expect(evaluated.curves.find(curve=>curve.id===map['right-a'])!.width).toBe(.025);expect(evaluated.fills[0].color).toBe('black');
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(current)));assertAppearance(before,resolveSnapshot(loaded,target.id,{useDraft:false}).drawing,map);
  expect(h.past).toHaveLength(1);h.value(h.api.undo());expect(JSON.stringify(h.project().recordingSnapshots)).toBe(bytes);h.value(h.api.redo());assertAppearance(before,resolveSnapshot(h.project().recordingSnapshots!,target.id).drawing,map);
  const detached=structuredClone(loaded);detached.library.nodes['left-0'].position=[-10,5];detached.snapshots.find(snapshot=>snapshot.id===source.id)!.relations.displayIntervals!.add![0].ranges[0].start=.7;assertAppearance(before,resolveSnapshot(detached,target.id).drawing,map);
 });
 it.each([{matrix:[1,.3,.7,-1,.2,.4] as Affine2D},{matrix:[0,0,0,2,.2,.4] as Affine2D},{matrix:[0,0,0,0,.2,.4] as Affine2D}])('retains the minimal deferred ARC material domain under matrix $matrix',({matrix})=>{
  const {w,source,mirror,target}=fixture();source.deformation.layerDomains=[{id:'affine',layerIds:['left-layer','right-layer'],matrix}];const before=resolveSnapshot(w,mirror.id,{useDraft:false}).drawing,bytes=JSON.stringify(w),project={...createEmptyProject(),recordingSnapshots:w};
  const result=prepareSnapshotBatch(project,{commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id,layerIds:['right-layer']}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),copy=loaded.snapshots.find(snapshot=>snapshot.id===map[mirror.id])!;
  expect(JSON.stringify(w)).toBe(bytes);expect(copy.deformation.layerDomains).toHaveLength(1);expect(copy.deformation.warps).toEqual([]);expect(copy.deformation.layers).toEqual({});assertAppearance(before,resolveSnapshot(loaded,target.id).drawing,map);
 });
 it('freezes nested shape residuals exactly once and keeps the new copy editable',()=>{
  const {w,source,mirror,target}=fixture();delete mirror.inputMirror;source.deformation.layers['right-layer']={shape:{nodes:{'right-0':[.1,.2]},handles:{'right-a':[[.02,.03],[0,0]]}}};mirror.deformation.layers['right-layer']={shape:{nodes:{'right-0':[.3,-.1]},handles:{'right-a':[[.04,.01],[0,0]]}}};
  const before=resolveSnapshot(w,mirror.id).drawing,project={...createEmptyProject(),recordingSnapshots:w},result=prepareSnapshotBatch(project,{commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id,layerIds:['right-layer']}]}),map=result.idMaps[0].idMap,slot=result.created.find(value=>value.kind==='layer')!.id;
  assertAppearance(before,resolveSnapshot(result.recordingSnapshots,target.id).drawing,map);const original=JSON.stringify(result.recordingSnapshots.snapshots.slice(0,2));
  const moved=prepareSnapshotBatch({...project,recordingSnapshots:result.recordingSnapshots},{commands:[{op:'moveShapeHandle',layerId:slot,curveId:map['right-a'],end:0,position:[1.8,.9]},{op:'updateSnapshot'}]});
  near(resolveSnapshot(moved.recordingSnapshots,target.id).drawing.curves.find(curve=>curve.id===map['right-a'])!.handles[0],[1.8,.9]);expect(JSON.stringify(moved.recordingSnapshots.snapshots.slice(0,2))).toBe(original);expect(w.library.curves['right-a']).toEqual(result.recordingSnapshots.library.curves['right-a']);
 });
 it('rejects unrepresentable heterogeneous reflected material atomically with the exact curve ID',()=>{
  const {w,mirror}=fixture();delete mirror.inputMirror;mirror.deformation.layers['right-layer']={elementPlacements:{'right-a':{translation:[0,0],rotation:0,scale:1,scaleX:.5,scaleY:2},'right-b':{translation:[0,0],rotation:0,scale:1,scaleX:.5,scaleY:2},'right-c':{translation:[0,0],rotation:0,scale:1,scaleX:.5,scaleY:2}}};
  // An independent extra curve shares the layer, but no topology or material.
  w.library.nodes.extra0={id:'extra0',position:[4,0]};w.library.nodes.extra1={id:'extra1',position:[5,0]};w.library.curves.extra={id:'extra',name:'Extra',nodes:['extra0','extra1'],handles:[[4.3,0],[4.7,0]],width:.01,visible:true,locked:false};
  const layer=mirror.layers.find(layer=>layer.id==='right-layer')!;if(layer.kind==='reference')layer.membership={addElementIds:['extra']};mirror.deformation.layerDomains=[{id:'reflection',layerIds:['right-layer'],matrix:[-1,0,.2,1,0,0]}];
  const bytes=JSON.stringify(w),h=harness(w),result=h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id,layerIds:['right-layer']}]});expect(result).toMatchObject({ok:false,error:{code:'INDEPENDENT_COPY_UNSUPPORTED',message:expect.stringContaining('object right-a')}});expect(JSON.stringify(w)).toBe(bytes);expect(h.project().recordingSnapshots).toBe(w);expect(h.past).toHaveLength(0);
 });
 it('preserves cross-layer display ARC links, interval direction and offset paint while enforcing dependency closure',()=>{
  const {w,source,mirror,target}=fixture();w.snapshots=w.snapshots.filter(snapshot=>snapshot!==mirror);
  w.library.nodes={a0:{id:'a0',position:[0,0]},a1:{id:'a1',position:[1,0]},b0:{id:'b0',position:[1,0]},b1:{id:'b1',position:[1,1]}};
  const properties={name:'Line',visible:true,locked:false,width:.02};w.library.curves={a:{...properties,id:'a',nodes:['a0','a1'],handles:[[.3,0],[.7,0]]},b:{...properties,id:'b',nodes:['b0','b1'],handles:[[1,.3],[1,.7]]}};w.library.fills={};
  w.library.offsets={offset:{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'a',reverse:false}],distance:.02,start:.1,end:.8,taper:.1,width:.012,translation:[.08,-.03]}};
  source.layers=[{kind:'original',id:'left-layer',name:'Left',visible:true,locked:false,items:['a','offset']},{kind:'original',id:'right-layer',name:'Right',visible:true,locked:false,items:['b']}];
  source.relations={endpointLinks:{add:[{id:'link',a:{curveId:'a',end:1},b:{curveId:'b',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.2}}]},displayIntervals:{add:[{id:'route',anchor:{id:'a',reverse:false},displayRoute:{seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:['link']},ranges:[{id:'show',start:.1,end:.9,inkEnds:[{taper:.04},{taper:.02}]}]}]}};
  source.deformation.layerDomains=[{id:'affine',layerIds:['left-layer','right-layer'],matrix:[1,.2,.6,2,.1,.3]}];
  const project={...createEmptyProject(),recordingSnapshots:w},bytes=JSON.stringify(w);expect(()=>prepareSnapshotBatch(project,{commands:[{op:'cloneLayers',sourceSnapshotId:source.id,layerIds:['left-layer']}]})).toThrow(/object link.*dependent layers: right-layer/);expect(JSON.stringify(w)).toBe(bytes);
  const before=resolveSnapshot(w,source.id).drawing,result=prepareSnapshotBatch(project,{commands:[{op:'cloneLayers',sourceSnapshotId:source.id,layerIds:['left-layer','right-layer']}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),actual=resolveSnapshot(loaded,target.id).drawing;
  assertAppearance(before,actual,map,'a');expect(actual.endpointLinks![0]).toMatchObject({id:map.link,a:{curveId:map.a},b:{curveId:map.b},joinBrush:{kind:'ARC',trimDistance:.2}});expect(actual.displayIntervals![0].displayRoute!.throughLinkIds).toEqual([map.link]);expect(actual.offsets[0]).toMatchObject({id:map.offset,source:[{id:map.a,reverse:false}],width:.012});expect(JSON.stringify(w)).toBe(bytes);
 });
 it('copies the full 121-curve mirrored asset with source-only identities and material intact',()=>{
  const {w,source,mirror,target}=fixture(),drawing=parseDrawing(fullFace);
  for(const kind of ['nodes','curves','fills','offsets'] as const)(w.library[kind] as Record<string,{id:string}>)=Object.fromEntries(drawing[kind].map(value=>[value.id,value]));
  source.layers=drawing.layers.map(layer=>({...layer,kind:'original'}));source.relations={joins:{add:drawing.joins},endpointLinks:{add:drawing.endpointLinks??[]},groups:{add:drawing.groups??[]},displayIntervals:{add:drawing.displayIntervals??[]}};
  source.deformation.layerDomains=[{id:'full-affine',layerIds:source.layers.map(layer=>layer.id),matrix:[1,.3,.1,.8,.04,.06]}];mirror.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));mirror.inputMirror={axisX:drawing.mirrorAxisX!,...drawing.mirrorEditing!};delete (mirror.inputMirror as {enabled?:boolean}).enabled;mirror.layers=mirrorSnapshotDrawing(resolveSnapshot(w,source.id).drawing,mirror.inputMirror).drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
  const before=resolveSnapshot(w,mirror.id).drawing,bytes=JSON.stringify(w),result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots))),after=resolveSnapshot(loaded,target.id).drawing;
  expect(before.curves).toHaveLength(121);expect(after.curves).toHaveLength(121);for(const curve of before.curves){near(shapeOf(after,map[curve.id]),shapeOf(before,curve.id));expect(after.curves.find(value=>value.id===map[curve.id])!.width).toBe(curve.width);}expect(after.displayIntervals).toHaveLength(before.displayIntervals!.length);for(const fill of before.fills)expect(after.fills.find(value=>value.id===map[fill.id])!.color).toBe(fill.color);expect(JSON.stringify(w)).toBe(bytes);
  // A locally reordered mirror can still use its old source paint context.
  // Reject that unsupported relative-order mismatch before publishing IDs.
  mirror.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));const h=harness(w),baseline=JSON.stringify(w),rejected=h.api.snapshot({commands:[{op:'cloneLayers',sourceSnapshotId:mirror.id}]});expect(rejected).toMatchObject({ok:false,error:{code:'INDEPENDENT_COPY_UNSUPPORTED',message:expect.stringContaining('relative paint order')}});expect(JSON.stringify(w)).toBe(baseline);expect(h.past).toHaveLength(0);
 },30000);
 it('materializes a real inserted view without retaining its recipe or old basis dependency',()=>{
  const {w,source,mirror,target}=fixture();w.snapshots=w.snapshots.filter(snapshot=>snapshot!==mirror);const first=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
  for(const [index,snapshot] of [first,side].entries()){snapshot.layers=[{kind:'reference',id:'right-layer',name:'Right',baseSnapshotId:source.id,baseLayerId:'right-layer'}];snapshot.deformation.layers['right-layer']={placement:{translation:[index*.3,index*.2],rotation:0,scale:1},intervals:{'right-interval':{appearance:{...source.relations.displayIntervals!.add![1],ranges:[{id:'right-show',start:.1,end:index?.8:.9}]},enabled:{}}}};}
  const recording=emptySnapshotRecording('material-recording');recording.mode='triangulated';recording.snapshotIds=[first.id,side.id];recording.activeSnapshotId=first.id;recording.angleGraph=createSnapshotAngleGraph([first,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.snapshots.push(first,side);w.recordings.push(recording);w.activeRecordingId=recording.id;
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0}});const inserted=recording.activeSnapshotId!;expect(recording.angleGraph.materialBasisRecipes?.[inserted]).toBeDefined();const before=resolveSnapshot(w,inserted).drawing;w.activeRecordingId='target-recording';
  const result=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'cloneLayers',sourceSnapshotId:inserted,layerIds:['right-layer']}]}),map=result.idMaps[0].idMap,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.recordingSnapshots)));assertAppearance(before,resolveSnapshot(loaded,target.id).drawing,map);
  loaded.library.nodes['right-0'].position=[50,50];assertAppearance(before,resolveSnapshot(loaded,target.id).drawing,map);expect(loaded.snapshots.find(snapshot=>snapshot.id===map[inserted])!.parentSnapshotId).toBeUndefined();
 });
});
