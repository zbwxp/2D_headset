import {test,expect} from 'vitest';
import {createAssembly,locatorProjection,parseAssembly,rotateLocal,worldPoint,type Vec3} from '../../domain/assembly/model';
import {locatorYawOrbits} from '../../domain/assembly/trajectories';
import {saveViewSlot,applyViewSlot,updateViewSlot,renameViewSlot,deleteViewSlot} from '../../domain/assembly/viewSlots';
import {savePlacement,setPlacementPoint,resolvePlacement} from '../../domain/assembly/placement';

const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
test('a fixed recorded pitch row keeps its shape and key markers when viewed from above or tilted',()=>{
 let a=createAssembly();
 for(const [yaw,pitch,z] of [[0,0,.4],[-45,0,.7],[0,30,1.2],[-45,30,1.5]]){
  a={...a,pose:{...a.pose,yaw,pitch}};a=savePlacement(setPlacementPoint(a,'chin','z',z));
 }
 const before=JSON.stringify(a),front=locatorYawOrbits({...a,pose:{...a.pose,pitch:0,roll:0}},{sourcePitch:0}).find(o=>o.locatorId==='chin')!;
 for(const [pitch,roll] of [[-90,0],[90,40],[-45,-30]]){
  const view={...a,pose:{...a.pose,yaw:75,pitch,roll}},orbit=locatorYawOrbits(view,{sourcePitch:0}).find(o=>o.locatorId==='chin')!;
  expect(orbit.samples.map(s=>[s.keyId,s.covered,s.recorded])).toEqual(front.samples.map(s=>[s.keyId,s.covered,s.recorded]));
  expect(orbit.samples.filter(s=>s.keyId)).toHaveLength(2);
  for(const s of orbit.samples){
   const frame=resolvePlacement(a,{...a.pose,yaw:s.yaw,pitch:0},false),l=frame.locators.find(l=>l.id==='chin')!,y=frame.planes.find(p=>p.id===l.planeId)!.height;
   near(s.world,worldPoint([l.x,y,l.z],{...view.pose,yaw:s.yaw}));
  }
  const other=locatorYawOrbits(view,{sourcePitch:30}).find(o=>o.locatorId==='chin')!;
  expect(other.samples.filter(s=>s.keyId).map(s=>s.keyId)).not.toEqual(orbit.samples.filter(s=>s.keyId).map(s=>s.keyId));
  expect(other.samples.find(s=>s.yaw===0)!.world).not.toEqual(orbit.samples.find(s=>s.yaw===0)!.world);
 }
 expect(JSON.stringify(a)).toBe(before);
});
test('recorded span and exact key markers remain distinct from the full loop and sample real interpolation',()=>{
 let a=createAssembly();
 for(const [yaw,z] of [[0,.3794],[-21.531,.6728],[-42.217,.5419],[-57.545,.5408]]){
  a={...a,pose:{...a.pose,yaw}};a=setPlacementPoint(a,'chin','z',z);a=savePlacement(a);
 }
 a={...a,placement:{...a.placement!,loop:true}};
 const orbit=locatorYawOrbits(a).find(o=>o.locatorId==='chin')!;
 expect(orbit.closed).toBe(true);expect(orbit.samples.every(s=>s.covered)).toBe(true);
 const shown=orbit.samples.filter(s=>s.recorded);
 expect(shown[0].yaw).toBe(-57.545);expect(shown.at(-1)!.yaw).toBe(0);expect(shown.length).toBeGreaterThan(30);
 expect(shown.filter(s=>s.keyId).map(s=>s.keyId).sort()).toEqual(a.placement!.keys.map(k=>k.id).sort());
 for(const s of shown)near(s.world,locatorProjection({...a,pose:{...a.pose,yaw:s.yaw}},'chin').world);
 const pitched=locatorYawOrbits({...a,pose:{...a.pose,pitch:20}})[0];expect(pitched.samples.some(s=>s.keyId)).toBe(false);
 // A partial arc through the yaw seam must not acquire a line across front view.
 let seam=createAssembly();for(const yaw of [170,-170])seam=savePlacement({...seam,pose:{...seam.pose,yaw}});
 const path=locatorYawOrbits(seam)[0];expect(path.samples.find(s=>s.yaw===0)!.recorded).toBe(false);
 expect(path.samples.filter(s=>s.keyId).map(s=>s.yaw)).toEqual([-170,170]);
});
test('yaw orbits follow actual motion in a circle perpendicular to the current main axis',()=>{
 for(const [pitch,roll] of [[0,0],[-30,0],[30,-20],[-45,40],[90,65],[-90,-130]]){
  const a=createAssembly();a.pose={...a.pose,yaw:37.5,pitch,roll,position:[.3,-.2,.4] as Vec3};
  a.locators.push({id:'on-axis',name:'轴上点',planeId:a.planes[0].id,x:0,z:0});
  const before=JSON.stringify(a),orbits=locatorYawOrbits(a);expect(orbits).toHaveLength(a.locators.length);
  const axis=rotateLocal([0,1,0],a.pose);
  for(const orbit of orbits){
   near(orbit.samples[0].world,orbit.samples.at(-1)!.world);
   const l=a.locators.find(l=>l.id===orbit.locatorId)!,height=a.planes.find(p=>p.id===l.planeId)!.height;
   const center=worldPoint([0,height,0],a.pose),radius=Math.hypot(l.x,l.z);
   near(orbit.samples.find(s=>s.yaw===a.pose.yaw)!.world,locatorProjection(a,l.id).world);
   for(const s of orbit.samples){
    near(s.world,locatorProjection({...a,pose:{...a.pose,yaw:s.yaw}},orbit.locatorId).world);
    near(rotateLocal([0,1,0],{...a.pose,yaw:s.yaw}),axis);
    const radial=s.world.map((v,i)=>v-center[i]);
    expect(radial.reduce((sum,v,i)=>sum+v*axis[i],0)).toBeCloseTo(0,10);
    expect(Math.hypot(...radial)).toBeCloseTo(radius,10);
   }
  }
  expect(locatorYawOrbits({...a,pose:{...a.pose,yaw:90}})).toEqual(orbits);expect(JSON.stringify(a)).toBe(before);
 }
});
test('view slots persist angles only and never restore old geometry, locator positions, planes, camera placement or bindings',()=>{
 let a=createAssembly();a.pose={...a.pose,yaw:40,pitch:20,roll:-10};a=saveViewSlot(a,'first','微侧');
 for(let i=1;i<12;i++)a=saveViewSlot({...a,pose:{...a.pose,yaw:i*10}},'v'+i,'View '+i);
 expect(a.viewSlots).toHaveLength(12);a=renameViewSlot(a,'first','斜侧');
 a={...a,pose:{...a.pose,yaw:90,pitch:0,roll:0,position:[.3,.4,.5],distance:12},planes:a.planes.map(p=>({...p,height:p.height+.1})),locators:a.locators.map(l=>({...l,x:l.x+.2}))};
 const applied=applyViewSlot(a,'first');expect(applied.pose).toEqual({...a.pose,yaw:40,pitch:20,roll:-10});
 expect(applied.planes).toBe(a.planes);expect(applied.locators).toBe(a.locators);expect(applied.drawing).toBe(a.drawing);expect(applied.bindings).toBe(a.bindings);
 const updated=updateViewSlot(a,'first');expect(updated.viewSlots![0]).toMatchObject({yaw:90,pitch:0,roll:0,name:'斜侧'});
 const loaded=parseAssembly(JSON.parse(JSON.stringify(updated)));expect(loaded).toEqual(updated);expect(JSON.stringify(loaded.viewSlots)).not.toMatch(/drawing|planes|locators|samples/);
 const removed=deleteViewSlot(loaded,'first');expect(removed.viewSlots).toHaveLength(11);expect(saveViewSlot(removed,'new','New').viewSlots!.at(-1)!.slot).toBe(0);
 expect(parseAssembly(createAssembly()).viewSlots).toBeUndefined();
});
test('view slot validation rejects malformed or ambiguous saved entries',()=>{
 const a=saveViewSlot(createAssembly(),'front','Front'),s=a.viewSlots![0];
 for(const patch of [{yaw:NaN},{name:''},{slot:-1},{slot:1.5}])expect(()=>parseAssembly({...a,viewSlots:[{...s,...patch}]})).toThrow();
 for(const patch of [{viewSlots:[s,s]},{viewSlots:[s,{...s,id:'duplicate-slot'}]},{activeViewSlotId:'missing'},{viewSlots:undefined}])expect(()=>parseAssembly({...a,...patch})).toThrow();
});
