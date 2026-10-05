import {expect,test} from 'vitest';
import rawSource from '../assets/hairless-symmetric-two-face.json';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,type DisplayInterval,type DrawingDocument,type Point2,type StrokeDisplayIntervals} from '../domain/drawing/model';
import {currentPreparedEditRevision} from '../app/preparedEditRevision';
import {beginDrawingIntervalGesture,updateDrawingIntervalGesture,type DrawingIntervalGesture} from '../ui/drawing/intervalGesture';
import {cancelEditorGesture,clearGestureTarget,previewGestureTarget,takeGestureTarget,type GesturePreviewTarget} from '../ui/drawing/gestureTransaction';

const unitsPerPixel=1/250;
const actual=parseDrawing(rawSource),actualRoute=actual.displayIntervals!.find(track=>track.displayRoute)!;
function fixture(drawing:DrawingDocument,track:StrokeDisplayIntervals){
 const base={...drawing,displayIntervals:[track]},field=displayField(base,displayPath(base,track.anchor.id));
 return {base,track,field,at:(value:number)=>field.at(field.native(track,value)).p};
}
function line(range:Partial<DisplayInterval>={}){
 let drawing=addLayer(emptyDrawing(),'Line');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.01,'Line','line');
 return fixture(drawing,{id:'track',anchor:{id:'line',reverse:false},ranges:[{id:'range',mode:'HIDE',start:.2,end:.8,inkEnds:[{taper:.1},{extension:.02}],...range}]});
}
function loop(range:Partial<DisplayInterval>={},reverse=false){
 const layer=addLayer(emptyDrawing(),'Loop'),drawing=ellipse(layer,layer.layers[0].id,[-1,-1],[1,1],.008);
 return fixture(drawing.document,{id:'track',anchor:{id:drawing.ids[2],reverse},ranges:[{id:'range',mode:'SHOW',start:.3,end:.7,...range}]});
}
function route(range:Partial<DisplayInterval>={}){
 return fixture(actual,{...actualRoute,ranges:[{id:'range',mode:'SHOW',start:.498,end:.7,...range}]});
}
const rangeOf=(drawing:DrawingDocument)=>drawing.displayIntervals![0].ranges[0];
const begin=(f:ReturnType<typeof fixture>,end:0|1=1)=>beginDrawingIntervalGesture(f.base,f.track.id,'range',end,f.at(end?f.track.ranges[0].end:f.track.ranges[0].start),unitsPerPixel);

test('the shared target producer selects the authored anchor and retains a fixed base across backtracking',()=>{
 const f=line(),before=JSON.stringify(f.base),initial=begin(f),selection={ids:['line'],displayInterval:{track:'track',range:'range',end:1}};
 expect(initial.selection).toEqual(selection);expect(initial.base).toBe(f.base);
 const forward=updateDrawingIntervalGesture(initial,f.at(.9)),returning=updateDrawingIntervalGesture(forward.gesture,f.at(.75)),back=updateDrawingIntervalGesture(returning.gesture,f.at(.6));
 expect(rangeOf(forward.drawing).end).toBeCloseTo(.9,12);expect(rangeOf(back.drawing).end).toBeCloseTo(.6,12);
 expect(rangeOf(back.drawing)).toMatchObject({start:.2,mode:'HIDE',inkEnds:[{taper:.1},{extension:.02}]});
 expect(back.gesture.base).toBe(f.base);expect(back.gesture.selection).toBe(initial.selection);expect(initial.walk.pointer).toEqual(f.at(.8));
 expect(back.drawing.nodes).toBe(f.base.nodes);expect(back.drawing.curves).toBe(f.base.curves);expect(JSON.stringify(f.base)).toBe(before);
});

test('a grabbed offset remains stable and no-motion samples preserve the document identity',()=>{
 const f=line(),grip=f.at(.8),offset:Point2=[.015,-.02],pointer:Point2=[grip[0]+offset[0],grip[1]+offset[1]],gesture=beginDrawingIntervalGesture(f.base,'track','range',1,pointer,unitsPerPixel);
 const still=updateDrawingIntervalGesture(gesture,pointer);expect(still.drawing).toBe(f.base);expect(still.gesture.walk).toBe(gesture.walk);
 const point=f.at(.85),moved=updateDrawingIntervalGesture(still.gesture,[point[0]+offset[0],point[1]+offset[1]]);
 expect(rangeOf(moved.drawing).end).toBeCloseTo(.85,12);
});

test.each([false,true])('a collapsed closed range expands through the seam to a full lap and back, reverse=%s',reverse=>{
 const f=loop({start:.3,end:.3},reverse),before=JSON.stringify(f.base);let gesture=begin(f),drawing:DrawingDocument=f.base;
 expect(updateDrawingIntervalGesture(gesture,f.at(.3)).drawing).toBe(f.base);
 for(let i=1;i<=20;i++){
  const result=updateDrawingIntervalGesture(gesture,f.at(.3+i*.05));gesture=result.gesture;drawing=result.drawing;
  const field=displayField(drawing,displayPath(drawing,f.track.anchor.id)),coverage=field.mask!.reduce((total,[a,b])=>total+b-a,0);
  expect(coverage).toBeCloseTo(i*.05,4);
 }
 expect(rangeOf(drawing)).toMatchObject({fullLoop:true});expect(rangeOf(drawing).start).toBeCloseTo(.3,12);expect(rangeOf(drawing).end).toBe(rangeOf(drawing).start);
 const back=updateDrawingIntervalGesture(gesture,f.at(1.25));expect(rangeOf(back.drawing).fullLoop).toBe(false);expect(rangeOf(back.drawing).end).toBeCloseTo(.25,4);
 expect(back.gesture.base).toBe(f.base);expect(JSON.stringify(f.base)).toBe(before);
});

test.each([0,1] as const)('an explicit full loop shrinks from the chosen coincident grip %s',end=>{
 const f=loop({start:.3,end:.3,fullLoop:true}),gesture=begin(f,end),result=updateDrawingIntervalGesture(gesture,f.at(end?.299:.301));
 expect(rangeOf(result.drawing).fullLoop).toBe(false);
 const field=displayField(result.drawing,displayPath(result.drawing,f.track.anchor.id));expect(field.mask!.reduce((total,[a,b])=>total+b-a,0)).toBeCloseTo(.999,4);
 expect(result.gesture.selection.displayInterval.end).toBe(end);
});

test('an open route keeps its coincident terminals and nearby crossing material distinct',()=>{
 const f=route({start:.7942714185677576,end:1});let gesture=begin(f);
 expect(gesture.walk.closed).toBe(false);
 for(const point of [1,0,.000001,.0001]){const result=updateDrawingIntervalGesture(gesture,f.at(point));expect(rangeOf(result.drawing).end).toBeGreaterThan(.998);gesture=result.gesture;}
 const crown=route({start:.2057285814322423,end:.38526009094373365}),result=updateDrawingIntervalGesture(begin(crown,0),crown.at(.7942));
 expect(Math.abs(rangeOf(result.drawing).start-crown.track.ranges[0].start)).toBeLessThan(.002);expect(rangeOf(result.drawing).end).toBe(crown.track.ranges[0].end);
});

test('a routed grip walks the linked ARC forward and backward without altering route or layer ownership',()=>{
 const f=route(),before=JSON.stringify(f.base);let gesture=begin(f,0);
 expect(f.field.geometry.pieces.some(piece=>piece.joinId)).toBe(true);
 for(const position of [.499,.5,.501,.502,.501,.5,.499,.498]){
  const result=updateDrawingIntervalGesture(gesture,f.at(position));gesture=result.gesture;
  expect(rangeOf(result.drawing).start).toBeCloseTo(position,4);expect(rangeOf(result.drawing).end).toBe(.7);
  expect(result.drawing.displayIntervals![0].displayRoute).toBe(f.track.displayRoute);expect(result.drawing.layers).toBe(f.base.layers);expect(result.drawing.endpointLinks).toBe(f.base.endpointLinks);
 }
 expect(JSON.stringify(f.base)).toBe(before);
});

test('preview acceptance and cancellation remain host responsibilities, including restart and duplicate release',()=>{
 const f=line(),revision=currentPreparedEditRevision(),slot:GesturePreviewTarget<DrawingDocument>={};let gesture:DrawingIntervalGesture=begin(f),shown:DrawingDocument|null=null;
 const sample=(point:Point2)=>previewGestureTarget(slot,()=>{const result=updateDrawingIntervalGesture(gesture,point);gesture=result.gesture;return result.drawing;},drawing=>{shown=drawing;});
 sample(f.at(.9));expect(rangeOf(shown!).end).toBeCloseTo(.9,12);expect(currentPreparedEditRevision()).toBe(revision);expect(rangeOf(f.base).end).toBe(.8);
 cancelEditorGesture(true,()=>{clearGestureTarget(slot);shown=null;});expect(shown).toBeNull();expect(takeGestureTarget(slot)).toBeUndefined();expect(currentPreparedEditRevision()).not.toBe(revision);
 gesture=begin(f);sample(f.at(.7));const accepted=takeGestureTarget(slot)!;
 expect(rangeOf(accepted).end).toBeCloseTo(.7,12);expect(takeGestureTarget(slot)).toBeUndefined();expect(rangeOf(f.base).end).toBe(.8);
});

test('a missing interval rejects begin before producing a selection or a target',()=>{
 const f=line(),before=JSON.stringify(f.base);
 expect(()=>beginDrawingIntervalGesture(f.base,'missing','range',0,[0,0],unitsPerPixel)).toThrow('no longer available');
 expect(()=>beginDrawingIntervalGesture(f.base,'track','missing',0,[0,0],unitsPerPixel)).toThrow('no longer available');expect(JSON.stringify(f.base)).toBe(before);
});
