import {describe,test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,shapeOf,nodeAt,type Cubic,type DrawingDocument as Doc,type Point2,type TerminusJoinBrush} from '../domain/drawing/model';
import {roundedJoins,derivedUses} from '../domain/drawing/roundedJoin';
import {point,arcField} from '../domain/drawing/sampling';
import {fillGeometry} from '../domain/drawing/appearance';
import {depthPaintBatches} from '../domain/drawing/depth';
import {compileDisplayRouteBrushes} from '../domain/drawing/displayRouteBrush';
import {resolveDisplayRoute,createDisplayRouteField,projectRouteSpansToPieces,captureRouteCoverage,remapRouteCoverage,mapRouteCoverageReferences,type DisplayRoute} from '../domain/drawing/displayRoutes';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const arc:TerminusJoinBrush={kind:'ARC',trimDistance:.2};
function fixture(brush:TerminusJoinBrush=arc,a:Point2=[-1,0],b:Point2=[0,1]){
 let d=c.addLayer(emptyDrawing(),'A');d=c.createCurve(d,d.layers[0].id,line(a,[0,0]),.01,'A','a');
 d=c.addLayer(d,'B');d=c.createCurve(d,d.layers[0].id,line([0,0],b),.01,'B','b');
 d=c.linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});const id=d.endpointLinks![0].id;
 d={...d,endpointLinks:d.endpointLinks!.map(l=>({...l,throughDisplay:true,joinBrush:brush}))};
 const route:DisplayRoute={seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:[id]};
 return {d,id,route};
}
const tangent=(s:Cubic,end:0|1):Point2=>{const p=end?s[3]:s[1],q=end?s[2]:s[0],n=Math.hypot(p[0]-q[0],p[1]-q[1]);return [(p[0]-q[0])/n,(p[1]-q[1])/n];};
const near=(a:Point2,b:Point2,tol=1e-8)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(tol);

describe('cross-layer 末端接笔 compiles to transient ink only',()=>{
 test('ARC exactly reuses the existing local biarc/trim algorithm without merging source nodes',()=>{
  const {d,id,route}=fixture(),snapshot=JSON.stringify(d),resolved=resolveDisplayRoute(d,route),compiled=compileDisplayRouteBrushes(d,resolved),item=compiled.links[0],field=createDisplayRouteField(d,route);
  expect(compiled.diagnostics).toEqual([]);expect(item).toMatchObject({linkId:id,resolved:true,ownersVisible:true,suppressionEligible:true});expect(item.geometry!.distance).toBeCloseTo(.2);
  let local=c.addLayer(emptyDrawing(),'Local');local=c.createCurve(local,local.layers[0].id,line([-1,0],[0,0]),.01,'A','la');local=c.createCurve(local,local.layers[0].id,line([0,0],[0,1]),.01,'B','lb');local=c.connect(local,{curveId:'la',end:1},{curveId:'lb',end:0},'ARC',.2);
  expect(item.geometry!.shapes).toEqual(roundedJoins(local).get(local.joins[0].id)!.shapes);
  expect(field.geometry.shapes).toEqual(derivedUses(local,[{id:'la',reverse:false},{id:'lb',reverse:false}]).shapes);
  expect(nodeAt(d,{curveId:'a',end:1}).id).not.toBe(nodeAt(d,{curveId:'b',end:0}).id);expect(JSON.stringify(d)).toBe(snapshot);expect(d.joins).toEqual([]);
 });
 test('G1 through both source trims and derived pieces, with source cubics unchanged',()=>{
  const {d,route}=fixture(),raw=d.curves.map(q=>shapeOf(d,q.id)),field=createDisplayRouteField(d,route);
  for(let i=1;i<field.geometry.shapes.length;i++){near(field.geometry.shapes[i-1][3],field.geometry.shapes[i][0]);near(tangent(field.geometry.shapes[i-1],1),tangent(field.geometry.shapes[i],0));}
  expect(d.curves.map(q=>shapeOf(d,q.id))).toEqual(raw);expect(d.curves).toHaveLength(2);
  // Same standard cubic approximation as the existing circular fillet, not an
  // assertion of exact circles or parameter-speed C1 continuity.
  for(const s of field.geometry.pieces.filter(p=>p.joinId).map(p=>p.shape))for(let i=0;i<=256;i++){const p=point(s,i/256);expect(Math.abs(Math.hypot(p[0]+.2,p[1]-.2)-.2)).toBeLessThan(.00006);}
 });
 test('source white fills, source topology and original depth plan stay unchanged',()=>{
  let {d,id}=fixture();
  const layerA=d.layers.find(l=>l.items.includes('a'))!.id,layerB=d.layers.find(l=>l.items.includes('b'))!.id;
  d=c.createCurve(d,layerA,line([0,0],[-1,1]),.01,'A closure1','ac1');d=c.createCurve(d,layerA,line([-1,1],[-1,0]),.01,'A closure2','ac2');
  d=c.connect(d,{curveId:'a',end:1},{curveId:'ac1',end:0},'POSITION');d=c.connect(d,{curveId:'ac1',end:1},{curveId:'ac2',end:0},'POSITION');d=c.connect(d,{curveId:'ac2',end:1},{curveId:'a',end:0},'POSITION');d=paint.createFill(d,['a','ac1','ac2'],'white');
  d=c.createCurve(d,layerB,line([0,1],[1,0]),.01,'B closure1','bc1');d=c.createCurve(d,layerB,line([1,0],[0,0]),.01,'B closure2','bc2');
  d=c.connect(d,{curveId:'b',end:1},{curveId:'bc1',end:0},'POSITION');d=c.connect(d,{curveId:'bc1',end:1},{curveId:'bc2',end:0},'POSITION');d=c.connect(d,{curveId:'bc2',end:1},{curveId:'b',end:0},'POSITION');d=paint.createFill(d,['b','bc1','bc2'],'white');
  const route:DisplayRoute={seed:{segments:[{id:'a',reverse:false},{id:'ac1',reverse:false},{id:'ac2',reverse:false}],closed:true},throughLinkIds:[id]},snapshot=JSON.stringify(d),fills=d.fills.map(f=>fillGeometry(d,f)),depth=depthPaintBatches(d);
  const field=createDisplayRouteField(d,route);expect(field.diagnostics).toEqual([]);expect(field.geometry.pieces.some(p=>p.joinId)).toBe(true);
  expect(d.fills.map(f=>fillGeometry(d,f))).toEqual(fills);expect(depthPaintBatches(d)).toEqual(depth);expect(JSON.stringify(d)).toBe(snapshot);
  // Deliberate validation tradeoff: ink is rounded while the independent fill
  // still contains its original sharp vertex. This helper never rewrites it.
  expect(fills.every(f=>f.shapes.some(s=>s.some(p=>p[0]===0&&p[1]===0)))).toBe(true);
 });
 test('ARC bridge uses both original paint owners and no extra caps at its midpoint',()=>{
  const {d,route}=fixture(),field=createDisplayRouteField(d,route),pieces=projectRouteSpansToPieces(field,[{start:0,end:1,ends:[{},{}]}]),arcs=pieces.filter(p=>p.joinId);
  expect(new Set(arcs.map(p=>p.inkOwner))).toEqual(new Set(['a','b']));expect(arcs.every(p=>p.continuesBefore&&p.continuesAfter)).toBe(true);expect(arcs.every(p=>p.ends.every(e=>e.taper===0&&e.extension===0))).toBe(true);
  const a=arcs.filter(p=>p.inkOwner==='a'),b=arcs.filter(p=>p.inkOwner==='b');expect(arcField(a.map(p=>p.shape)).total).toBeCloseTo(arcField(b.map(p=>p.shape)).total,7);
 });
 test('requested trim distance is retained when available source length clamps it',()=>{
  const {d,route}=fixture({kind:'ARC',trimDistance:.8},[-.1,0],[0,.1]),snapshot=JSON.stringify(d),out=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,route));
  expect(out.links[0].geometry!.clamped).toBe(true);expect(out.links[0].geometry!.distance).toBeLessThan(.1);expect(out.links[0].brush).toEqual({kind:'ARC',trimDistance:.8});expect(out.diagnostics.some(x=>x.code==='ARC_CLAMPED'&&x.severity==='warning')).toBe(true);expect(JSON.stringify(d)).toBe(snapshot);
 });
 test('two cross-layer ARC requests share the middle curve length without overlapping trims',()=>{
  let {d,id,route}=fixture({kind:'ARC',trimDistance:.8},[-1,0],[0,.1]);d=c.addLayer(d,'C');d=c.createCurve(d,d.layers[0].id,line([0,.1],[1,.1]),.01,'C','c');d=c.linkEndpoints(d,{curveId:'b',end:1},{curveId:'c',end:0});
  const nextId=d.endpointLinks!.find(l=>l.id!==id)!.id;d={...d,endpointLinks:d.endpointLinks!.map(l=>({...l,throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.8}}))};
  const field=createDisplayRouteField(d,{...route,throughLinkIds:[id,nextId]});expect(field.diagnostics).toEqual([]);expect(field.brushes.links.every(l=>l.resolved&&l.geometry!.clamped)).toBe(true);
  expect(field.brushes.links.reduce((sum,l)=>sum+l.geometry!.distance,0)).toBeLessThan(.1);expect(field.geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);
 });
 test('hidden source owners do not change structural curve/ARC coordinates or enable brush suppression',()=>{
  const {d,route}=fixture(),hidden={...d,curves:d.curves.map(c=>c.id==='b'?{...c,inkVisible:false}:c)},a=createDisplayRouteField(d,route),b=createDisplayRouteField(hidden,route);
  expect(b.geometry.shapes).toEqual(a.geometry.shapes);expect(b.total).toBe(a.total);expect(b.brushes.links[0]).toMatchObject({resolved:true,ownersVisible:false,suppressionEligible:false});expect(b.brushes.diagnostics.some(x=>x.code==='HIDDEN_OWNER')).toBe(true);expect(b.diagnostics).toEqual([]);
 });
 test('same style travels with stable link material through radius edits and route reversal',()=>{
  const {d,id,route}=fixture(),a=createDisplayRouteField(d,route),join=a.brushes.links[0].joinId!,material={kind:'join' as const,joinId:join,s:.3};
  const reversed={...route,seed:{segments:[{id:'a',reverse:true}],closed:false}},b=createDisplayRouteField(d,reversed,{[id]:{kind:'ARC',trimDistance:.3}});
  expect(b.diagnostics).toEqual([]);expect(b.materialAt(b.positionOf(material)!)).toEqual({kind:'join',joinId:join,s:expect.closeTo(.3,7)});
  expect(d.endpointLinks![0]).toMatchObject({joinBrush:{kind:'ARC',trimDistance:.2}});
 });
 test('explicit verified local-ARC to link-ARC provenance preserves complete old visible coverage',()=>{
  let d=c.addLayer(emptyDrawing(),'Local');d=c.createCurve(d,d.layers[0].id,line([-1,0],[0,0]),.01,'A','a');d=c.createCurve(d,d.layers[0].id,line([0,0],[0,1]),.01,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
  const old=createDisplayRouteField(d,{seed:{segments:[{id:'a',reverse:false},{id:'b',reverse:false}],closed:false},throughLinkIds:[]}),cross=fixture(),next=createDisplayRouteField(cross.d,cross.route),material=captureRouteCoverage(old,[{start:.1,end:.9,ends:[{taper:.03},{taper:.04}]}]);
  expect(old.geometry.shapes).toEqual(next.geometry.shapes);expect(remapRouteCoverage(material,next).unmapped.length).toBeGreaterThan(0);
  const mapped=mapRouteCoverageReferences(material,id=>id,id=>{expect(id).toBe(d.joins[0].id);return {id:next.brushes.links[0].joinId!};}),result=remapRouteCoverage(mapped,next);
  expect(result.unmapped).toEqual([]);expect(result.inkSpans).toHaveLength(1);expect(result.inkSpans[0].start).toBeCloseTo(.1,8);expect(result.inkSpans[0].end).toBeCloseTo(.9,8);expect(result.inkSpans[0].ends).toEqual([{taper:.03},{taper:.04}]);
  expect(material.some(s=>s.from.kind==='join'&&s.from.joinId===d.joins[0].id)).toBe(true);
 });
});

describe('honest brush capabilities and failure diagnostics',()=>{
 test('SHARP keeps independent directions and source geometry, without claiming G1',()=>{
  const {d,route}=fixture({kind:'SHARP'}),out=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,route));expect(out.links[0].resolved).toBe(true);expect(out.inkDocument.joins[0].mode).toBe('CUSP');expect(createDisplayRouteField(d,route).geometry.shapes).toEqual([shapeOf(d,'a'),shapeOf(d,'b')]);
 });
 test('SMOOTH accepts an existing tangent match but never edits handle lengths or directions',()=>{
  const {d,route}=fixture({kind:'SMOOTH'},[-1,0],[2,0]),snapshot=JSON.stringify(d),out=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,route));
  expect(out.links[0].resolved).toBe(true);expect(out.diagnostics).toEqual([]);expect(out.inkDocument.curves).toBe(d.curves);expect(JSON.stringify(d)).toBe(snapshot);
 });
 test('SMOOTH at a real corner reports missing capability rather than rotating source handles',()=>{
  const {d,route}=fixture({kind:'SMOOTH'}),snapshot=JSON.stringify(d),out=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,route));
  expect(out.links[0]).toMatchObject({resolved:false,suppressionEligible:false});expect(out.diagnostics[0].code).toBe('SMOOTH_REQUIRES_TANGENT_MATCH');expect(JSON.stringify(d)).toBe(snapshot);
 });
 test('width mismatch is explicit and never changes any source line width',()=>{
  const {d,route}=fixture(),wide={...d,curves:d.curves.map(c=>c.id==='b'?{...c,width:.02}:c)},out=compileDisplayRouteBrushes(wide,resolveDisplayRoute(wide,route));
  expect(out.diagnostics[0].code).toBe('WIDTH_MISMATCH');expect(out.links[0].resolved).toBe(false);expect(out.inkDocument.curves.map(c=>c.width)).toEqual([.01,.02]);
  expect(()=>captureRouteCoverage(createDisplayRouteField(wide,route),[{start:0,end:1,ends:[{},{}]}])).toThrow(/线宽/);
 });
 test('varying profiles are reported, not silently replaced by the first owner style',()=>{
  const {d,route}=fixture(),profile={...d,curves:d.curves.map(c=>c.id==='b'?{...c,profile:'EYELID' as const}:c)},out=compileDisplayRouteBrushes(profile,resolveDisplayRoute(profile,route));
  expect(out.diagnostics.some(x=>x.code==='PROFILE_VARIATION')).toBe(true);expect(out.inkDocument.curves).toBe(profile.curves);
 });
 test('SMOOTH still rejects degenerate endpoint tangents',()=>{
  const {d,route}=fixture({kind:'SMOOTH'}),degenerate={...d,curves:d.curves.map(c=>c.id==='a'?{...c,handles:[c.handles[0],[0,0]] as [Point2,Point2]}:c)},out=compileDisplayRouteBrushes(degenerate,resolveDisplayRoute(degenerate,route));
  expect(out.diagnostics[0].code).toBe('DEGENERATE_TANGENT');expect(out.links[0].suppressionEligible).toBe(false);
 });
 test('ARC accepts a zero raw handle when both actual trim tangents are valid',()=>{
  const {d,route}=fixture(),degenerate={...d,curves:d.curves.map(c=>c.id==='a'?{...c,handles:[c.handles[0],[0,0]] as [Point2,Point2]}:c)},before=structuredClone(degenerate),field=createDisplayRouteField(degenerate,route);
  expect(field.diagnostics).toEqual([]);expect(field.brushes.links[0]).toMatchObject({resolved:true,suppressionEligible:true});
  expect(field.brushes.links[0].geometry?.error).toBeUndefined();expect(field.geometry.pieces.some(p=>p.joinId)).toBe(true);
  for(let i=1;i<field.geometry.shapes.length;i++){near(field.geometry.shapes[i-1][3],field.geometry.shapes[i][0]);near(tangent(field.geometry.shapes[i-1],1),tangent(field.geometry.shapes[i],0));}
  const coverage=captureRouteCoverage(field,[{start:.1,end:.9,ends:[{taper:.03},{taper:.04}]}]);expect(remapRouteCoverage(coverage,field).unmapped).toEqual([]);
  expect(degenerate).toEqual(before);
 });
 test('failed U-turn arcs retain finite raw fallback and explicit errors',()=>{
  const fold=fixture(arc,[-1,0],[-1,0]),field=createDisplayRouteField(fold.d,fold.route);expect(field.brushes.diagnostics.some(x=>x.code==='ARC_FAILED')).toBe(true);expect(field.geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);expect(field.brushes.links[0].suppressionEligible).toBe(false);
 });
 test('an actually collapsed ARC owner still reports failure rather than successful smoothing',()=>{
  const {d,route}=fixture(),collapsed=structuredClone(d),owner=collapsed.curves.find(c=>c.id==='a')!;
  for(const id of owner.nodes)collapsed.nodes.find(n=>n.id===id)!.position=[0,0];owner.handles=[[0,0],[0,0]];
  const field=createDisplayRouteField(collapsed,route);expect(field.brushes.diagnostics.some(x=>x.code==='ARC_FAILED')).toBe(true);
  expect(field.brushes.links[0]).toMatchObject({resolved:false,suppressionEligible:false});expect(field.geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);
 });
 test.each([0,-1,NaN,3])('invalid ARC influence %s does not generate geometry',(trimDistance)=>{
  const {d,id,route}=fixture(),out=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,route),{[id]:{kind:'ARC',trimDistance}});expect(out.diagnostics[0].code).toBe('INVALID_BRUSH');expect(out.links[0].resolved).toBe(false);expect(out.inkDocument.joins).toEqual([]);
 });
 test('adding an ARC never silently remaps an old raw-corner material cut into the new bridge',()=>{
  const {d,id,route}=fixture({kind:'SHARP'}),old=createDisplayRouteField(d,route),next=createDisplayRouteField(d,route,{[id]:arc}),coverage=captureRouteCoverage(old,[{start:.49,end:.51,ends:[{},{}]}]);
  expect(remapRouteCoverage(coverage,next).unmapped.length).toBeGreaterThan(0);
 });
});
