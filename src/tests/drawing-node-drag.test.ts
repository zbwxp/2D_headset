import {test,expect} from 'vitest';
import {dragNode} from '../domain/drawing/nodeDrag';
import * as cmd from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,curveById,sub,length,rotate,type DrawingDocument as Doc,type Point2,type Endpoint} from '../domain/drawing/model';
import {roundedJoins} from '../domain/drawing/roundedJoin';

const a:Endpoint={curveId:'a',end:0},b:Endpoint={curveId:'b',end:0};
function base(){
 let d=cmd.addLayer(emptyDrawing(),'Hair');
 d=cmd.createCurve(d,d.layers[0].id,[[0,0],[.3,.1],[.7,.1],[1,0]],.01,'A','a');
 return cmd.createCurve(d,d.layers[0].id,[[0,0],[-.2,.2],[-.5,.4],[-.8,.4]],.01,'B','b');
}
const vector=(d:Doc,e:Endpoint)=>sub(curveById(d,e.curveId).handles[e.end],nodeAt(d,e).position);
const near=(a:Point2,b:Point2)=>a.forEach((x,i)=>expect(x).toBeCloseTo(b[i],10));
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));

test('zero follows the old translation exactly; fractional follow rotates the near handle without changing its length',()=>{
 const d=base(),before=structuredClone(d),id=nodeAt(d,a).id,p:Point2=[1,-1];
 expect(dragNode(d,id,p,0)).toEqual(cmd.moveNode(d,id,p));
 const next=dragNode(d,id,p,.4);
 near(vector(next,a),rotate(vector(d,a),36));
 expect(length(vector(next,a))).toBeCloseTo(length(vector(d,a)),12);
 expect(shapeOf(next,'a').slice(2)).toEqual(shapeOf(d,'a').slice(2));
 expect(shapeOf(next,'b')).toEqual(shapeOf(d,'b'));expect(d).toEqual(before);valid(next);
 near(vector(dragNode(d,id,p,1),a),rotate(vector(d,a),90));
});

test('each gesture evaluates from its base: intermediate pointer events do not accumulate and returning restores exact geometry',()=>{
 const d=base(),id=nodeAt(d,a).id,p:Point2=[.2,-.4];
 const expected=dragNode(d,id,p,.4);
 for(const position of [[.1,.2],[.7,-.2],[-.3,.8]] as Point2[])dragNode(d,id,position,.4);
 expect(dragNode(d,id,p,.4)).toEqual(expected);
 expect(dragNode(d,id,[0,0],.4)).toBe(d);
});

test.each(['POSITION','CUSP','ARC'] as const)('%s keeps independent branch directions, exact snap position and existing topology',mode=>{
 const original=base(),d=cmd.connect(original,a,b,mode,.08),p:Point2=[.15,-.2],next=dragNode(d,nodeAt(d,a).id,p,.4);
 for(const e of [a,b]){
  near(vector(next,e),vector(dragNode(original,nodeAt(original,e).id,p,.4),e));
  expect(nodeAt(next,e).position).toEqual(p);
 }
 expect(next.joins).toEqual(d.joins);expect(next.layers).toEqual(d.layers);valid(next);
 if(mode==='ARC')expect([...roundedJoins(next).values()].every(x=>x.shapes.flat(2).every(Number.isFinite))).toBe(true);
});

test('smooth handles share one rotation and preserve G1 with unequal lengths, including a third independent branch',()=>{
 let d=cmd.connect(base(),a,b,'SMOOTH');
 d=cmd.createCurve(d,d.layers[0].id,[[0,0],[0,.4],[.1,.6],[.2,1]],.01,'C','c');
 d=cmd.connect(d,a,{curveId:'c',end:0},'POSITION');
 const next=dragNode(d,nodeAt(d,a).id,[.2,-.3],.75),va=vector(next,a),vb=vector(next,b);
 near(va.map(x=>x/length(va)) as Point2,vb.map(x=>-x/length(vb)) as Point2);
 for(const e of [a,b,{curveId:'c',end:0 as const}])expect(length(vector(next,e))).toBeCloseTo(length(vector(d,e)),12);
 expect(va).not.toEqual(vector(d,a));valid(next);
});

test('position-linked nodes move across layers without changing ownership; whole-curve translation does not rotate handles',()=>{
 let d=base();d=cmd.addLayer(d,'Other');d=cmd.createCurve(d,d.layers[0].id,[[0,0],[0,.2],[.3,.6],[.3,.8]],.01,'C','c');
 d=cmd.linkEndpoints(d,a,{curveId:'c',end:0});
 const p:Point2=[.2,.1],next=dragNode(d,nodeAt(d,a).id,p,.4);
 expect(nodeAt(next,{curveId:'c',end:0}).position).toEqual(p);expect(next.layers).toEqual(d.layers);expect(next.endpointLinks).toEqual(d.endpointLinks);valid(next);
 const closed=cmd.connect(base(),a,{curveId:'a',end:1},'POSITION');
 expect(dragNode(closed,nodeAt(closed,a).id,p,1)).toEqual(cmd.moveNode(closed,nodeAt(closed,a).id,p));
});

test('collapsed chords and crossing the opposite endpoint remain finite and continuous on both sides',()=>{
 const d=base(),id=nodeAt(d,a).id;
 for(const p of [[1,0],[1,1e-10],[1,-1e-10],[2,1e-7],[2,-1e-7]] as Point2[]){
  const next=dragNode(d,id,p,1);valid(next);near(vector(next,a),vector(d,a));
 }
 const zero=cmd.createCurve(d,d.layers[0].id,[[0,0],[0,0],[0,0],[0,0]],.01,'Zero','zero');
 valid(dragNode(zero,nodeAt(zero,{curveId:'zero',end:0}).id,[.3,.2],1));
});

test('mirrored drags mirror their result and normal hidden/locked protections remain atomic',()=>{
 const d=cmd.connect(base(),a,b,'SMOOTH'),before=structuredClone(d),p:Point2=[.2,.3],mirror=(p:Point2):Point2=>[-p[0],p[1]];
 const mirrored=cmd.transform(d,['a','b'],mirror),next=dragNode(d,nodeAt(d,a).id,p,.4),other=dragNode(mirrored,nodeAt(mirrored,a).id,mirror(p),.4);
 for(const id of ['a','b'])shapeOf(next,id).forEach((point,i)=>near(mirror(point),shapeOf(other,id)[i]));
 for(const change of [{locked:true},{visible:false}])expect(()=>dragNode(cmd.curveChange(d,'b',change),nodeAt(d,a).id,p,.4)).toThrow(/隐藏或锁定/);
 expect(d).toEqual(before);valid(other);
});
