import {expect,test} from 'vitest';
import {emptyDrawing,shapeOf,type Point2} from '../domain/drawing/model';
import {drawingShapeWorkStats,resetDrawingShapeWorkStats,type DrawingShapeControl} from '../domain/drawing/sparseShape';
import {registerEvaluatedAffine} from '../domain/drawing/evaluatedAffine';
import {intervalPinch,withIntervalPinch} from '../domain/drawing/intervalPinch';
import {applySceneShapes,sceneShapeRevision,sceneShapeWorkStats,resetSceneShapeWorkStats} from '../domain/recordingScene/shapes';
import {emptyRecordingScene,identitySceneShape,instanceObjectId,type RecordingScene,type SceneShapeValue,type SceneSourceObject,type SceneDiagnostic} from '../domain/recordingScene/model';
import type {DeformedDrawing} from '../domain/vectorWarp/evaluation';
const angle={x:0,y:0},id=(value:string)=>instanceObjectId('instance',value);
function fixture(nuisance=0){
 const drawing=emptyDrawing(),provenance:Record<string,SceneSourceObject>={};drawing.displayIntervals=[];
 const remember=(sourceId:string)=>{provenance[id(sourceId)]={instanceId:'instance',artworkId:'art',sourceId};return id(sourceId);};
 for(let i=0;i<10+nuisance;i++){
  const curve=remember(`c${i}`),a=remember(`a${i}`),b=remember(`b${i}`),x=i*3;drawing.nodes.push({id:a,position:[x,0]},{id:b,position:[x+1,0]});drawing.curves.push({id:curve,name:curve,nodes:[a,b],handles:[[x+.3,.2],[x+.7,-.1]],width:.02,visible:true,locked:false});drawing.layers.push({id:remember(`l${i}`),name:'Layer',items:[curve],visible:true,locked:false});
  if(i<9)drawing.displayIntervals.push({id:remember(`t${i}`),anchor:{id:curve,reverse:false},ranges:[withIntervalPinch({id:remember(`r${i}`),start:.13,end:.82,mode:i===2?'HIDE':'SHOW'},i===2?.35:0)]});
 }
 const base:DeformedDrawing={drawing,maxError:.01,warningCurveIds:[id('c2')],conflictingNodeIds:[],intervalTransportErrors:[],diagnosticStage:'full',diagnostics:drawing.curves.map(curve=>({sourceCurveId:curve.id,cubic:shapeOf(drawing,curve.id),maxError:.01,peakT:.4,peakExpected:[.4,0],peakActual:[.4,.01],tolerance:.1,exceedsTolerance:false,warning:false,diagnosticStage:'full',validationKind:'sampled',validationSamples:1024,endpointMismatchError:0,endpointConflict:false,tangentStatus:'preserved',tangentDeviationRadians:[0,0],nonFinite:false}))};
 return {base,provenance};
}
const scene=(value?:SceneShapeValue):RecordingScene=>({...emptyRecordingScene('scene'),instances:[{id:'instance',artworkId:'art',name:'Instance'}],shapeTracks:value?[{id:'shape',instanceId:'instance',keys:[{id:'key',angle,value}]}]:[]});
const shape=(curve:string,offset:Point2=[0,.2]):SceneShapeValue=>({nodes:{},handles:{[curve]:[offset,[0,0]]}});
const handle=(curve:string):DrawingShapeControl=>({kind:'handle',curveId:id(curve),end:0});
const changes=(controls:DrawingShapeControl[])=>({structureUnchanged:true as const,controls});
const output=(result:DeformedDrawing)=>({result,pinches:result.drawing.displayIntervals?.map(track=>track.ranges.map(intervalPinch))});
function run(f:ReturnType<typeof fixture>,value:SceneShapeValue,previous?:DeformedDrawing,controls:DrawingShapeControl[]=[]){
 const diagnostics:SceneDiagnostic[]=[],result=applySceneShapes(f.base,scene(value),angle,true,f.provenance,diagnostics,{retainRevision:true,previous,changes:previous?changes(controls):undefined});return {result,diagnostics};
}
function cold(f:ReturnType<typeof fixture>,value:SceneShapeValue){const diagnostics:SceneDiagnostic[]=[];return {result:applySceneShapes(f.base,scene(value),angle,true,f.provenance,diagnostics),diagnostics};}

test.each([0,100,1000])('shape and source-material consumers revise one of nine paths with %i unrelated curves',nuisance=>{
 const f=fixture(nuisance),saved=structuredClone(f.base),prior=run(f,shape('c0')).result;resetSceneShapeWorkStats();resetDrawingShapeWorkStats();
 const value=shape('c0',[.1,.4]),next=run(f,value,prior,[handle('c0')]),stats=sceneShapeWorkStats(),shapeStats=drawingShapeWorkStats(),full=cold(f,value);
 expect(output(next.result)).toEqual(output(full.result));expect(next.diagnostics).toEqual(full.diagnostics);
 expect(stats).toMatchObject({revisionApplications:1,fullApplications:0,materialPlans:0,materialPathPlans:0,transportedTracks:1,reusedTracks:8,fitShifts:1});expect(shapeStats).toMatchObject({plans:0,handleControls:1,nodeControls:0});
 expect(sceneShapeRevision(next.result)?.dirtyCurveIds).toEqual([id('c0')]);for(let i=1;i<9;i++){expect(next.result.drawing.displayIntervals![i]).toBe(prior.drawing.displayIntervals![i]);expect(next.result.diagnostics[i]).toBe(prior.diagnostics[i]);expect(next.result.drawing.curves[i]).toBe(prior.drawing.curves[i]);}
 expect(f.base).toEqual(saved);
});

test('an unpainted edit transports zero paths and first shape creation revises a retained empty-track product',()=>{
 const f=fixture(),prior=applySceneShapes(f.base,scene(),angle,true,f.provenance,[],{retainRevision:true});expect(prior).toBe(f.base);
 resetSceneShapeWorkStats();const value=shape('c9'),next=run(f,value,prior,[handle('c9')]),stats=sceneShapeWorkStats();
 expect(output(next.result)).toEqual(output(cold(f,value).result));expect(stats).toMatchObject({revisionApplications:1,transportedTracks:0,reusedTracks:9,fitShifts:1});next.result.drawing.displayIntervals!.forEach((track,index)=>expect(track).toBe(prior.drawing.displayIntervals![index]));
 const diagnostics:SceneDiagnostic[]=[],removed=applySceneShapes(f.base,scene(),angle,true,f.provenance,diagnostics,{retainRevision:true,previous:next.result,changes:changes([handle('c9')])});expect(removed).toBe(f.base);expect(diagnostics).toEqual([]);
});

test('ordered per-track diagnostics, source errors, pinches and unaffected fit diagnostics are retained exactly',()=>{
 const f=fixture(),curve=f.base.drawing.curves[3];f.base.drawing.nodes[6].position=[9,0];f.base.drawing.nodes[7].position=[9,0];curve.handles=[[9,0],[9,0]];f.base.intervalTransportErrors.push({trackId:'source-error',sourceCurveIds:[id('c7')],message:'Prior source failure'});
 const initial:SceneShapeValue={nodes:{},handles:{c3:[[0,.1],[0,0]]}},prior=run(f,initial),value:SceneShapeValue={nodes:{},handles:{...initial.handles,c0:[[0,.4],[0,0]]}};
 expect(prior.result.intervalTransportErrors).toHaveLength(2);expect(prior.diagnostics).toHaveLength(1);resetSceneShapeWorkStats();const revised=run(f,value,prior.result,[handle('c0')]);expect(sceneShapeWorkStats().transportedTracks).toBe(1);
 const full=cold(f,value);expect(output(revised.result)).toEqual(output(full.result));expect(revised.diagnostics).toEqual(full.diagnostics);expect(revised.result.intervalTransportErrors[1]).toBe(prior.result.intervalTransportErrors[1]);expect(revised.result.drawing.displayIntervals![3]).toBe(prior.result.drawing.displayIntervals![3]);
});

test.each(['local ARC','route ARC'] as const)('the real %s dependency closure consumes an adjacent curve edit',kind=>{
 const f=fixture(),d=f.base.drawing,a=d.curves[0],b=d.curves[1];d.nodes[2].position=[1,0];d.nodes[3].position=[1,1];b.handles=[[1.1,.3],[1,.7]];a.handles=[[.3,0],[.7,0]];
 if(kind==='local ARC'){b.nodes[0]=a.nodes[1];d.nodes.splice(2,1);d.layers[0].items.push(b.id);d.layers.splice(1,1);d.joins=[{id:id('arc'),a:{curveId:a.id,end:1},b:{curveId:b.id,end:0},mode:'ARC',radius:.15}];}
 else{d.endpointLinks=[{id:id('link'),a:{curveId:a.id,end:1},b:{curveId:b.id,end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.15}}];d.displayIntervals![0].displayRoute={seed:{segments:[{id:a.id,reverse:false}],closed:false},throughLinkIds:[id('link')]};}
 d.displayIntervals!.splice(1,1);const prior=run(f,shape('c9')).result,value:SceneShapeValue={nodes:{},handles:{c9:[[0,.2],[0,0]],c1:[[.1,.2],[0,0]]}};resetSceneShapeWorkStats();const next=run(f,value,prior,[handle('c1')]);expect(sceneShapeWorkStats()).toMatchObject({transportedTracks:1,reusedTracks:7});const full=cold(f,value);expect(output(next.result)).toEqual(output(full.result));expect(next.diagnostics).toEqual(full.diagnostics);
});

test('invalid route support and unknown material programs use canonical transport for all tracks',()=>{
 for(const kind of ['route','program'] as const){const f=fixture();if(kind==='route')f.base.drawing.displayIntervals![0].displayRoute={seed:{segments:[{id:id('c0'),reverse:false}],closed:false},throughLinkIds:['missing']};else registerEvaluatedAffine(f.base.drawing,structuredClone(f.base.drawing),()=>({point:point=>[point[0]*2,point[1]],maxScale:2}));
  const prior=run(f,shape('c0')).result,value=shape('c0',[0,.3]);resetSceneShapeWorkStats();const next=run(f,value,prior,[handle('c0')]);expect(sceneShapeWorkStats()).toMatchObject({transportedTracks:9,reusedTracks:0});const full=cold(f,value);expect(output(next.result)).toEqual(output(full.result));expect(next.diagnostics).toEqual(full.diagnostics);
 }
});

test('source, provenance and unretained products cannot establish revision authority',()=>{
 const f=fixture(),value=shape('c0'),previous=run(f,value).result;
 const replacements=[{...f,base:{...f.base,drawing:structuredClone(f.base.drawing)}},{...f,provenance:{...f.provenance}}];
 for(const replacement of replacements){resetSceneShapeWorkStats();const next=run(replacement,shape('c0',[0,.4]),previous,[handle('c0')]);expect(sceneShapeRevision(next.result)).toBeUndefined();expect(sceneShapeWorkStats()).toMatchObject({fullApplications:1,transportedTracks:9});expect(output(next.result)).toEqual(output(cold(replacement,shape('c0',[0,.4])).result));}
 const unretained=cold(f,identitySceneShape()).result;resetSceneShapeWorkStats();const next=run(f,value,unretained,[handle('c0')]);expect(sceneShapeWorkStats().fullApplications).toBe(1);expect(sceneShapeRevision(next.result)).toBeUndefined();
});
