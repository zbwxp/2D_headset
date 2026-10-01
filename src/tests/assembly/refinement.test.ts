import {test,expect} from 'vitest';
import {createAssembly,parseAssembly} from '../../domain/assembly/model';
import {ensureTimeline,setTimelineStage,savePose,discardPose,deleteLayerPose,poseRows,layerPoseStatus} from '../../domain/assembly/timeline';
import {beginRefinementFrame,moveRefinedControl,refinementEvaluation,refinementProjector,refinedControls,zeroCorrection} from '../../domain/assembly/refinement';
import {layerProjection} from '../../domain/assembly/projection';
import {neutralBend,writeBend} from '../../domain/assembly/bending';
import {emptyDrawing,shapeOf,type Point2,type Cubic} from '../../domain/drawing/model';
import {addLayer,createCurve,connect} from '../../domain/drawing/commands';
import {vectorProjection} from '../../domain/assembly/vectorProjection';
import {point} from '../../domain/drawing/sampling';
import {subcurve,derivedUses} from '../../domain/drawing/roundedJoin';
import {inkRuns,displayInkSampling,strokeInk,fillGeometry} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
function fixture(){let d=addLayer(emptyDrawing(),'Jaw');d=createCurve(d,d.layers[0].id,[[-.5,.4],[-.6,-.2],[-.2,-.6],[0,-.6]],.02);d=createCurve(d,d.layers[0].id,[[0,-.6],[.3,-.6],[.4,-.2],[.5,.4]],.02);d=connect(d,{curveId:d.curves[0].id,end:1},{curveId:d.curves[1].id,end:0},'SMOOTH');let a=ensureTimeline(createAssembly(d));a={...a,pose:{...a.pose,yaw:60}};return setTimelineStage(a,'REFINE');}
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],5));
const mapOf=(a:ReturnType<typeof fixture>)=>{const p=layerProjection(a,a.drawing.layers[0].id,{width:0,height:0,unit:1,pan:[0,0]});return (q:Point2):Point2=>{const p2=p.mapCanonical(q);return [p2[0],-p2[1]];};};
test('post-deformer cubic correction, exact zero, source IDs and subdivision correspondence',()=>{
 let a=fixture();const bend=neutralBend();bend.handles[1][0][0]=1.3;a=writeBend(a,a.drawing.layers[0].id,bend);const id=a.drawing.curves[0].id,s=shapeOf(a.drawing,id),base=structuredClone(a.drawing),map=mapOf(a),zero=refinementProjector(a,map);
 for(let i=0;i<=10;i++)near(zero(point(s,i/10),s,i/10),map(point(s,i/10)));
 a=moveRefinedControl(a,id,1,[.1,.2]);const corrected=refinementProjector(a,map),t=.4,w=3*(1-t)**2*t,q=map(point(s,t));near(corrected(point(s,t),s,t),[q[0]+.1*w,q[1]+.2*w]);
 const sub=subcurve(s,.2,.8);near(corrected(point(sub,.5),sub,.5),corrected(point(s,.5),s,.5));expect(a.drawing).toEqual(base);
 const controls=refinedControls(a,id,map),raw=refinedControls(setTimelineStage(a,'BEND'),id,map);near(controls[1],[raw[1][0]+.1,raw[1][1]+.2]);
});
test('sparse per-curve drafts, interpolation, save/discard/delete and JSON roundtrip',()=>{
 let a=fixture();const id=a.drawing.curves[0].id,layer=a.drawing.layers[0].id;a=moveRefinedControl(a,id,1,[.2,.1]);expect(layerPoseStatus(a,layer,'refine')).toBe('draft');expect(poseRows(a).find(r=>r.yaw===60)?.dirty).toBe(true);expect(a.timeline!.refinements).toHaveLength(1);
 expect(discardPose(a).timeline!.refinements![0].drafts).toHaveLength(0);a=savePose(a);const before=refinementEvaluation(a,id);a={...a,pose:{...a.pose,yaw:30}};const mid=refinementEvaluation(a,id);near(mid.delta[1],before.delta[1].map(n=>n/2) as Point2);expect(layerPoseStatus(a,layer,'refine')).toBe('interpolated');
 a=savePose(a);expect(a.timeline!.refinements![0].keys).toHaveLength(2);expect(parseAssembly(JSON.parse(JSON.stringify(a)))).toEqual(a);
 a={...a,pose:{...a.pose,yaw:60}};expect(deleteLayerPose(a,layer,'refine').timeline!.refinements![0].keys).toHaveLength(1);
});
test('shared endpoints and smooth handle relationship survive post-transform edits',()=>{
 let a=fixture();const [x,y]=a.drawing.curves.map(c=>c.id),map=mapOf(a);a=moveRefinedControl(a,x,3,[.2,.3]);const p=refinedControls(a,x,map),q=refinedControls(a,y,map);near(p[3],q[0]);expect(a.timeline!.refinements).toHaveLength(2);
 a=moveRefinedControl(a,x,2,[.1,.1]);const left=refinedControls(a,x,map),right=refinedControls(a,y,map),v=[left[2][0]-left[3][0],left[2][1]-left[3][1]],w=[right[1][0]-right[0][0],right[1][1]-right[0][1]];expect(v[0]*w[1]-v[1]*w[0]).toBeCloseTo(0,7);expect(v[0]*w[0]+v[1]*w[1]).toBeLessThan(0);
});
test('corrected ink, fill and arc bridge share geometry, width stays unchanged',()=>{
 let a=fixture();let d=a.drawing;d=connect(d,{curveId:d.curves[0].id,end:1},{curveId:d.curves[1].id,end:0},'ARC',.1);a={...a,drawing:d};const [x,y]=d.curves.map(c=>c.id);a=moveRefinedControl(a,x,3,[.15,.1]);const project=refinementProjector(a,p=>p),projection=vectorProjection(project),path=strokeFor(a.drawing,x),g=derivedUses(a.drawing,path.segments),shapes=projection.shapes(g.shapes);
 for(let i=1;i<shapes.length;i++)near(shapes[i-1][3],shapes[i][0]);expect(strokeInk(a.drawing,path,undefined,false,{...displayInkSampling(250),projection})[0].shapes.length).toBeGreaterThan(0);
 // A solid closed boundary is derived through the exact same provenance path.
 const close:Cubic=[shapeOf(d,y)[3],[.25,.4],[-.25,.4],shapeOf(d,x)[0]];d=createCurve(a.drawing,d.layers[0].id,close,.02);const boundary=[x,y,d.curves.at(-1)!.id].map(id=>({id,reverse:false}));const f={id:'f',name:'fill',visible:true,locked:false,color:'white' as const,boundary};const fs=projection.shapes(fillGeometry(d,f).shapes);near(fs[0][0],fs.at(-1)![3]);
});
test('tapered interval samples receive the same correction as uniform paths without widening ink',()=>{
 let a=fixture();const id=a.drawing.curves[0].id;a=moveRefinedControl(a,id,1,[.25,0]);const s=shapeOf(a.drawing,id),project=refinementProjector(a,p=>p),projection=vectorProjection(project),sampling={...displayInkSampling(250),projection};
 const runs=inkRuns([s],.02,'UNIFORM',false,undefined,false,[{},{}],[],[[.2,.8]],[{start:.2,end:.8,ends:[{taper:.1},{taper:.1}]}],undefined,false,sampling);const plain=inkRuns([s],.02,'UNIFORM',false,undefined,false,[{},{}],[],[[.2,.8]],[{start:.2,end:.8,ends:[{taper:.1},{taper:.1}]}]);expect(runs[0].outline).not.toEqual(plain[0].outline);expect(runs[0].outline.flat().every(Number.isFinite)).toBe(true);
 const c:Cubic=[[0,0],[.3,0],[.7,0],[1,0]],widthRun=inkRuns([c],.02,'UNIFORM',false,undefined,false,[{taper:.1},{}],undefined,undefined,undefined,undefined,false,{...sampling,projection:vectorProjection(([x,y])=>[x*.2,y*.3])})[0];expect(Math.max(...widthRun.outline.map(p=>p[1]))-Math.min(...widthRun.outline.map(p=>p[1]))).toBeCloseTo(.02,6);
});
test('shared endpoints remain joined across a new zero-default handle-only pose',()=>{
 let a=fixture();const [x,y]=a.drawing.curves.map(c=>c.id);a=savePose(moveRefinedControl(a,x,3,[.3,.1]));a={...a,pose:{...a.pose,yaw:30}};a=savePose(moveRefinedControl(a,x,1,[.15,.08]));
 for(const yaw of [5,15,25,35,45,55]){const current={...a,pose:{...a.pose,yaw}},map=mapOf(current);near(refinedControls(current,x,map)[3],refinedControls(current,y,map)[0]);}
});
const at=(a:ReturnType<typeof fixture>,yaw:number)=>({...a,pose:{...a.pose,yaw}});
function regionKey(a:ReturnType<typeof fixture>,layerId:string){const bend=neutralBend();bend.handles[1][0][0]=1.2;return savePose(writeBend(a,layerId,bend));}
test('unedited recorded layer poses are zero boundaries; intermediate angles interpolate both offsets',()=>{
 let a=fixture();const id=a.drawing.curves[0].id,layer=a.drawing.layers[0].id;
 a=savePose(moveRefinedControl(a,id,1,[.2,.1]));const correction=refinementEvaluation(a,id).delta;
 a=regionKey(at(a,30),layer);expect(refinementEvaluation(a,id).delta).toEqual(zeroCorrection());expect(layerPoseStatus(a,layer,'refine')).toBe('zero');
 for(const yaw of [0,10,20,30])expect(refinementEvaluation(at(a,yaw),id).delta).toEqual(zeroCorrection());
 near(refinementEvaluation(at(a,45),id).delta[1],correction[1].map(n=>n/2) as Point2);
 expect(refinementEvaluation(at(a,60),id).delta).toEqual(correction);
 // Missing control entries at a recorded angle are zero, not inherited from 60°.
 a=savePose(moveRefinedControl(a,id,0,[.05,.03]));expect(refinementEvaluation(a,id).delta[2]).toEqual([0,0]);
 expect(parseAssembly(JSON.parse(JSON.stringify(a)))).toEqual(a);
});
test('another layer or an angle label alone cannot introduce a zero boundary',()=>{
 let a=fixture();const id=a.drawing.curves[0].id;
 a=savePose(moveRefinedControl(a,id,1,[.2,.1]));const expected=refinementEvaluation(at(a,30),id).delta;
 let d=addLayer(a.drawing,'Unrelated');const other=d.layers[0].id;d=createCurve(d,other,[[0,0],[.2,0],[.4,.3],[.5,.5]],.02);
 a=regionKey(at({...a,drawing:d},30),other);expect(refinementEvaluation(a,id).delta).toEqual(expected);
 a={...a,timeline:{...a.timeline!,labels:[...a.timeline!.labels,{yaw:30,pitch:0,name:'label only'}]}};
 expect(refinementEvaluation(a,id).delta).toEqual(expected);
});
test('new correction authoring starts at zero while navigation, saved corrections and originals stay intact',()=>{
 let a=fixture();const id=a.drawing.curves[0].id,layer=a.drawing.layers[0].id,source=structuredClone(a.drawing);
 a=savePose(moveRefinedControl(a,id,1,[.2,.1]));const saved=refinementEvaluation(a,id).delta;
 const middle=at(a,30),before=JSON.stringify(middle),half=refinementEvaluation(middle,id).delta;
 expect(half[1][0]).toBeGreaterThan(0);expect(JSON.stringify(middle)).toBe(before);
 const started=beginRefinementFrame(middle,[layer]);expect(refinementEvaluation(started,id).delta).toEqual(zeroCorrection());expect(layerPoseStatus(started,layer,'refine')).toBe('draft');
 expect(refinementEvaluation(discardPose(started),id).delta).toEqual(half);
 const edited=moveRefinedControl(middle,id,1,[.03,.04]),e=refinementEvaluation(edited,id);near([e.delta[1][0]*e.size[0],e.delta[1][1]*e.size[1]],[.03,.04]);
 expect(refinementEvaluation(beginRefinementFrame(at(edited,60),[layer]),id).delta).toEqual(saved);expect(edited.drawing).toEqual(source);
 const locked={...middle,drawing:{...middle.drawing,curves:middle.drawing.curves.map(c=>({...c,locked:true}))}};expect(()=>beginRefinementFrame(locked,[layer])).not.toThrow();
});
test('region drafts default to zero locally; deleting a correction versus the entire frame has distinct results',()=>{
 let a=fixture();const id=a.drawing.curves[0].id,layer=a.drawing.layers[0].id;
 a=savePose(moveRefinedControl(a,id,1,[.2,.1]));const middle=at(a,30),expected=refinementEvaluation(middle,id).delta,bend=neutralBend();bend.handles[1][0][0]=1.2;
 a=writeBend(middle,layer,bend);expect(refinementEvaluation(a,id).delta).toEqual(zeroCorrection());expect(refinementEvaluation(discardPose(a),id).delta).toEqual(expected);
 expect(refinementEvaluation(at(a,45),id).delta).toEqual(refinementEvaluation(at(middle,45),id).delta);
 a=savePose(moveRefinedControl(a,id,1,[.05,.03]));a=deleteLayerPose(a,layer,'refine');expect(refinementEvaluation(a,id).delta).toEqual(zeroCorrection());
 a=deleteLayerPose(a,layer);expect(refinementEvaluation(a,id).delta).toEqual(expected);
});
