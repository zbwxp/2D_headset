import {expect,test} from 'vitest';
import {createVectorEditingApi,type VectorEditingHost,type VectorResult,type VectorCommand} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,ellipse,createCurve,linkEndpoints} from '../domain/drawing/commands';
import {createFill,movePaint} from '../domain/drawing/paintCommands';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {fillGeometry} from '../domain/drawing/appearance';
import type {LandmarkProject} from '../domain/landmarks/model';

function fixture(){let d=addLayer(emptyDrawing(),'Eye');const e=ellipse(d,d.layers[0].id,[-1,-.5],[1,.5],.02);d=createFill(e.document,e.ids,'white');d.curves[0].visible=false;d.mirrorAxisX=.2;return d;}
function harness(d=fixture()){
 let project:LandmarkProject={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[],mode:'drawing'|'recording'='drawing',commits=0;
 const host:VectorEditingHost={getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(drawing){commits++;past.push(project);future=[];project={...project,drawing};},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}};
 return {api:createVectorEditingApi(host),state:()=>({project,past,commits}),mode:(v:typeof mode)=>{mode=v;}};
}
function value<T>(r:VectorResult<T>):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
function error(r:VectorResult<unknown>,code:string){expect(r.ok).toBe(false);if(!r.ok)expect(r.error.code).toBe(code);}

test('duplicate, mirror, rename and reorder a complete filled layer atomically with local references',()=>{
 const source=fixture(),h=harness(source),revision=h.api.inspect().revision,layer=source.layers[0].id;
 const commands:VectorCommand[]=[{op:'duplicateLayer',layerId:layer,ref:'copy'},{op:'transformLayers',layerIds:['$copy'],matrix:[-1,0,0,1,.4,0]},{op:'setLayer',layerId:'$copy',name:'Mirrored eye'},{op:'reorderLayer',layerId:'$copy',targetLayerId:layer,after:true}];
 const dry=value(h.api.execute({commands,expectedRevision:revision,dryRun:true}));expect(dry.applied).toBe(false);expect(dry.created).toHaveLength(1);expect(h.state().commits).toBe(0);expect(h.api.inspect().revision).toBe(revision);
 const result=value(h.api.execute({commands,expectedRevision:revision})),map=result.created[0].idMap!,d=h.state().project.drawing!;
 expect(h.state().commits).toBe(1);expect(d.layers.map(l=>l.name)).toEqual(['Eye','Mirrored eye']);expect(result.addedCurves).toHaveLength(4);
 for(const c of source.curves){expect(shapeOf(d,map[c.id])).toEqual(shapeOf(source,c.id).map(([x,y])=>[.4-x,y]));expect(d.curves.find(x=>x.id===map[c.id])!.visible).toBe(c.visible);}
 expect(d.fills.at(-1)!.boundary).toEqual(source.fills[0].boundary.map(u=>({...u,id:map[u.id]})));expect(fillGeometry(d,d.fills.at(-1)!).error).toBeUndefined();
 value(h.api.undo());expect(h.state().project.drawing).toBe(source);value(h.api.redo());expect(h.state().project.drawing).toBe(d);
});

test('empty named layers can be created, queried, renamed, hidden and removed',()=>{
 const h=harness(emptyDrawing()),r=value(h.api.execute({commands:[{op:'createLayer',name:'A',ref:'a'},{op:'createLayer',name:'B',ref:'b'},{op:'setLayer',layerId:'$a',name:'Named empty',visible:false},{op:'reorderLayer',layerId:'$a',targetLayerId:'$b'}]}));
 expect(value(h.api.inspect({layerNames:['Named empty']})).layers.map(l=>l.name)).toEqual(['Named empty']);expect(value(h.api.inspect()).mirrorAxisX).toBe(0);
 const id=r.created[0].id,result=value(h.api.execute({commands:[{op:'deleteLayers',layerIds:[id]}]}));expect(result.removed.layerIds).toEqual([id]);
});

test('boundary visibility changes preserve fill geometry and are independently reversible',()=>{
 const d=fixture(),h=harness(d),shape=fillGeometry(d,d.fills[0]).shapes;
 const r=value(h.api.execute({commands:[{op:'setObjectState',objectIds:d.curves.map(c=>c.id),visible:false},{op:'setFill',fillId:d.fills[0].id,name:'Skin',color:'black'}]}));
 const after=h.state().project.drawing!;expect(after.curves.every(c=>!c.visible)).toBe(true);expect(after.fills[0]).toMatchObject({name:'Skin',color:'black',visible:true});expect(fillGeometry(after,after.fills[0]).shapes).toEqual(shape);expect(r.fillIds).toEqual([d.fills[0].id]);
 value(h.api.undo());expect(h.state().project.drawing).toBe(d);
});

test('create and remove a fill in an existing closed boundary without raw document replacement',()=>{
 const d=fixture();d.fills=[];d.layers[0].items=d.layers[0].items.filter(id=>d.curves.some(c=>c.id===id));const h=harness(d);
 const r=value(h.api.execute({commands:[{op:'createFill',curveIds:d.curves.map(c=>c.id),color:'white',ref:'skin'},{op:'setFill',fillId:'$skin',visible:false},{op:'reorderObject',objectId:'$skin',targetObjectId:d.curves[0].id,after:true}]}));
 const id=r.created[0].id;expect(h.state().project.drawing!.fills[0]).toMatchObject({id,visible:false});value(h.api.execute({commands:[{op:'deleteObjects',objectIds:[id]}]}));expect(h.state().project.drawing!.fills).toEqual([]);
});

test('failures after provisional creation leave no partial edits, history or aliases',()=>{
 const h=harness(),before=h.state().project,revision=h.api.inspect().revision;
 for(const commands of [
  [{op:'createLayer',name:'Temporary',ref:'new'},{op:'setLayer',layerId:'missing',name:'Fail'}],
  [{op:'createLayer',name:'A',ref:'new'},{op:'createLayer',name:'B',ref:'new'}],
  [{op:'createLayer',name:'A',ref:'bad ref'}],
  [{op:'setLayer',layerId:'$future',name:'No forward alias'}],
 ] as VectorCommand[][]){expect(h.api.execute({commands}).ok).toBe(false);expect(h.state().project).toBe(before);expect(h.state().commits).toBe(0);expect(h.api.inspect().revision).toBe(revision);}
 error(h.api.execute({commands:[{op:'setLayer',layerId:'$new',name:'No leaked alias'}]}),'UNKNOWN_REFERENCE');
});

test('CRUD mutations preserve mode, stale revision, strict input and locking gates',()=>{
 const h=harness(),layer=h.state().project.drawing!.layers[0].id,revision=h.api.inspect().revision;
 h.mode('recording');error(h.api.execute({commands:[{op:'deleteLayers',layerIds:[layer]}]}),'MODE_RESTRICTED');h.mode('drawing');
 value(h.api.execute({commands:[{op:'setLayer',layerId:layer,name:'Changed'}]}));error(h.api.execute({commands:[{op:'deleteLayers',layerIds:[layer]}],expectedRevision:revision}),'STALE_REVISION');
 const state=h.state().project;error(h.api.execute({commands:[{op:'setLayer',layerId:layer,visible:'false'} as unknown as VectorCommand]}),'INVALID_REQUEST');error(h.api.execute({commands:[{op:'setLayer',layerId:layer,extra:true} as unknown as VectorCommand]}),'INVALID_REQUEST');expect(h.state().project).toBe(state);
 value(h.api.execute({commands:[{op:'setLayer',layerId:layer,locked:true}]}));expect(h.api.execute({commands:[{op:'deleteLayers',layerIds:[layer]}]}).ok).toBe(false);
 value(h.api.execute({commands:[{op:'setLayer',layerId:layer,locked:false},{op:'deleteLayers',layerIds:[layer]}]}));expect(h.state().project.drawing!.layers).toEqual([]);
});

test('deleting a used boundary is rejected unless its fill is explicitly removed too',()=>{
 const d=fixture(),h=harness(d);error(h.api.execute({commands:[{op:'deleteObjects',objectIds:[d.curves[0].id]}]}),'GEOMETRY_INVALID');expect(h.state().commits).toBe(0);
 const r=value(h.api.execute({commands:[{op:'deleteObjects',objectIds:[...d.curves.map(c=>c.id),d.fills[0].id]}]}));expect(r.removed.curveIds).toHaveLength(4);expect(r.removed.fillIds).toHaveLength(1);expect(h.state().project.drawing!.curves).toEqual([]);
});

test('layer duplication rejects external endpoint dependencies instead of silently dropping them',()=>{
 let d=addLayer(emptyDrawing(),'One');const one=d.layers[0].id;d=createCurve(d,one,[[0,0],[.2,0],[.4,0],[.6,0]],.02,'A','a');d=addLayer(d,'Two');d=createCurve(d,d.layers[0].id,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.02,'B','b');d=linkEndpoints(d,{curveId:'a',end:0},{curveId:'b',end:0});const h=harness(d);
 error(h.api.execute({commands:[{op:'duplicateLayer',layerId:one}]}),'DEPENDENCY_REQUIRED');expect(h.state().project.drawing).toBe(d);expect(h.state().commits).toBe(0);
});

test('creates a closed filled piece and hides only its internal closure through an explicit interval',()=>{
 const h=harness(emptyDrawing()),line=(a:[number,number],b:[number,number])=>[a,a.map((x,i)=>x+(b[i]-x)/3),a.map((x,i)=>x+2*(b[i]-x)/3),b];
 const commands:VectorCommand[]=[{op:'createLayer',name:'Face piece',ref:'piece'},...[[[-1,-1],[.2,-1]],[[.2,-1],[.2,1]],[[.2,1],[-1,1]],[[-1,1],[-1,-1]]].map((ends,i)=>({op:'createCurve',layerId:'$piece',shape:line(ends[0] as [number,number],ends[1] as [number,number]),name:`Edge ${i}`,ref:`edge${i}`} as VectorCommand)),{op:'createFill',curveIds:['$edge0','$edge1','$edge2','$edge3'],color:'white',ref:'skin'},{op:'addDisplayInterval',curveId:'$edge1',mode:'HIDE',start:0,end:1,ref:'closure'},{op:'setDisplayIntervalEnd',rangeId:'$closure',end:0,style:{taper:0,extension:0}}];
 const result=value(h.api.execute({commands})),d=h.state().project.drawing!;expect(h.state().commits).toBe(1);expect(d.curves).toHaveLength(4);expect(d.fills).toHaveLength(1);expect(d.joins).toHaveLength(0);expect(fillGeometry(d,d.fills[0]).error).toBeUndefined();
 const range=result.created.find(x=>x.ref==='closure')!;expect(d.displayIntervals![0].ranges[0]).toMatchObject({id:range.id,mode:'HIDE',start:0,end:1,inkEnds:[{taper:0,extension:0},{taperWidthScale:20}]});
 value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId:range.id,enabled:false,start:.2,end:.8}]}));expect(h.state().project.drawing!.displayIntervals![0].ranges[0]).toMatchObject({enabled:false,start:.2,end:.8});
 value(h.api.execute({commands:[{op:'removeDisplayInterval',rangeId:range.id}]}));expect(h.state().project.drawing!.displayIntervals).toEqual([]);expect(h.state().project.drawing!.fills).toEqual(d.fills);
});

test('curve subdivision retains fills and authored outer tip styles and reports its new curve',()=>{
 const d=fixture();d.curves.forEach(c=>{c.visible=true;});const id=d.curves[0].id;d.curves[0].inkEnds=[{taper:.12,extension:.01},{taper:.2}];const h=harness(d),before=fillGeometry(d,d.fills[0]);
 const result=value(h.api.execute({commands:[{op:'splitCurve',curveId:id,t:.4,ref:'split'},{op:'renameCurve',curveId:'$split',name:'Second piece'}]})),next=h.state().project.drawing!,second=result.created[0].id;
 expect(next.curves).toHaveLength(5);expect(next.fills[0].boundary).toHaveLength(5);expect(next.curves.find(c=>c.id===id)!.inkEnds).toEqual([{taper:.12,extension:.01},{}]);expect(next.curves.find(c=>c.id===second)!.inkEnds).toEqual([{}, {taper:.2}]);expect(fillGeometry(next,next.fills[0]).error).toBeUndefined();expect(before.error).toBeUndefined();expect(result.addedCurves[0].curveId).toBe(second);
});

test('explicit ink visibility, depth, mirror guide and mist changes keep fill boundaries and source geometry',()=>{
 const d=fixture();d.curves.forEach(c=>{c.visible=true;});const h=harness(d),id=d.curves[0].id;
 value(h.api.execute({commands:[{op:'setMirrorAxis',x:-.3},{op:'setInkVisibility',curveIds:[id],visible:false},{op:'setCurveInkEnd',curveId:id,end:0,style:{taper:.1}},{op:'setDepth',curveId:id,offset:1,scope:'LAYER'},{op:'setFill',fillId:d.fills[0].id,mist:{enabled:true,side:'INSIDE',width:.02,opacity:.4}}]}));
 const next=h.state().project.drawing!;expect(next.mirrorAxisX).toBe(-.3);expect(next.curves[0]).toMatchObject({inkVisible:false,depthOffset:1,depthScope:'LAYER',inkEnds:[{taper:.1},{}]});expect(next.fills[0].boundary).toEqual(d.fills[0].boundary);expect(next.fills[0].mist?.opacity).toBe(.4);expect(shapeOf(next,id)).toEqual(shapeOf(d,id));
});

test('malformed topology and interval commands roll back the entire private draft',()=>{
 const h=harness(),d=h.state().project.drawing!,id=d.curves.find(c=>c.visible)!.id,before=h.state().project;
 for(const command of [
  {op:'createCurve',layerId:d.layers[0].id,shape:[[0,0],[1,1],[2,2]]},
  {op:'splitCurve',curveId:id,t:0},
  {op:'addDisplayInterval',curveId:id,start:1.01},
  {op:'setDepth',curveId:id,offset:.5},
  {op:'setCurveInkEnd',curveId:id,end:0,style:{taper:.1,taperWidthScale:2}},
  {op:'setDisplayIntervalEnd',rangeId:'missing',end:0,style:{taper:0}},
 ] as VectorCommand[]){expect(h.api.execute({commands:[{op:'createLayer',name:'Temporary'},command]}).ok).toBe(false);expect(h.state().project).toBe(before);expect(h.state().commits).toBe(0);}
});

test('canonical IDs beginning with dollar signs are literal and alias collisions fail atomically',()=>{
 let d=addLayer(emptyDrawing(),'Opaque');d=createCurve(d,d.layers[0].id,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'Literal','$actual');const h=harness(d);
 value(h.api.execute({commands:[{op:'renameCurve',curveId:'$actual',name:'Works'}]}));const before=h.state().project;
 error(h.api.execute({commands:[{op:'createLayer',name:'Copy',ref:'actual'}]}),'REFERENCE_COLLISION');expect(h.state().project).toBe(before);
});

test('duplicate mapping safely includes prototype-like opaque IDs and their nodes',()=>{
 let d=addLayer(emptyDrawing(),'Opaque');d=createCurve(d,d.layers[0].id,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'Literal','__proto__');const h=harness(d),r=value(h.api.execute({commands:[{op:'duplicateLayer',layerId:d.layers[0].id}]})),map=r.created[0].idMap!;
 expect(Object.hasOwn(map,'__proto__')).toBe(true);expect(typeof map.__proto__).toBe('string');for(const id of d.curves[0].nodes)expect(Object.hasOwn(map,id)).toBe(true);expect(JSON.parse(JSON.stringify(map)).__proto__).toBe(map.__proto__);
});

test('fill-only layers expose their owned paints and effective member state without unrelated rig data',()=>{
 let d=fixture();d=addLayer(d,'Fill only');const layer=d.layers[0].id;d=movePaint(d,d.fills[0].id,layer);d.fills[0]={...d.fills[0],visible:false,locked:true};const h=harness(d),r=value(h.api.inspect({layerIds:[layer],includeRecording:false}));
 expect(r.curves).toEqual([]);expect(r.fills).toHaveLength(1);expect(r.fills[0]).toMatchObject({id:d.fills[0].id,layerId:layer,selectionRelation:'owned'});expect(r.layers[0].effectiveState).toMatchObject({count:1,anyVisible:false,allVisible:false,anyLocked:true,allLocked:true});expect(r.recording).toBeNull();expect(r.recordingIncluded).toBe(false);
});
