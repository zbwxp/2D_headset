import {test,expect} from 'vitest';
import {createAssembly,assemblyDrawing,bindLayer,parseAssembly,type AssemblyDocument} from '../../domain/assembly/model';
import {ensureTimeline,savePose,poseRows,setTimelineStage,setBaseEditing,setBaseAngle,deleteLayerPose,deletePose,discardPose,intervalEvaluation,evaluatedIntervalDrawing,setTimelineLoop} from '../../domain/assembly/timeline';
import {savePlacement,setPlacementPoint,setPlacementPlane,resolvePlacement} from '../../domain/assembly/placement';
import {createPerspective,neutralQuad} from '../../domain/assembly/perspective';
import {resolvedPerspectives,writeLayerPerspective,saveLayerDeform} from '../../domain/assembly/deformRecording';
import {layerProjection} from '../../domain/assembly/projection';
import {updateAssemblyDrawing} from '../../ui/assemblyDrawing/workspace';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';
import {createCurve,addLayer,ellipse,moveToLayer} from '../../domain/drawing/commands';
import {addDisplayInterval,changeDisplayInterval,setDisplayIntervalEnd,displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {intervalPinch} from '../../domain/drawing/intervalPinch';
import {createFill} from '../../domain/drawing/paintCommands';
import {fillGeometry} from '../../domain/drawing/appearance';
import type {Quad} from '../../domain/drawing/deform';
const at=(a:AssemblyDocument,yaw:number,pitch=0)=>({...a,pose:{...a.pose,yaw,pitch}});
function fixture(){let d=addLayer(emptyDrawing(),'Eye');const eye=d.layers[0].id;d=createCurve(d,eye,[[-.5,0],[-.4,.2],[.2,.4],[.5,0]],.01);d=addLayer(d,'Hair');d=createCurve(d,d.layers[0].id,[[0,0],[.1,.6],[.5,.8],[.6,1]],.01);return createAssembly(d);}
const q:Quad=[[.1,0],[.8,.1],[.9,.9],[.2,1.1]];
const deform=(a:AssemblyDocument,id:string)=>writeLayerPerspective(a,{...a.perspectives?.find(p=>p.layerId===id)??createPerspective(a.drawing,id),quad:q});
const px=(a:AssemblyDocument)=>resolvePlacement(a).locators.find(l=>l.id==='eye-l')!.x;
const view={width:700,height:600,unit:200,pan:[0,0] as Point2};

test('legacy records merge by angle without changing existing evaluated geometry',()=>{
 let a=fixture();const id=a.drawing.layers[0].id;a=savePlacement(a);a=savePlacement(setPlacementPoint(at(a,60),'eye-l','x',.3));a=saveLayerDeform(deform(at(a,30),id),id);
 const old=a,next=ensureTimeline(a);expect(poseRows(next).map(r=>r.yaw)).toEqual([0,30,60]);expect(next.drawing).toBe(old.drawing);
 for(const yaw of [0,15,30,45,60]){expect(assemblyDrawing(at(next,yaw))).toEqual(assemblyDrawing(at(old,yaw)));expect(resolvedPerspectives(at(next,yaw))).toEqual(resolvedPerspectives(at(old,yaw)));}
 expect(next.placement!.keys).toBe(old.placement!.keys);
});
test('sparse positioning does not key or slow unrelated locator motion',()=>{
 let a=ensureTimeline(fixture());a=savePose(setPlacementPoint(at(a,60),'eye-l','x',.4));const original=a;
 a=savePose(setPlacementPoint(at(a,30),'eye-r','x',.8));
 expect(a.placement!.keys.find(k=>k.yaw===30)!.values.locators).toEqual({'eye-r':[.8,.7]});
 for(const yaw of [10,20,30,40,50])expect(px(at(a,yaw))).toBeCloseTo(px(at(original,yaw)),10);
 const draft=setPlacementPlane(at(a,20),'eyes',.6);expect(px(draft)).toBeCloseTo(px(at(a,20)),10);
});
test('one save commits edited channels on all layers and leaves untouched channels sparse',()=>{
 let a=ensureTimeline(fixture());const [hair,eye]=a.drawing.layers.map(l=>l.id);a=at(a,30);
 a=setPlacementPoint(a,'eye-l','x',.1);a=deform(a,eye);
 let d=assemblyDrawing(a);d=addDisplayInterval(d,d.layers.find(l=>l.id===hair)!.items[0],'HIDE');a=updateAssemblyDrawing(a,d);
 expect(poseRows(a).find(r=>r.yaw===30)?.dirty).toBe(true);a=savePose(a,'Three channels');
 expect(a.placement!.drafts).toHaveLength(0);expect(a.deformRecording!.tracks[0].drafts).toHaveLength(0);expect(a.timeline!.intervals[0].drafts).toHaveLength(0);
 expect(a.timeline!.intervals.map(t=>t.layerId)).toEqual([hair]);expect(a.deformRecording!.tracks.map(t=>t.layerId)).toEqual([eye]);
 const counts=[a.placement!.keys.length,a.deformRecording!.tracks[0].keys.length,a.timeline!.intervals[0].keys.length];
 a=savePose(at(a,45));expect([a.placement!.keys.length,a.deformRecording!.tracks[0].keys.length,a.timeline!.intervals[0].keys.length]).toEqual(counts);
 expect(parseAssembly(JSON.parse(JSON.stringify(a)))).toEqual(a);
});
test('stage switches preserve records and original artwork, with masks usable in every stage',()=>{
 let a=fixture();const id=a.drawing.layers[0].id;a=ensureTimeline(bindLayer(a,id,'eye-l'));a=savePose(deform(at(a,60),id));
 a=updateAssemblyDrawing(a,addDisplayInterval(assemblyDrawing(a),a.drawing.layers[0].items[0],'HIDE'));a=savePose(a);const original=a.drawing,keys=structuredClone(a.timeline!.intervals);
 a=setTimelineStage(a,'BASE');expect(assemblyDrawing(a).nodes).toEqual(original.nodes);expect(layerProjection(a,id,view).active).toBe(false);expect(assemblyDrawing(a).displayIntervals).toHaveLength(1);
 a=setTimelineStage(a,'PLACEMENT');expect(assemblyDrawing(a).nodes).not.toEqual(original.nodes);expect(layerProjection(a,id,view).active).toBe(false);
 a=setTimelineStage(a,'PERSPECTIVE');expect(layerProjection(a,id,view).active).toBe(true);
 a={...a,timeline:{...a.timeline!,applyIntervals:false}};a=savePose(a);expect(a.timeline!.intervals).toEqual(keys);expect(a.drawing).toEqual(original);
});
test('a thirty-degree base is calibrated without adding a false front deformer',()=>{
 let a=ensureTimeline(at(fixture(),30));a=bindLayer(a,a.drawing.layers[0].id,'eye-l');const original=a.drawing,id=a.drawing.layers[0].id;
 expect(assemblyDrawing(a).nodes).toEqual(original.nodes);a=savePose(deform(at(a,60),id));expect(a.deformRecording!.tracks[0].keys.map(k=>k.yaw)).toEqual([30,60]);
 expect(resolvedPerspectives(at(a,30))[0].quad).toEqual(neutralQuad());expect(poseRows(a).some(k=>k.yaw===0)).toBe(false);
 let b=ensureTimeline(fixture());b=bindLayer(b,b.drawing.layers[0].id,'eye-l');const raw=b.drawing;b=setBaseAngle(b,{yaw:30,pitch:0});expect(assemblyDrawing(b).nodes).toEqual(raw.nodes);
});
test('interval drafts survive navigation, do not bake into the base, and leave fills independent',()=>{
 let a=ensureTimeline(fixture());const id=a.drawing.curves[0].id,base=a.drawing;a=at(a,60);
 a=updateAssemblyDrawing(a,addDisplayInterval(assemblyDrawing(a),id,'HIDE'));
 expect(a.drawing.displayIntervals).toEqual(base.displayIntervals);expect(intervalEvaluation(at(a,0),a.drawing.layers.find(l=>l.items.includes(id))!.id).tracks).toHaveLength(0);
 const restored=parseAssembly(JSON.parse(JSON.stringify(a)));expect(assemblyDrawing(restored).displayIntervals).toEqual(assemblyDrawing(a).displayIntervals);
 expect(discardPose(a).timeline!.intervals[0].drafts).toHaveLength(0);a=savePose(a);const mid=assemblyDrawing(at(a,45));expect(mid.fills).toEqual(base.fills);
 const r=mid.displayIntervals![0].ranges[0];expect(r.end-r.start).toBeGreaterThan(0);expect(r.end-r.start).toBeLessThan(1/3);
});
test('deleting a layer key returns to interpolation and leaves shared positioning intact',()=>{
 let a=ensureTimeline(fixture());const id=a.drawing.layers[0].id;a=savePose(setPlacementPoint(deform(at(a,60),id),'eye-l','x',.3));
 a=deform(at(a,30),id);const placement=a.placement;a=savePose(a);a=deleteLayerPose(a,id);
 expect(a.placement).toEqual(placement);expect(a.deformRecording!.tracks[0].keys.map(k=>k.yaw)).toEqual([0,60]);expect(resolvedPerspectives(a)[0].quad).not.toEqual(q);
 a=deletePose(at(a,60));expect(a.placement!.keys.some(k=>k.yaw===60)).toBe(false);expect(a.deformRecording!.tracks[0].keys.some(k=>k.yaw===60)).toBe(false);
});
test('normal reference edits never save interpolated intervals; source editing is explicit',()=>{
 let a=ensureTimeline(fixture());a=savePose(updateAssemblyDrawing(at(a,60),addDisplayInterval(assemblyDrawing(at(a,60)),a.drawing.curves[0].id,'HIDE')));a=at(a,30);
 const old=a,doc=assemblyDrawing(a);a=updateAssemblyDrawing(a,{...doc,mirrorAxisX:.25});expect(a.timeline!.intervals).toEqual(old.timeline!.intervals);expect(a.drawing.displayIntervals).toEqual(old.drawing.displayIntervals);
 const moved={...doc,nodes:doc.nodes.map((n,i)=>i?n:{...n,position:[.2,.2] as Point2})};expect(()=>updateAssemblyDrawing(a,moved)).toThrow('编辑原稿');
 a=setBaseEditing(a,true);const raw=assemblyDrawing(a);a=updateAssemblyDrawing(a,{...raw,nodes:raw.nodes.map((n,i)=>i?n:{...n,position:[.2,.2] as Point2})});expect(a.drawing.nodes[0].position).toEqual([.2,.2]);
});
test('new tapered gaps retain pinch-before-break through placement projection',()=>{
 let a=fixture();const id=a.drawing.curves[0].id,layer=a.drawing.layers.find(l=>l.items.includes(id))!.id;a=ensureTimeline(bindLayer(a,layer,'eye-l'));
 a=at(a,60);let d=addDisplayInterval(assemblyDrawing(a),id,'HIDE');const tr=d.displayIntervals![0],r=tr.ranges[0];
 d=setDisplayIntervalEnd(d,tr.id,r.id,0,{taper:.2});d=setDisplayIntervalEnd(d,tr.id,r.id,1,{taper:.2});a=savePose(updateAssemblyDrawing(a,d));
 const mid=at(a,5),raw=evaluatedIntervalDrawing(mid).displayIntervals![0].ranges[0];expect(intervalPinch(raw)).toBeGreaterThan(0);expect(intervalPinch(assemblyDrawing(mid).displayIntervals![0].ranges[0])).toBe(intervalPinch(raw));
});
test('invalid interval keys are rejected and the shared loop option updates every channel',()=>{
 let a=ensureTimeline(fixture());a=savePose(deform(setPlacementPoint(at(a,60),'eye-l','x',.1),a.drawing.layers[0].id));a=setTimelineLoop(a,true);
 expect(a.placement!.loop).toBe(true);expect(a.deformRecording!.loop).toBe(true);expect(a.timeline!.loop).toBe(true);
 expect(()=>parseAssembly({...a,timeline:{...a.timeline,stage:'UNKNOWN'}})).toThrow();
 expect(()=>parseAssembly({...a,timeline:{...a.timeline,intervals:[{layerId:'missing',keys:[],drafts:[]}]}})).toThrow();
});

test('editing another stroke in the same layer does not insert keys into the first stroke mask',()=>{
 let a=fixture(),layer=a.drawing.layers[0].id;a={...a,drawing:createCurve(a.drawing,layer,[[.1,0],[.2,.1],[.4,.1],[.5,0]],.01)};a=ensureTimeline(a);
 const [one,two]=a.drawing.layers[0].items;const gap=(a:AssemblyDocument,id:string)=>updateAssemblyDrawing(a,addDisplayInterval(assemblyDrawing(a),id,'HIDE'));
 a=savePose(gap(at(a,60),one));const original=a;a=savePose(gap(at(a,30),two));
 expect(a.timeline!.intervals[0].keys.find(k=>k.yaw===30)!.curveIds).toEqual([two]);
 for(const yaw of [10,20,30,40,50]){
  const own=(a:AssemblyDocument)=>assemblyDrawing(at(a,yaw)).displayIntervals!.filter(t=>t.anchor.id===one);
  expect(own(a)).toEqual(own(original));
 }
});


test('closed interval seam keeps its short span and never clips a white fill',()=>{
 let d=addLayer(emptyDrawing(),'Highlight'),shape=ellipse(d,d.layers[0].id,[-.4,-.3],[.4,.3],.01);d=createFill(shape.document,shape.ids,'white');
 d=addDisplayInterval(d,shape.ids[0],'HIDE');const track=d.displayIntervals![0],r=track.ranges[0];d=changeDisplayInterval(d,track.id,r.id,{start:.9,end:.1});
 let a=ensureTimeline(createAssembly(d));a=at(a,60);let target=assemblyDrawing(a);target=changeDisplayInterval(target,track.id,r.id,{start:.95,end:.15});a=savePose(updateAssemblyDrawing(a,target));
 const mid=assemblyDrawing(at(a,30)),range=mid.displayIntervals![0].ranges[0];expect((range.end-range.start+1)%1).toBeCloseTo(.2);expect(mid.fills).toEqual(d.fills);expect(fillGeometry(mid,mid.fills[0]).error).toBeUndefined();
});
test('moving a source stroke to another layer carries its angle masks and survives parsing',()=>{
 let a=ensureTimeline(fixture());const layer=a.drawing.layers[0].id,target=a.drawing.layers[1].id,id=a.drawing.layers[0].items[0];a=savePose(updateAssemblyDrawing(at(a,60),addDisplayInterval(assemblyDrawing(at(a,60)),id,'HIDE')));
 const records=a.timeline!.intervals[0].keys;a=setBaseEditing(a,true);a=updateAssemblyDrawing(a,moveToLayer(assemblyDrawing(a),[id],target));
 expect(a.timeline!.intervals.some(t=>t.layerId===layer)).toBe(false);expect(a.timeline!.intervals.find(t=>t.layerId===target)!.keys.map(k=>k.tracks)).toEqual(records.map(k=>k.tracks));
 expect(()=>parseAssembly(a)).not.toThrow();a=setBaseEditing(a,false);expect(assemblyDrawing(a).displayIntervals![0].anchor.id).toBe(id);
});
