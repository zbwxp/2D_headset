import {test,expect} from 'vitest';
import {createAssembly,assemblyDrawing,assemblySnapshots,locatorProjection,bindLayer,unbindLayer,parseAssembly,frameOf,type AssemblyDocument} from '../../domain/assembly/model';
import {resolvePlacement,savePlacement,setPlacementPoint,setPlacementPlane,setPlacementOffset,discardPlacementDraft,deletePlacement,placementWeights,importPlacement,parsePlacement,visitPlacement} from '../../domain/assembly/placement';
import {locatorYawOrbits} from '../../domain/assembly/trajectories';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';
import {createPerspective} from '../../domain/assembly/perspective';
import {saveDrawingSnapshot,restoreDrawingSnapshot} from '../../domain/drawing/snapshots';
import {changeAssemblySnapshots} from '../../ui/assemblyDrawing/workspace';
const at=(a:AssemblyDocument,yaw:number,pitch=0)=>({...a,pose:{...a.pose,yaw,pitch}});
const x=(a:AssemblyDocument)=>resolvePlacement(a).locators.find(l=>l.id==='eye-l')!.x;
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],9));
function fixture(){let d=addLayer(emptyDrawing(),'Eye');d=createCurve(d,d.layers[0].id,[[-.5,0],[-.4,.2],[.2,.4],[.5,0]],.01);let a=bindLayer(createAssembly(d),d.layers[0].id,'eye-l');a={...a,perspectives:[createPerspective(a.drawing,d.layers[0].id)]};return a;}
function recorded(base=fixture()){let a=savePlacement(base,'Front');a=setPlacementPoint(at(a,60),'eye-l','x',.2);a=setPlacementPlane(a,'eyes',.75);a=setPlacementOffset(a,a.drawing.layers[0].id,0,.1);return savePlacement(a,'60');}

test('legacy mode edits base construction; recording saves only local values and preserves artwork, perspective and binding calibration',()=>{
 const base=fixture(),changed=setPlacementPoint(base,'eye-l','x',-.6);expect(changed.locators.find(l=>l.id==='eye-l')!.x).toBe(-.6);expect(changed.placement).toBeUndefined();
 const a=recorded(base);expect(a.drawing).toEqual(base.drawing);expect(a.perspectives).toEqual(base.perspectives);expect(a.bindings).toEqual(base.bindings);expect(a.planes).toEqual(base.planes);expect(a.locators).toEqual(base.locators);
 expect(a.placement!.keys).toHaveLength(2);expect(JSON.stringify(a.placement)).not.toMatch(/handles|drawing|perspectives|referenceScale/);
});
test('draft belongs to its angle, survives navigation and reload, and saving/replacing does not duplicate keys',()=>{
 let a=savePlacement(fixture(),'Front');a=setPlacementPoint(at(a,30),'eye-l','x',.4);
 expect(x(a)).toBe(.4);expect(x(at(a,0))).toBe(-.4);expect(x(at(a,60))).toBe(-.4);expect(a.placement!.keys).toHaveLength(1);
 a=parseAssembly(JSON.parse(JSON.stringify(a)));expect(x(a)).toBe(.4);expect(a.placement!.drafts).toHaveLength(1);
 a=savePlacement(a,'Thirty');expect(a.placement!.keys).toHaveLength(2);expect(a.placement!.drafts).toHaveLength(0);
 a=savePlacement(setPlacementPoint(a,'eye-l','x',.6),'Thirty updated');expect(a.placement!.keys).toHaveLength(2);expect(x(a)).toBe(.6);
 a=setPlacementPoint(at(a,15),'eye-l','x',1);expect(x(a)).toBe(1);a=discardPlacementDraft(a);expect(x(a)).toBeCloseTo(.1);
 expect(x(visitPlacement(a,a.placement!.keys.find(k=>k.yaw===30)!.id))).toBe(.6);
});
test('smooth local interpolation drives point, plane and layer offset before projection, with exact keyed endpoints',()=>{
 const a=recorded(),middle=at(a,30),f=resolvePlacement(middle);
 expect(x(at(a,0))).toBe(-.4);expect(x(a)).toBe(.2);expect(x(middle)).toBeCloseTo(-.1);
 expect(f.planes.find(p=>p.id==='eyes')!.height).toBeCloseTo(.55);expect(f.bindings[0].offset[0]).toBeCloseTo(.05);
 near(locatorProjection(middle,'eye-l').world,locatorProjection(f,'eye-l').world);
 const d=assemblyDrawing(middle),expected=assemblyDrawing({...middle,...f,placement:undefined});expect(d).toEqual(expected);
 // Rotation stays circular for unchanged local values; corrections never shrink
 // a 3D orbit by interpolating the two projected endpoints.
 const front=savePlacement(fixture(),'Front'),same=savePlacement(at(front,90),'Side');
 near(locatorProjection(at(same,45),'eye-l').world,locatorProjection(at(fixture(),45),'eye-l').world);
 const eps=1e-3;expect(Math.abs(x(at(a,eps))-x(at(a,0)))).toBeLessThan(1e-8);
});
test('yaw seam is periodic, partial coverage clamps and full-circle mode closes continuously',()=>{
 let a=savePlacement(at(fixture(),170),'170');a=savePlacement(setPlacementPoint(at(a,-170),'eye-l','x',.4),'-170');
 expect(x(at(a,180))).toBeCloseTo(0);expect(x(at(a,-180))).toBeCloseTo(0);expect(placementWeights(a.placement!,{yaw:180,pitch:0}).covered).toBe(true);
 expect(placementWeights(a.placement!,{yaw:0,pitch:0}).covered).toBe(false);expect(x(at(a,150))).toBe(-.4);
 a={...a,placement:{...a.placement!,loop:true}};expect(placementWeights(a.placement!,{yaw:0,pitch:0}).covered).toBe(true);expect(x(at(a,0))).toBeCloseTo(0);
 near(locatorProjection(at(a,179.999),'eye-l').world,locatorProjection(at(a,-180.001),'eye-l').world);
 const b=savePlacement(savePlacement(at(fixture(),180),'Back'));expect(b.placement!.keys).toHaveLength(1);expect(b.placement!.keys[0].yaw).toBe(-180);
});
test('pitch rows blend local corrections and roll remains independent of recording coordinates',()=>{
 let a=savePlacement(fixture(),'0/0');
 a=savePlacement(setPlacementPoint(at(a,60),'eye-l','x',.2),'60/0');
 a=savePlacement(setPlacementPoint(at(a,0,30),'eye-l','x',.4),'0/30');
 a=savePlacement(setPlacementPoint(at(a,60,30),'eye-l','x',1),'60/30');
 expect(x(at(a,30,15))).toBeCloseTo(.3);expect(placementWeights(a.placement!,{yaw:30,pitch:15}).covered).toBe(true);
 expect(x(at(a,30,60))).toBeCloseTo(.7);expect(placementWeights(a.placement!,{yaw:30,pitch:60}).covered).toBe(false);
 const mid=at(a,30,15);expect(x({...mid,pose:{...mid.pose,roll:45}})).toBeCloseTo(.3);
});
test('trajectory uses saved keys and live projection, not drafts; partial recordings do not draw false closed paths',()=>{
 const a=recorded(),orbits=locatorYawOrbits(a),eye=orbits.find(o=>o.locatorId==='eye-l')!;
 expect(eye.closed).toBe(false);for(const s of eye.samples)near(s.world,locatorProjection(at(a,s.yaw),'eye-l').world);
 expect(eye.samples.find(s=>s.yaw===30)!.covered).toBe(true);expect(eye.samples.find(s=>s.yaw===-90)!.covered).toBe(false);
 const draft=setPlacementPoint(at(a,30),'eye-l','x',1);expect(locatorYawOrbits(draft)).toEqual(orbits);
 expect(locatorProjection(draft,'eye-l').world).not.toEqual(eye.samples.find(s=>s.yaw===30)!.world);
 const loop={...a,placement:{...a.placement!,loop:true}},orbit=locatorYawOrbits(loop).find(o=>o.locatorId==='eye-l')!;expect(orbit.closed).toBe(true);near(orbit.samples[0].world,orbit.samples.at(-1)!.world);
});
test('deleting keys, disabling preview and adding points never destroys original data or produces NaNs',()=>{
 const a=recorded(),disabled={...a,placement:{...a.placement!,enabled:false}};expect(x(disabled)).toBe(-.4);expect(assemblyDrawing(disabled)).toEqual(assemblyDrawing({...disabled,placement:undefined}));
 const id=a.placement!.keys.find(k=>k.yaw===60)!.id,b=deletePlacement(a,id);expect(b.placement!.keys).toHaveLength(1);expect(x(b)).toBe(-.4);
 const c=deletePlacement(b,b.placement!.keys[0].id);expect(c.placement!.enabled).toBe(false);expect(c.drawing).toBe(a.drawing);
 const added={...a,locators:[...a.locators,{id:'new',name:'New',planeId:'eyes',x:.9,z:.5}]};expect(resolvePlacement(added).locators.find(l=>l.id==='new')!.x).toBe(.9);
});
test('snapshot captures evaluated position without duplicating recording; restoring it suspends playback, while importing only updates locator keys',()=>{
 const a=recorded(),mid=at(a,30),snapshot=changeAssemblySnapshots(mid,saveDrawingSnapshot({drawing:assemblyDrawing(mid),drawingSnapshots:assemblySnapshots(mid)},'Middle'));
 const id=snapshot.drawingSnapshots!.activeId!,frame=snapshot.frames[id];expect(frame.locators.find(l=>l.id==='eye-l')!.x).toBeCloseTo(-.1);expect('placement' in frame).toBe(false);
 const restored=changeAssemblySnapshots(at(snapshot,0),restoreDrawingSnapshot({drawing:assemblyDrawing(at(snapshot,0)),drawingSnapshots:assemblySnapshots(snapshot)},id));
 expect(restored.placement!.enabled).toBe(false);expect(restored.placement!.keys).toEqual(a.placement!.keys);expect(x(restored)).toBeCloseTo(-.1);
 expect(restored.drawing).toEqual(a.drawing);expect(restored.perspectives).toEqual(a.perspectives);
 const imported=importPlacement(snapshot,id);expect(imported.placement!.keys).toHaveLength(3);expect(x(imported)).toBeCloseTo(-.1);expect(imported.drawing).toBe(snapshot.drawing);expect(imported.perspectives).toBe(snapshot.perspectives);
 expect(frameOf(resolvePlacement(imported)).locators).toEqual(frame.locators);
});
test('malformed, duplicate and noncanonical recording keys are rejected; old documents still load',()=>{
 const a=recorded(),r=a.placement!,key=r.keys[0];expect(parseAssembly(fixture()).placement).toBeUndefined();expect(parsePlacement(JSON.parse(JSON.stringify(r)))).toEqual(r);
 for(const patch of [{enabled:'yes'},{keys:[key,key]},{drafts:[key,key]},{keys:[{...key,yaw:360}]},{keys:[{...key,pitch:100}]},{keys:[{...key,name:''}]},{keys:[{...key,values:{...key.values,planes:{eyes:NaN}}}]}])expect(()=>parseAssembly({...a,placement:{...r,...patch}})).toThrow();
});


test('reattaching a layer with recorded offsets calibrates without jumping',()=>{
 const a=recorded(),id=a.drawing.layers[0].id,displayed=assemblyDrawing(a),detached=unbindLayer(a,id),reattached=bindLayer(detached,id,'eye-l');
 for(const next of [assemblyDrawing(detached),assemblyDrawing(reattached)]){
  next.nodes.forEach((n,i)=>near(n.position,displayed.nodes[i].position));
  next.curves.forEach((c,i)=>c.handles.forEach((p,j)=>near(p,displayed.curves[i].handles[j])));
 }
 expect(reattached.placement).toBe(a.placement);
});
