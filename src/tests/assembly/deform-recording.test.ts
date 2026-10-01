import {test,expect} from 'vitest';
import {createAssembly,parseAssembly,bindLayer,unbindLayer,assemblyDrawing,assemblySnapshots,type AssemblyDocument} from '../../domain/assembly/model';
import {createPerspective,neutralQuad,assertPerspective,map3,perspectiveMatrix} from '../../domain/assembly/perspective';
import {interpolateDeform,resolvedPerspectives,saveLayerDeform,writeLayerPerspective,discardLayerDeform,deleteLayerDeformKey,deformEvaluation,resolvedAssemblyFrame,sameDeformSnapshotFrame} from '../../domain/assembly/deformRecording';
import {savePlacement,setPlacementPoint} from '../../domain/assembly/placement';
import {layerProjection} from '../../domain/assembly/projection';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';
import {createCurve,addLayer} from '../../domain/drawing/commands';
import {saveDrawingSnapshot,restoreDrawingSnapshot} from '../../domain/drawing/snapshots';
import {changeAssemblySnapshots} from '../../ui/assemblyDrawing/workspace';
import type {Quad} from '../../domain/drawing/deform';
function fixture(){let d=addLayer(emptyDrawing(),'Eye');d=createCurve(d,d.layers[0].id,[[0,0],[.1,.4],[.5,.3],[.6,0]],.01);d=addLayer(d,'Mouth');d=createCurve(d,d.layers[0].id,[[0,0],[.1,.2],[.3,.2],[.4,0]],.01);let a=createAssembly(d);a.perspectives=d.layers.map(l=>createPerspective(d,l.id));return a;}
const near=(a:number[],b:number[])=>a.forEach((x,i)=>expect(x).toBeCloseTo(b[i],7));
const q:Quad=[[.2,0],[.8,.1],[.9,.9],[.1,1.1]];
const edit=(a:AssemblyDocument,id:string,quad:Quad)=>writeLayerPerspective(a,{...resolvedPerspectives(a).find(p=>p.layerId===id)!,quad});
const angle=(a:AssemblyDocument,yaw:number,pitch=0)=>({...a,pose:{...a.pose,yaw,pitch}});

test('record a side deformer with a neutral front, then interpolate without touching locator or artwork data',()=>{
 let a=fixture();const id=a.drawing.layers[0].id,other=a.drawing.layers[1].id,original=structuredClone(a);
 a=savePlacement(a);a=savePlacement(setPlacementPoint(angle(a,-60),'eye-l','x',.1));const placement=a.placement;
 a=saveLayerDeform(edit(a,id,q),id);expect(a.deformRecording!.tracks[0].keys.map(k=>k.yaw)).toEqual([0,-60]);
 expect(resolvedPerspectives(angle(a,0))[0].quad).toEqual(neutralQuad());expect(resolvedPerspectives(angle(a,-60))[0].quad).toEqual(q);
 const mid=resolvedPerspectives(angle(a,-30))[0];expect(mid.quad).not.toEqual(q);expect(mid.quad).not.toEqual(neutralQuad());assertPerspective(mid);
 expect(resolvedPerspectives(a).find(p=>p.layerId===other)).toEqual(original.perspectives![1]);expect(a.drawing).toEqual(original.drawing);expect(a.placement).toBe(placement);
 expect(JSON.stringify(a.deformRecording)).not.toMatch(/handles|curves|nodes|data:image/);
 const view={width:700,height:600,unit:200,pan:[0,0] as Point2};expect(layerProjection(angle(a,-30),id,view).matrix).not.toEqual(layerProjection(angle(a,0),id,view).matrix);
});
test('drafts stay per angle and per layer, survive parsing and do not reset unrelated motion',()=>{
 let a=fixture();const [id,other]=a.drawing.layers.map(l=>l.id);a=saveLayerDeform(a,id);a=saveLayerDeform(edit(angle(a,-60),id,q),id);
 const original=a;const draft:Quad=[[0,0],[.8,0],[.8,1],[0,1]];a=edit(angle(a,-30),id,draft);
 expect(deformEvaluation(a,id).draft).toBeTruthy();expect(resolvedPerspectives(angle(a,0))[0].quad).toEqual(neutralQuad());expect(resolvedPerspectives(angle(a,-30))[0].quad).toEqual(draft);
 a=parseAssembly(JSON.parse(JSON.stringify(a)));expect(resolvedPerspectives(a)[0].quad).toEqual(draft);
 const otherDraft=edit(a,other,q);expect(otherDraft.deformRecording).toBe(a.deformRecording);expect(otherDraft.perspectives![1].quad).toEqual(q);
 expect(discardLayerDeform(a,id).deformRecording).toEqual(original.deformRecording);
 a=saveLayerDeform(a,id);expect(a.deformRecording!.tracks[0].keys).toHaveLength(3);expect(a.deformRecording!.tracks[0].drafts).toHaveLength(0);
 const k=a.deformRecording!.tracks[0].keys.find(k=>k.yaw===-30)!;a=deleteLayerDeformKey(a,id,k.id);expect(a.deformRecording!.tracks[0].keys).toHaveLength(2);
});
test('rotation interpolation never collapses the card, follows shortest rotation and treats disabled as neutral',()=>{
 const rotate=(deg:number)=>neutralQuad().map(([x,y])=>{const t=deg*Math.PI/180;return [.5+(x-.5)*Math.cos(t)-(y-.5)*Math.sin(t),.5+(x-.5)*Math.sin(t)+(y-.5)*Math.cos(t)] as Point2;}) as Quad;
 const a={quad:neutralQuad(),enabled:true},b={quad:rotate(180),enabled:true};
 for(let i=0;i<=40;i++){const m=interpolateDeform(a,b,i/40);assertPerspective({layerId:'x',source:{min:[0,0],max:[1,1]},...m});near([Math.hypot(m.quad[1][0]-m.quad[0][0],m.quad[1][1]-m.quad[0][1])],[1]);}
 const mid=interpolateDeform({quad:rotate(170),enabled:true},{quad:rotate(-170),enabled:true},.5);mid.quad.forEach((p,i)=>near(p,rotate(180)[i]));
 const off=interpolateDeform(a,{quad:q,enabled:false},.5);off.quad.forEach((p,i)=>near(p,neutralQuad()[i]));
});
test('yaw seam and pitch rows interpolate independently for every layer',()=>{
 let a=fixture();const id=a.drawing.layers[0].id;a=saveLayerDeform(a,id);
 // Delete the automatically recorded front for a deliberate back-view-only range.
 a=deleteLayerDeformKey(a,id,a.deformRecording!.tracks[0].keys[0].id);
 for(const [yaw,pitch,w] of [[170,0,1],[-170,0,.5],[170,30,.8],[-170,30,.4]])a=saveLayerDeform(edit(angle(a,yaw,pitch),id,[[0,0],[w,0],[w,1],[0,1]]),id);
 const at=(yaw:number,pitch:number)=>resolvedPerspectives(angle(a,yaw,pitch))[0].quad;
 at(180,15).forEach((p,i)=>near(p,at(-180,15)[i]));expect(deformEvaluation(angle(a,180,15),id).covered).toBe(true);
 expect(deformEvaluation(angle(a,0,0),id).covered).toBe(false);a={...a,deformRecording:{...a.deformRecording!,loop:true}};expect(deformEvaluation(angle(a,0,0),id).covered).toBe(true);
});
test('composes with placement and reattachment, full snapshots capture evaluated shape and suspend playback on restore',()=>{
 let a=fixture();const id=a.drawing.layers[0].id;const save=(a:AssemblyDocument,name:string)=>changeAssemblySnapshots(a,saveDrawingSnapshot({drawing:assemblyDrawing(a),drawingSnapshots:assemblySnapshots(a)},name));
 a=save(a,'Before');const before=a.drawingSnapshots!.activeId!;
 a=saveLayerDeform(a,id);a=saveLayerDeform(edit(angle(a,-60),id,q),id);a=angle(a,-30);const visible=resolvedPerspectives(a)[0];a=save(a,'Middle');const middle=a.drawingSnapshots!.activeId!;
 expect(a.frames[middle].perspectives![0].quad).toEqual(visible.quad);expect(a.frames[middle]).not.toHaveProperty('deformRecording');
 a=changeAssemblySnapshots(a,restoreDrawingSnapshot({drawing:assemblyDrawing(a),drawingSnapshots:assemblySnapshots(a)},before));expect(a.deformRecording!.enabled).toBe(false);expect(sameDeformSnapshotFrame(a,a.frames[before])).toBe(true);
 expect(parseAssembly(JSON.parse(JSON.stringify(a))).deformRecording).toEqual(a.deformRecording);
 a={...a,deformRecording:{...a.deformRecording!,enabled:true}};a=angle(a,-30);const d=a.drawing,track=a.deformRecording;
 const view={width:700,height:600,unit:200,pan:[0,0] as Point2},p=resolvedPerspectives(a)[0],old=layerProjection(a,id,view);
 for(const next of [bindLayer(a,id,'eye-l'),unbindLayer(bindLayer(a,id,'eye-l'),id)]){const n=layerProjection(next,id,view),q=resolvedPerspectives(next)[0];for(const uv of [[.2,.3],[.8,.7]] as Point2[]){const src=(p:any,uv:Point2):Point2=>uv.map((v,i)=>p.source.min[i]+v*(p.source.max[i]-p.source.min[i])) as Point2;near(map3(old.placement,map3(perspectiveMatrix(p),src(p,uv))),map3(n.placement,map3(perspectiveMatrix(q),src(q,uv))));}expect(next.deformRecording).toBe(track);}
 expect(a.drawing).toBe(d);expect(resolvedAssemblyFrame(a).perspectives![0].quad).toEqual(visible.quad);
});
test('invalid saved values and duplicate layer/angle keys are rejected, legacy projects retain static deformation',()=>{
 let a=fixture();expect(parseAssembly(a).deformRecording).toBeUndefined();const id=a.drawing.layers[0].id;a=saveLayerDeform(a,id);const r=a.deformRecording!,t=r.tracks[0],k=t.keys[0];
 for(const tracks of [[t,t],[{...t,layerId:'missing'}],[{...t,keys:[k,k]}],[{...t,keys:[{...k,yaw:NaN}]}],[{...t,keys:[{...k,quad:[[0,0],[0,0],[0,0],[0,0]]}]}]])expect(()=>parseAssembly({...a,deformRecording:{...r,tracks}})).toThrow();
});
