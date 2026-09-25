import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,nodeAt,curveById,shapeOf,sub,type DrawingDocument as Doc,type Cubic,type Endpoint} from '../domain/drawing/model';
import {strokeFor,strokeIds,strokes} from '../domain/drawing/strokes';
import {linkedNodeIds} from '../domain/drawing/endpointLinks';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
const a:Endpoint={curveId:'a',end:1},b:Endpoint={curveId:'b',end:0};
function base(crossLayer=false){let d=c.addLayer(emptyDrawing(),'A');d=c.createCurve(d,d.layers[0].id,[[-1,0],[-.7,.2],[-.3,.2],[0,0]],.01,'A','a');if(crossLayer)d=c.addLayer(d,'B');return c.createCurve(d,d.layers[0].id,[[.3,.3],[.5,.6],[.8,.6],[1,.3]],.025,'B','b');}
const pos=(d:Doc,e:Endpoint)=>nodeAt(d,e).position;
const relative=(d:Doc,e:Endpoint)=>sub(curveById(d,e.curveId).handles[e.end],pos(d,e));
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
test('link connects positions across layers without merging any node, stroke, style or layer',()=>{
 const d=addDisplayInterval(p.setInk(base(true),['b'],{profile:'EYELID'}),'b'),n=c.linkEndpoints(d,a,b);
 expect(pos(n,b)).toEqual(pos(n,a));expect(n.layers).toEqual(d.layers);expect(n.curves.map(c=>c.nodes)).toEqual(d.curves.map(c=>c.nodes));expect(n.joins).toEqual(d.joins);expect(n.curves.map(c=>[c.width,c.profile,c.name])).toEqual(d.curves.map(c=>[c.width,c.profile,c.name]));expect(n.displayIntervals).toEqual(d.displayIntervals);
 expect(strokeIds(strokeFor(n,'a'))).toEqual(['a']);expect(strokeIds(strokeFor(n,'b'))).toEqual(['b']);expect(relative(n,b)).toEqual(relative(d,b).map(x=>expect.closeTo(x,12)));expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));expect(shapeOf(n,'b')[3]).toEqual(shapeOf(d,'b')[3]);expect(n.nodes).toHaveLength(d.nodes.length);valid(n);
});
test('dragging either linked endpoint follows from both sides, translating handles without aligning them',()=>{
 let n=c.linkEndpoints(base(),a,b);const before=n;
 for(const e of [a,b]){const target:[number,number]=e===a?[.1,-.2]:[.2,.2];n=c.moveNode(n,nodeAt(n,e).id,target);expect(pos(n,a)).toEqual(target);expect(pos(n,b)).toEqual(target);for(const end of [a,b])expect(relative(n,end)).toEqual(relative(before,end).map(x=>expect.closeTo(x,12)));valid(n);}
 const handles=c.moveHandle(n,b,[.8,.2]);expect(curveById(handles,'a').handles).toEqual(curveById(n,'a').handles);expect(pos(handles,a)).toEqual(pos(handles,b));
});
test('link a node of an existing closed/continuous stroke without absorbing another stroke',()=>{
 let d=base(true);const e=c.ellipse(d,d.layers[1].id,[-.5,-.5],[.5,.5],.01);d=e.document;const target={curveId:e.ids[0],end:1 as const},ids=strokeIds(strokeFor(d,target.curveId));d=c.linkEndpoints(d,target,b);
 expect(strokeIds(strokeFor(d,target.curveId))).toEqual(ids);expect(strokeIds(strokeFor(d,'b'))).toEqual(['b']);const n=c.moveNode(d,nodeAt(d,b).id,[.15,.7]);expect(pos(n,b)).toEqual(pos(n,target));expect(strokeFor(n,target.curveId).closed).toBe(true);valid(n);
});
test('linked endpoint networks are bidirectional and repeated linking is a no-op',()=>{
 let d=c.linkEndpoints(base(),a,b);d=c.createCurve(d,d.layers[0].id,[[.3,-.3],[.5,-.6],[.8,-.6],[1,-.3]],.02,'C','c');const end={curveId:'c',end:0 as const};d=c.linkEndpoints(d,b,end);expect(c.linkEndpoints(d,end,a)).toBe(d);expect(linkedNodeIds(d,nodeAt(d,a).id).size).toBe(3);
 const n=c.moveNode(d,nodeAt(d,end).id,[0,-.4]);for(const e of [a,b,end])expect(pos(n,e)).toEqual([0,-.4]);expect(strokes(n,n.layers[0].id)).toHaveLength(3);valid(n);
});
test('whole-curve transforms only move linked partners at affected endpoints; moving layers stays independent',()=>{
 const d=c.linkEndpoints(base(true),a,b),n=c.transform(d,['a'],([x,y])=>[x+.2,y+.1]);expect(pos(n,b)).toEqual(pos(n,a));expect(shapeOf(n,'b')[3]).toEqual(shapeOf(d,'b')[3]);expect(relative(n,b)).toEqual(relative(d,b).map(x=>expect.closeTo(x,12)));expect(n.layers).toEqual(d.layers);
 const scaled=c.transform(n,['a'],([x,y])=>[x*1.3,y*.6]);expect(pos(scaled,a)).toEqual(pos(scaled,b));expect(relative(scaled,b)[0]).toBeCloseTo(relative(d,b)[0]);valid(scaled);
 const l=c.addLayer(scaled,'Target'),moved=c.moveToLayer(l,['a'],l.layers[0].id);expect(moved.layers[0].items).toEqual(['a']);expect(moved.endpointLinks).toEqual(d.endpointLinks);valid(moved);
});
test('mirror edit follows an explicitly linked endpoint without treating its curve as merged topology',()=>{
 let d=c.linkEndpoints(base(true),a,b);d=c.createCurve(d,d.layers[0].id,[[-.8,.4],[-.5,.7],[-.2,.8],[.1,.5]],.012,'Mirror source','source');const before=structuredClone(d),n=c.mirrorEdit(d,'source','b');
 expect(shapeOf(n,'b')).toEqual(shapeOf(d,'source').map(([x,y])=>[0-x,y]));expect(pos(n,a)).toEqual(pos(n,b));expect(relative(n,a)).toEqual(relative(d,a).map(x=>expect.closeTo(x,12)));expect(shapeOf(n,'a')[0]).toEqual(shapeOf(d,'a')[0]);expect(shapeOf(n,'source')).toEqual(shapeOf(d,'source'));expect(n.layers).toEqual(d.layers);expect(strokeIds(strokeFor(n,'b'))).toEqual(['b']);expect(d).toEqual(before);valid(n);
});
test('explicit Bind or Smooth still merges topology and eliminates redundant link; external links follow the move',()=>{
 for(const mode of ['POSITION','SMOOTH','CUSP','ARC'] as const){let d=c.linkEndpoints(base(),a,b);const n=c.connect(d,a,b,mode);expect(n.endpointLinks).toEqual([]);expect(strokeIds(strokeFor(n,'a')).sort()).toEqual(['a','b']);valid(n);}
 let d=c.linkEndpoints(base(true),a,b);d=c.createCurve(d,d.layers[0].id,[[.7,-.4],[.7,-.2],[.5,-.1],[.2,.1]],.025,'C','c');const target={curveId:'c',end:0 as const};d=c.connect(d,target,b,'POSITION');expect(pos(d,a)).toEqual(pos(d,b));expect(pos(d,a)).toEqual(pos(d,target));valid(d);
});
test('unlink holds positions; split, duplicate and delete preserve valid endpoint references',()=>{
 const d=c.linkEndpoints(base(),a,b),unlinked=c.unlinkEndpoints(d,d.endpointLinks![0].id);expect(unlinked.curves).toEqual(d.curves);expect(unlinked.nodes).toEqual(d.nodes);const moved=c.moveNode(unlinked,nodeAt(unlinked,a).id,[0,-.2]);expect(pos(moved,b)).toEqual(pos(d,b));
 const split=c.splitCurve(d,'a',.6),link=split.document.endpointLinks![0];expect(link.a).toEqual({curveId:split.ids[1],end:1});valid(split.document);
 const both=c.duplicateCurves(d,['a','b']);expect(both.document.endpointLinks).toHaveLength(2);valid(both.document);const one=c.duplicateCurves(d,['a']);expect(one.document.endpointLinks).toHaveLength(1);valid(one.document);
 const deleted=c.deleteCurves(d,['a']);expect(deleted.endpointLinks).toEqual([]);expect(shapeOf(deleted,'b')).toEqual(shapeOf(d,'b'));valid(deleted);
});
test('locked and hidden linked partners prevent partial writes; parser rejects dangling or separated links',()=>{
 const d=c.linkEndpoints(base(true),a,b),locked=c.layerChange(d,d.layers[0].id,{locked:true});expect(()=>c.moveNode(locked,nodeAt(locked,a).id,[.1,.1])).toThrow();expect(()=>c.transform(locked,['a'],([x,y])=>[x+.1,y])).toThrow();expect(()=>c.unlinkEndpoints(locked,d.endpointLinks![0].id)).toThrow();
 const hidden=c.curveChange(d,'b',{visible:false});expect(()=>c.moveNode(hidden,nodeAt(hidden,a).id,[.1,.1])).toThrow();valid(d);
 expect(()=>parseDrawing({...d,endpointLinks:[{...d.endpointLinks![0],b:{curveId:'missing',end:0}}]})).toThrow();expect(()=>parseDrawing({...d,endpointLinks:[{...d.endpointLinks![0],b:{curveId:'b',end:1}}]})).toThrow();expect(()=>parseDrawing({...d,endpointLinks:[...d.endpointLinks!,{...d.endpointLinks![0],id:'duplicate'}]})).toThrow();
});
