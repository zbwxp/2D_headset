import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,curveById,nodeAt,add,sub,length,type Cubic,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {arcField,fillGeometry,offsetGeometry,inkRuns,profileAt,strokeInk,point} from '../domain/drawing/appearance';
import {strokeFor,paintItems,strokeIds,orientedShape} from '../domain/drawing/strokes';
const line=(a:Point2,b:Point2):Cubic=>[a,add(a,sub(b,a).map(x=>x/3) as Point2),add(a,sub(b,a).map(x=>x*2/3) as Point2),b];
function base(){let d=c.addLayer(emptyDrawing(),'Ink');return c.createCurve(d,d.layers[0].id,[[0,0],[.3,.5],[.7,.5],[1,0]],.02,'Lid','a');}
function loop(){let d=c.addLayer(emptyDrawing(),'Eye');for(const [i,s] of [line([0,0],[1,0]),line([1,0],[1,1]),line([1,1],[0,1]),line([0,1],[0,0])].entries())d=c.createCurve(d,d.layers[0].id,s,.02,'Boundary '+i,'b'+i);return d;}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
const near=(a:Point2,b:Point2,epsilon=1e-8)=>expect(length(sub(a,b))).toBeLessThan(epsilon);

test('V1 migrates one ordered layer list without changing geometry, V2 rejects malformed paint data',()=>{
 const d=base(),v1={...d,version:1,fills:undefined,offsets:undefined,layers:d.layers.map(({items,...l})=>({...l,curves:items}))};
 expect(parseDrawing(v1)).toEqual(d);valid(d);
 const filled=paint.createFill(loop(),['b2','b0','b3','b1'],'white');valid(filled);
 for(const edit of [{fills:[{...filled.fills[0],color:'red'}]},{layers:[{...filled.layers[0],items:filled.layers[0].items.slice(1)}]},{offsets:[{id:'bad'}]}])expect(()=>parseDrawing({...filled,...edit})).toThrow();
});

test('profile progress uses total arc length, crosses unequal segments and survives an exact split',()=>{
 const shapes=[line([0,0],[.2,0]),line([.2,0],[1,0])],run=inkRuns(shapes,.1,'EYELID')[0];
 const joint=run.outline.find(p=>Math.abs(p[0]-.2)<1e-10)!;expect(Math.abs(joint[1])).toBeCloseTo(.05*profileAt('EYELID',.2),10);
 expect(profileAt('EYELID',.76)).toBeGreaterThan(1.6);expect(profileAt('EYELID',1)).toBe(0);expect(profileAt('TAPER_BOTH',0)).toBe(0);
 let d=paint.setInk(base(),['a'],{profile:'TAPER_END'});const before=strokeFor(d,'a'),first=orientedShape(d,before.segments[0])[0],n=c.splitCurve(d,'a',.24).document,after=strokeFor(n,'a');
 expect(after.segments).toHaveLength(2);near(orientedShape(n,after.segments[0])[0],first);
 const fieldA=arcField(before.segments.map(x=>orientedShape(d,x))),fieldB=arcField(after.segments.map(x=>orientedShape(n,x)));
 for(let i=0;i<=30;i++)near(fieldA.at(i/30).p,fieldB.at(i/30).p,.00015);
 expect(n.curves.every(c=>c.profile==='TAPER_END')).toBe(true);valid(n);
});

test('hiding selected ink retains its geometry and does not restart a whole-stroke profile',()=>{
 const shapes=[line([0,0],[.4,0]),line([.4,0],[1,0])],run=inkRuns(shapes,.1,'TAPER_END',false,[false,true])[0];
 expect(run.shapes).toHaveLength(1);expect(run.outline[0][0]).toBe(.4);expect(run.outline[0][1]).toBeCloseTo(.05*profileAt('TAPER_END',.4),10);
 let d=c.splitCurve(base(),'a',.4).document;d=paint.setInk(d,['a'],{inkVisible:false});expect(strokeInk(d,strokeFor(d,'a'))[0].shapes).toHaveLength(1);expect(d.curves).toHaveLength(2);
});

test('Fill accepts several separate strokes in any selection order, stays independent from ink',()=>{
 const source=loop(),before=structuredClone(source),n=paint.createFill(source,['b2','b0','b3','b1'],'white');expect(source).toEqual(before);expect(n.joins).toHaveLength(0);
 expect(fillGeometry(n,n.fills[0]).error).toBeUndefined();const hidden=paint.setInk(n,['b0','b1'],{inkVisible:false});expect(fillGeometry(hidden,hidden.fills[0])).toEqual(fillGeometry(n,n.fills[0]));
 const invisible=c.curveChange(hidden,'b2',{visible:false});expect(fillGeometry(invisible,invisible.fills[0]).error).toBeUndefined();valid(invisible);
 expect(()=>paint.createFill(n,['b0','b1'],'black')).toThrow(/闭合/);
});

test('Fill reports a geometric break and is removed with a deleted source curve',()=>{
 const d=paint.createFill(loop(),['b0','b1','b2','b3'],'black'),moved=c.moveNode(d,nodeAt(d,{curveId:'b0',end:1}).id,[1.1,0]);
 expect(fillGeometry(moved,moved.fills[0]).error).toMatch(/断开/);expect(fillGeometry(moved,moved.fills[0]).shapes).toHaveLength(0);
 const gone=c.deleteCurves(d,['b0']);expect(gone.fills).toEqual([]);expect(gone.layers.flatMap(layer=>layer.items)).not.toContain(d.fills[0].id);valid(gone);
});

test('splitting geometry remaps forward and reverse Fill/Offset references',()=>{
 let d=paint.createFill(loop(),['b0','b1','b2','b3'],'white');d={...d,fills:[{...d.fills[0],boundary:[...d.fills[0].boundary].reverse().map(x=>({...x,reverse:!x.reverse}))}]};d=paint.createOffset(d,'b0');
 const n=c.splitCurve(d,'b0',.37).document;expect(n.fills[0].boundary).toHaveLength(5);expect(n.offsets[0].source).toHaveLength(2);expect(fillGeometry(n,n.fills[0]).error).toBeUndefined();valid(n);
 const old=offsetGeometry(d,d.offsets[0]),next=offsetGeometry(n,n.offsets[0]);expect(old.error).toBeUndefined();expect(next.error).toBeUndefined();for(let i=0;i<=25;i++)near(arcField(old.shapes).at(i/25).p,arcField(next.shapes).at(i/25).p,.0003);
});

test('offset has signed normal distance, exact converged ends, follows source edits without baking',()=>{
 let d=base();d={...d,curves:d.curves.map(c=>({...c,handles:[[1/3,0],[2/3,0]]}))};d=paint.createOffset(d,'a');let o={...d.offsets[0],source:[{id:'a',reverse:false}],start:.2,end:.8,distance:.1,taper:.2};d={...d,offsets:[o]};
 const g=offsetGeometry(d,o);expect(g.error).toBeUndefined();near(g.shapes[0][0],[.2,0]);near(g.shapes.at(-1)![3],[.8,0]);near(arcField(g.shapes).at(.5).p,[.5,.1],.0002);
 const negative=paint.changePaint(d,o.id,{distance:-.1});near(arcField(offsetGeometry(negative,negative.offsets[0]).shapes).at(.5).p,[.5,-.1],.0002);
 const translated=c.transform(d,['a'],p=>add(p,[0,.4]));expect(translated.offsets).toEqual(d.offsets);near(offsetGeometry(translated,translated.offsets[0]).shapes[0][0],[.2,.4]);expect(offsetGeometry(d,o)).toBe(g);
});

test('curved offset approximation respects distance on a curved source',()=>{
 let d=paint.createOffset(base(),'a');d=paint.changePaint(d,d.offsets[0].id,{start:0,end:1,taper:0,distance:.03});const o=d.offsets[0],g=offsetGeometry(d,o),source=arcField(o.source.map(x=>orientedShape(d,x)));
 expect(g.error).toBeUndefined();expect(g.shapes.length).toBeLessThan(100);
 // Compare independently sampled true normal offsets to the fitted follower polyline.
 const pts=g.shapes.flatMap(s=>Array.from({length:101},(_,i)=>point(s,i/100)));
 for(let i=0;i<=80;i++){const q=source.at(i/80),expected=add(q.p,[-q.tangent[1]*o.distance,q.tangent[0]*o.distance]);expect(Math.min(...pts.map(p=>length(sub(p,expected))))).toBeLessThan(.0015);}
});

test('detach preserves the visible cubics and asymmetric profile, creates independent geometry',()=>{
 let d=paint.createOffset(base(),'a');d=paint.changePaint(d,d.offsets[0].id,{profile:'EYELID'});const g=offsetGeometry(d,d.offsets[0]),result=paint.detachOffset(d,d.offsets[0].id),n=result.document;
 expect(n.offsets).toHaveLength(0);expect(result.ids.length).toBe(g.shapes.length);g.shapes.forEach((s,i)=>shapeOf(n,result.ids[i]).forEach((p,j)=>near(p,s[j])));valid(n);
 const stroke=strokeFor(n,result.ids[0]),reversed=stroke.segments[0].id!==result.ids[0]||stroke.segments[0].reverse;expect(!!curveById(n,result.ids[0]).profileReverse).toBe(reversed);
 const moved=c.transform(n,['a'],p=>add(p,[1,1]));result.ids.forEach(id=>expect(shapeOf(moved,id)).toEqual(shapeOf(n,id)));
});

test('offset reports sharp joins and is removed with a deleted source',()=>{
 let d=base();d=c.createCurve(d,d.layers[0].id,[[1,0],[1.1,0],[1.2,.3],[2,0]],.02,'Next','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'CUSP');d=paint.createOffset(d,'a');d=paint.changePaint(d,d.offsets[0].id,{start:0,end:1});
 expect(offsetGeometry(d,d.offsets[0]).error).toMatch(/尖点/);const missing=c.deleteCurves(d,['a']);expect(missing.offsets).toEqual([]);expect(missing.layers.flatMap(layer=>layer.items)).not.toContain(d.offsets[0].id);valid(missing);
});

test('Fill, Stroke, Offset share one z order; source and dependent may live on different layers',()=>{
 let d=paint.createFill(loop(),['b0','b1','b2','b3'],'white');d=paint.createOffset(d,'b0');const f=d.fills[0].id,o=d.offsets[0].id,l=d.layers[0].id;
 expect(paintItems(d,l).map(x=>x.kind)).toEqual(['offset','stroke','stroke','stroke','stroke','fill']);
 d=paint.reorderPaint(d,f,o);expect(d.layers[0].items[0]).toBe(f);d=c.addLayer(d,'Hair');d=paint.movePaint(d,f,d.layers[0].id);expect(fillGeometry(d,d.fills[0]).error).toBeUndefined();valid(d);
 const gone=c.deleteLayer(d,l);expect(gone.fills).toHaveLength(0);expect(gone.offsets).toHaveLength(0);expect(gone.layers).toHaveLength(1);expect(gone.layers[0].items).toEqual([]);valid(gone);
});

test('duplicate layer remaps all internal source references and retains ordering',()=>{
 let d=paint.createFill(loop(),['b0','b1','b2','b3'],'black');d=paint.createOffset(d,'b0');const n=c.duplicateLayer(d,d.layers[0].id);expect(n.fills).toHaveLength(2);expect(n.offsets).toHaveLength(2);valid(n);
 const ids=new Set(n.layers[0].items);expect(n.fills[1].boundary.every(x=>ids.has(x.id))).toBe(true);expect(n.offsets[1].source.every(x=>ids.has(x.id))).toBe(true);expect(paintItems(n,n.layers[0].id).map(x=>x.kind)).toEqual(paintItems(d,d.layers[0].id).map(x=>x.kind));
});

test('duplicate open chain preserves profile direction despite new random node IDs',()=>{
 let d=c.splitCurve(base(),'a',.4).document;d=paint.setInk(d,d.curves.map(c=>c.id),{profile:'EYELID'});const s=strokeFor(d,'a'),shape=orientedShape(d,s.segments[0]),before=profileAt('EYELID',0,!!curveById(d,'a').profileReverse);
 for(let k=0;k<10;k++){const n=c.duplicateCurves(d,strokeIds(s),d.layers[0].id,[0,0]),ss=strokeFor(n.document,n.ids[0]),start=orientedShape(n.document,ss.segments[0])[0],reverse=length(sub(start,shape[0]))>1e-7;expect(profileAt('EYELID',reverse?1:0,!!curveById(n.document,ss.segments[0].id).profileReverse)).toBe(before);}
});

test('locked objects reject style, reorder and detach mutations',()=>{
 let d=paint.createOffset(base(),'a');const oid=d.offsets[0].id;d=paint.changePaint(d,oid,{locked:true});expect(()=>paint.detachOffset(d,oid)).toThrow(/锁定/);expect(()=>paint.reorderPaint(d,oid,'a',true)).toThrow(/锁定/);
 d=c.curveChange(d,'a',{locked:true});expect(()=>paint.setInk(d,['a'],{profile:'EYELID'})).toThrow(/锁定/);valid(d);
});
