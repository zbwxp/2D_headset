import {expect,test} from 'vitest';
import rawSource from '../assets/hairless-symmetric-two-face.json';
import {emptyDrawing,parseDrawing,type DisplayInterval,type DrawingDocument as Doc,type Point2,type StrokeDisplayIntervals} from '../domain/drawing/model';
import {addLayer,ellipse} from '../domain/drawing/commands';
import {changeDisplayInterval,displayField,displayPath,nearestDisplayPosition} from '../domain/drawing/displayIntervals';
import {beginIntervalDrag,updateIntervalDrag} from '../domain/drawing/intervalDrag';
const actual=parseDrawing(rawSource),routeTrack=actual.displayIntervals!.find(t=>t.displayRoute)!,routeField=displayField(actual,displayPath(actual,routeTrack.anchor.id));
function loop(range:Partial<DisplayInterval>={},reverse=false,anchor=0){
 const layer=addLayer(emptyDrawing(),'Loop'),e=ellipse(layer,layer.layers[0].id,[-1,-1],[1,1],.008);
 const track:StrokeDisplayIntervals={id:'track',anchor:{id:e.ids[anchor],reverse},ranges:[{id:'range',mode:'SHOW',start:.3,end:.7,...range}]};
 const d:Doc={...e.document,displayIntervals:[track]},field=displayField(d,displayPath(d,track.anchor.id));return {d,track,field,range:track.ranges[0]};
}
const measure=(d:Doc,track:StrokeDisplayIntervals)=>displayField(d,displayPath(d,track.anchor.id)).mask!.reduce((n,[a,b])=>n+b-a,0);

test('every member selection resolves the same whole-route order, range index and grip position',()=>{
 const path=displayPath(actual,routeTrack.anchor.id),reference=routeField.tracks.flatMap(t=>t.ranges.flatMap(r=>[0,1].map(side=>({track:t.id,range:r.id,side,point:routeField.at(routeField.native(t,side?r.end:r.start)).p}))));
 for(const member of path.segments){
  const selectedPath=displayPath(actual,member.id),field=displayField(actual,selectedPath);
  expect(selectedPath).toEqual(path);
  const grips=field.tracks.flatMap(t=>t.ranges.flatMap(r=>[0,1].map(side=>({track:t.id,range:r.id,side,point:field.at(field.native(t,side?r.end:r.start)).p}))));
  expect(grips).toEqual(reference);
 }
});

test('a full turn at a nonzero anchor is explicit and never relocates its grips to the origin',()=>{
 const {d,track,field,range}=loop({start:.3,end:.2999});let state=beginIntervalDrag(field,track,range,1,field.at(field.native(track,range.end)).p,1/250);
 const update=updateIntervalDrag(state,field.at(field.native(track,.3001)).p);
 expect(update.change.fullLoop).toBe(true);expect(update.change.start).toBeCloseTo(.3,12);expect(update.change.end).toBe(update.change.start);
 // The serialized representation distinguishes equal full-turn grips from an
 // empty range; no epsilon gap or canonical origin relocation is invented.
 const full=changeDisplayInterval(d,track.id,range.id,update.change);expect(measure(full,track)).toBe(1);
 state=update.state;const shrink=updateIntervalDrag(state,field.at(field.native(track,.299)).p);
 expect(shrink.change.fullLoop).toBe(false);expect(shrink.change.start).toBeCloseTo(.3,12);expect(measure(changeDisplayInterval(d,track.id,range.id,shrink.change),track)).toBeCloseTo(.999,4);
});

test.each([0,1] as const)('existing explicit full loop keeps its arbitrary anchor and shrinks from side%s',side=>{
 const {d,track,field,range}=loop({start:.3,end:.3,fullLoop:true} as Partial<DisplayInterval>),p=field.at(field.native(track,.3)).p,state=beginIntervalDrag(field,track,range,side,p,1/250);
 expect(updateIntervalDrag(state,p).change).toEqual({start:.3,end:.3,fullLoop:true});
 const aim=side?.299:.301,update=updateIntervalDrag(state,field.at(field.native(track,aim)).p);
 expect(update.change.fullLoop).toBe(false);expect(measure(changeDisplayInterval(d,track.id,range.id,update.change),track)).toBeCloseTo(.999,4);
});

test('a collapsed pair can make one continuous lap without switching empty/full at the seam',()=>{
 const {d,track,field,range}=loop({start:.3,end:.3});let state=beginIntervalDrag(field,track,range,1,field.at(field.native(track,.3)).p,1/250);
 for(let i=1;i<=21;i++){
  const end=.3+i*.05,update=updateIntervalDrag(state,field.at(field.native(track,end)).p),changed=changeDisplayInterval(d,track.id,range.id,update.change);
  expect(measure(changed,track)).toBeCloseTo(Math.min(1,i*.05),4);
  if(i>=20){expect(update.change.fullLoop).toBe(true);expect(update.change.start).toBeCloseTo(.3,12);expect(update.change.end).toBe(update.change.start);}
  state=update.state;
 }
});

test('actual open route keeps coincident0/1 terminals distinct, including exact1',()=>{
 const range={id:'end',start:.7942714185677576,end:1},p=routeField.at(1).p;
 expect(displayPath(actual,routeTrack.anchor.id).closed).toBe(false);
 // Old global nearest reverses an unchanged endpoint from1 to0.
 expect(nearestDisplayPosition(routeField,routeTrack,p,1)).toBe(0);
 let state=beginIntervalDrag(routeField,routeTrack,range,1,p,1/250);expect(state.closed).toBe(false);
 for(const aim of [1,0,.000001,.0001]){const update=updateIntervalDrag(state,routeField.at(aim).p);expect(update.change.end).toBeGreaterThan(.998);state=update.state;}
});

test.each([1/125,1/250,1/1000])('actual coincident crown does not jump branches at scale%s',units=>{
 const range={id:'crown',start:.2057285814322423,end:.38526009094373365},p=routeField.at(range.start).p,state=beginIntervalDrag(routeField,routeTrack,range,0,p,units),other=routeField.at(.7942).p;
 expect(nearestDisplayPosition(routeField,routeTrack,other,range.start)).toBeGreaterThan(.79);
 const update=updateIntervalDrag(state,other);expect(Math.abs(update.change.start!-range.start)).toBeLessThan(.002);
 expect(update.change.end).toBe(range.end);
});

test('dragging through a real source join continues along the fixed authored route',()=>{
 const seam=routeField.parts[2].start/routeField.total,range={id:'test',start:seam-.002,end:.8};let state=beginIntervalDrag(routeField,routeTrack,range,0,routeField.at(range.start).p,1/250);
 for(const s of [seam-.001,seam,seam+.001,seam+.002]){const update=updateIntervalDrag(state,routeField.at(s).p);expect(update.change.start).toBeCloseTo(s,4);state=update.state;}
});

test('dragging through the actual linked ARC follows its material instead of the nearby raw chin',()=>{
 const range={id:'arc',start:.498,end:.7};let state=beginIntervalDrag(routeField,routeTrack,range,0,routeField.at(range.start).p,1/250);
 for(const s of [.499,.5,.501,.502]){const update=updateIntervalDrag(state,routeField.at(s).p);expect(update.change.start).toBeCloseTo(s,4);state=update.state;}
});

test.each([false,true])('closed full-loop end at seam never flips full to empty, reverse=%s',reverse=>{
 const {d,track,field,range}=loop({start:0,end:1},reverse),p=field.at(field.native(track,1)).p;let state=beginIntervalDrag(field,track,range,1,p,1/250);
 expect(state.closed).toBe(true);expect(updateIntervalDrag(state,p).change).toEqual({start:0,end:1});
 for(const s of [1.00001,1.0001,1.001]){const update=updateIntervalDrag(state,field.at(field.native(track,s)).p);expect(update.change).toEqual({start:0,end:1});expect(measure(changeDisplayInterval(d,track.id,range.id,update.change),track)).toBe(1);state=update.state;}
});

test.each([0,1] as const)('full loop shrinks continuously when boundary%s moves inward',side=>{
 const {d,track,field,range}=loop({start:0,end:1}),start=side?1:0;let state=beginIntervalDrag(field,track,range,side,field.at(field.native(track,start)).p,1/250);
 for(const step of [.0001,.001,.005]){const target=side?1-step:step,update=updateIntervalDrag(state,field.at(field.native(track,target)).p);expect(measure(changeDisplayInterval(d,track.id,range.id,update.change),track)).toBeCloseTo(1-step,4);state=update.state;}
});

test.each([{reverse:false,anchor:0},{reverse:true,anchor:0},{reverse:false,anchor:2},{reverse:true,anchor:2}])('closed seam wrap is continuous in rotated/reversed frame $reverse/$anchor',({reverse,anchor})=>{
 const {d,track,field,range}=loop({start:.3,end:.999},reverse,anchor);let state=beginIntervalDrag(field,track,range,1,field.at(field.native(track,range.end)).p,1/250);
 for(const end of [.9995,1,1.0005,1.001]){const update=updateIntervalDrag(state,field.at(field.native(track,end)).p);expect(measure(changeDisplayInterval(d,track.id,range.id,update.change),track)).toBeCloseTo(end-.3,4);state=update.state;}
});

test('closed boundary cannot pass its opposite boundary and turn empty into nearly full',()=>{
 const {d,track,field,range}=loop({start:.3,end:.3001});let state=beginIntervalDrag(field,track,range,1,field.at(field.native(track,range.end)).p,1/250);
 for(const end of [.3,.2999,.299,.298]){const update=updateIntervalDrag(state,field.at(field.native(track,end)).p);expect(measure(changeDisplayInterval(d,track.id,range.id,update.change),track)).toBeLessThan(1e-5);state=update.state;}
});

test('curve-local interval remains linear even when its surrounding stroke is closed',()=>{
 const {d,track,range}=loop({start:.8,end:1});track.scope='CURVE';const field=displayField(d,displayPath(d,track.anchor.id)),p=field.at(field.native(track,range.end)).p,state=beginIntervalDrag(field,track,range,1,p,1/250);
 expect(state.closed).toBe(false);const update=updateIntervalDrag(state,field.at(field.native(track,.999)).p);expect(update.change.end).toBeGreaterThan(.99);
});

test('pointer grip offset and no-motion updates do not alter authored values or source data',()=>{
 const {d,track,field,range}=loop(),before=JSON.stringify(d),p=field.at(field.native(track,range.start)).p,pointer:Point2=[p[0]+.015,p[1]-.02],state=beginIntervalDrag(field,track,range,0,pointer,1/250);
 const exact=updateIntervalDrag(state,pointer);expect(exact.state).toBe(state);expect(exact.change).toEqual({start:range.start,end:range.end});
 const target=field.at(field.native(track,.31)).p,result=updateIntervalDrag(state,[target[0]+.015,target[1]-.02]);expect(result.change.start).toBeCloseTo(.31,4);expect(JSON.stringify(d)).toBe(before);
});
