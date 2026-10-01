import {describe,test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {fillGeometry} from '../domain/drawing/appearance';
import {strokeFor,type StrokePath} from '../domain/drawing/strokes';
import {depthPaintBatches} from '../domain/drawing/depth';
import {createDisplayRouteField,resolveDisplayRoute,captureRouteCoverage,remapRouteCoverage,projectRouteSpansToPieces,splitDisplayRoute,splitRouteCoverage,mapDisplayRouteReferences,type DisplayRoute} from '../domain/drawing/displayRoutes';
import type {InkSpan} from '../domain/drawing/displayIntervals';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const seed:StrokePath={segments:[{id:'a0',reverse:false},{id:'a1',reverse:false},{id:'a2',reverse:false}],closed:true};
const reverse=(path:StrokePath):StrokePath=>({segments:[...path.segments].reverse().map(u=>({...u,reverse:!u.reverse})),closed:path.closed});
const route=(ids:string[]=[],path=seed):DisplayRoute=>({seed:path,throughLinkIds:ids});
const span=(start:number,end:number):InkSpan=>({start,end,ends:[{taper:.017,extension:.013},{taper:.029,extension:.019}]});
function fixture(arc=false){
 let d=emptyDrawing();
 for(const [name,points] of [['a',[[0,0],[-1,0],[-1,1]]],['b',[[0,0],[1,0],[1,1]]]] as const){
  d=c.addLayer(d,name);const layer=d.layers[0].id;
  for(let i=0;i<3;i++)d=c.createCurve(d,layer,line([...points[i]],[...points[(i+1)%3]]),.01,name+i,name+i);
  for(let i=0;i<3;i++)d=c.connect(d,{curveId:name+i,end:1},{curveId:name+((i+1)%3),end:0},arc&&name==='a'&&i===2?'ARC':'POSITION',.1);
  d=paint.createFill(d,[name+'0',name+'1',name+'2'],'white');
 }
 d=c.linkEndpoints(d,{curveId:'a2',end:1},{curveId:'b0',end:0});
 const id=d.endpointLinks![0].id;
 return {d:{...d,endpointLinks:d.endpointLinks!.map(l=>({...l,throughDisplay:true}))},id};
}
const close=(a:Point2,b:Point2,tol=1e-7)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(tol);
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

describe('explicit cross-layer display traversal',()=>{
 test('without explicit selected links a captured interval path stays local',()=>{
  const {d}=fixture(),out=resolveDisplayRoute(d,route());expect(out.diagnostics).toEqual([]);expect(out.path).toEqual(seed);expect(out.usedLinkIds).toEqual([]);
 });
 test('one selected a/b pair cuts the local continuations and traverses both loops as one open path',()=>{
  const {d,id}=fixture(),out=resolveDisplayRoute(d,route([id]));expect(out.diagnostics).toEqual([]);
  expect(out.path.segments).toEqual(['a0','a1','a2','b0','b1','b2'].map(id=>({id,reverse:false})));expect(out.path.closed).toBe(false);expect(out.usedLinkIds).toEqual([id]);
  // The two free ports have the SAME coordinates, but are not a closing edge.
  close(shapeOf(d,'a0')[0],shapeOf(d,'b2')[3]);
 });
 test('retains source topology, every fill, local stroke ownership, widths and depth slots',()=>{
  const {d,id}=fixture(true),snapshot=JSON.stringify(d),fills=d.fills.map(f=>fillGeometry(d,f)),paints=depthPaintBatches(d),local=strokeFor(d,'a0');
  freeze(d);const out=createDisplayRouteField(d,route([id]));expect(out.diagnostics).toEqual([]);
  expect(JSON.stringify(d)).toBe(snapshot);expect(d.fills.map(f=>fillGeometry(d,f))).toEqual(fills);expect(depthPaintBatches(d)).toEqual(paints);expect(strokeFor(d,'a0')).toEqual(local);
  expect(out.path.segments).toHaveLength(6);expect(local.segments).toHaveLength(3);expect(d.curves.every(q=>q.width===.01)).toBe(true);
 });
 test('chosen seed direction survives independent layer and item reordering',()=>{
  const {d,id}=fixture(),reordered={...d,layers:[...d.layers].reverse().map(l=>({...l,items:[...l.items].reverse()}))};
  const r=route([id],reverse(seed));expect(resolveDisplayRoute(reordered,r)).toEqual(resolveDisplayRoute(d,r));
  expect(resolveDisplayRoute(d,r).path.segments).toEqual(['b2','b1','b0','a2','a1','a0'].map(id=>({id,reverse:true})));
 });
 test('legacy position-only links never become display routing implicitly',()=>{
  const {d,id}=fixture(),legacy={...d,endpointLinks:d.endpointLinks!.map(({id,a,b})=>({id,a,b}))};
  const out=resolveDisplayRoute(legacy,route([id]));expect(out.path).toEqual(seed);expect(out.diagnostics[0].code).toBe('DISABLED_LINK');
 });
 test('missing and conflicting selected ports report errors rather than choose another branch',()=>{
  const {d,id}=fixture();expect(resolveDisplayRoute(d,route(['missing'])).diagnostics[0].code).toBe('MISSING_LINK');
  const n={...d,endpointLinks:[...d.endpointLinks!,{...d.endpointLinks![0],id:'other'}]};
  expect(resolveDisplayRoute(n,route([id,'other'])).diagnostics[0].code).toBe('PORT_CONFLICT');
 });
 test('captured route requires explicit source identity repair after deletion/split, never nearest geometry',()=>{
  const {d,id}=fixture(),deleted={...d,curves:d.curves.filter(q=>q.id!=='a1')};expect(resolveDisplayRoute(deleted,route([id])).diagnostics[0].code).toBe('INVALID_SEED');
  const split=c.splitCurve(d,'a1',.4).document;expect(resolveDisplayRoute(split,route([id])).diagnostics[0].code).toBe('INVALID_SEED');
 });
 test('separated endpoints and a disconnected selected link are diagnosed',()=>{
  const {d,id}=fixture(),q=d.curves.find(c=>c.id==='b0')!,separated={...d,nodes:d.nodes.map(n=>n.id===q.nodes[0]?{...n,position:[.1,.1] as Point2}:n)};
  expect(resolveDisplayRoute(separated,route([id])).diagnostics[0].code).toBe('SEPARATED_LINK');
  const other={...d,endpointLinks:[...d.endpointLinks!,{id:'unused',a:{curveId:'b1',end:1 as const},b:{curveId:'b2',end:0 as const},throughDisplay:true}]};
  expect(resolveDisplayRoute(other,route(['unused'])).diagnostics[0].code).toBe('DISCONNECTED_LINK');
 });
 test('persisted seed/link references round-trip without storing transient geometry',()=>{
  const {d,id}=fixture(),r=route([id]);expect(resolveDisplayRoute(d,JSON.parse(JSON.stringify(r)))).toEqual(resolveDisplayRoute(d,r));expect(Object.keys(r)).toEqual(['seed','throughLinkIds']);
 });
});

describe('material coverage rather than reinterpreted percentages',()=>{
 test('linking after intervals keeps physical cuts; percentages change with total route length',()=>{
  const {d,id}=fixture(),before=createDisplayRouteField(d,route()),after=createDisplayRouteField(d,route([id])),old=span(.1,.8),captured=captureRouteCoverage(before,[old]),mapped=remapRouteCoverage(captured,after);
  expect(mapped.unmapped).toEqual([]);expect(mapped.inkSpans).toHaveLength(1);expect(mapped.inkSpans[0].start).toBeCloseTo(.05,8);expect(mapped.inkSpans[0].end).toBeCloseTo(.4,8);
  close(before.at(old.start).p,after.at(mapped.inkSpans[0].start).p);close(before.at(old.end).p,after.at(mapped.inkSpans[0].end).p);expect(mapped.inkSpans[0].ends).toEqual(old.ends);
 });
 test('a range crossing the old closed seam becomes multiple spans without exposing the added loop',()=>{
  const {d,id}=fixture(),rotated={segments:[seed.segments[1],seed.segments[2],seed.segments[0]],closed:true},before=createDisplayRouteField(d,route([],rotated)),after=createDisplayRouteField(d,route([id],rotated));
  const mapped=remapRouteCoverage(captureRouteCoverage(before,[span(.3,.9)]),after);expect(mapped.unmapped).toEqual([]);expect(mapped.inkSpans).toHaveLength(2);
  expect(mapped.inkSpans.every(s=>s.end<=.5+1e-8)).toBe(true);expect(mapped.inkSpans.reduce((n,s)=>n+s.end-s.start,0)*after.total).toBeCloseTo(before.total*.6,7);
 });
 test('reversing traversal reverses brush roles while preserving curve parameter identity',()=>{
  const {d}=fixture(),before=createDisplayRouteField(d,route()),after=createDisplayRouteField(d,route([],reverse(seed))),old=span(.1,.7),mapped=remapRouteCoverage(captureRouteCoverage(before,[old]),after);
  expect(mapped.unmapped).toEqual([]);expect(mapped.inkSpans).toHaveLength(1);expect(mapped.inkSpans[0].start).toBeCloseTo(.3);expect(mapped.inkSpans[0].end).toBeCloseTo(.9);expect(mapped.inkSpans[0].ends).toEqual([...old.ends].reverse());
  close(before.at(.1).p,after.at(.9).p);
 });
 test('nonuniform deformation transports the same cubic t, not the old arc percentage',()=>{
  let d=c.addLayer(emptyDrawing(),'A');d=c.createCurve(d,d.layers[0].id,[[0,0],[.1,1],[.4,-.5],[1,0]],.01,'curve','curve');
  const r=route([],{segments:[{id:'curve',reverse:false}],closed:false}),before=createDisplayRouteField(d,r),warped={...d,curves:d.curves.map(c=>({...c,handles:[[.3,2],[.6,-.1]] as [Point2,Point2]}))},after=createDisplayRouteField(warped,r),old=span(.2,.75),captured=captureRouteCoverage(before,[old]),mapped=remapRouteCoverage(captured,after);
  expect(mapped.unmapped).toEqual([]);expect(Math.abs(mapped.inkSpans[0].start-.2)).toBeGreaterThan(.001);
  expect(after.materialAt(mapped.inkSpans[0].start)).toEqual({kind:'curve',curveId:'curve',t:expect.closeTo((before.materialAt(.2) as {t:number}).t,8)});
  expect(after.materialAt(mapped.inkSpans[0].end)).toEqual({kind:'curve',curveId:'curve',t:expect.closeTo((before.materialAt(.75) as {t:number}).t,8)});
 });
 test('ARC material has canonical join direction and round-trips through reversed paths',()=>{
  const {d}=fixture(true),before=createDisplayRouteField(d,route()),after=createDisplayRouteField(d,route([],reverse(seed)));
  const i=before.geometry.pieces.findIndex(p=>p.joinId),part=before.parts[i],s=(part.start+part.length*.37)/before.total,material=before.materialAt(s)!;
  expect(material.kind).toBe('join');const t=after.positionOf(material)!;expect(t).toBeGreaterThanOrEqual(0);close(before.at(s).p,after.at(t).p,1e-5);expect(after.materialAt(t)).toEqual({kind:'join',joinId:(material as {joinId:string}).joinId,s:expect.closeTo((material as {s:number}).s,7)});
 });
 test('displaced old ARC cannot be silently rebound to another curve or transition',()=>{
  const {d,id}=fixture(true),before=createDisplayRouteField(d,route()),after=createDisplayRouteField(d,route([id])),mapped=remapRouteCoverage(captureRouteCoverage(before,[span(0,1)]),after);
  expect(mapped.unmapped.length).toBeGreaterThan(0);expect(mapped.unmapped.every(e=>e.reason==='MISSING_MATERIAL')).toBe(true);expect(after.geometry.pieces.every(p=>!p.joinId)).toBe(true);
 });
 test('source positions trimmed by a newly added ARC are explicit unmapped material',()=>{
  const {d}=fixture(false),before=createDisplayRouteField(d,route()),n=c.connect(d,{curveId:'a2',end:1},{curveId:'a0',end:0},'ARC',.2),after=createDisplayRouteField(n,route());
  expect(remapRouteCoverage(captureRouteCoverage(before,[span(0,.01)]),after).unmapped[0].reason).toBe('TRIMMED_MATERIAL');
 });
 test('dense independently chosen material samples round-trip without zoom or nearest-point matching',()=>{
  const {d,id}=fixture(),field=createDisplayRouteField(d,route([id]));
  for(let i=1;i<1000;i++){const s=(i+.314159)/1001,m=field.materialAt(s)!;expect(field.positionOf(m)).toBeCloseTo(s,9);}
 });
 test.each([false,true])('explicit source split mapping preserves material cuts and traversal, reversed=%s',(reversed)=>{
  const {d,id}=fixture(),oldRoute=route([id],reversed?reverse(seed):seed),before=createDisplayRouteField(d,oldRoute),old=span(.1,.8),material=captureRouteCoverage(before,[old]);
  const split=c.splitCurve(d,'a1',.4),nextRoute=splitDisplayRoute(oldRoute,'a1',split.ids[1]),after=createDisplayRouteField(split.document,nextRoute),mapped=remapRouteCoverage(splitRouteCoverage(material,'a1',split.ids[1],.4),after);
  expect(after.diagnostics).toEqual([]);expect(mapped.unmapped).toEqual([]);expect(mapped.inkSpans).toHaveLength(1);
  close(before.at(old.start).p,after.at(mapped.inkSpans[0].start).p);close(before.at(old.end).p,after.at(mapped.inkSpans[0].end).p);expect(mapped.inkSpans[0].ends).toEqual(old.ends);
  expect(after.path.segments).toHaveLength(7);expect(oldRoute.seed.segments).toHaveLength(3);
 });
 test('copy/import only uses explicit curve/link ID mapping',()=>{
  const {id}=fixture(),old=route([id]),mapped=mapDisplayRouteReferences(old,id=>'copy:'+id,id=>'copy:'+id);
  expect(mapped.seed.segments.map(u=>u.id)).toEqual(['copy:a0','copy:a1','copy:a2']);expect(mapped.throughLinkIds).toEqual(['copy:'+id]);expect(old.seed).toEqual(seed);
  expect(()=>mapDisplayRouteReferences(old,()=>{throw Error('missing dependency');},x=>x)).toThrow('missing dependency');
 });
});

describe('global coverage projected into existing source paint owners',()=>{
 test('cross-layer pieces keep their owners and only true visible末端 keep brush styles',()=>{
  const {d,id}=fixture(),field=createDisplayRouteField(d,route([id])),old=span(.2,.8),pieces=projectRouteSpansToPieces(field,[old]);
  expect(new Set(pieces.flatMap(p=>p.owners))).toEqual(new Set(['a1','a2','b0','b1','b2']));
  expect(pieces[0].ends[0]).toEqual(old.ends[0]);expect(pieces.at(-1)!.ends[1]).toEqual(old.ends[1]);
  expect(pieces.every(p=>p.inkOwner===p.owners[0])).toBe(true);
  for(let i=1;i<pieces.length;i++){expect(pieces[i].continuesBefore).toBe(true);expect(pieces[i-1].continuesAfter).toBe(true);expect(pieces[i].ends[0]).toEqual({taper:0,extension:0});expect(pieces[i-1].ends[1]).toEqual({taper:0,extension:0});close(pieces[i-1].shape[3],pieces[i].shape[0]);}
 });
 test('independent visible runs retain independent original tips and no false continuation',()=>{
  const {d,id}=fixture(),field=createDisplayRouteField(d,route([id])),pieces=projectRouteSpansToPieces(field,[span(.05,.1),span(.7,.75)]);
  expect(pieces.map(p=>p.run)).toEqual([0,1]);expect(pieces.every(p=>!p.continuesBefore&&!p.continuesAfter)).toBe(true);expect(pieces.every(p=>p.ends[0].taper===.017&&p.ends[1].taper===.029)).toBe(true);
 });
 test('hidden members keep their structural coordinate length rather than shifting remaining cuts',()=>{
  const {d,id}=fixture(),hidden={...d,curves:d.curves.map(c=>c.id==='b0'?{...c,visible:false,inkVisible:false}:c)},a=createDisplayRouteField(d,route([id])),b=createDisplayRouteField(hidden,route([id]));
  expect(a.total).toBe(b.total);expect(a.path).toEqual(b.path);close(a.at(.7).p,b.at(.7).p);expect(hidden.curves.find(c=>c.id==='b0')!.visible).toBe(false);
 });
 test('ARC ink is partitioned at its arc midpoint into original owners without duplicated tips',()=>{
  const {d}=fixture(true),field=createDisplayRouteField(d,route()),pieces=projectRouteSpansToPieces(field,[span(0,1)]),arcs=pieces.filter(p=>p.joinId);
  expect(new Set(arcs.map(p=>p.inkOwner))).toEqual(new Set(['a2','a0']));expect(arcs.every(p=>p.continuesBefore&&p.continuesAfter)).toBe(true);
  expect(pieces.every(p=>p.inkOwner)).toBe(true);expect(pieces[0].continuesBefore).toBe(true);expect(pieces.at(-1)!.continuesAfter).toBe(true);
 });
 test('closed 0/100% seam is not a new visible末端 when coverage wraps through it',()=>{
  const {d}=fixture(),field=createDisplayRouteField(d,route()),pieces=projectRouteSpansToPieces(field,[span(0,.1),span(.9,1)]);
  expect(pieces[0].continuesBefore).toBe(true);expect(pieces.at(-1)!.continuesAfter).toBe(true);expect(new Set(pieces.map(p=>p.run))).toEqual(new Set([0]));
  const material=captureRouteCoverage(field,[span(0,.1),span(.9,1)]);expect(material[0].continuesBefore).toBe(true);expect(material.at(-1)!.continuesAfter).toBe(true);
 });
});
