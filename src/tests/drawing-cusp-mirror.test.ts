import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,curveById,sub,length,add,type DrawingDocument as Doc,type Endpoint} from '../domain/drawing/model';
const a:Endpoint={curveId:'a',end:1},b:Endpoint={curveId:'b',end:0};
function base(){let d=c.addLayer(emptyDrawing());d=c.createCurve(d,d.layers[0].id,[[-1,0],[-.8,.2],[-.3,.1],[0,0]],.008,'Source','a');return c.createCurve(d,d.layers[0].id,[[.2,0],[.5,.3],[.8,.4],[1,0]],.008,'Target','b');}
const vector=(d:Doc,e:Endpoint)=>sub(curveById(d,e.curveId).handles[e.end],nodeAt(d,e).position);
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
for(const ae of [0,1] as const)for(const be of [0,1] as const)test(`cusp ${ae}/${be}: bind position without constraining handles`,()=>{
 const source=base(),aa={curveId:'a',end:ae},bb={curveId:'b',end:be},d=c.connect(source,aa,bb,'CUSP'),original=structuredClone(d);
 expect(vector(d,aa)).toEqual(vector(source,aa));expect(length(sub(vector(d,bb),vector(source,bb)))).toBeLessThan(1e-10);
 for(const [moving,fixed] of [[aa,bb],[bb,aa]]){const n=c.moveHandle(d,moving,add(nodeAt(d,moving).position,[.2,.6]));expect(shapeOf(n,fixed.curveId)).toEqual(shapeOf(d,fixed.curveId));valid(n);}
 const zero=c.moveHandle(d,aa,nodeAt(d,aa).position);valid(zero);expect(d).toEqual(original);
});
test('cusp transform, reflection, split and duplication preserve authored geometry without angle realignment',()=>{
 const d=c.connect(base(),a,b,'CUSP'),reverse=c.connect(d,b,a,'CUSP');expect(reverse.curves).toEqual(d.curves);valid(reverse);
 const map=([x,y]:[number,number]):[number,number]=>[-x*2,y*.5],n=c.transform(d,['a','b'],map);for(const id of ['a','b'])expect(shapeOf(n,id)).toEqual(shapeOf(d,id).map(map));valid(n);
 const dupe=c.duplicateCurves(d,['a','b']);expect(dupe.document.joins.map(j=>j.mode)).toEqual(['CUSP','CUSP']);valid(dupe.document);valid(c.splitCurve(d,'a',.5).document);
});
test('legacy angle is removed without changing source geometry; invalid legacy fields reject',()=>{
 const d=c.connect(base(),a,b,'CUSP'),legacy={...d,joins:d.joins.map(j=>({...j,angle:30}))},loaded=parseDrawing(legacy);expect(loaded.curves).toEqual(d.curves);expect(loaded.joins).toEqual(d.joins);expect(legacy.joins[0].angle).toBe(30);
 for(const bad of [-91,91,NaN])expect(()=>parseDrawing({...d,joins:d.joins.map(j=>({...j,angle:bad}))})).toThrow();
 const locked=c.curveChange(d,'b',{locked:true});expect(()=>c.moveHandle(locked,b,[.2,.3])).toThrow(/锁定/);expect(()=>c.moveHandle(locked,a,[.2,.3])).not.toThrow();
});
function mirrorBase(){
 let d=base();d=c.createCurve(d,d.layers[0].id,[[.2,0],[.2,-.2],[.3,-.6],[.5,-.8]],.008,'Neighbour','n');
 return c.connect(d,b,{curveId:'n',end:0},'POSITION');
}
test('mirror only warns about actual changes; shared stationary endpoint and locked stationary neighbor are allowed',()=>{
 let d=mirrorBase();d=c.moveNode(d,nodeAt(d,{curveId:'a',end:0}).id,[-.2,0]);
 d=c.curveChange(d,'n',{locked:true});const before=structuredClone(d),n=c.mirrorEdit(d,'a','b');
 expect(shapeOf(n,'n')).toEqual(shapeOf(d,'n'));expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));
 expect(shapeOf(n,'b')).toEqual(shapeOf(d,'a').map(([x,y])=>[0-x,y]));expect(d).toEqual(before);valid(n);
 expect(c.moveNode(d,nodeAt(d,b).id,nodeAt(d,b).position)).toBe(d);
});
test('mirror confirms only actually affected curves, stays atomic and respects locked changes',()=>{
 const d=mirrorBase(),before=structuredClone(d);
 try{c.mirrorEdit(d,'a','b');throw Error('missing warning');}catch(e){expect(e).toBeInstanceOf(c.RelatedSelection);expect((e as c.RelatedSelection).ids).toEqual(['b','n']);}
 expect(d).toEqual(before);const n=c.mirrorEdit(d,'a','b',true),delta=sub(nodeAt(n,b).position,nodeAt(d,b).position);
 expect(shapeOf(n,'b')).toEqual(shapeOf(d,'a').map(([x,y])=>[0-x,y]));expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));
 expect(curveById(n,'n').handles[0]).toEqual(add(curveById(d,'n').handles[0],delta));expect(shapeOf(n,'n')[3]).toEqual(shapeOf(d,'n')[3]);valid(n);
 expect(()=>c.mirrorEdit(c.curveChange(d,'n',{locked:true}),'a','b',true)).toThrow(/锁定/);
});
