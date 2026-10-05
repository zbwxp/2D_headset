import {expect,test} from 'vitest';
import {addLayer} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type Point2} from '../domain/drawing/model';
import {beginPenGesture,movePenGesture,previewPenGesture,finishPenGesture,penHoverShape,penHistoryAction,type PenOptions,type PenState} from '../ui/drawing/penController';

function fixture(join:PenOptions['join']='POSITION') {const document=addLayer(emptyDrawing(),'Ink');return {document,options:{layerId:document.layers[0].id,unit:100,width:.012,join,taperScale:8}};}
const end=(base:ReturnType<typeof fixture>['document'],state:PenState|null,start:Point2,handle:Point2,options:PenOptions)=>finishPenGesture(movePenGesture(beginPenGesture(base,state,start),handle),options);

test('first anchor and dragged outgoing handle stay draft-only; continuation preserves native POSITION semantics',()=>{
 const {document,options}=fixture(),before=JSON.stringify(document),first=end(document,null,[3,4],[3.3,4.7],options);
 expect(first.candidate).toBeUndefined();expect(JSON.stringify(document)).toBe(before);
 const segment=end(document,first.state,[5,4],[5.2,4.6],options),candidate=segment.candidate!;
 expect(shapeOf(candidate.document,candidate.next.last!)).toEqual([[3,4],[3.3,4.7],[4.8,3.4000000000000004],[5,4]]);
 expect(candidate.document.curves[0].inkEnds).toEqual([{taperWidthScale:8},{taperWidthScale:8}]);
 const next=end(candidate.document,segment.state,[6,4],[6,4],options).candidate!;
 expect(next.document.curves[1].nodes[0]).toBe(next.document.curves[0].nodes[1]);expect(next.document.joins).toEqual([]);
 expect(shapeOf(next.document,next.next.last!)[1]).toEqual([5+1/3,4]);
});
test.each(['SMOOTH','CUSP'] as const)('%s continuation and closure use native Drawing joins',join=>{
 const {document,options}=fixture(join),first=end(document,null,[0,0],[.4,.5],options),one=end(document,first.state,[1,0],[1.3,.4],options),two=end(one.candidate!.document,one.state,[1,1],[1.3,1.2],options);
 expect(two.candidate!.document.joins[0].mode).toBe(join);
 const closed=end(two.candidate!.document,two.state,[.03,.02],[.3,.5],options);
 expect(closed.state).toBeNull();expect(closed.candidate!.closed).toBe(true);
 const shape=shapeOf(closed.candidate!.document,closed.candidate!.next.last!);expect(shape[3]).toEqual([0,0]);
 expect(closed.candidate!.document.curves.at(-1)!.nodes[1]).toBe(closed.candidate!.document.curves[0].nodes[0]);
});
test('snapped anchor keeps handle displacement relative to actual pointer grab and ignores duplicate anchor clicks',()=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[0,0],options).state!;
 const gesture=movePenGesture(beginPenGesture(document,first,[1,1],[.98,.97]),[1.18,1.37]),preview=previewPenGesture(gesture,options)!;
 expect(gesture.cursor[0]).toBeCloseTo(1.2);expect(gesture.cursor[1]).toBeCloseTo(1.4);
 expect(preview.shape[2][0]).toBeCloseTo(.8);expect(preview.shape[2][1]).toBeCloseTo(.6);
 expect(finishPenGesture(beginPenGesture(document,first,[.01,0]),options)).toEqual({state:first});
 expect(penHoverShape(first,[1,0],'POSITION')).toEqual([[0,0],[1/3,0],[1-1/3,0],[1,0]]);
});
test('Undo cancels a pending drag or unsaved anchor before touching document history',()=>{
 expect(penHistoryAction(false,true,null)).toBe('cancel-gesture');expect(penHistoryAction(false,false,{position:[0,0],out:[0,0]})).toBe('cancel-anchor');
 expect(penHistoryAction(true,false,{position:[0,0],out:[0,0]})).toBe('history');expect(penHistoryAction(false,false,{position:[1,0],out:[0,0],last:'curve'})).toBe('history');
});

test('preview and finish retain the exact pen candidate for one gesture and equal options',()=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[.4,.5],options).state;
 const gesture=movePenGesture(beginPenGesture(document,first,[1,0]),[1.3,.4]),preview=previewPenGesture(gesture,options)!;
 expect(previewPenGesture(gesture,{...options})).toBe(preview);
 const result=finishPenGesture(gesture,{...options});expect(result.candidate).toBe(preview);expect(result.candidate!.document).toBe(preview.document);expect(result.state).toBe(preview.next);
 expect(finishPenGesture(gesture,options).candidate).toBe(preview);
});

test('finish without a prior preview prepares one candidate and retains it for later reads',()=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[0,0],options).state,gesture=beginPenGesture(document,first,[1,0]);
 const result=finishPenGesture(gesture,options);expect(result.candidate).toBeDefined();expect(previewPenGesture(gesture,options)).toBe(result.candidate);
});

test('moving a gesture creates a fresh candidate without altering a retained earlier target',()=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[0,0],options).state,gesture=beginPenGesture(document,first,[1,0]),preview=previewPenGesture(gesture,options)!,before=JSON.stringify(preview);
 const moved=movePenGesture(gesture,[1.3,.4]),next=previewPenGesture(moved,options)!;
 expect(next).not.toBe(preview);expect(next.next.last).not.toBe(preview.next.last);expect(next.shape).not.toEqual(preview.shape);expect(finishPenGesture(moved,options).candidate).toBe(next);
 expect(finishPenGesture(gesture,options).candidate).toBe(preview);expect(JSON.stringify(preview)).toBe(before);
});

test.each([
 {width:.02},{unit:200},{join:'SMOOTH'},{taperScale:4},{preserveAuthoredBrush:true},
] satisfies Partial<PenOptions>[])('a changed pen option %j replaces the candidate even if the options object is reused',change=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[0,0],options).state,gesture=beginPenGesture(document,first,[1,0]),preview=previewPenGesture(gesture,options)!;
 Object.assign(options,change);const next=previewPenGesture(gesture,options)!;
 expect(next).not.toBe(preview);expect(next.next.last).not.toBe(preview.next.last);expect(finishPenGesture(gesture,{...options}).candidate).toBe(next);
});

test('layer changes replace the candidate and invalid options cannot return a stale target',()=>{
 const {document,options}=fixture(),base=addLayer(document,'Other'),first=end(base,null,[0,0],[0,0],options).state,gesture=beginPenGesture(base,first,[1,0]),preview=previewPenGesture(gesture,options)!;
 options.layerId=base.layers.find(layer=>layer.id!==options.layerId)!.id;const next=previewPenGesture(gesture,options)!;
 expect(next).not.toBe(preview);expect(next.document.layers.find(layer=>layer.id===options.layerId)!.items).toContain(next.next.last);
 const invalid={...options,layerId:null};expect(()=>previewPenGesture(gesture,invalid)).toThrow();expect(()=>finishPenGesture(gesture,invalid)).toThrow();
});

test('changed pixel scale can suppress a previously previewed segment',()=>{
 const {document,options}=fixture(),first=end(document,null,[0,0],[0,0],options).state,gesture=beginPenGesture(document,first,[.03,0]);
 expect(previewPenGesture(gesture,options)).toBeDefined();options.unit=10;
 expect(previewPenGesture(gesture,options)).toBeUndefined();expect(finishPenGesture(gesture,options)).toEqual({state:first});
});
