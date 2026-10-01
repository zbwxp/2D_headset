import {test,expect} from 'vitest';
import {displayInkSampling,strokeInk,inkRuns} from '../domain/drawing/appearance';
import {depthPaintBatches,memberInk} from '../domain/drawing/depth';
import {strokes,strokePaths} from '../domain/drawing/strokes';
import {evaluatePoses} from '../domain/recording/poseEvaluation';
import {emptyPoseRecording,recordSnapshot} from '../domain/recording/poses';
import {parseDrawing} from '../domain/drawing/model';
import type {Point2,Cubic} from '../domain/drawing/model';
import fixture from '../../artifacts/recording-performance/fixture.json';

const recording=fixture.drawingSnapshots.items.reduce((r,s,i)=>recordSnapshot(r,{...s,drawing:parseDrawing(s.drawing)},{yaw:i*15,pitch:0}),emptyPoseRecording());
function distance(p:Point2,line:Point2[]){
 let best=Infinity;for(let i=0;i<line.length;i++){const a=line[i],b=line[(i+1)%line.length],x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));best=Math.min(best,Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y));}return best;
}
test('display samples preserve the face silhouette, tips and interval boundaries within a subpixel budget',()=>{
 const before=JSON.stringify(recording);let worst=0,oldCount=0,newCount=0,worstName='';
 for(const yaw of [0,7.5,15]){
  const d=evaluatePoses(recording,{yaw,pitch:0}).drawing;
  for(const s of d.layers.flatMap(l=>strokes(d,l.id))){
   const precise=strokeInk(d,s),coarse=strokeInk(d,s,undefined,false,{...displayInkSampling(250),nativeUniform:false});expect(coarse).toHaveLength(precise.length);
   coarse.forEach((run,i)=>{
    const previous=precise[i];expect(run.uniform).toBe(previous.uniform);expect(run.closed).toBe(previous.closed);expect(run.shapes).toHaveLength(previous.shapes.length);
    // Hausdorff distance at all polygon vertices in both directions, including cusps.
    for(const [a,b] of [[run.outline,previous.outline],[previous.outline,run.outline]])for(const p of a){const error=distance(p,b)*250;if(error>worst){worst=error;worstName=d.curves.find(c=>c.id===s.id)!.name;}}
    oldCount+=previous.outline.length;newCount+=run.outline.length;
   });
  }
 }

 expect(worst,`silhouette error at ${worstName}`).toBeLessThan(.25);expect(newCount).toBeLessThan(oldCount*.75);expect(JSON.stringify(recording)).toBe(before);
});
test('uniform cubic rendering keeps exact curves and sharp tips without a redundant outline',()=>{
 const a:Cubic=[[0,1],[0,.5],[0,.2],[0,0]],b:Cubic=[[0,0],[.2,.05],[.6,.2],[1,.2]];
 const exact=inkRuns([a,b],.02,'UNIFORM',false,undefined,false,undefined,[0]);
 const native=inkRuns([a,b],.02,'UNIFORM',false,undefined,false,undefined,[0],undefined,undefined,undefined,false,displayInkSampling(250));
 expect(native[0].uniform).toBe(true);expect(native[0].outline).toEqual([]);expect(native[0].shapes).toEqual(exact[0].shapes);expect(native[0].tips).toEqual(exact[0].tips);
 const raster=inkRuns([a,b],.02,'UNIFORM',false,undefined,false,undefined,[0],undefined,undefined,undefined,false,{...displayInkSampling(250),nativeUniform:false});expect(raster[0].outline.length).toBeGreaterThan(0);
 expect(displayInkSampling(2000).tolerance).toBeLessThan(displayInkSampling(250).tolerance);expect(displayInkSampling(2000).taperSteps).toBeGreaterThan(displayInkSampling(250).taperSteps);
});
test('paint order cache follows structural edits but reuses unchanged topology across interpolated frames',()=>{
 const a=evaluatePoses(recording,{yaw:10,pitch:0}).drawing,b=evaluatePoses(recording,{yaw:12,pitch:0}).drawing;
 expect(depthPaintBatches(b)).toBe(depthPaintBatches(a));
 const changed=structuredClone(b),previous=depthPaintBatches(changed);changed.layers.reverse();expect(depthPaintBatches(changed)).not.toBe(previous);
 const edited=structuredClone(b),layer=edited.layers.find(l=>l.items.length>2)!;const old=depthPaintBatches(edited);layer.items.reverse();expect(depthPaintBatches(edited)).not.toBe(old);
 const offset=structuredClone(b),base=depthPaintBatches(offset);offset.curves[0].depthOffset=1;expect(depthPaintBatches(offset)).not.toBe(base);
 const positions=new Map(depthPaintBatches(b).filter(x=>x.owner).map(x=>[x.owner!,x.position]));
 for(const batch of depthPaintBatches(b))if(batch.owner){for(const path of strokePaths(batch.item.stroke!)){const runs=memberInk(b,{...path,id:batch.item.id},positions,displayInkSampling(250)).get(batch.owner)??[];for(const r of runs)expect(r.outline.length).toBeGreaterThan(0);}}
});
