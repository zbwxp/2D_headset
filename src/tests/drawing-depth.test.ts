import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,curveById,parseDrawing,boundEndpoint,type Cubic,type Point2,type DrawingDocument as Doc} from '../domain/drawing/model';
import {strokeFor,strokePaths} from '../domain/drawing/strokes';
import {depthContext,depthPaintBatches,setDepthOffset,reorderCurveMember,memberInk} from '../domain/drawing/depth';
import {strokeInk,strokeEnds,fillGeometry,inkEndpointInfo} from '../domain/drawing/appearance';
import {partitionedUses,derivedUses} from '../domain/drawing/roundedJoin';
import {drawingListRows} from '../ui/drawing/listSelection';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function fixture(){
 let d=c.addLayer(emptyDrawing(),'Neck'),l=d.layers[0].id;
 d=c.createCurve(d,l,line([-1,.5],[1,.5]),.04,'Shoulder','back');d=c.createCurve(d,l,[[1,.5],[1,-1],[-1,-1],[-1,.5]],.04,'Back','back2');d=c.connect(d,{curveId:'back',end:1},{curveId:'back2',end:0},'POSITION');d=c.connect(d,{curveId:'back',end:0},{curveId:'back2',end:1},'POSITION');d=p.createFill(d,['back','back2'],'white');
 d=c.createCurve(d,l,line([-1,0],[1,0]),.04,'Collar','front');d=c.createCurve(d,l,line([1,0],[1,1]),.04,'Collar side','side');d=c.connect(d,{curveId:'front',end:1},{curveId:'side',end:0},'POSITION');return d;
}
const order=(d:Doc)=>depthPaintBatches(d).map(b=>b.owner??b.item.id);
test('offset crosses one whole sibling including its fill, retaining topology, ownership and array order',()=>{
 const d=fixture(),n=setDepthOffset(d,'front',-1),f=d.fills[0].id;
 expect(depthContext(n,'front').target.ids).toEqual(expect.arrayContaining(['back','back2',f]));
 expect(order(n).indexOf('front')).toBeGreaterThan(order(n).indexOf(f));expect(order(n)[0]).toBe('side');
 expect(n.layers).toBe(d.layers);expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(n.fills).toBe(d.fills);expect(fillGeometry(n,n.fills[0])).toEqual(fillGeometry(d,d.fills[0]));
 expect(parseDrawing(JSON.parse(JSON.stringify(n)))).toEqual(JSON.parse(JSON.stringify(n)));
 expect(()=>parseDrawing({...n,curves:n.curves.map(x=>x.id==='front'?{...x,depthOffset:.5}:x)})).toThrow();
});
test('relative sibling depth clamps, counts hidden siblings, and has independent layer reference',()=>{
 let d=fixture();const n=setDepthOffset(d,'front',-99);expect(depthContext(n,'front').effective).toBe(-1);
 d=c.curveChange(d,'back',{visible:false});expect(depthContext(setDepthOffset(d,'front',-1),'front').effective).toBe(-1);
 d=c.addLayer(d,'Above');d=c.createCurve(d,d.layers[0].id,line([0,0],[1,1]),.04,'Other','other');
 const cross=setDepthOffset(d,'front',1,'LAYER');expect(order(cross)[0]).toBe('front');expect(depthContext(cross,'front').target.name).toBe('Above');
 const parent=setDepthOffset(d,'front',99);expect(depthContext(parent,'front').effective).toBe(0);expect(depthContext(parent,'front').scope).toBe('PARENT');
 const moved=c.reorderLayers(cross,d.layers[1].id,d.layers[0].id);expect(depthContext(moved,'front').effective).toBe(0);
});
test('member drag changes only sibling list/ink order, Shift range sees the same order',()=>{
 const d=fixture(),n=reorderCurveMember(d,'side','front');expect(n.layers[0].items.slice(0,2)).toEqual(['side','front']);expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(n.fills).toBe(d.fills);
 expect(order(n).slice(0,2)).toEqual(['side','front']);expect(drawingListRows(n,[]).filter(r=>r.kind==='curve').slice(0,2).map(r=>r.ids[0])).toEqual(['side','front']);
 expect(reorderCurveMember(d,'front','back')).toBe(d);
});
const area=(ps:Point2[])=>Math.abs(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
for(const mode of ['POSITION','SMOOTH','CUSP','ARC'] as const)test(`partitioned ${mode} ink preserves continuous width, visible area and join geometry`,()=>{
 let d=fixture();d=c.connect(d,{curveId:'front',end:1},{curveId:'side',end:0},mode,.2);
 const s=strokeFor(d,'front'),g=partitionedUses(d,s.segments,s.closed),old=derivedUses(d,s.segments,s.closed),runs=strokeInk(d,s,undefined,true),parts=memberInk(d,s,new Map([['front',1],['side',0]]));
 expect(parts.get('front')!.length).toBeGreaterThan(0);expect(parts.get('side')!.length).toBeGreaterThan(0);
 expect(runs.reduce((v,r)=>v+area(r.outline),0)).toBeCloseTo([...parts.values()].flat().reduce((v,r)=>v+area(r.outline),0),6);
 expect(g.shapes[0][0]).toEqual(old.shapes[0][0]);expect(g.shapes.at(-1)![3]).toEqual(old.shapes.at(-1)![3]);
 if(mode==='ARC'){expect(new Set(g.pieces.filter(x=>x.joinId).map(x=>x.inkOwner))).toEqual(new Set(['front','side']));}
});
test('per-curve extension remains owned by that curve after partition',()=>{
 let d=fixture();d=p.enableInteriorInkEnd(d,'front',1,true);d=p.setInkEnd(d,'front',1,{taper:.1,extension:.1});
 const n=memberInk(d,strokeFor(d,'front'),new Map([['front',1],['side',0]]));expect(n.get('front')!.flatMap(r=>r.extensions??[])).toHaveLength(1);expect(n.get('side')!.flatMap(r=>r.extensions??[])).toHaveLength(0);
});
function branch(){let d=c.addLayer(emptyDrawing(),'Branches');for(const [id,b] of [['a',[1,0]],['b',[0,1]],['c',[-1,0]]] as [string,Point2][])d=c.createPenCurve(d,d.layers[0].id,line([0,0],b),.02,id);d=c.connect(d,{curveId:'a',end:0},{curveId:'b',end:0},'POSITION');return c.connect(d,{curveId:'a',end:0},{curveId:'c',end:0},'POSITION');}
test('new branch bind clears ALL joined endpoint defaults but not remote tips; legacy branch defaults cannot taper the junction',()=>{
 const d=branch();for(const id of ['a','b','c']){expect(curveById(d,id).inkEnds![0]).toEqual({taper:0,extension:0});expect(curveById(d,id).inkEnds![1]).toEqual({taperWidthScale:20});expect(boundEndpoint(d,{curveId:id,end:0})).toBe(true);}
 const legacy:Doc={...d,curves:d.curves.map(c=>({...c,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]}))};
 for(const path of strokePaths(strokeFor(legacy,'a')))for(const e of strokeEnds(legacy,path))if(e.endpoint.end===0)expect(e.style).toEqual({taper:0,extension:0});
 expect(strokeInk(legacy,strokeFor(legacy,'a'))).toEqual(strokeInk(d,strokeFor(d,'a')));
 const styled=p.setInkEnd(p.enableInteriorInkEnd(d,'a',0,true),'a',0,{taper:.1,extension:.1});expect(inkEndpointInfo(styled,'a',0)!.enabled).toBe(true);expect(strokeInk(styled,strokeFor(styled,'a')).flatMap(r=>r.extensions??[])).toHaveLength(1);
});
test('position links suppress default end ink without merging strokes or layers',()=>{
 let d=c.addLayer(emptyDrawing(),'A');d=c.createPenCurve(d,d.layers[0].id,line([0,0],[1,0]),.02,'a');d=c.addLayer(d,'B');d=c.createPenCurve(d,d.layers[0].id,line([0,0],[0,1]),.02,'b');const layers=d.layers;
 const n=c.linkEndpoints(d,{curveId:'a',end:0},{curveId:'b',end:0});expect(n.layers.map(l=>l.items)).toEqual(layers.map(l=>l.items));expect(strokeFor(n,'a').segments).toHaveLength(1);expect(curveById(n,'a').inkEnds![0]).toEqual({taper:0,extension:0});expect(inkEndpointInfo(n,'b',0)!.interior).toBe(true);
});

test('an empty layer remains a depth slot and does not prevent crossing intervening content',()=>{
 let d=fixture(),source=d.layers[0].id;d=c.addLayer(d,'Middle');d=c.createCurve(d,d.layers[0].id,line([0,0],[1,0]),.04,'Middle','middle');d=c.addLayer(d,'Empty above');
 const n=setDepthOffset(d,'front',2,'LAYER');expect(order(n)[0]).toBe('front');expect(depthContext(n,'front').target.name).toBe('Empty above');expect(n.layers.find(l=>l.id===source)!.items).toEqual(d.layers.find(l=>l.id===source)!.items);
});
test('changing an existing join type preserves explicitly enabled local ink',()=>{
 let d=fixture();d=p.setInkEnd(p.enableInteriorInkEnd(d,'front',1,true),'front',1,{taper:.08,extension:.08});const changed=c.connect(d,{curveId:'front',end:1},{curveId:'side',end:0},'CUSP');expect(curveById(changed,'front').inkEnds).toEqual(curveById(d,'front').inkEnds);
});
