import {expect,test} from 'vitest';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument as Doc,type InkEnds} from '../domain/drawing/model';
import {strokeInk} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
import {evaluatePoses} from '../domain/recording/poseEvaluation';
import {parsePoseRecording,type PoseRecording} from '../domain/recording/poses';
import {blendPoseInkEnds} from '../domain/recording/poseInkEnds';
import hair from './fixtures/hair-midpoint-poses.json';

const ink=(d:Doc,id:string)=>strokeInk(d,strokeFor(d,id));
const area=(d:Doc,id:string)=>ink(d,id).reduce((sum,r)=>sum+Math.abs(r.outline.reduce((s,p,i)=>{const q=r.outline[(i+1)%r.outline.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2,0);
function line(size=1,width=.02,ends:InkEnds=[{taperWidthScale:20},{taperWidthScale:20}]){
 const d=addLayer(emptyDrawing(),'Ink'),n=createCurve(d,d.layers[0].id,[[0,0],[size/3,0],[size*2/3,0],[size,0]],width,'Line','line');
 n.nodes.forEach((p,i)=>p.id=String(i));n.curves[0].nodes=['0','1'];n.curves[0].inkEnds=ends;return n;
}
function recording(a:Doc,b:Doc):PoseRecording{return {version:1,poses:[a,b].map((drawing,i)=>({id:String(i),name:String(i),sourceSnapshotId:String(i),yaw:i*10,pitch:0,offset:[0,0],drawing}))};}
const evaluate=(r:PoseRecording,yaw:number)=>evaluatePoses(r,{yaw,pitch:0});

test('real hair has no ink jump when dominant pose and stroke traversal switch at 15 degrees',()=>{
 const r=parsePoseRecording(hair),before=JSON.stringify(r),a=evaluate(r,15-1e-6),b=evaluate(r,15+1e-6);
 for(const id of ['dfe61aac-f7b3-4c78-b834-3e8e899ac584','84b654f8-f033-4ed8-8075-724e7d48d718']){
  expect(Math.max(...shapeOf(a.drawing,id).flatMap((p,i)=>p.map((v,k)=>Math.abs(v-shapeOf(b.drawing,id)[i][k]))))).toBeLessThan(1e-7);
  expect(Math.abs(area(a.drawing,id)/area(b.drawing,id)-1)).toBeLessThan(1e-4);
  expect(ink(a.drawing,id).every(r=>r.outline.every(p=>p.every(Number.isFinite)))).toBe(true);
 }
 const newId='7ee706ca-8959-4079-bc6b-161714a977e7';
 for(const yaw of [10,14.89,15.14,19.99]){const e=evaluate(r,yaw);expect(e.status.get(newId)).toBe('frozen');expect(e.opacity.get(newId)).toBe(0);expect(shapeOf(e.drawing,newId)).toEqual(shapeOf(evaluate(r,20).drawing,newId));}
 expect(JSON.stringify(r)).toBe(before);
});
test('short 20x tapers retain their rendered fit at authored views and approach them continuously',()=>{
 const a=line(.1),b=line(.15,.03,[{taper:0},{taper:.02}]),r=recording(a,b);
 expect(ink(evaluate(r,0).drawing,'line')).toEqual(ink(a,'line'));
 expect(ink(evaluate(r,10).drawing,'line')).toEqual(ink(b,'line'));
 expect(area(evaluate(r,1e-5).drawing,'line')).toBeCloseTo(area(a,'line'),8);
 expect(area(evaluate(r,10-1e-5).drawing,'line')).toBeCloseTo(area(b,'line'),8);
 const ends=evaluate(r,5).drawing.curves[0].inkEnds!;
 expect(ends[0].taper).toBeCloseTo(.025);expect(ends[1].taper).toBeCloseTo(.035);
});
test('mixed absolute and width-relative taper distances and tangent extensions interpolate, without rewriting source',()=>{
 const a=line(2,.02,[{taperWidthScale:5,extension:.04},{taper:.2}]),b=line(2,.04,[{taper:.3,extension:.1},{taperWidthScale:10}]),r=recording(a,b),saved=JSON.stringify(r);
 for(const t of [.1,.49,.51,.9]){
  const ends=evaluate(r,t*10).drawing.curves[0].inkEnds!;
  expect(ends[0].taper).toBeCloseTo(.1+.2*t);expect(ends[0].extension).toBeCloseTo(.04+.06*t);expect(ends[1].taper).toBeCloseTo(.2+.2*t);
 }
 expect(JSON.stringify(r)).toBe(saved);expect(parsePoseRecording(JSON.parse(saved))).toEqual(r);
});
test('bound default tapers stay inactive; explicit interior ink alone interpolates',()=>{
 const a=line(),b0=createCurve(a,a.layers[0].id,[[1,0],[1.3,0],[1.7,0],[2,0]],.02,'Next','next');
 b0.curves[1].nodes[0]='1';b0.curves[1].inkEnds=[{taperWidthScale:20},{taperWidthScale:20}];
 const b=structuredClone(b0);b.curves[0].inkEnds![1]={interior:true,taper:.12,extension:.03};
 const ends=blendPoseInkEnds('line',[{drawing:b0,weight:.5},{drawing:b,weight:.5}]);
 expect(ends[1]).toEqual({taper:.06,extension:.015,interior:true});
 expect(blendPoseInkEnds('next',[{drawing:b0,weight:.5},{drawing:b,weight:.5}])[0]).toEqual({taper:0,extension:0});
 const loopLayer=addLayer(emptyDrawing(),'Loop'),e=ellipse(loopLayer,loopLayer.layers[0].id,[-1,-1],[1,1],.02);
 // The loop's four source curves carry the same dormant pen defaults.
 e.document.layers[0].items=[...e.ids];e.document.curves.forEach(c=>c.inkEnds=[{taperWidthScale:20},{taperWidthScale:20}]);
 const loop=structuredClone(e.document);
 expect(blendPoseInkEnds(e.ids[0],[{drawing:e.document,weight:.5},{drawing:loop,weight:.5}])).toEqual([{taper:0,extension:0},{taper:0,extension:0}]);
});
