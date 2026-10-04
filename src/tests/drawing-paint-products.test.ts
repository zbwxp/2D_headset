import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {forEachPaintProductCase} from './fixtures/paint-product-parity';
import {paintMarkup,publicPaintDrawing,styledPaintDrawing} from './fixtures/paint-read-scope';
import expected from './fixtures/paint-products-baseline.json';
import {paintProductStats,createPaintProductReader} from '../ui/drawing/paintProducts';
import {prepareDrawingControlEditPlan,applyDrawingControlEditPlan,drawingControlEditProof} from '../domain/drawing/controlEditPlan';
import {withDrawingReadScope} from '../domain/drawing/readContext';
import {displayInkSampling} from '../domain/drawing/appearance';
import {strokes,strokePaths} from '../domain/drawing/strokes';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {scaleEvaluatedDisplayRouteBrush} from '../domain/drawing/displayRouteBrush';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const delta=(before:ReturnType<typeof paintProductStats>)=>Object.fromEntries(Object.entries(paintProductStats()).map(([key,value])=>[key,value-before[key as keyof typeof before]]));

test('all 74 renderer cases match the independent previous canonical kernel, with fresh and reused products',()=>{
 let count=0;
 forEachPaintProductCase((name,d,options)=>{
  const before=JSON.stringify(d),reference=expected[name as keyof typeof expected],svg=paintMarkup(d,options);
  expect(hash(svg),name).toBe(reference.hash);expect(svg.length,name).toBe(reference.length);expect((svg.match(/<path/g)??[]).length,name).toBe(reference.paths);
  expect(paintMarkup(d,options),name).toBe(svg);expect(JSON.stringify(d),name).toBe(before);count++;
 });expect(count).toBe(74);
},30000);

test('fixed public geometry builds no products; one proved handle edit rebuilds only its affected product',()=>{
 const d=publicPaintDrawing(),curve=d.curves.find(c=>c.name==='鼻尖短线')!,plan=prepareDrawingControlEditPlan(d,{kind:'handle',endpoint:{curveId:curve.id,end:0}});
 expect(plan.controls).toHaveLength(1);const first=paintMarkup(d),before=paintProductStats();expect(paintMarkup(d)).toBe(first);
 const fixed=delta(before);expect(fixed.productBuilds).toBe(0);expect(fixed.cacheHits).toBeGreaterThan(20);expect(fixed.routeResolutions).toBe(1);
 const next=applyDrawingControlEditPlan(plan,{kind:'point',position:[curve.handles[0][0]+.011,curve.handles[0][1]+.003]});expect(drawingControlEditProof(d,next,plan)).toBe(plan);expect(next.curves.filter((c,i)=>c!==d.curves[i])).toHaveLength(1);
 const start=paintProductStats(),edited=paintMarkup(next),work=delta(start);expect(edited).not.toBe(first);expect(work.productBuilds).toBe(1);expect(work.cacheHits).toBe(fixed.cacheHits-1);expect(work.fallbackBuilds).toBe(0);
 expect(paintMarkup(d)).toBe(first);
});

test('cached pieces, offset curves, mist and extension points are detached from mutable authoring values',()=>{
 const d=styledPaintDrawing(),before=paintMarkup(d,{showFills:true}),initial=JSON.stringify(d),stats=paintProductStats();
 expect(paintMarkup(d,{showFills:true})).toBe(before);expect(delta(stats).offsetBuilds).toBe(0);expect(delta(stats).fillBuilds).toBe(0);
 d.nodes[1].position[0]-=.12;d.curves[6].handles[0][0]+=.025;d.curves[6].mist!.density=.2;d.curves[6].inkEnds![0].extension=.13;d.joins[0].radius=.09;
 const changed=paintMarkup(d,{showFills:true});expect(changed).not.toBe(before);expect(changed).toBe(paintMarkup({...d},{showFills:true}));
 const restored=JSON.parse(initial) as DrawingDocument;expect(paintMarkup(restored,{showFills:true})).toBe(before);
});

test('equal brush JSON cannot hide the opaque permission of an evaluated oversized ARC',()=>{
 const d=styledPaintDrawing();d.endpointLinks![0].joinBrush=scaleEvaluatedDisplayRouteBrush({kind:'ARC',trimDistance:.04},60);
 const json=JSON.stringify(d),start=paintProductStats(),evaluated=paintMarkup(d);expect(delta(start).cacheHits).toBe(0);expect(delta(start).fallbackBuilds).toBeGreaterThan(0);
 d.endpointLinks![0].joinBrush={...d.endpointLinks![0].joinBrush};expect(JSON.stringify(d)).toBe(json);const raw=paintMarkup(d);expect(raw).not.toBe(evaluated);expect(raw).toBe(paintMarkup({...d}));
});

function borrowedRoute():DrawingDocument {
 const points:Point2[]=[[-1,0],[0,0],[1,0],[.6,.8]],curve=(id:string,a:number,b:number)=>({id,name:id,nodes:[`n${a}`,`n${b}`] as [string,string],handles:[[points[a][0]+(points[b][0]-points[a][0])/3,points[a][1]+(points[b][1]-points[a][1])/3],[points[a][0]+2*(points[b][0]-points[a][0])/3,points[a][1]+2*(points[b][1]-points[a][1])/3]] as [Point2,Point2],width:.012,visible:true,locked:false});
 return {...emptyDrawing(),nodes:points.map((position,i)=>({id:`n${i}`,position})),curves:[curve('A',0,1),curve('B',1,2),curve('C',1,3)],layers:[{id:'L',name:'Branch',visible:true,locked:false,items:['A','B','C']}],joins:[{id:'AB',a:{curveId:'A',end:1},b:{curveId:'B',end:0},mode:'CUSP'}],displayIntervals:[{id:'route',anchor:{id:'C',reverse:false},ranges:[],displayRoute:{seed:{segments:[{id:'A',reverse:false},{id:'C',reverse:false}],closed:false},throughLinkIds:[]}},{id:'local-A',anchor:{id:'A',reverse:false},scope:'CURVE',ranges:[{id:'cut',start:.15,end:.72}]}]};
}
test('a local path borrowing an equal-length different route observes the foreign curve through canonical fallback',()=>{
 const d=borrowedRoute(),s={...strokePaths(strokes(d,'L')[0]).find(p=>p.segments.some(u=>u.id==='B'))!,id:'A'},render=()=>withDrawingReadScope(()=>createPaintProductReader(d,displayInkSampling(250)).member(s));
 expect(s.segments.map(use=>use.id)).toEqual(['A','B']);const before=render(),start=paintProductStats();expect(render()).toEqual(before);expect(delta(start).fallbackBuilds).toBe(1);
 d.nodes[3].position[1]+=.4;d.curves[2].handles[1][1]+=.2;
 const next=render();expect(next).not.toEqual(before);expect(next).toEqual(withDrawingReadScope(()=>createPaintProductReader({...d},displayInkSampling(250)).member(s)));
});
