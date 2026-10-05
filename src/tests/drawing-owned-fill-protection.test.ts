import {expect,test} from 'vitest';
import {emptyDrawing,parseDrawing,type DrawingDocument as Doc,type Cubic,type Point2} from '../domain/drawing/model';
import {addLayer,createCurve,connect,curveChange} from '../domain/drawing/commands';
import {createFill,createOffset,changePaint,reorderPaint,setInk,setInkEnd} from '../domain/drawing/paintCommands';
import {setContourMist} from '../domain/drawing/mist';
import {depthPaintBatches,setDepthOffset,reorderCurveMember} from '../domain/drawing/depth';
import {addDisplayInterval,changeDisplayInterval,localDisplayPath} from '../domain/drawing/displayIntervals';
import {displayInkSampling,fillGeometry,offsetGeometry,strokeInk} from '../domain/drawing/appearance';
import {strokeFor,strokeWidth} from '../domain/drawing/strokes';
import {withDrawingReadScope} from '../domain/drawing/readContext';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../domain/drawing/affineDrawing';
import {deformDrawing,type Quad} from '../domain/drawing/deform';
import {createPaintProductReader,type FillBoundaryInkProduct} from '../ui/drawing/paintProducts';
import {fillInkSupport,fillInkSupportDiagnostics} from '../ui/drawing/fillInkSupport';
import {paintMarkup} from './fixtures/paint-read-scope';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const sampling=()=>displayInkSampling(250);
const read=(d:Doc)=>createPaintProductReader(d,sampling());
const protectedInk=(d:Doc,fill=d.fills[0],opacity?:ReadonlyMap<string,number>)=>withDrawingReadScope(()=>read(d).fillBoundaryInk(fill,opacity));
const ownerIds=(p:FillBoundaryInkProduct)=>[...new Set(p.passes.flatMap(pass=>pass.ownerIds))].sort();
const queue=(d:Doc)=>depthPaintBatches(d).map(b=>({id:b.owner??b.item.id,layerId:b.layerId,position:b.position}));
const svg=(d:Doc,options:Parameters<typeof paintMarkup>[1]={})=>paintMarkup(d,{showFills:true,...options});

/** Public Drawing commands establish real connections, fill ownership and depth. */
function loop(source=emptyDrawing(),prefix='own',points:Point2[]=[[0,0],[1,0],[.5,1]]){
 let d=addLayer(source,prefix);const layerId=d.layers[0].id,ids=points.map((_,i)=>`${prefix}${i}`);
 for(let i=0;i<points.length;i++)d=createCurve(d,layerId,line(points[i],points[(i+1)%points.length]),.04,ids[i],ids[i]);
 for(let i=0;i<ids.length;i++)d=connect(d,{curveId:ids[i],end:1},{curveId:ids[(i+1)%ids.length],end:0},'POSITION');
 d=createFill(d,ids,'white');return {d,ids,layerId,fillId:d.fills.at(-1)!.id};
}
function cycle(layerDepth=false){
 let {d,ids,layerId,fillId}=loop();
 if(layerDepth)d=addLayer(d,'Foreign');
 d=createCurve(d,layerDepth?d.layers[0].id:layerId,line([.4,-.2],[.4,1.2]),.08,'Foreign occluder','foreign');
 d=layerDepth?setDepthOffset(d,fillId,1,'LAYER'):reorderPaint(d,fillId,'foreign');
 return {d,ids,layerId,fillId};
}
function interval(d:Doc,id:string,mode:'SHOW'|'HIDE',start:number,end:number){
 const next=addDisplayInterval(d,id,mode),track=next.displayIntervals!.at(-1)!;
 return changeDisplayInterval(next,track.id,track.ranges.at(-1)!.id,{start,end});
}

interface SvgElement {tag:string;attributes:Record<string,string>;ancestors:SvgElement[]}
function elements(markup:string){
 const stack:SvgElement[]=[],result:SvgElement[]=[];
 for(const match of markup.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*)>/g)){
  const [,closing,tag,raw]=match;if(closing){stack.pop();continue;}
  const attributes=Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  const element={tag,attributes,ancestors:[...stack]};result.push(element);if(!raw.endsWith('/'))stack.push(element);
 }
 return result;
}
const tagged=(markup:string,id:string)=>elements(markup).filter(e=>e.attributes['data-testid']===id);
const clipsAt=(element:SvgElement)=>element.ancestors.flatMap(e=>e.attributes['clip-path']?[e.attributes['clip-path']]:[]);
const protectedFills=(markup:string)=>[...new Set(tagged(markup,'drawing-owned-ink-clip').map(e=>e.attributes['data-id']))].sort();

test.each([false,true])('own ink / foreign occluder / own fill cycle preserves queue, source and painter order (layer depth %s)',layerDepth=>{
 const {d,ids,fillId}=cycle(layerDepth),before=JSON.stringify(d),batches=depthPaintBatches(d),order=queue(d),source=strokeFor(d,ids[0]);
 expect(order.map(b=>b.id)).toEqual([fillId,'foreign',source.id]);
 const product=protectedInk(d);expect(product.diagnostics).toEqual([]);expect(ownerIds(product)).toEqual([...ids].sort());expect(ownerIds(product)).not.toContain('foreign');
 expect(product.passes.flatMap(p=>p.runs)).toEqual(strokeInk(d,source,undefined,false,sampling()));
 const markup=svg(d),paint=elements(markup).filter(e=>['drawing-ink','drawing-fill'].includes(e.attributes['data-testid']));
 expect(paint.map(e=>e.attributes['data-testid']==='drawing-fill'?e.attributes['data-id']:e.attributes['data-stroke'])).toEqual([source.id,'foreign',fillId]);
 expect(protectedFills(markup)).toEqual([fillId]);
 const fill=tagged(markup,'drawing-fill')[0];expect(clipsAt(fill).length).toBeGreaterThan(0);
 for(const ink of tagged(markup,'drawing-ink'))expect(ink.ancestors.some(e=>e.attributes['data-testid']==='drawing-owned-ink-clip')).toBe(false);
 expect(depthPaintBatches(d)).toBe(batches);expect(queue(d)).toEqual(order);expect(JSON.stringify(d)).toBe(before);
});

test('normal fills behind their own ink need no protection and foreign upper fills never acquire another loop',()=>{
 const base=loop(),plain=protectedInk(base.d);expect(plain).toEqual({passes:[],diagnostics:[]});expect(tagged(svg(base.d),'drawing-owned-ink-clip')).toHaveLength(0);
 let {d,ids,fillId}=cycle();const ownGeometry=fillGeometry(d,d.fills[0]),foreign=loop(d,'other',[[.2,-.2],[.8,-.2],[.5,.7]]);d=foreign.d;
 d=reorderPaint(d,foreign.fillId,foreign.ids[0]);
 expect(ownerIds(protectedInk(d,d.fills.find(f=>f.id===fillId)!))).toEqual([...ids].sort());
 expect(ownerIds(protectedInk(d,d.fills.find(f=>f.id===foreign.fillId)!))).toEqual([...foreign.ids].sort());
 expect(fillGeometry(d,d.fills.find(f=>f.id===fillId)!)).toEqual(ownGeometry);
});

test('two fills sharing a boundary get independent support at their own depth slots',()=>{
 const fixture=cycle();let d=createFill(fixture.d,fixture.ids,'black');const second=d.fills.at(-1)!.id;
 expect(protectedInk(d,d.fills.find(f=>f.id===second)!)).toEqual({passes:[],diagnostics:[]});
 d=reorderPaint(d,second,'foreign');const before=queue(d),first=protectedInk(d,d.fills[0]),next=protectedInk(d,d.fills[1]);
 expect(ownerIds(first)).toEqual([...fixture.ids].sort());expect(next).toEqual(first);
 const markup=svg(d);expect(protectedFills(markup)).toEqual([fixture.fillId,second].sort());
 const fills=tagged(markup,'drawing-fill');expect(fills.map(f=>f.attributes['data-id'])).toEqual(depthPaintBatches(d).filter(b=>b.item.kind==='fill').reverse().map(b=>b.item.id));
 expect(new Set(fills.flatMap(clipsAt)).size).toBe(fills.flatMap(clipsAt).length);expect(queue(d)).toEqual(before);
});

test('hidden source ink, invisible curves, zero group opacity and collapsed SHOW have no protection',()=>{
 const {d,ids}=cycle();
 const cases=[setInk(d,ids,{inkVisible:false}),ids.reduce((next,id)=>curveChange(next,id,{visible:false}),d),interval(d,ids[0],'SHOW',.4,.4)];
 for(const next of cases){expect(protectedInk(next)).toEqual({passes:[],diagnostics:[]});expect(tagged(svg(next),'drawing-owned-ink-clip')).toHaveLength(0);expect(fillGeometry(next,next.fills[0])).toEqual(fillGeometry(d,d.fills[0]));}
 const opacity=new Map([[strokeFor(d,ids[0]).segments[0].id,0]]);expect(protectedInk(d,d.fills[0],opacity).passes).toEqual([]);expect(tagged(svg(d,{opacity}),'drawing-owned-ink-clip')).toHaveLength(0);
 const partial=new Map([[strokeFor(d,ids[0]).segments[0].id,.25]]);expect(protectedInk(d,d.fills[0],partial)).toEqual(protectedInk(d));
});

test('an exactly collapsed HIDE with large end brushes has no effect on source ink or its protection',()=>{
 const {d,ids}=cycle();let next=interval(d,ids[0],'HIDE',.4,.4);next.displayIntervals![0].ranges[0].inkEnds=[{taper:.7,extension:.2},{taper:.8,extension:.3}];
 expect(protectedInk(next)).toEqual(protectedInk(d));expect(svg(next)).toBe(svg(d));
});

test('display interval tapers and local ARC pieces protect the same measured ink rather than the full fill boundary',()=>{
 const fixture=cycle();let d=connect(fixture.d,{curveId:fixture.ids[0],end:1},{curveId:fixture.ids[1],end:0},'ARC',.14);
 d=setInk(d,fixture.ids,{profile:'TAPER_BOTH'});d=interval(d,fixture.ids[0],'SHOW',.16,.67);
 const track=d.displayIntervals![0];track.ranges[0].inkEnds=[{taper:.08},{taper:.12}];
 const source=strokeFor(d,fixture.ids[0]),expected=strokeInk(d,source,undefined,false,sampling()),product=protectedInk(d);
 expect(expected.length).toBeGreaterThan(0);expect(expected.every(run=>!run.uniform&&!run.closed)).toBe(true);
 expect(product.passes.flatMap(p=>p.runs)).toEqual(expected);expect(product.passes.every(p=>p.width===strokeWidth(d,source))).toBe(true);
 expect(read(d).stroke(source).pieces.some(p=>p.joinId)).toBe(true);expect(product.passes.flatMap(p=>p.runs.flatMap(r=>r.shapes))).not.toEqual(fillGeometry(d,d.fills[0]).shapes);
});

test('member depth protects only own visible owners behind the fill and keeps their width metadata',()=>{
 const fixture=cycle(true);let d=reorderCurveMember(fixture.d,fixture.ids[0],fixture.ids[1]);
 d=setDepthOffset(d,fixture.ids[0],1,'LAYER');d=setInkEnd(d,fixture.ids[1],0,{interior:true,taper:.09});
 const reader=read(d),fill=d.fills[0],fillIndex=reader.batches.findIndex(b=>b.item.id===fill.id),expected=reader.batches.slice(fillIndex+1).filter(b=>b.owner&&fixture.ids.includes(b.owner)).map(b=>b.owner!).sort();
 const product=reader.fillBoundaryInk(fill);expect(ownerIds(product)).toEqual(expected);expect(expected.length).toBeGreaterThan(0);expect(expected).not.toContain(fixture.ids[0]);
 for(const pass of product.passes){expect(pass.ownerIds).toHaveLength(1);expect(pass.runs).toEqual(reader.member(strokeFor(d,pass.ownerIds[0])).runs.get(pass.ownerIds[0]));expect(pass.width).toBe(.04);}
 expect(queue(d)).toEqual(reader.batches.map(b=>({id:b.owner??b.item.id,layerId:b.layerId,position:b.position})));
});

test('distinct offsets remain independent and mutable cold/warm products observe coordinates, width, visibility and fill depth',()=>{
 const fixture=cycle();let d=createOffset(fixture.d,'foreign');d=createOffset(d,'foreign');
 d=changePaint(d,d.offsets[0].id,{distance:.08,width:.012});d=changePaint(d,d.offsets[1].id,{distance:-.11,width:.024});
 const before=JSON.stringify(d),reader=read(d),offsets=d.offsets.map(o=>reader.offset(o));expect(offsets[0]).not.toEqual(offsets[1]);
 expect(protectedInk(d)).toEqual(protectedInk(d));expect(ownerIds(protectedInk(d))).toEqual([...fixture.ids].sort());expect(JSON.stringify(d)).toBe(before);
 for(const edit of [()=>{d.curves[0].handles[0][1]+=.13;},()=>{d.curves.filter(c=>fixture.ids.includes(c.id)).forEach(c=>{c.width=.07;});},()=>{d.curves[0].inkVisible=false;},()=>{d.fills[0].depthOffset=-1;}]){
  edit();const warm=protectedInk(d),cold=parseDrawing(JSON.parse(JSON.stringify(d)));expect(warm).toEqual(protectedInk(cold));expect(svg(d)).toBe(svg(cold));
  const fresh=read(d);for(const offset of d.offsets)expect(fresh.offset(offset)).toEqual(offsetGeometry(cold,cold.offsets.find(o=>o.id===offset.id)!));
 }
 expect(d.offsets.map(o=>({id:o.id,distance:o.distance,width:o.width}))).toEqual(JSON.parse(before).offsets.map((o:{id:string;distance:number;width:number})=>({id:o.id,distance:o.distance,width:o.width})));
});

test('mist fills against sharp ink use the same protection, while active filtered ink exposes the retained-render boundary',()=>{
 const {d,ids}=cycle(),sharp=protectedInk(d),mistFill:Doc={...d,fills:d.fills.map(f=>({...f,mist:{enabled:true,side:'BOTH',width:.05,opacity:.7}}))};
 expect(protectedInk(mistFill)).toEqual(sharp);
 const filtered=setContourMist(d,ids,{enabled:true,width:.004,density:.6}),product=protectedInk(filtered);
 expect(product.passes).toEqual([]);expect(product.diagnostics.join(' ')).toMatch(/filtered|filter/i);
 for(const id of ids)expect(product.diagnostics.join(' ')).toContain(id);
 const markup=svg(filtered);expect(tagged(markup,'drawing-owned-ink-clip')).toHaveLength(0);expect(tagged(markup,'drawing-ink-edge').length).toBeGreaterThan(0);
 expect(tagged(markup,'drawing-owned-ink-diagnostic')[0].attributes['data-message']).toBe(product.diagnostics.join('; '));
 expect(tagged(markup,'drawing-ink').map(e=>e.attributes)).toEqual(tagged(svg(filtered,{showFills:false}),'drawing-ink').map(e=>e.attributes));
 const dormant=setContourMist(d,ids,{enabled:true,width:.004,density:0});expect(protectedInk(dormant)).toEqual(sharp);
});

test('transparent cutouts retain layer clips and never request own-ink protection',()=>{
 const fixture=cycle();let d=createFill(fixture.d,fixture.ids,'transparent');const cut=d.fills.at(-1)!;
 expect(protectedInk(d,cut)).toEqual({passes:[],diagnostics:[]});
 const markup=svg(d),fill=tagged(markup,'drawing-fill').find(e=>e.attributes['data-id']===fixture.fillId)!;
 expect(clipsAt(fill).some(id=>id.includes('-cut-'))).toBe(true);expect(clipsAt(fill).some(id=>!id.includes('-cut-'))).toBe(true);
 expect(tagged(markup,'drawing-cutout')).toHaveLength(1);expect(d.fills[0].boundary).toEqual(cut.boundary);
 d=changePaint(d,fixture.fillId,{color:'transparent'});expect(tagged(svg(d),'drawing-owned-ink-clip')).toHaveLength(0);
});

test.each(['nonuniform','perspective'] as const)('%s geometry keeps source IDs, fill offset and native width metadata',kind=>{
 const fixture=cycle(true),d=fixture.d,before=JSON.stringify(d),ids=d.curves.map(c=>c.id),owners=drawingLayerObjectOwners(d);
 const quad:Quad=[[-.2,-.3],[1.3,-.1],[1.05,1.3],[.1,1.1]];
 const next=kind==='nonuniform'?placeDrawingAffines(d,{own:[1.6,.12,.25,.65,.1,-.1]},id=>owners.get(id)===fixture.layerId?'own':undefined):deformDrawing(d,fixture.ids,{min:[0,0],max:[1,1]},quad).document;
 const product=protectedInk(next);expect(product.passes.length).toBeGreaterThan(0);expect(product.passes.every(p=>p.width===.04)).toBe(true);expect(ownerIds(product)).toEqual([...fixture.ids].sort());
 const circles=product.passes.flatMap(p=>fillInkSupport(p,sampling())).filter(s=>s.kind==='circle');expect(circles.length).toBeGreaterThan(0);expect(circles.every(c=>c.radius===.02)).toBe(true);
 expect(next.curves.map(c=>[c.id,c.width])).toEqual(d.curves.map(c=>[c.id,c.width]));expect(next.curves.map(c=>c.id)).toEqual(ids);expect(next.fills).toEqual(d.fills);expect(queue(next)).toEqual(queue(d));expect(JSON.stringify(d)).toBe(before);
 expect(product).not.toEqual(protectedInk(d));expect(protectedFills(svg(next))).toEqual([fixture.fillId]);
});

/** Cross-layer display routes are authored from two ordinary closed loops. */
function routedCycle(){
 let {d,ids,fillId}=loop(undefined,'a',[[-1,1],[0,0],[-.2,1]]);const other=loop(d,'b',[[1,1],[0,0],[.2,1]]);d=other.d;
 const seed=localDisplayPath(d,ids[0]);d={...d,endpointLinks:[{id:'bridge',a:{curveId:'a0',end:1},b:{curveId:'b0',end:1},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.09}}],displayIntervals:[{id:'routed',anchor:{...seed.segments[0]},displayRoute:{seed,throughLinkIds:['bridge']},ranges:[{id:'all',start:0,end:1,mode:'SHOW'}]}]};
 d=setDepthOffset(d,fillId,1,'LAYER');return {d,ids,fillId};
}
test('a cross-layer ARC route protects only the fill’s owners using their existing routed fragments',()=>{
 const {d,ids,fillId}=routedCycle(),reader=read(d),fill=d.fills.find(f=>f.id===fillId)!,route=reader.routeFor(ids[0])!;expect(route).toBeDefined();
 const plan=reader.route(route),product=reader.fillBoundaryInk(fill);expect(plan.diagnostics).toEqual([]);expect(plan.curveIds.size).toBe(6);expect(plan.pieces.some(p=>p.joinId)).toBe(true);
 expect(ownerIds(product)).toEqual([...ids].sort());expect(product.diagnostics).toEqual([]);
 for(const pass of product.passes){const [owner]=pass.ownerIds;expect(pass.ownerIds).toHaveLength(1);expect(pass.runs).toEqual(plan.runs.get(owner));expect(pass.width).toBe(d.curves.find(c=>c.id===owner)!.width);}
 expect(product.passes.flatMap(p=>p.ownerIds).some(id=>id.startsWith('b'))).toBe(false);
 const before=queue(d),markup=svg(d);expect(tagged(markup,'drawing-route-ink')).toHaveLength(6);expect(protectedFills(markup)).toEqual([fillId]);expect(queue(d)).toEqual(before);
});

test('sharp native endpoints retain exact round-cap radii, while interval caps stay butt and taper outlines stay exact',()=>{
 const fixture=cycle(),open=setInk(fixture.d,fixture.ids.slice(1),{inkVisible:false}),pass=protectedInk(open).passes[0];
 expect(pass.runs).toHaveLength(1);expect(pass.runs[0]).toMatchObject({uniform:true,closed:false});
 const support=fillInkSupport(pass,sampling()),caps=support.filter(s=>s.kind==='circle');
 expect(caps).toEqual([{kind:'circle',center:pass.runs[0].shapes[0][0],radius:.02},{kind:'circle',center:pass.runs[0].shapes.at(-1)![3],radius:.02}]);
 expect(fillInkSupport(pass,sampling())).toBe(support);
 const clipped=protectedInk(interval(open,fixture.ids[0],'SHOW',.05,.2)).passes;
 expect(clipped.length).toBeGreaterThan(0);for(const p of clipped){expect(p.runs.every(r=>r.clipped)).toBe(true);expect(fillInkSupport(p,sampling()).filter(s=>s.kind==='circle')).toEqual([]);}
 const taperedDocument=interval(open,fixture.ids[0],'SHOW',.05,.2);taperedDocument.displayIntervals![0].ranges[0].inkEnds=[{taper:.08},{taper:.08}];
 const tapered=protectedInk(taperedDocument).passes;expect(tapered.length).toBeGreaterThan(0);
 for(const p of tapered){const outlines=fillInkSupport(p,sampling());expect(outlines).toHaveLength(p.runs.length);p.runs.forEach((run,i)=>{expect(run.uniform).toBe(false);expect(outlines[i]).toEqual({kind:'outline',points:run.outline});if(outlines[i].kind==='outline')expect(outlines[i].points).toBe(run.outline);});}
});

test('the same inverse SVG clips constrain fill paint and fill hit geometry without creating stroke hits',()=>{
 const {d,fillId}=cycle(),markup=svg(d,{selectedPaint:fillId}),fill=tagged(markup,'drawing-fill')[0],support=protectedInk(d).passes.flatMap(p=>fillInkSupport(p,sampling())),all=elements(markup);
 expect(fill.attributes['pointer-events']).toBe('fill');expect(fill.attributes['data-id']).toBe(fillId);expect(clipsAt(fill)).toHaveLength(support.length);
 for(const clip of clipsAt(fill)){
  const id=clip.slice(5,-1),definition=all.find(e=>e.tag==='clipPath'&&e.attributes.id===id)!;expect(definition).toBeDefined();
  const inverse=all.find(e=>e.tag==='path'&&e.ancestors.includes(definition))!;
  expect(inverse.attributes['clip-rule']).toBe('evenodd');expect(inverse.attributes.d).toMatch(/^M .* H .* V .* H .* Z /);
 }
 expect(tagged(markup,'drawing-hit')).toHaveLength(d.curves.length);expect(tagged(markup,'drawing-ink')).toHaveLength(2);
});

test('a crossed variable-width run is diagnosed and omitted while its healthy sibling remains protected without changing ink',()=>{
 const fixture=loop(undefined,'crossed',[[0,0],[1,1],[0,1],[1,0]]);
 let d=reorderPaint(fixture.d,fixture.fillId,fixture.ids[0]);d=interval(d,fixture.ids[0],'SHOW',.02,.72);d=interval(d,fixture.ids[0],'SHOW',.82,.95);
 for(const range of d.displayIntervals![0].ranges)range.inkEnds=[{taper:.015},{taper:.015}];
 const original=JSON.stringify(d),ink=strokeInk(d,strokeFor(d,fixture.ids[0]),undefined,false,sampling()),inkBefore=JSON.stringify(ink),product=protectedInk(d),pass=product.passes[0];
 expect(product.passes).toHaveLength(1);expect(pass.runs).toHaveLength(2);expect(pass.runs.every(r=>!r.uniform)).toBe(true);expect(pass.runs).toEqual(ink);
 const [crossed,healthy]=pass.runs,unsupported={...pass,runs:[crossed]},supported={...pass,runs:[healthy]};
 expect(fillInkSupport(unsupported,sampling())).toEqual([]);expect(fillInkSupportDiagnostics(unsupported,sampling()).join(' ')).toMatch(/Self-intersecting boundary ink/);
 expect(fillInkSupportDiagnostics(supported,sampling())).toEqual([]);expect(fillInkSupport(supported,sampling())).toEqual([{kind:'outline',points:healthy.outline}]);
 expect(fillInkSupport(pass,sampling())).toEqual(fillInkSupport(supported,sampling()));expect(product.diagnostics).toEqual(fillInkSupportDiagnostics(pass,sampling()));
 const markup=svg(d);expect(protectedFills(markup)).toEqual([fixture.fillId]);expect(tagged(markup,'drawing-owned-ink-diagnostic')[0].attributes['data-message']).toContain('Self-intersecting');
 expect(tagged(markup,'drawing-ink').map(e=>e.attributes)).toEqual(tagged(svg(d,{showFills:false}),'drawing-ink').map(e=>e.attributes));
 expect(JSON.stringify(ink)).toBe(inkBefore);expect(JSON.stringify(d)).toBe(original);
});

test('quoted and bracketed source IDs stay data while generated SVG clip IDs use numeric slots',()=>{
 const fixture=loop(undefined,'owner"[0](#)<>&'),fillId='fill"[1](#)<>&';
 let d:Doc={...fixture.d,fills:fixture.d.fills.map(f=>({...f,id:fillId})),layers:fixture.d.layers.map(l=>({...l,items:l.items.map(id=>id===fixture.fillId?fillId:id)}))};
 d=reorderPaint(d,fillId,fixture.ids[0]);const before=JSON.stringify(d),markup=svg(d),all=elements(markup),fill=tagged(markup,'drawing-fill')[0];
 expect(ownerIds(protectedInk(d))).toEqual([...fixture.ids].sort());expect(fill.attributes['data-id']).toBe('fill&quot;[1](#)&lt;&gt;&amp;');expect(clipsAt(fill).length).toBeGreaterThan(0);
 const definitions=all.filter(e=>e.tag==='clipPath').map(e=>e.attributes.id);expect(new Set(definitions).size).toBe(definitions.length);
 for(const clip of clipsAt(fill)){const id=clip.slice(5,-1);expect(id).toMatch(/-own-\d+-\d+-\d+$/);expect(id).not.toMatch(/["\[\]()<>#&]/);expect(definitions).toContain(id);}
 expect(JSON.stringify(d)).toBe(before);
});
