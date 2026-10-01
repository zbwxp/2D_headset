import {expect,test} from 'vitest';
import * as c from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument as Doc,type DisplayInterval,type InkEnds} from '../domain/drawing/model';
import {displayField,displayPath,subtractInkSpans} from '../domain/drawing/displayIntervals';
import {strokeInk,type InkRun} from '../domain/drawing/appearance';
import type {StrokePath} from '../domain/drawing/strokes';

const ends=(a=.2,b=a):InkEnds=>[{taper:a},{taper:b}];
const hide=(start:number,end:number,inkEnds=ends()):DisplayInterval=>({id:'hide',mode:'HIDE',start,end,inkEnds});
function circle(ranges:DisplayInterval[]){
 const base=c.addLayer(emptyDrawing(),'Loop'),e=c.ellipse(base,base.layers[0].id,[-1,-1],[1,1],.02),path=displayPath(e.document,e.ids[0]);
 return {...e.document,displayIntervals:[{id:'track',anchor:{...path.segments[0]},ranges}]};
}
const render=(d:Doc,path=displayPath(d,d.displayIntervals![0].anchor.id))=>strokeInk(d,{id:'loop',...path});
function tipWidths(run:InkRun){
 const n=run.outline.length/2;
 const distance=(a:number,b:number)=>Math.hypot(run.outline[a][0]-run.outline[b][0],run.outline[a][1]-run.outline[b][1]);
 return [distance(0,run.outline.length-1),distance(n-1,n)];
}
function expectTaperedTips(d:Doc,path?:StrokePath){
 const runs=render(d,path);expect(runs).toHaveLength(1);expect(runs[0].closed).toBe(false);
 for(const width of tipWidths(runs[0]))expect(width).toBeCloseTo(0,12);
 return runs[0];
}

// Exact four-curve source coordinates, rounded chin and interval values from
// the reported hidden-crown drawing. Unrelated facial objects are omitted.
function reportedCrown():Doc{
 return {...emptyDrawing(),
  layers:[{id:'face',name:'Face',visible:true,locked:false,items:['a','b','c','d']}],
  nodes:[
   {id:'right',position:[-.7657886639037134,.09792762502142666]},
   {id:'left',position:[.10682776104592862,.09792762502142666]},
   {id:'chin',position:[-.3294804514288924,-.36047937039627503]},
   {id:'crown',position:[-.3294804514288924,.82]},
  ],
  curves:[
   {id:'a',name:'Right jaw',nodes:['right','chin'],handles:[[-.7225171883662357,-.209242826591701],[-.49127512420371144,-.2898634914425202]],visible:true,locked:false,width:.008},
   {id:'b',name:'Left jaw',nodes:['left','chin'],handles:[[.06355628550845094,-.209242826591701],[-.1676857786540733,-.2898634914425202]],visible:true,locked:false,width:.008},
   {id:'c',name:'Left crown',nodes:['left','crown'],handles:[[.25241414694524533,.5130906820331453],[.12237946620077689,.82]],visible:true,locked:false,width:.008,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]},
   {id:'d',name:'Right crown',nodes:['crown','right'],handles:[[-.7813403690585616,.82],[-.9113750498030301,.5130906820331453]],visible:true,locked:false,width:.008,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]},
  ],
  joins:[{id:'chin-arc',a:{curveId:'a',end:1},b:{curveId:'b',end:1},mode:'ARC',radius:.05257222158088604}],
  displayIntervals:[{id:'track',anchor:{id:'a',reverse:false},ranges:[
   {id:'disabled-show',start:.042880304699886684,end:.3606729887796445,inkEnds:ends(.04),enabled:false},
   hide(.3899118358647087,1,[{taperWidthScale:20},{taperWidthScale:20}]),
  ]}],
 };
}

test('reported symmetric hidden crown retains both .16 tapers without altering source geometry',()=>{
 const d=reportedCrown(),before=JSON.stringify(d),path=displayPath(d,'a'),field=displayField(d,path);
 expect(path.closed).toBe(true);expect(field.inkSpans).toHaveLength(1);
 expect(field.mask![0][0]).toBe(0);expect(field.mask![0][1]).toBeCloseTo(.3899118358647087,14);
 for(const end of field.inkSpans![0].ends)expect(end.taper).toBeCloseTo(.16,14);
 const run=expectTaperedTips(d),a=run.shapes[0][0],b=run.shapes.at(-1)![3];
 expect(a[0]+b[0]).toBeCloseTo(2*-.3294804514288924,12);expect(a[1]).toBeCloseTo(b[1],12);
 expect(a[1]).toBeCloseTo(.09792762502142666,12);expect(JSON.stringify(d)).toBe(before);
});

test.each([[.5,1],[0,.5],[.5,1-1e-12],[1e-12,.5],[.074,1]])('HIDE %s → %s keeps the cut brush across a closed 0/1 seam',(a,b)=>{
 const d=circle([hide(a,b)]);expectTaperedTips(d);
 const spans=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id)).inkSpans!;
 expect(spans).toHaveLength(1);expect(spans[0].ends.map(e=>e.taper)).toEqual([.2,.2]);
});

test('a floating-point seam overshoot with a rotated anchor retains its true boundary brush',()=>{
 const d=circle([hide(.0075,.75,ends(.1,.3))]),path=displayPath(d,d.displayIntervals![0].anchor.id);
 d.displayIntervals![0].anchor={...path.segments[1]};
 expectTaperedTips(d);const field=displayField(d,path);
 expect(field.mask![0][0]).toBe(0);expect(field.mask![0][1]).toBeCloseTo(.2575,14);
 expect(field.inkSpans![0].ends.map(e=>e.taper)).toEqual([.3,.1]);
});

test('a rotated cut just before the seam does not discard its brush with a tiny wrapped fragment',()=>{
 const d=circle([hide(.75-1e-12,.1,ends(.1,.3))]),path=displayPath(d,d.displayIntervals![0].anchor.id);
 d.displayIntervals![0].anchor={...path.segments[1]};
 expectTaperedTips(d);const field=displayField(d,path);
 expect(field.mask![0][0]).toBeCloseTo(.35,10);expect(field.mask![0][1]).toBe(1);
 expect(field.inkSpans![0].ends.map(e=>e.taper)).toEqual([.3,.1]);
});

test('rotating or reversing a closed traversal preserves the same physical tapered cuts',()=>{
 const d=circle([hide(.5,1)]),original=displayPath(d,d.displayIntervals![0].anchor.id),initial=expectTaperedTips(d);
 const expected=[initial.shapes[0][0],initial.shapes.at(-1)![3]];
 for(let i=0;i<original.segments.length;i++)for(const reverse of [false,true]){
  const segments=[...original.segments.slice(i),...original.segments.slice(0,i)];
  const path={closed:true,segments:reverse?segments.reverse().map(u=>({...u,reverse:!u.reverse})):segments};
  const run=expectTaperedTips(d,path),actual=[run.shapes[0][0],run.shapes.at(-1)![3]];
  for(const p of actual)expect(Math.min(...expected.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])))).toBeLessThan(1e-10);
 }
});

test('reversing the saved anchor keeps both seam brushes, including unequal styles',()=>{
 const d=circle([hide(.5,1,ends(.1,.3))]);d.displayIntervals![0].anchor.reverse=!d.displayIntervals![0].anchor.reverse;
 expectTaperedTips(d);const spans=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id)).inkSpans!;
 const tapered=spans.flatMap(s=>s.ends).flatMap(e=>e.taper===undefined?[]:[e.taper]);expect(tapered.sort()).toEqual([.1,.3]);
});

test('SHOW union through the seam still receives the exposed HIDE brush',()=>{
 const d=circle([{id:'show-a',mode:'SHOW',start:.8,end:.3,inkEnds:ends(.7)},{id:'show-b',mode:'SHOW',start:.2,end:.9,inkEnds:ends(.9)},hide(.5,1,ends(.1,.3))]);
 expectTaperedTips(d);const field=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id));
 expect(field.mask).toEqual([[0,.5]]);expect(field.inkSpans![0].ends.map(e=>e.taper)).toEqual([.3,.1]);
});

test('overlapping HIDE ranges use union boundary brushes and ignore covered markers',()=>{
 const d=circle([hide(.4,.8,ends(.1,.9)),{...hide(.7,1,ends(.8,.3)),id:'hide-second'}]);
 expectTaperedTips(d);const field=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id));
 expect(field.mask![0][1]).toBeCloseTo(.4,14);expect(field.inkSpans![0].ends.map(e=>e.taper)).toEqual([.3,.1]);
});

test('interior and seam-wrapping gaps create only their two genuine brush boundaries',()=>{
 for(const [a,b] of [[.25,.75],[.75,.25]]){
  const d=circle([hide(a,b,ends(.1,.3))]);expectTaperedTips(d);
  const f=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id));
  expect(f.inkSpans!.flatMap(s=>s.ends).flatMap(e=>e.taper===undefined?[]:[e.taper]).sort()).toEqual([.1,.3]);
 }
});

test('a full hidden loop is empty and a full shown loop has no false seam tip',()=>{
 const hidden=circle([hide(0,1)]);expect(render(hidden)).toEqual([]);
 const shown=circle([{id:'show',start:0,end:1,inkEnds:ends()}]),runs=render(shown);
 expect(runs).toHaveLength(1);expect(runs[0].closed).toBe(true);expect(runs[0].uniform).toBe(true);
});

test('a SHOW already bounded at the seam keeps its brush when ink did not cross the seam',()=>{
 const d=circle([{id:'show',start:0,end:.4,inkEnds:ends(.6,.7)},hide(.7,1)]);
 const field=displayField(d,displayPath(d,d.displayIntervals![0].anchor.id));
 expect(field.inkSpans![0].ends.map(e=>e.taper)).toEqual([.6,.7]);expectTaperedTips(d);
});

test('circular subtraction preserves full brush metadata and does not change the default open-path operation',()=>{
 const base=[{start:0,end:1,ends:ends(0)}],gaps=[{start:.5,end:1,ends:[{taper:.1,extension:.05},{taper:.3,extension:.07}] as InkEnds}];
 const input=JSON.stringify({base,gaps}),closed=subtractInkSpans(base,gaps,true),open=subtractInkSpans(base,gaps);
 expect(closed[0].ends).toEqual([{taper:.3,extension:.07},{taper:.1,extension:.05}]);
 expect(open[0].ends).toEqual([{taper:0},{taper:.1,extension:.05}]);expect(JSON.stringify({base,gaps})).toBe(input);
});
