import {expect,test} from 'vitest';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument as Doc,type InkEnds} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {strokeInk,displayInkSampling} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
import {blendPoseIntervals} from '../domain/recording/poseIntervals';

function line(){const d=addLayer(emptyDrawing(),'Ink'),n=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'Line','line');n.nodes.forEach((p,i)=>p.id=String(i));n.curves[0].nodes=['0','1'];return n;}
const gap=(d:Doc,start=.3,end=.7,inkEnds:InkEnds=[{taperWidthScale:5},{taperWidthScale:5}],id='line'):Doc=>({...d,displayIntervals:[{id:'track',anchor:{...displayPath(d,id).segments[0]},ranges:[{id:'gap',mode:'HIDE',start,end,inkEnds}]}]});
const blend=(a:Doc,b:Doc,t:number)=>({...a,displayIntervals:blendPoseIntervals(a,[{drawing:a,weight:1-t},{drawing:b,weight:t}])});
const field=(d:Doc,id='line')=>displayField(d,displayPath(d,id));
const ink=(d:Doc,id='line',partition=false)=>strokeInk(d,strokeFor(d,id),undefined,partition,{...displayInkSampling(1000),nativeUniform:false});
function widthAt(d:Doc,x:number){
 const ys=ink(d).flatMap(r=>r.outline.flatMap((p,i)=>{
  const q=r.outline[(i+1)%r.outline.length];
  if(Math.abs(p[0]-x)<1e-9)return [p[1]];
  if((p[0]<x&&q[0]>x)||(q[0]<x&&p[0]>x))return [p[1]+(q[1]-p[1])*(x-p[0])/(q[0]-p[0])];
  return [];
 }));return ys.length?Math.max(...ys)-Math.min(...ys):0;
}
test('a new break visibly thins before separating, carries fixed multiplier tips and reverses continuously',()=>{
 const a=line(),b=gap(a),before=JSON.stringify([a,b]);
 let previous=.02;
 for(const t of [0,.001,.05,.1,.2,.3,1/3,.4,.5,.8,1]){
  const n=blend(a,b,t),w=widthAt(n,.5);
  expect(w).toBeLessThanOrEqual(previous+1e-9);previous=w;
  if(t>0&&t<1/3){expect(w).toBeGreaterThan(0);expect(field(n).mask).toEqual([[0,1]]);expect(ink(n)[0].uniform).toBe(false);}
  if(t>1/3)expect(ink(n)).toHaveLength(2);
  expect(widthAt(n,.1)).toBeCloseTo(.02,8);
  expect(widthAt(blend(b,a,1-t),.5)).toBeCloseTo(w,8);
 }
 const middle=blend(a,b,.5),end=field(middle).mask![0][1];
 expect(field(middle).inkSpans![0].ends[1].taper).toBeCloseTo(.1,9);
 expect(widthAt(middle,end-.05)).toBeCloseTo(.01,5);
 expect(widthAt(middle,end)).toBeCloseTo(0,9);
 expect(Math.abs(widthAt(blend(a,b,1/3-1e-6),.475)-widthAt(blend(a,b,1/3+1e-6),.475))).toBeLessThan(1e-6);
 expect(ink(blend(a,b,1))).toEqual(ink(b));expect(JSON.stringify([a,b])).toBe(before);
});
test('new visible fragments grow from fine tips, retaining taper length instead of growing thick nubs',()=>{
 const d=line(),a:Doc={...d,displayIntervals:[{id:'t',anchor:{id:'line',reverse:false},ranges:[{id:'old',start:0,end:.2}]}]};
 const b:Doc={...a,displayIntervals:[{...a.displayIntervals![0],ranges:[...a.displayIntervals![0].ranges,{id:'new',start:.4,end:.8,inkEnds:[{taper:.1},{taper:.1}]}]}]};
 let last=0;
 for(const t of [.001,.01,.05,.1,.2,.5,1]){
  const n=blend(a,b,t),w=widthAt(n,.6);expect(w).toBeGreaterThanOrEqual(last-1e-9);last=w;
  if(t<.1)expect(w).toBeLessThan(.0001);
  expect(ink(n).every(r=>r.outline.every(p=>p.every(Number.isFinite)))).toBe(true);
 }
 expect(last).toBeCloseTo(.02,7);
});
test('full ink to two SHOW sides pinches just like a HIDE middle, independent of the authoring recipe',()=>{
 const a=line(),hide=gap(a),show:Doc={...a,displayIntervals:[{id:'show',anchor:{id:'line',reverse:false},ranges:[
  {id:'left',start:0,end:.3,inkEnds:[{},{taperWidthScale:5}]},
  {id:'right',start:.7,end:1,inkEnds:[{taperWidthScale:5},{}]},
 ]}]};
 for(const t of [.001,.1,.3,.5,.9,1])for(const x of [.1,.45,.5,.55,.9])expect(widthAt(blend(a,show,t),x)).toBeCloseTo(widthAt(blend(a,hide,t),x),7);
});
test('edge breaks retract from the edge without leaving an isolated sliver, and zero-taper stays a hard cut',()=>{
 const a=line();
 for(const [start,end] of [[0,.4],[.6,1]]){
  const b=gap(a,start,end),pinching=blend(a,b,.05);expect(ink(pinching)).toHaveLength(1);
  expect(widthAt(pinching,start===0?0:1)).toBeLessThan(.02);
  const n=blend(a,b,.5);expect(ink(n)).toHaveLength(1);
  const mask=field(n).mask!;expect(start===0?mask[0][1]:mask[0][0]).toBe(start===0?1:0);
 }
 const hard=blend(a,gap(a,.3,.7,[{taper:0},{taper:0}]),.1);expect(ink(hard)).toHaveLength(2);expect(field(hard).pinches).toEqual([]);
});
test('closed seam pinch stays finite and depth-partitioned rendering carries the same width envelope',()=>{
 const d=addLayer(emptyDrawing(),'Loop'),e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.02),id=e.ids[0],a=e.document,b=gap(a,.98,.02,[{taper:.2},{taper:.3}],id);
 const n=blend(a,b,.1),f=field(n,id);expect(f.pinches).toHaveLength(1);expect(f.pinches[0].position).toBeCloseTo(0,8);
 expect(ink(n,id)).toHaveLength(1);expect(ink(n,id)[0].closed).toBe(true);expect(ink(n,id)[0].uniform).toBe(false);
 expect(ink(n,id)[0].outline.every(p=>p.every(Number.isFinite))).toBe(true);
 const partitions=ink(n,id,true);expect(partitions[0].fragments!.length).toBeGreaterThan(0);
 const ordinaryWidth=widthAt(blend(line(),gap(line()),.1),.5);expect(ordinaryWidth).toBeLessThan(.02);
 const base=line(),p=blend(base,gap(base),.1),seamPoints=ink(p,'line',true)[0].fragments!.flatMap(f=>f.outline).filter(q=>Math.abs(q[0]-.5)<1e-9);
 expect(seamPoints.length).toBeGreaterThan(0);expect(Math.max(...seamPoints.map(q=>Math.abs(q[1])))*2).toBeCloseTo(widthAt(p,.5),9);
 expect(JSON.stringify(n)).not.toContain('pinch');expect(JSON.stringify(a)).not.toContain('displayIntervals');
});
