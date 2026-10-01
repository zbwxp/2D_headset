import {test,expect} from 'vitest';
import {neutralBend,bendEdges,bendPoint,inverseBend,assertBend,writeBend,bendEvaluation} from '../../domain/assembly/bending';
import {point} from '../../domain/drawing/sampling';
import {emptyDrawing,type Point2,type Cubic} from '../../domain/drawing/model';
import {createCurve,addLayer} from '../../domain/drawing/commands';
import {createAssembly,parseAssembly,bindLayer,assemblyDrawing,updateDrawing} from '../../domain/assembly/model';
import {ensureTimeline,setTimelineStage,savePose,deleteLayerPose,discardPose,deletePose,poseRows,layerPoseStatus,setTimelineLoop} from '../../domain/assembly/timeline';
import {layerProjection} from '../../domain/assembly/projection';
import {vectorProjection} from '../../domain/assembly/vectorProjection';
import {inkRuns,displayInkSampling} from '../../domain/drawing/appearance';
import {map3} from '../../domain/assembly/perspective';
function bowed(){const v=neutralBend();v.handles[1][0][0]=1.3;v.handles[1][1][0]=1.3;return v;}
function fixture(){let d=addLayer(emptyDrawing(),'Bend');d=createCurve(d,d.layers[0].id,[[-.5,-.5],[-.5,-.2],[.5,.2],[.5,.5]],.04);return ensureTimeline(createAssembly(d));}
const near=(p:Point2,q:Point2)=>p.forEach((n,i)=>expect(n).toBeCloseTo(q[i],7));
test('Coons identity, exact boundaries and continuous edge influence',()=>{
 const v=bowed(),e=bendEdges(v);assertBend(v);
 for(let i=0;i<=20;i++){const t=i/20;near(bendPoint(neutralBend(),[t,1-t]),[t,1-t]);near(bendPoint(v,[t,0]),point(e[0],t));near(bendPoint(v,[1,t]),point(e[1],t));near(bendPoint(v,[t,1]),point(e[2],1-t));near(bendPoint(v,[0,t]),point(e[3],1-t));}
 expect(bendPoint(v,[.75,.5])[0]-.75).toBeGreaterThan(bendPoint(v,[.25,.5])[0]-.25);
});
test('interior inverse returns source points and rejects fold-over',()=>{
 const v=bowed();v.handles[0][0][1]=-.15;v.handles[2][1][1]=1.15;assertBend(v);
 for(let i=0;i<=10;i++)for(let j=0;j<=10;j++)near(inverseBend(v,bendPoint(v,[i/10,j/10])),[i/10,j/10]);
 const bad=neutralBend();bad.handles[1][0][0]=bad.handles[1][1][0]=-2;expect(()=>assertBend(bad)).toThrow('折叠');
});
test('bend records are sparse, saved with poses, interpolated, removable and round trip',()=>{
 let a=fixture();const id=a.drawing.layers[0].id,raw=structuredClone(a.drawing);a={...a,pose:{...a.pose,yaw:60}};a=writeBend(a,id,bowed());
 expect(layerPoseStatus(a,id,'bend')).toBe('draft');expect(poseRows(a).find(r=>r.yaw===60)?.channels).toContain('bend');expect(a.drawing).toEqual(raw);
 expect(discardPose(a).timeline!.bends![0].drafts).toHaveLength(0);a=savePose(a);expect(layerPoseStatus(a,id,'bend')).toBe('key');
 a={...a,pose:{...a.pose,yaw:30}};const half=bendEvaluation(a,id).value;expect(half.handles[1][0][0]).toBeCloseTo(1.15);expect(layerPoseStatus(a,id,'bend')).toBe('interpolated');
 a=savePose(a);expect(a.timeline!.bends![0].keys).toHaveLength(2);expect(parseAssembly(JSON.parse(JSON.stringify(a)))).toEqual(a);
 a=writeBend(a,id,neutralBend());a=savePose(a);expect(a.timeline!.bends![0].keys).toHaveLength(3);
 expect(deleteLayerPose(a,id,'bend').timeline!.bends![0].keys).toHaveLength(2);
 expect(deletePose(a).timeline!.bends![0].keys).toHaveLength(2);
 expect(setTimelineLoop(a,true).timeline!.loop).toBe(true);
});
test('straight boundaries preserve exact perspective and stage switches retain source',()=>{
 let a=fixture(),id=a.drawing.layers[0].id;a=writeBend(a,id,bowed());a=setTimelineStage(a,'BEND');
 const v={width:600,height:600,unit:200,pan:[0,0] as Point2},p=layerProjection(a,id,v),q:Point2=[.2,.15];near(p.inverseDrawing(p.mapDrawing(q)),q);
 const raw=setTimelineStage(a,'PERSPECTIVE'),r=layerProjection(raw,id,v);near(r.mapDrawing(q),[340,270]);expect(p.mapDrawing(q)).not.toEqual(r.mapDrawing(q));
 a=writeBend(a,id,neutralBend());const straight=layerProjection(a,id,v);near(straight.mapCanonical(q),map3(straight.manualPlacement,q));
});
test('depth scaling preserves authored width including inverse updates',()=>{
 let a=fixture();const id=a.drawing.layers[0].id;a=bindLayer(a,id,'eye-l');a={...a,pose:{...a.pose,yaw:80,position:[0,0,-3]}};const d=assemblyDrawing(a);
 expect(d.curves[0].width).toBe(a.drawing.curves[0].width);expect(d.nodes).not.toEqual(a.drawing.nodes);expect(updateDrawing(a,d).drawing.curves[0].width).toBe(a.drawing.curves[0].width);
});
test('projected uniform and tapered centerlines retain width instead of scaling their outline',()=>{
 const shape:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]],projection=vectorProjection(([x,y])=>[x*.3,y*.2]),sampling={...displayInkSampling(250),projection};
 const uniform=inkRuns([shape],.1,'UNIFORM',false,undefined,false,undefined,undefined,undefined,undefined,undefined,false,sampling)[0];
 expect(uniform.uniform).toBe(true);expect(uniform.shapes.at(-1)![3][0]).toBeCloseTo(.3);
 const tapered=inkRuns([shape],.1,'UNIFORM',false,undefined,false,[{taper:.1},{taper:.1}],undefined,undefined,undefined,undefined,false,sampling)[0];
 const ys=tapered.outline.map(p=>p[1]);expect(Math.max(...ys)-Math.min(...ys)).toBeCloseTo(.1,7);
 // The same inputs with another projection cannot hit a stale geometry cache.
 const second=inkRuns([shape],.1,'UNIFORM',false,undefined,false,undefined,undefined,undefined,undefined,undefined,false,{...sampling,projection:vectorProjection(([x,y])=>[x*2,y])})[0];expect(second.shapes.at(-1)![3][0]).toBeCloseTo(2);
});
test('adaptive vector fit follows a nonlinear field without modifying source topology',()=>{
 const c:Cubic=[[0,0],[.3,.8],[.7,.3],[1,1]],original=structuredClone(c),v=bowed(),projection=vectorProjection(p=>bendPoint(v,p),.0001),curves=projection.shapes([c]);
 expect(c).toEqual(original);near(curves[0][0],bendPoint(v,c[0]));near(curves.at(-1)![3],bendPoint(v,c[3]));expect(curves.length).toBeGreaterThan(1);
});
