import {test,expect} from 'vitest';
import {addLayer,ellipse,createCurve} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing,type DisplayInterval,type DrawingDocument,type StrokeDisplayIntervals} from '../domain/drawing/model';
import {displayField,displayPath,closedIntervalLength,changeDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk,fillGeometry} from '../domain/drawing/appearance';
import {blendInterval,blendPoseIntervals} from '../domain/recording/poseIntervals';
import {alignPoseIntervalDrawings} from '../domain/recording/poseIntervalCorrespondence';

function loop(){const d=addLayer(emptyDrawing()),e=ellipse(d,d.layers[0].id,[-1,-.7],[1,.7],.02);return createFill(e.document,e.ids,'white');}
const range=(change:Partial<DisplayInterval>={}):DisplayInterval=>({id:'range',start:.3,end:.3,fullLoop:true,inkEnds:[{taper:.1,extension:.04},{taper:.2}],...change});
function withRanges(d:DrawingDocument,ranges:DisplayInterval[],change:Partial<StrokeDisplayIntervals>={}):DrawingDocument{
 return {...d,displayIntervals:[{id:'track',anchor:{id:d.curves[0].id,reverse:false},ranges,...change}]};
}
const field=(d:DrawingDocument)=>displayField(d,displayPath(d,d.displayIntervals![0].anchor.id));
const measure=(d:DrawingDocument)=>field(d).mask?.reduce((n,[a,b])=>n+b-a,0)??1;

test.each([false,true])('full-loop grips at .3 render full closed ink with no visible cut brushes, reverse=%s',reverse=>{
 const original=loop(),d=withRanges(original,[range()],{anchor:{id:original.curves[2].id,reverse}}),t=d.displayIntervals![0],f=field(d);
 expect(f.span(t,t.ranges[0])).toEqual([{start:0,end:1,ends:[{},{}]}]);expect(measure(d)).toBe(1);
 const runs=strokeInk(d,strokeFor(d,t.anchor.id));expect(runs).toHaveLength(1);expect(runs[0].closed).toBe(true);expect(runs[0].uniform).toBe(true);
 expect(fillGeometry(d,d.fills[0])).toEqual(fillGeometry(original,original.fills[0]));expect(t.ranges[0]).toEqual(range());
});

test('equal coordinates are empty unless fullLoop is explicitly true; legacy [0,1] remains full',()=>{
 const d=loop();for(const fullLoop of [undefined,false]){
  expect(measure(withRanges(d,[range({fullLoop})]))).toBe(0);
  expect(measure(withRanges(d,[range({fullLoop,mode:'HIDE'})]))).toBe(1);
 }
 expect(measure(withRanges(d,[range({fullLoop:undefined,start:0,end:1})]))).toBe(1);
 expect(measure(withRanges(d,[range({mode:'HIDE'})]))).toBe(0);
});

test('full SHOW unions correctly, full HIDE subtracts all, and partial HIDE owns the surviving cut brushes',()=>{
 const d=loop(),full=range(),gap=range({id:'gap',mode:'HIDE',start:.15,end:.45,fullLoop:undefined,inkEnds:[{taper:.03},{taper:.07}]}),n=withRanges(d,[full,gap]);
 expect(measure(n)).toBeCloseTo(.7);const spans=field(n).inkSpans!;expect(spans.find(s=>s.end<1)!.ends[1]).toEqual({taper:.03});expect(spans.find(s=>s.start>0)!.ends[0]).toEqual({taper:.07});
 expect(measure(withRanges(d,[full,{...full,id:'hide',mode:'HIDE'}]))).toBe(0);
 expect(measure(withRanges(d,[full,{...gap,mode:'SHOW'}]))).toBe(1);
});

test('numeric boundary edits clear fullLoop; explicitly full edits normalize both grips to the chosen anchor',()=>{
 const d=withRanges(loop(),[range()]);const changed=changeDisplayInterval(d,'track','range',{end:.55});expect(changed.displayIntervals![0].ranges[0].fullLoop).toBeUndefined();expect(measure(changed)).toBeCloseTo(.25);
 const same=changeDisplayInterval(d,'track','range',{start:.3});expect(measure(same)).toBe(0);expect(same.displayIntervals![0].ranges[0].fullLoop).toBeUndefined();
 const full=changeDisplayInterval(changed,'track','range',{start:.7,end:.9,fullLoop:true});expect(full.displayIntervals![0].ranges[0]).toMatchObject({start:.7,end:.7,fullLoop:true});expect(measure(full)).toBe(1);
 const mode=changeDisplayInterval(full,'track','range',{mode:'HIDE'});expect(mode.displayIntervals![0].ranges[0].fullLoop).toBe(true);expect(measure(mode)).toBe(0);
});

test('open paths and CURVE scopes keep linear semantics and reject authoring fullLoop=true',()=>{
 let d=addLayer(emptyDrawing());d=createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.7,0],[1,0]],.02,'Line','line');d=withRanges(d,[range({start:.2,end:.8,fullLoop:undefined})]);
 expect(measure(d)).toBeCloseTo(.6);expect(()=>changeDisplayInterval(d,'track','range',{fullLoop:true})).toThrow(/闭合/);
 const scoped=withRanges(loop(),[range({fullLoop:undefined,start:.2,end:.8})],{scope:'CURVE'});expect(()=>changeDisplayInterval(scoped,'track','range',{fullLoop:true})).toThrow(/闭合/);
});

test('start-plus-length interpolation preserves arbitrary full anchors but does not leak the flag into partial or empty blends',()=>{
 const full=range(),empty=range({fullLoop:undefined}),partial=range({fullLoop:undefined,end:.7});
 expect(blendInterval([{range:full,weight:1,width:.02}],true)).toMatchObject({start:expect.closeTo(.3,12),end:expect.closeTo(.3,12),fullLoop:true});
 for(const weight of [.01,.25,.5,.99])for(const other of [empty,partial]){
  const r=blendInterval([{range:full,weight,width:.02},{range:other,weight:1-weight,width:.02}],true);
  expect(r.fullLoop).toBeUndefined();expect(closedIntervalLength(r)).toBeCloseTo(weight+(1-weight)*closedIntervalLength(other),10);
 }
 const end=blendInterval([{range:full,weight:0,width:.02},{range:empty,weight:1,width:.02}],true);expect(end.fullLoop).toBeUndefined();expect(closedIntervalLength(end)).toBe(0);
 const legacy=blendInterval([{range:range({start:0,end:1,fullLoop:undefined}),weight:1,width:.02}],true);expect(legacy).toMatchObject({start:0,end:1});expect(legacy.fullLoop).toBeUndefined();
});

test('pose rebase retains a full revolution through different anchors and reversed directions',()=>{
 const d=loop(),a=withRanges(d,[range()]),b=withRanges(d,[range({start:.6,end:.6})],{id:'other',anchor:{id:d.curves[2].id,reverse:true}});
 const before=JSON.stringify([a,b]),aligned=alignPoseIntervalDrawings([a,b]);for(const x of aligned){expect(measure(x)).toBe(1);expect(x.displayIntervals![0].ranges[0].fullLoop).toBe(true);}
 const blended={...d,displayIntervals:blendPoseIntervals(d,[{drawing:a,weight:.5},{drawing:b,weight:.5}])};expect(measure(blended)).toBe(1);expect(JSON.stringify([a,b])).toBe(before);
});

test('a missing full HIDE range becomes a partial gap rather than inheriting a whole-loop flag',()=>{
 const d=loop(),a=withRanges(d,[range({mode:'HIDE',inkEnds:[{},{}]})]),b={...d,displayIntervals:[]};
 const n={...d,displayIntervals:blendPoseIntervals(d,[{drawing:a,weight:.5},{drawing:b,weight:.5}])};expect(n.displayIntervals![0].ranges[0].fullLoop).toBeUndefined();expect(measure(n)).toBeCloseTo(.5);
});

test('equivalent full SHOW and no interval do not invent a seam gap during pose coverage alignment',()=>{
 const d=loop(),a=withRanges(d,[range()]),b=withRanges(d,[range({id:'emptyHide',mode:'HIDE',fullLoop:undefined})]);
 for(const t of [.1,.5,.9]){const n={...d,displayIntervals:blendPoseIntervals(d,[{drawing:a,weight:1-t},{drawing:b,weight:t}])};expect(measure(n)).toBe(1);}
});
