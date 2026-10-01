import {test,expect} from 'vitest';
import {emptyDrawing,parseDrawing,type DisplayIntervalMode,type DrawingDocument} from '../../domain/drawing/model';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {addDisplayInterval,changeDisplayInterval,displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {strokeInk} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {createAssembly,assemblyDrawing,parseAssembly,type AssemblyDocument} from '../../domain/assembly/model';
import {ensureTimeline,savePose,deleteLayerPose,discardPose,setTimelineLoop} from '../../domain/assembly/timeline';
import {updateAssemblyDrawing} from '../../ui/assemblyDrawing/workspace';
import {blendPoseIntervals} from '../../domain/recording/poseIntervals';

function fixture(mode:DisplayIntervalMode='HIDE'){
 let d=addLayer(emptyDrawing(),'Mouth');d=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'Mouth','mouth');
 d=addDisplayInterval(d,'mouth',mode);const t=d.displayIntervals![0],r=t.ranges[0];
 return changeDisplayInterval(d,t.id,r.id,{start:.2,end:.8,enabled:false});
}
const at=(a:AssemblyDocument,yaw:number,pitch=0)=>({...a,pose:{...a.pose,yaw,pitch}});
function switchTo(d:DrawingDocument,enabled:boolean,start?:number){const t=d.displayIntervals![0],r=t.ranges[0];return changeDisplayInterval(d,t.id,r.id,{enabled,...(start===undefined?{}:{start})});}
const edit=(a:AssemblyDocument,enabled:boolean,start?:number)=>updateAssemblyDrawing(a,switchTo(assemblyDrawing(a),enabled,start));
const range=(a:AssemblyDocument)=>assemblyDrawing(a).displayIntervals![0].ranges[0];
const field=(d:DrawingDocument)=>displayField(d,displayPath(d,'mouth'));

test.each(['SHOW','HIDE'] as const)('%s can be paused without losing its range or pen tips',mode=>{
 const d=fixture(mode),without={...d,displayIntervals:[]};
 d.curves[0].inkEnds=[{taper:.1},{taper:.1}];
 // A disabled inferred cut must not suppress the real endpoint's pen style.
 d.displayIntervals![0].scope='CURVE';d.displayIntervals![0].revealFrom=0;
 const off=switchTo(d,false,0),on=switchTo(off,true);
 expect(field(off).mask).toBeUndefined();expect(strokeInk(off,strokeFor(off,'mouth'))).toEqual(strokeInk(without,strokeFor(without,'mouth')));
 expect(field(on).mask).toEqual(mode==='SHOW'?[[0,.8]]:[[.8,1]]);
 expect(switchTo(on,false).displayIntervals).toEqual(off.displayIntervals);
 expect(parseDrawing(JSON.parse(JSON.stringify(off)))).toEqual(off);
 const invalid=structuredClone(off);(invalid.displayIntervals![0].ranges[0] as any).enabled=1;expect(()=>parseDrawing(invalid)).toThrow();
});

test.each([1,-1])('switch waits for the keyed yaw in direction %s, while positions keep interpolating',direction=>{
 const d=fixture();let a=ensureTimeline(createAssembly(d));
 a=savePose(edit(at(a,30*direction),true,.4));a=savePose(edit(at(a,60*direction),false,.5));
 for(const [yaw,enabled] of [[0,false],[.1,false],[15,false],[29.99,false],[30,true],[30.01,true],[45,true],[59.99,true],[60,false],[70,false]] as const){
  const posed=at(a,yaw*direction);expect(range(posed).enabled,`yaw ${yaw*direction}`).toBe(enabled);
  if(!enabled)expect(field(assemblyDrawing(posed)).mask).toBeUndefined();
 }
 expect(range(at(a,15*direction)).start).toBeCloseTo(.3);
 expect(range(at(a,45*direction)).start).toBeCloseTo(.45);
 expect(a.drawing).toEqual(d);expect(parseAssembly(JSON.parse(JSON.stringify(a)))).toEqual(a);
 const draft=edit(at(a,15*direction),true);expect(range(draft).enabled).toBe(true);expect(range(discardPose(draft)).enabled).toBe(false);
 const removed=deleteLayerPose(at(a,30*direction),d.layers[0].id,'intervals');expect(range(at(removed,30*direction)).enabled).toBe(false);
});

test('side-angle base and circular yaw seam keep switches held until arrival',()=>{
 let a=ensureTimeline(at(createAssembly(fixture()),170));a=setTimelineLoop(a,true);
 a=savePose(edit(at(a,-170),true));
 for(const yaw of [170,175,179.99,-180,-175,-170.01])expect(range(at(a,yaw)).enabled).toBe(false);
 expect(range(at(a,-170)).enabled).toBe(true);
 let b=ensureTimeline(at(createAssembly(fixture()),30));b=savePose(edit(at(b,60),true));expect(range(at(b,59.9)).enabled).toBe(false);expect(range(at(b,60)).enabled).toBe(true);
});

test('pitch uses a held switch too; unrelated layers never acquire keys',()=>{
 let a=ensureTimeline(createAssembly(fixture()));a=savePose(edit(at(a,0,30),true));
 expect(range(at(a,0,29.9)).enabled).toBe(false);expect(range(at(a,0,30)).enabled).toBe(true);
 expect(a.timeline!.intervals.map(t=>t.layerId)).toEqual([a.drawing.layers[0].id]);
});

test('mixed SHOW/HIDE keeps authored switch identities instead of baking them into coverage',()=>{
 let off=addDisplayInterval(fixture('SHOW'),'mouth','HIDE');const t=off.displayIntervals![0],gap=t.ranges[1];
 off=changeDisplayInterval(off,t.id,gap.id,{start:.4,end:.6});const on=switchTo(off,true);
 const blend=(state:number)=>({...off,displayIntervals:blendPoseIntervals(off,[{drawing:off,weight:.1},{drawing:on,weight:.9}],state)});
 expect(field(blend(0)).mask).toEqual([[0,.4],[.6,1]]);
 expect(field(blend(1)).mask![0][0]).toBeCloseTo(.2);expect(field(blend(1)).mask![1][1]).toBeCloseTo(.8);
 expect(blend(0).displayIntervals![0].ranges.map(r=>r.id)).toEqual(off.displayIntervals![0].ranges.map(r=>r.id));
});

test('an explicitly enabled new range stays inactive until its first keyed angle',()=>{
 const drawing={...fixture(),displayIntervals:[]};let a=ensureTimeline(createAssembly(drawing));
 let d=addDisplayInterval(assemblyDrawing(at(a,30)),'mouth','HIDE');d=switchTo(d,true);a=savePose(updateAssemblyDrawing(at(a,30),d));
 expect(range(at(a,29.99)).enabled).toBe(false);expect(field(assemblyDrawing(at(a,29.99))).mask).toBeUndefined();expect(range(at(a,30)).enabled).toBe(true);
});
