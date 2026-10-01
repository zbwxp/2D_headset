import {expect,test} from 'vitest';
import collar from './fixtures/collar-gap-poses.json';
import threeCollars from './fixtures/collar-three-poses.json';
import {parsePoseRecording} from '../domain/recording/poses';
import {evaluatePoses} from '../domain/recording/poseEvaluation';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,type DrawingDocument as Doc,type DisplayInterval as Range} from '../domain/drawing/model';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {blendPoseIntervals} from '../domain/recording/poseIntervals';
import {alignPoseIntervalDrawings} from '../domain/recording/poseIntervalCorrespondence';
const anchor='3085f1f1-e1b2-4c7d-886e-91de9d7fa74a';
test('three collar snapshots: equivalent hide-middle and show-sides descriptions never reveal the bottom at 15 degrees',()=>{
 const recording=parsePoseRecording(threeCollars),before=JSON.stringify(recording);
 for(let yaw=0;yaw<=20;yaw+=.25){
  const d=evaluatePoses(recording,{yaw,pitch:0}).drawing,f=displayField(d,displayPath(d,anchor));
  expect(f.mask!.reduce((n,[a,b])=>n+b-a,0),`visible length at ${yaw}°`).toBeLessThan(.35);
  expect(f.mask!.some(([a,b])=>a<.5&&b>.5)).toBe(false);
 }
 expect(JSON.stringify(recording)).toBe(before);
});
test('collar gap stays hidden between front and micro-side snapshots, including reversed A/B and different interval IDs',()=>{
 const recording=parsePoseRecording(collar),before=JSON.stringify(recording);
 const results=[0,.001,1,2.5,4.999,5,5.001,7.5,9,9.999,10].map(yaw=>{
  const drawing=evaluatePoses(recording,{yaw,pitch:0}).drawing,f=displayField(drawing,displayPath(drawing,anchor));
  return {yaw,drawing,visibleFraction:f.mask!.reduce((n,[a,b])=>n+b-a,0),mask:f.mask};
 });
 for(const r of results){expect(r.visibleFraction).toBeLessThan(.35);expect(r.mask!.some(([a,b])=>a<.5&&b>.5)).toBe(false);}
 expect(JSON.stringify(recording)).toBe(before);
});

function line(){
 let d=addLayer(emptyDrawing(),'Test');d=createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.7,0],[1,0]],.01,'Line','line');
 d.nodes.forEach((n,i)=>n.id=`n${i}`);d.curves[0].nodes=['n0','n1'];return d;
}
function withRanges(d:Doc,id:string,ranges:Range[],reverse=false):Doc{return {...d,displayIntervals:[{id,anchor:{id:'line',reverse},ranges}]};}
const gap=(id:string,start:number,end:number):Range=>({id,mode:'HIDE',start,end});
const blend=(a:Doc,b:Doc,t=.5)=>({...a,displayIntervals:blendPoseIntervals(a,[{drawing:a,weight:1-t},{drawing:b,weight:t}])});
const field=(d:Doc,id='line')=>displayField(d,displayPath(d,id));
const expectMask=(d:Doc,mask:number[][],id='line')=>{const actual=field(d,id).mask!;expect(actual).toHaveLength(mask.length);actual.forEach((s,i)=>s.forEach((n,j)=>expect(n).toBeCloseTo(mask[i][j],8)));};

test('reversed open A/B and anchor directions keep the same hidden span and the physical endpoint styles',()=>{
 const d=line(),a=withRanges(d,'track-a',[{...gap('gap-a',.2,.75),inkEnds:[{taper:.03,extension:.01},{taper:.07,extension:.02}]}]);
 for(const reverse of [false,true]){
  const b=withRanges(d,'track-b',[{...gap('gap-b',reverse?.8:.75,reverse?.25:.2),inkEnds:reverse?a.displayIntervals![0].ranges[0].inkEnds:[{taper:.07,extension:.02},{taper:.03,extension:.01}]}],reverse);
  for(const t of [0,.001,.25,.5,.75,.999,1]){
   const evaluated=blend(a,b,t);expectMask(evaluated,[[0,.2],[.75,1]]);
   expect(field(evaluated).inkSpans![0].ends[1]).toEqual({taper:.03,extension:.01});expect(field(evaluated).inkSpans![1].ends[0]).toEqual({taper:.07,extension:.02});
   expect(()=>parseDrawing(JSON.parse(JSON.stringify(evaluated)))).not.toThrow();
  }
 }
 const reversed=withRanges(d,'track-a',[{...a.displayIntervals![0].ranges[0],start:.75,end:.2,inkEnds:[{taper:.07,extension:.02},{taper:.03,extension:.01}]}]);
 expectMask(blend(a,reversed),[[0,.2],[.75,1]]);
});

test('recreated intervals match by location, not array order; only a genuinely new distant gap grows',()=>{
 const d=line(),a=withRanges(d,'a',[gap('left',.1,.25),gap('right',.6,.75)]),b=withRanges(d,'b',[gap('right-new',.62,.77),gap('left-new',.12,.27),gap('new',.88,.98)]);
 const mid=blend(a,b);expectMask(mid,[[0,.11],[.26,.61],[.76,.905],[.955,1]]);
 expect(field(blend(b,a)).mask).toEqual(field(mid).mask);
 const sameIds=withRanges(d,'b',[gap('left',.6,.75),gap('right',.1,.25)]);
 expectMask(blend(a,sameIds),[[0,.35],[.5,1]]); // Explicit identities win even when locations cross.
});

test('stable mixed SHOW/HIDE identities survive disjoint motion, reordered ranges and three-way blending',()=>{
 const d=line(),show:Range={id:'visible',start:.1,end:.9},a=withRanges(d,'a',[show,{...gap('moving',.15,.25),inkEnds:[{taper:.02},{taper:.04}]}]);
 const b=withRanges(d,'a',[{...gap('moving',.75,.65),inkEnds:[{taper:.08},{taper:.06}]},{...show,mode:'SHOW'}]);
 const c=withRanges(d,'a',[show,{...gap('moving',.4,.5),inkEnds:[{taper:.04},{taper:.06}]}]),before=JSON.stringify([a,b,c]);
 const inputs=[{drawing:a,weight:.2},{drawing:b,weight:.4},{drawing:c,weight:.4}];
 for(const samples of [inputs,[...inputs].reverse()]){
  const ranges=blendPoseIntervals(d,samples)[0].ranges;expect(ranges.map(r=>r.id).sort()).toEqual(['moving','visible']);
  const result={...d,displayIntervals:[{...a.displayIntervals![0],ranges}]};expectMask(result,[[.1,.45],[.55,.9]]);
  const ends=field(result).inkSpans!;expect(ends[0].ends[1].taper).toBeCloseTo(.044);expect(ends[1].ends[0].taper).toBeCloseTo(.064);
 }
 expect(JSON.stringify([a,b,c])).toBe(before);
});

test('recreated mixed recipe matches before coverage conversion, including unordered endpoints and list order',()=>{
 const d=line(),a=withRanges(d,'a',[
  {id:'old-show',start:.1,end:.9,inkEnds:[{taper:.02},{taper:.04}]},
  {...gap('old-gap',.2,.4),inkEnds:[{taper:.06},{taper:.08}]},
 ]),b=withRanges(d,'b',[
  {...gap('new-gap',.42,.22),inkEnds:[{taper:.1},{taper:.08}]},
  {id:'new-show',mode:'SHOW',start:.91,end:.11,inkEnds:[{taper:.06},{taper:.04}]},
 ]),before=JSON.stringify([a,b]);
 for(const [x,y] of [[a,b],[b,a]]){
  const n=blend(x,y);expect(n.displayIntervals![0].ranges).toHaveLength(2);
  expectMask(n,[[.105,.21],[.41,.905]]);
  const spans=field(n).inkSpans!;expect(spans[0].ends[0].taper).toBeCloseTo(.03);expect(spans[0].ends[1].taper).toBeCloseTo(.07);
  expect(spans[1].ends[0].taper).toBeCloseTo(.09);expect(spans[1].ends[1].taper).toBeCloseTo(.05);
 }
 expect(JSON.stringify([a,b])).toBe(before);
});

test('the same interval in three poses is one channel, independent of weights and source enumeration',()=>{
 const d=line(),a=withRanges(d,'a',[gap('a-gap',.1,.8)]),b=withRanges(d,'b',[gap('b-gap',.12,.82)]),c=withRanges(d,'c',[gap('c-gap',.14,.84)]);
 const sources=[{drawing:a,weight:.2},{drawing:b,weight:.3},{drawing:c,weight:.5}],before=JSON.stringify(sources);
 const result=blendPoseIntervals(d,sources);expect(result).toHaveLength(1);expect(result[0].ranges).toHaveLength(1);expectMask({...d,displayIntervals:result},[[0,.126],[.826,1]]);
 expect(blendPoseIntervals(d,[...sources].reverse())).toEqual(result);expect(JSON.stringify(sources)).toBe(before);
 expect(alignPoseIntervalDrawings([a,b,c])).toBe(alignPoseIntervalDrawings([a,b,c]));
 const edited=withRanges(d,'c',[gap('c-gap',.3,.9)]);expect(alignPoseIntervalDrawings([a,b,edited])).not.toBe(alignPoseIntervalDrawings([a,b,c]));
});

test('ambiguous or disjoint recreated ranges are not force-matched; actual mode changes retain their different masks',()=>{
 const d=line(),a=withRanges(d,'a',[gap('left',.1,.4),gap('right',.2,.5)]),b=withRanges(d,'b',[gap('unknown',.15,.45)]);
 expect(blend(a,b).displayIntervals![0].ranges).toHaveLength(3);
 const only=withRanges(d,'a',[gap('one',.1,.3)]),distant=withRanges(d,'b',[gap('two',.7,.9)]);expect(blend(only,distant).displayIntervals![0].ranges).toHaveLength(2);
 const positive=withRanges(d,'b',[{id:'positive',mode:'SHOW',start:.1,end:.3}]);
 expectMask(blend(only,positive,0),[[0,.1],[.3,1]]);expectMask(blend(only,positive,1),[[.1,.3]]);
 expect(field(blend(only,positive)).mask).not.toEqual(field(only).mask);
});

test('hide-middle and show-sides are identical states regardless of IDs, A/B order, anchor direction or range order',()=>{
 const d=line(),left={taper:.03,extension:.01},right={taper:.06,extension:.02};
 const a=withRanges(d,'hide',[{...gap('middle',.2,.8),inkEnds:[left,right]}]);
 const b=withRanges(d,'show',[
  {id:'right',start:1,end:.8,inkEnds:[{taper:0},right]},
  {id:'left',start:.2,end:0,inkEnds:[left,{taper:0}]},
 ]);
 const c=withRanges(d,'reverse',[{...gap('again',.8,.2),inkEnds:[left,right]}],true);
 const before=JSON.stringify([a,b,c]);
 for(const t of [0,.001,.25,.4999,.5,.5001,.75,.999,1])for(const [x,y] of [[a,b],[b,a],[c,b]]){
  const n=blend(x,y,t);expectMask(n,[[0,.2],[.8,1]]);
  expect(field(n).inkSpans![0].ends[1].taper).toBeCloseTo(.03,10);expect(field(n).inkSpans![1].ends[0].extension).toBeCloseTo(.02,10);
  expect(()=>parseDrawing(JSON.parse(JSON.stringify(n)))).not.toThrow();
 }
 expect(JSON.stringify([a,b,c])).toBe(before);
});

test('closed coverage unifies opposite directions and seam-split show ranges into one gap, preserving physical tips',()=>{
 const d=addLayer(emptyDrawing(),'Loop'),e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.01),id=e.ids[0],path=displayPath(e.document,id),anchorA={...path.segments[0]},left={taper:.02},right={taper:.04};
 const a:Doc={...e.document,displayIntervals:[{id:'a',anchor:anchorA,ranges:[{...gap('middle',.2,.8),inkEnds:[left,right]}]}]};
 const b:Doc={...e.document,displayIntervals:[{id:'b',anchor:anchorA,ranges:[{id:'left',start:0,end:.2,inkEnds:[{},left]},{id:'right',start:.8,end:1,inkEnds:[right,{}]}]}]};
 const f=field(a,id),track={id:'c',anchor:{...path.segments[2],reverse:!path.segments[2].reverse},ranges:[]};
 const c:Doc={...e.document,displayIntervals:[{...track,ranges:[{id:'reverse',mode:'SHOW',start:f.relative(track,f.native(a.displayIntervals![0],.2)),end:f.relative(track,f.native(a.displayIntervals![0],.8)),inkEnds:[left,right]}]}]};
 for(const other of [b,c])for(const t of [0,.001,.5,.999,1]){
  const n=blend(a,other,t);expectMask(n,[[0,.2],[.8,1]],id);
  expect(field(n,id).inkSpans![0].ends[1].taper).toBeCloseTo(.02,10);expect(field(n,id).inkSpans![1].ends[0].taper).toBeCloseTo(.04,10);
  expect(()=>parseDrawing(JSON.parse(JSON.stringify(n)))).not.toThrow();
 }
 const across:Doc={...a,displayIntervals:[{id:'a',anchor:anchorA,ranges:[{...gap('seam',.85,.15),inkEnds:[right,left]}]}]};
 const inside:Doc={...b,displayIntervals:[{id:'b',anchor:anchorA,ranges:[{id:'middle',start:.15,end:.85,inkEnds:[left,right]}]}]};
 for(const t of [.001,.5,.999])expectMask(blend(across,inside,t),[[.15,.85]],id);
});

test('mixed coverage handles overlapping edits, full and empty ink, and a source with no track',()=>{
 const d=line(),a=withRanges(d,'a',[{id:'show',start:.1,end:.9},{...gap('one',.3,.5),inkEnds:[{taper:.03},{}]},{...gap('two',.4,.7),inkEnds:[{},{taper:.07}]}]);
 const b=withRanges(d,'b',[{id:'l',start:.1,end:.3,inkEnds:[{},{taper:.03}]},{id:'r',start:.7,end:.9,inkEnds:[{taper:.07},{}]}]);
 expectMask(blend(a,b),[[.1,.3],[.7,.9]]);
 const full=withRanges(d,'full',[{id:'whole',start:0,end:1}]),hidden=withRanges(d,'hidden',[gap('all',0,1)]);
 expectMask(blend(full,hidden,0),[[0,1]]);expectMask(blend(full,hidden,1),[]);
 expect(field(blend(full,hidden,.5)).mask!.reduce((n,[x,y])=>n+y-x,0)).toBeCloseTo(.5);
 const mix=blendPoseIntervals(d,[{drawing:d,weight:.2},{drawing:a,weight:.3},{drawing:b,weight:.5}]);
 expect(()=>parseDrawing({...d,displayIntervals:mix})).not.toThrow();
});

test('closed ranges rebase across a different anchor and opposite traversal without changing the gap, seam or styles',()=>{
 const d=addLayer(emptyDrawing(),'Loop'),e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.01),id=e.ids[0],path=displayPath(e.document,id);
 const anchorA={...path.segments[0]},anchorB={...path.segments[2],reverse:!path.segments[2].reverse};
 const a:Doc={...e.document,displayIntervals:[{id:'a',anchor:anchorA,ranges:[{...gap('a-gap',.85,.15),inkEnds:[{taper:.02},{taper:.04}]}]}]};
 const f=field(a,id),trackB={id:'b',anchor:anchorB,ranges:[]};
 const b:Doc={...a,displayIntervals:[{...trackB,ranges:[{...gap('b-gap',f.relative(trackB,f.native(a.displayIntervals![0],.15)),f.relative(trackB,f.native(a.displayIntervals![0],.85))),inkEnds:[{taper:.04},{taper:.02}]}]}]};
 for(const t of [.001,.5,.999]){
  const mid=blend(a,b,t);expectMask(mid,[[.15,.85]],id);expect(field(mid,id).inkSpans![0].ends).toEqual([{taper:.04},{taper:.02}]);
 }
});

test('intervals on different paths cannot match even when their coverage percentages coincide',()=>{
 const d=line(),other=createCurve(d,d.layers[0].id,[[0,1],[.3,1],[.7,1],[1,1]],.01,'Other','other');
 const a=withRanges(other,'a',[gap('one',.2,.8)]),b:Doc={...other,displayIntervals:[{id:'b',anchor:{id:'other',reverse:false},ranges:[gap('two',.2,.8)]}]};
 expect(blend(a,b).displayIntervals).toHaveLength(2);
});
