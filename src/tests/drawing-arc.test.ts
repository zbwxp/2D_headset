import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,curveById,sub,add,mul,length,type Cubic,type Point2,type DrawingDocument as Doc} from '../domain/drawing/model';
import {roundedJoins,derivedUses} from '../domain/drawing/roundedJoin';
import {arcField,point} from '../domain/drawing/sampling';
import {strokeFor,strokeIds,orientedShape} from '../domain/drawing/strokes';
import {fillGeometry,offsetGeometry,strokeInk} from '../domain/drawing/appearance';
const line=(a:Point2,b:Point2):Cubic=>[a,add(a,mul(sub(b,a),1/3)),add(a,mul(sub(b,a),2/3)),b];
const near=(a:Point2,b:Point2,tol=1e-8)=>expect(length(sub(a,b))).toBeLessThan(tol);
const dir=(p:Point2)=>mul(p,1/length(p));
const tangent=(s:Cubic,end:0|1)=>dir(end?sub(s[3],s[2]):sub(s[1],s[0]));
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
function base(aEnd:0|1=1,bEnd:0|1=0){let d=c.addLayer(emptyDrawing(),'Ink');const a=line([-1,0],[0,0]),b=line([0,0],[0,1]);d=c.createCurve(d,d.layers[0].id,(aEnd?a:[...a].reverse()) as Cubic,.008,'A','a');return c.createCurve(d,d.layers[0].id,(bEnd?[...b].reverse():b) as Cubic,.008,'B','b');}
function rounded(radius=.2){return c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'ARC',radius);}
for(const ae of [0,1] as const)for(const be of [0,1] as const)test(`ARC endpoint ${ae}/${be}: preserves raw handles, circular fillet, G1 and reversed traversal`,()=>{
 const source=base(ae,be),d=c.connect(source,{curveId:'a',end:ae},{curveId:'b',end:be},'ARC',.2),g=roundedJoins(d).get(d.joins[0].id)!;
 expect(g.error).toBeUndefined();expect(shapeOf(d,'a')).toEqual(shapeOf(source,'a'));expect(shapeOf(d,'b')).toEqual(shapeOf(source,'b'));expect(nodeAt(d,{curveId:'a',end:ae}).id).toBe(nodeAt(d,{curveId:'b',end:be}).id);valid(d);
 near(g.shapes[0][0],[-.2,0]);near(g.shapes.at(-1)![3],[0,.2]);near(tangent(g.shapes[0],0),[1,0]);near(tangent(g.shapes.at(-1)!,1),[0,1]);
 for(const s of g.shapes)for(let i=0;i<=30;i++)expect(Math.abs(length(sub(point(s,i/30),[-.2,.2]))-.2)).toBeLessThan(.00006);
 const uses=[{id:'a',reverse:!ae},{id:'b',reverse:!!be}],forward=derivedUses(d,uses),back=derivedUses(d,[...uses].reverse().map(x=>({...x,reverse:!x.reverse})));
 const check=(shapes:Cubic[])=>{for(let i=1;i<shapes.length;i++){near(shapes[i-1][3],shapes[i][0]);near(tangent(shapes[i-1],1),tangent(shapes[i],0));}};check(forward.shapes);check(back.shapes);
 near(arcField(forward.shapes).at(.25).p,arcField(back.shapes).at(.75).p,.0001);expect(forward.pieces.some(p=>!!p.joinId)).toBe(true);
});

test('curved sources update the tangent-derived bridge; editing ARC handles never rotates the other source',()=>{
 let d=rounded();d=c.moveHandle(d,{curveId:'a',end:1},[-.2,.13]);d=c.moveHandle(d,{curveId:'b',end:0},[.08,.2]);const before=shapeOf(d,'b'),j=d.joins[0],g=roundedJoins(d).get(j.id)!;expect(g.error).toBeUndefined();
 const n=c.moveHandle(d,{curveId:'a',end:1},[-.15,.18]);expect(shapeOf(n,'b')).toEqual(before);expect(roundedJoins(n).get(j.id)!.shapes).not.toEqual(g.shapes);valid(n);
 const pieces=derivedUses(n,[{id:'a',reverse:false},{id:'b',reverse:false}]).shapes;for(let i=1;i<pieces.length;i++)near(tangent(pieces[i-1],1),tangent(pieces[i],0));
 const position=c.removeJoin(n,j.id);expect(shapeOf(position,'a')).toEqual(shapeOf(n,'a'));expect(strokeFor(position,'a').segments).toHaveLength(2);
});

test('radius affects only local derived segments, retains raw data and scales under whole-stroke transforms',()=>{
 const d=rounded(),j=d.joins[0],n=c.setArcRadius(d,j.id,.3);expect(n.curves).toBe(d.curves);expect(n.nodes).toBe(d.nodes);near(roundedJoins(n).get(j.id)!.shapes[0][0],[-.3,0]);
 const moved=c.transform(n,['a','b'],p=>add(p,[2,1]));expect(moved.joins[0].radius).toBeCloseTo(.3);const scaled=c.transform(n,['a','b'],p=>mul(p,2));expect(scaled.joins[0].radius).toBeCloseTo(.6);valid(scaled);
 const g=roundedJoins(n).get(j.id)!,gg=roundedJoins(scaled).get(j.id)!;g.shapes.forEach((s,i)=>s.forEach((p,k)=>near(mul(p,2),gg.shapes[i][k])));
});

test('two ARC ends share available length without overlap; closed Fill follows all transitions',()=>{
 let d=c.addLayer(emptyDrawing());const points:Point2[]=[[0,0],[1,0],[1,1],[0,1]];for(let i=0;i<4;i++)d=c.createCurve(d,d.layers[0].id,line(points[i],points[(i+1)%4]),.008,'Side','c'+i);
 for(let i=0;i<4;i++)d=c.connect(d,{curveId:'c'+i,end:1},{curveId:'c'+((i+1)%4),end:0},'ARC',.8);
 for(const g of roundedJoins(d).values()){expect(g.error).toBeUndefined();expect(g.clamped).toBe(true);expect(g.distance).toBeLessThan(.5);}
 d=paint.createFill(d,['c0','c1','c2','c3'],'white');const fill=fillGeometry(d,d.fills[0]);expect(fill.error).toBeUndefined();expect(fill.shapes.length).toBeGreaterThan(4);near(fill.shapes[0][0],fill.shapes.at(-1)![3]);valid(d);
});

test('Fill and offset resolve rounded geometry; hiding ink preserves the rounded fill boundary',()=>{
 let d=rounded();d=paint.createOffset(d,'a');const g=offsetGeometry(d,d.offsets[0]);expect(g.error).toBeUndefined();
 d=c.createCurve(d,d.layers[0].id,line([0,1],[-1,0]),.008,'Closure','c');d=paint.createFill(d,['a','b','c'],'white');const shapes=fillGeometry(d,d.fills[0]).shapes;expect(shapes.length).toBe(5);d=paint.setInk(d,['a'],{inkVisible:false});expect(fillGeometry(d,d.fills[0]).shapes).toEqual(shapes);valid(d);
});

test('retained-source exact split and layer duplication preserve arc references and appearance',()=>{
 let d=rounded();d=paint.createOffset(d,'a');const j=d.joins[0].id,before=roundedJoins(d).get(j)!;
 const split=c.splitCurve(d,'a',.4).document;expect(split.joins.find(x=>x.id===j)!.a.curveId).not.toBe('a');roundedJoins(split).get(j)!.shapes.forEach((s,i)=>s.forEach((p,k)=>near(p,before.shapes[i][k])));valid(split);
 expect(()=>c.splitCurve(d,'a',.9)).toThrow(/圆弧/);const copy=c.duplicateLayer(d,d.layers[0].id);const copiedJoin=copy.joins.find(x=>x.id!==j)!;expect(copiedJoin.mode).toBe('ARC');expect(copiedJoin.radius).toBe(.2);expect(roundedJoins(copy).get(copiedJoin.id)!.shapes).toEqual(before.shapes);valid(copy);
});

test('degenerate U-turn reports a diagnostic and falls back to position-bound raw geometry',()=>{
 let d=base();d=c.moveNode(d,nodeAt(d,{curveId:'b',end:1}).id,[-1,0]);d=c.moveHandle(d,{curveId:'b',end:0},[-1/3,0]);d=c.moveHandle(d,{curveId:'b',end:1},[-2/3,0]);d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 const g=roundedJoins(d).get(d.joins[0].id)!;expect(g.error).toBeDefined();const evaluated=derivedUses(d,[{id:'a',reverse:false},{id:'b',reverse:false}]);expect(evaluated.shapes).toEqual([shapeOf(d,'a'),shapeOf(d,'b')]);valid(d);
});

test('exact split rejects a cut that would expand another clamped transition',()=>{
 let d=c.addLayer(emptyDrawing());d=c.createCurve(d,d.layers[0].id,line([0,0],[1,0]),.008,'Middle','m');d=c.createCurve(d,d.layers[0].id,line([0,.1],[0,0]),.008,'Short','a');d=c.createCurve(d,d.layers[0].id,line([1,0],[1,1]),.008,'Long','b');
 d=c.connect(d,{curveId:'a',end:1},{curveId:'m',end:0},'ARC',.8);d=c.connect(d,{curveId:'m',end:1},{curveId:'b',end:0},'ARC',.8);const snapshot=JSON.stringify(d);
 expect(()=>c.splitCurve(d,'m',.3)).toThrow(/圆弧范围/);expect(JSON.stringify(d)).toBe(snapshot);
});

test('profile spans source + arc + source without restarting, and bound point movement remains shared',()=>{
 const d=paint.setInk(rounded(),['a'],{profile:'TAPER_BOTH'}),s=strokeFor(d,'a'),ink=strokeInk(d,s);expect(ink).toHaveLength(1);expect(ink[0].shapes).toHaveLength(4);
 const n=c.moveNode(d,nodeAt(d,{curveId:'a',end:1}).id,[.1,.1]);near(nodeAt(n,{curveId:'b',end:0}).position,[.1,.1]);valid(n);
});

test('mirror axis persists, is honored by target edits and never mutates source geometry',()=>{
 const source=base(),d=c.setMirrorAxis(source,.3),n=c.mirrorEdit(d,'a','b');expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));shapeOf(n,'b').forEach((p,i)=>near(p,[.6-shapeOf(d,'a')[i][0],shapeOf(d,'a')[i][1]]));valid(n);
 expect(source.mirrorAxisX).toBeUndefined();expect(c.setMirrorAxis(d,NaN)).toBe(d);expect(()=>parseDrawing({...d,mirrorAxisX:Infinity})).toThrow();
 const bad=rounded();for(const radius of [0,-1,NaN,3])expect(()=>parseDrawing({...bad,joins:bad.joins.map(j=>({...j,radius}))})).toThrow();
});
