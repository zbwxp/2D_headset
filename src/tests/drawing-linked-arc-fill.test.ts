import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,test} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,nodeAt,parseDrawing,type Cubic,type DrawingDocument as Doc,type FillRegion,type Point2} from '../domain/drawing/model';
import {fillGeometry,offsetGeometry,pathOf,displayInkSampling} from '../domain/drawing/appearance';
import {derivedUses,type DerivedUses} from '../domain/drawing/roundedJoin';
import {arcField,point} from '../domain/drawing/sampling';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {setEndpointLinkBrush} from '../domain/drawing/endpointRelationAuthoring';
import {createDisplayRouteField,deriveDisplayRouteCornerGeometry} from '../domain/drawing/displayRoutes';
import {displayRouteInk} from '../domain/drawing/displayRouteInk';
import {depthPaintBatches,setDepthOffset} from '../domain/drawing/depth';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../domain/drawing/affineDrawing';
import {applyAffine2D,type Affine2D} from '../domain/geometry/affine2d';
import {applyLayerCageDomain} from '../domain/recordingSnapshot/layerCageEvaluation';
import {neutralBend} from '../domain/deformation/coons';
import {createPaintProductReader} from '../ui/drawing/paintProducts';
import PaintScene from '../ui/drawing/PaintScene';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorEditingHost,type VectorResult} from '../app/vectorEditingApi';
import type {LandmarkProject} from '../domain/landmarks/model';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const flip=(shape:Cubic)=>[...shape].reverse() as Cubic;
const near=(a:Point2,b:Point2,tolerance=1e-8)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(tolerance);
const geometry=(d:Doc)=>d.fills.map(fill=>fillGeometry(d,fill));
const queue=(d:Doc)=>depthPaintBatches(d).map(batch=>({id:batch.owner??batch.item.id,layerId:batch.layerId,position:batch.position}));
const canonical=(shape:Cubic)=>[JSON.stringify(shape),JSON.stringify(flip(shape))].sort()[0];
const arcPieces=(g:DerivedUses)=>g.pieces.filter(piece=>piece.joinId?.startsWith('display'));
const closed=(g:DerivedUses)=>{
 expect(g.error).toBeUndefined();expect(g.shapes.length).toBeGreaterThan(0);
 g.shapes.forEach((shape,i)=>{expect(shape.flat().every(Number.isFinite)).toBe(true);near(shape[3],g.shapes[(i+1)%g.shapes.length][0]);});
};

/** Two independent, command-created closed faces, each with its own hidden
 * closure and its own chin node. No private artwork is needed for this contract. */
function twoFaces(options:{reverseA?:boolean;reverseB?:boolean;scale?:number;trim?:number}={}){
 let d=emptyDrawing();const scale=options.scale??1;
 for(const [name,side,reversed] of [['a',-1,!!options.reverseA],['b',1,!!options.reverseB]] as const){
  d=c.addLayer(d,name);const layer=d.layers[0].id,points:Point2[]=[[side*scale,scale],[0,0],[side*.2*scale,scale]];
  for(let i=0;i<3;i++){const shape=line(points[i],points[(i+1)%3]);d=c.createCurve(d,layer,reversed?flip(shape):shape,.008,name+i,name+i);}
  for(let i=0;i<3;i++)d=c.connect(d,{curveId:name+i,end:reversed?0:1},{curveId:name+((i+1)%3),end:reversed?1:0},'POSITION');
  d=paint.createFill(d,[name+'0',name+'1',name+'2'],'white');
  d=paint.setInk(d,[name+'1',name+'2'],{inkVisible:false});
 }
 const a={curveId:'a0',end:(options.reverseA?0:1) as 0|1},b={curveId:'b0',end:(options.reverseB?0:1) as 0|1};
 d=c.linkEndpoints(d,a,b);const linkId=d.endpointLinks![0].id;
 d={...d,displayIntervals:[{id:'chin-track',anchor:{id:'a0',reverse:!!options.reverseA},ranges:[{id:'inactive-cut',start:0,end:0,mode:'HIDE'}]}]};
 d=adoptDisplayRoute(d,'chin-track',linkId).document;
 const sharp=d;d=setEndpointLinkBrush(d,linkId,{kind:'ARC',trimDistance:options.trim??.2});
 return {d,sharp,linkId,a,b,route:d.displayIntervals![0].displayRoute!};
}

/** Return exact ownership-partitioned corners; do not reconstruct a biarc in
 * these tests. Independent circle/length checks below also guard the contract. */
function corners(d:Doc){return deriveDisplayRouteCornerGeometry(d,d.displayIntervals![0].displayRoute!);}
function assertOwnedHalf(d:Doc,fill:FillRegion){
 const g=fillGeometry(d,fill),corner=corners(d),owner=fill.boundary.find(use=>use.id==='a0'||use.id==='b0')!.id;
 closed(g);expect(corner.resolved.diagnostics).toEqual([]);expect(corner.brushes.links[0].resolved).toBe(true);
 const actual=arcPieces(g),expected=corner.geometry.pieces.filter(piece=>piece.joinId&&piece.inkOwner===owner);
 expect(actual.length).toBeGreaterThan(0);expect(actual.map(piece=>canonical(piece.shape)).sort()).toEqual(expected.map(piece=>canonical(piece.shape)).sort());
 expect(actual.every(piece=>piece.inkOwner===owner)).toBe(true);
 // The retained jaw matches the ink's trimmed source, while its neighbour is
 // derived onto the shared seam. No segment returns to the raw chin node.
 const jaw=g.pieces.find(piece=>!piece.joinId&&piece.owners[0]===owner)!;
 const routedJaw=corner.geometry.pieces.find(piece=>!piece.joinId&&piece.owners[0]===owner)!;
 expect(canonical(jaw.shape)).toBe(canonical(routedJaw.shape));
 expect(g.shapes.every(shape=>[shape[0],shape[3]].every(p=>Math.hypot(...p)>1e-7))).toBe(true);
 return g;
}

function apiHarness(d:Doc){
 let project:LandmarkProject={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const host:VectorEditingHost={getState:()=>({project,past,future}),getMode:()=> 'drawing',
  commitDrawing(drawing){past=[...past,project];future=[];project={...project,drawing};},
  undo(){const prior=past.at(-1);if(prior){future=[project,...future];past=past.slice(0,-1);project=prior;}},
  redo(){const next=future[0];if(next){past=[...past,project];future=future.slice(1);project=next;}},
 };
 return {api:createVectorEditingApi(host),state:()=>({project:project as LandmarkProject&{drawing:Doc},past,future})};
}
function value<T>(result:VectorResult<T>):T{expect(result.ok,result.ok?'':result.error.message).toBe(true);if(!result.ok)throw Error(result.error.message);return result.value;}
const screen=(p:Point2):Point2=>p.map(n=>Math.round(n*250000)/1000) as Point2;
function scene(d:Doc,preview=false,selectedPaint?:string){const noop=()=>{};return renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d,screen,unit:250,pixelsPerUnit:250,preview,showFills:true,referenceMoving:false,tool:'select',selectedPaint,curveDown:noop,paintDown:noop,arcDown:noop})));}
function elements(svg:string){return [...svg.matchAll(/<([A-Za-z][\w:-]*)([^>]*)>/g)].map(match=>({tag:match[1],attributes:Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]))}));}
const tagged=(svg:string,name:string)=>elements(svg).filter(element=>element.attributes['data-testid']===name);

describe('adopted linked ARC fill boundaries',()=>{
 test('each face meets at the existing ARC arc-length midpoint with complete, nonduplicated arc coverage',()=>{
  const {d,a,b}=twoFaces(),before=JSON.stringify(d),corner=corners(d),fills=d.fills.map(fill=>assertOwnedHalf(d,fill));
  expect(nodeAt(d,a).id).not.toBe(nodeAt(d,b).id);expect(d.joins).toEqual([]);
  const bridge=corner.geometry.pieces.filter(piece=>piece.joinId),left=bridge.filter(piece=>piece.inkOwner==='a0'),right=bridge.filter(piece=>piece.inkOwner==='b0');
  expect(fills.flatMap(arcPieces).map(piece=>canonical(piece.shape)).sort()).toEqual(bridge.map(piece=>canonical(piece.shape)).sort());
  expect(arcField(left.map(piece=>piece.shape)).total).toBeCloseTo(arcField(right.map(piece=>piece.shape)).total,9);
  for(let i=1;i<bridge.length;i++)near(bridge[i-1].shape[3],bridge[i].shape[0]);
  const seam=arcField(bridge.map(piece=>piece.shape)).at(.5).p;near(seam,[0,.2*(Math.SQRT2-1)],1e-7);
  for(const g of fills){const closure=g.pieces.find(piece=>!piece.joinId&&piece.owners.some(id=>id==='a1'||id==='b1'))!;expect([closure.shape[0],closure.shape[3]].some(p=>Math.hypot(p[0]-seam[0],p[1]-seam[1])<1e-8)).toBe(true);}
  for(const piece of bridge)for(let i=0;i<=32;i++){const p=point(piece.shape,i/32);expect(Math.abs(Math.hypot(p[0],p[1]-.2*Math.SQRT2)-.2)).toBeLessThan(.00006);}
  expect(JSON.stringify(d)).toBe(before);expect(parseDrawing(JSON.parse(before))).toEqual(d);
 });

 test.each([[false,false],[false,true],[true,false],[true,true]])('source endpoint directions %s / %s and reversed/rotated fill uses preserve ownership', (reverseA,reverseB)=>{
  const {d}=twoFaces({reverseA,reverseB});for(const fill of d.fills){
   const base=assertOwnedHalf(d,fill);
   for(const reverse of [false,true])for(let rotate=0;rotate<fill.boundary.length;rotate++){
    const uses=reverse?[...fill.boundary].reverse().map(use=>({...use,reverse:!use.reverse})):fill.boundary;
    const changed={...fill,boundary:[...uses.slice(rotate),...uses.slice(0,rotate)]},g=assertOwnedHalf(d,changed);
    expect(g.shapes.map(canonical).sort()).toEqual(base.shapes.map(canonical).sort());
   }
  }
 });

 test('independent fills sharing one face boundary reuse their half without changing fill identity or depth',()=>{
  const fixture=twoFaces();let d=paint.createFill(fixture.d,['a0','a1','a2'],'black');d=paint.createFill(d,['b0','b1','b2'],'transparent');
  const before=JSON.stringify(d),order=queue(d),fills=d.fills.map(fill=>assertOwnedHalf(d,fill));
  expect(fills[2]).toEqual(fills[0]);expect(fills[3]).toEqual(fills[1]);expect(d.fills.map(fill=>fill.color)).toEqual(['white','white','black','transparent']);
  expect(queue(d)).toEqual(order);expect(JSON.stringify(d)).toBe(before);
 });

 test('fill derivation ignores hidden jaw ink, SHOW zero, full HIDE and hidden closures',()=>{
  const {d}=twoFaces(),expected=geometry(d),variants:Doc[]=[
   paint.setInk(d,['a0'],{inkVisible:false}),paint.setInk(d,['a0','b0'],{inkVisible:false}),paint.setInk(d,['a1','a2','b1','b2'],{inkVisible:true}),
   {...d,displayIntervals:d.displayIntervals!.map(track=>({...track,ranges:[{id:'zero',mode:'SHOW',start:.4,end:.4}]}))},
   {...d,displayIntervals:d.displayIntervals!.map(track=>({...track,ranges:[{id:'all-hidden',mode:'HIDE',start:0,end:1}]}))},
  ];
  for(const variant of variants){expect(geometry(variant)).toEqual(expected);expect(parseDrawing(JSON.parse(JSON.stringify(variant)))).toEqual(variant);}
  for(const variant of variants.slice(-2))expect([...displayRouteInk(variant,variant.displayIntervals![0].displayRoute!,new Map()).runs.values()].flat()).toEqual([]);
 });

 test('unadopted, disabled and SHARP links leave both source fill boundaries unchanged',()=>{
  const {d,sharp,route}=twoFaces(),unadopted={...d,displayIntervals:d.displayIntervals!.map(({displayRoute:_,...track})=>track)},disabled={...d,endpointLinks:d.endpointLinks!.map(link=>({...link,throughDisplay:false}))};
  expect(createDisplayRouteField(unadopted,route).geometry.pieces.some(piece=>piece.joinId)).toBe(true);
  for(const inactive of [unadopted,disabled,sharp])for(const fill of inactive.fills)expect(fillGeometry(inactive,fill)).toEqual(derivedUses(inactive,fill.boundary,true));
 });

 test('long requested trims clamp to available jaw length and still close at one seam',()=>{
  const {d}=twoFaces({scale:.08,trim:.8}),before=JSON.stringify(d),corner=corners(d),brush=corner.brushes.links[0];
  expect(brush.resolved).toBe(true);expect(brush.geometry!.clamped).toBe(true);expect(brush.geometry!.distance).toBeLessThan(.08*Math.SQRT2);
  expect(corner.brushes.diagnostics.some(diagnostic=>diagnostic.code==='ARC_CLAMPED')).toBe(true);
  for(const fill of d.fills)assertOwnedHalf(d,fill);expect(d.endpointLinks![0].joinBrush).toEqual({kind:'ARC',trimDistance:.8});expect(JSON.stringify(d)).toBe(before);
 });

 test('a zero raw endpoint handle with valid trimmed tangents still derives both filled halves',()=>{
  const {d,a}=twoFaces(),next=c.moveHandle(d,a,nodeAt(d,a).position),corner=corners(next);
  expect(corner.brushes.links[0].resolved).toBe(true);expect(corner.brushes.diagnostics.some(diagnostic=>diagnostic.code==='ARC_FAILED')).toBe(false);
  for(const fill of next.fills)assertOwnedHalf(next,fill);
 });

 test('actually collapsed selected ARC keeps original finite fills and reports failure through existing route diagnostics',()=>{
  const {d}=twoFaces(),collapsed=structuredClone(d),jaw=collapsed.curves.find(curve=>curve.id==='a0')!;
  for(const id of jaw.nodes)collapsed.nodes.find(node=>node.id===id)!.position=[0,0];jaw.handles=[[0,0],[0,0]];
  const before=JSON.stringify(collapsed),corner=corners(collapsed);expect(corner.brushes.diagnostics.some(diagnostic=>diagnostic.code==='ARC_FAILED')).toBe(true);
  for(const fill of collapsed.fills){const g=fillGeometry(collapsed,fill);expect(g).toEqual(derivedUses(collapsed,fill.boundary,true));closed(g);}
  expect(tagged(scene(collapsed),'drawing-fill')).toHaveLength(2);expect(tagged(scene(collapsed),'drawing-route-error').length).toBeGreaterThan(0);
  expect(JSON.stringify(collapsed)).toBe(before);
 });

 test('same-node local ARC fill behavior remains unchanged without any adopted link',()=>{
  const {sharp}=twoFaces(),source={...sharp,displayIntervals:undefined,endpointLinks:undefined},d=c.connect(source,{curveId:'a0',end:1},{curveId:'a1',end:0},'ARC',.12);
  for(const fill of d.fills){const g=fillGeometry(d,fill);expect(g).toEqual(derivedUses(d,fill.boundary,true));closed(g);}
  expect(fillGeometry(d,d.fills[0]).pieces.some(piece=>piece.joinId)).toBe(true);
 });

 test('selected cross-endpoint ARC displaces the old local corner but preserves unrelated same-node ARC joins',()=>{
  const {d,sharp,linkId}=twoFaces(),source={...sharp,endpointLinks:sharp.endpointLinks!.map(link=>({...link,throughDisplay:false})),displayIntervals:sharp.displayIntervals!.map(({displayRoute:_,...track})=>track)};
  const withLocalArcs=(extra:boolean)=>{
   let local=c.connect(source,{curveId:'a0',end:1},{curveId:'a1',end:0},'ARC',.06);const displaced=local.joins[0].id;
   if(extra)local=c.connect(local,{curveId:'a1',end:1},{curveId:'a2',end:0},'ARC',.04);
   local=adoptDisplayRoute(local,'chin-track',linkId).document;return {local:setEndpointLinkBrush(local,linkId,{kind:'ARC',trimDistance:.2}),displaced};
  };
  const first=withLocalArcs(false);expect(corners(first.local).resolved.displacedJoinIds).toContain(first.displaced);expect(geometry(first.local)).toEqual(geometry(d));expect(first.local.joins.some(join=>join.id===first.displaced)).toBe(true);
  const {local,displaced}=withLocalArcs(true),retained=local.joins.find(join=>join.id!==displaced)!.id,g=fillGeometry(local,local.fills[0]);closed(g);
  expect(g.pieces.some(piece=>piece.joinId===retained)).toBe(true);expect(g.pieces.some(piece=>piece.joinId===displaced)).toBe(false);expect(arcPieces(g).length).toBeGreaterThan(0);
 });

 test.each([
  ['mirror',[-1,0,0,1,.3,-.1]],
  ['nonuniform affine',[1.8,.2,.35,.6,.3,-.1]],
 ] as const)('%s projects existing arc material and seam rather than refitting a world-space circle',(_label,matrix)=>{
  const {d}=twoFaces(),before=JSON.stringify(d),base=geometry(d),affine=[...matrix] as Affine2D,placed=placeDrawingAffines(d,{all:affine},()=> 'all');
  const projected=geometry(placed);projected.forEach((g,index)=>{closed(g);expect(g.shapes).toHaveLength(base[index].shapes.length);g.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyAffine2D(affine,base[index].shapes[i][j]))));});
  const cornersBefore=corners(d).geometry.pieces.filter(piece=>piece.joinId),cornersAfter=corners(placed).geometry.pieces.filter(piece=>piece.joinId);
  expect(cornersAfter.map(piece=>piece.inkOwner)).toEqual(cornersBefore.map(piece=>piece.inkOwner));
  expect(placed.fills).toEqual(d.fills);expect(placed.curves.map(curve=>[curve.id,curve.width])).toEqual(d.curves.map(curve=>[curve.id,curve.width]));expect(JSON.stringify(d)).toBe(before);
 });

 test('retained nonlinear material projection reuses exact ink arc halves and closes both faces on the projected seam',()=>{
  const {d}=twoFaces(),before=JSON.stringify(d),bend=neutralBend();bend.handles[1][0][0]=1.2;bend.handles[1][1][0]=1.1;
  const placed=applyLayerCageDomain(d,{id:'both-faces',kind:'h-coons',layerIds:d.layers.map(layer=>layer.id),restRect:{min:[-1.5,-.5],max:[1.5,1.5]},quad:[[-1.5,-.5],[1.8,-.3],[1.3,1.6],[-1.2,1.4]],bend});
  const corner=corners(placed),bridge=corner.geometry.pieces.filter(piece=>piece.joinId),halves=placed.fills.map(fill=>assertOwnedHalf(placed,fill));
  expect(halves.flatMap(arcPieces).map(piece=>canonical(piece.shape)).sort()).toEqual(bridge.map(piece=>canonical(piece.shape)).sort());
  expect(halves.map(g=>g.shapes)).not.toEqual(geometry(d).map(g=>g.shapes));expect(placed.fills).toEqual(d.fills);expect(JSON.stringify(d)).toBe(before);
 });

 test('incompatible retained layer programs preserve finite original fill geometry with explicit diagnostics',()=>{
  const {d}=twoFaces(),owners=drawingLayerObjectOwners(d),leftLayer=owners.get('a0')!,placed=placeDrawingAffines(d,{left:[1,.2,.1,1,0,0]},id=>owners.get(id)===leftLayer?'left':undefined);
  for(const fill of placed.fills){const g=fillGeometry(placed,fill),original=derivedUses(placed,fill.boundary,true);closed(g);expect(g.shapes).toEqual(original.shapes);expect(g.diagnostics?.join(' ')).toMatch(/incompatible/i);}
 });

 test('warm paint readers observe changes to the foreign jaw, link brush and adoption state',()=>{
  const {d}=twoFaces(),read=(doc:Doc)=>createPaintProductReader(doc,displayInkSampling(250)).fill(doc.fills[0]),first=read(d),jaw=d.curves.find(curve=>curve.id==='b0')!;
  jaw.handles[1][0]+=.1;const changed=read(d);expect(changed.shapes).not.toEqual(first.shapes);expect(changed).toEqual(read(parseDrawing(JSON.parse(JSON.stringify(d)))));
  d.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.3};const wider=read(d);expect(wider.shapes).not.toEqual(changed.shapes);expect(wider).toEqual(read(parseDrawing(JSON.parse(JSON.stringify(d)))));
  d.endpointLinks![0].throughDisplay=false;expect(read(d)).toEqual(derivedUses(d,d.fills[0].boundary,true));
 });

 test('renderer, fill picking and exported SVG use the same rounded fill path',()=>{
  const {d}=twoFaces(),before=JSON.stringify(d),interactive=scene(d),preview=scene(d,true),reader=createPaintProductReader(d,displayInkSampling(250));
  for(const fill of d.fills){const expected=fillGeometry(d,fill),path=pathOf(expected.shapes,screen,true),pick=tagged(interactive,'drawing-fill').find(element=>element.attributes['data-id']===fill.id)!,exported=tagged(preview,'drawing-fill').find(element=>element.attributes['data-id']===fill.id)!;
   expect(reader.fill(fill)).toEqual(expected);expect(pick.attributes.d).toBe(path);expect(pick.attributes['pointer-events']).toBe('fill');expect(exported.attributes.d).toBe(path);expect(exported.attributes['pointer-events']).toBe('none');
  }
  const h=apiHarness(d),svg=value(h.api.preview({showFills:true,width:500,height:500,center:[0,0],pixelsPerUnit:250})).svg;
  for(const fill of d.fills){const exported=tagged(svg,'drawing-fill').find(element=>element.attributes['data-id']===fill.id)!;expect(exported.attributes.d).toBe(pathOf(fillGeometry(d,fill).shapes,p=>[Math.round((250+p[0]*250)*1000)/1000,Math.round((250-p[1]*250)*1000)/1000],true));}
  expect(JSON.stringify(d)).toBe(before);expect(h.state().past).toEqual([]);
 });

 test('own-ink protection, transparent cutouts and offsets retain their separate owners and original paint order',()=>{
  const fixture=twoFaces();let d=c.createCurve(fixture.d,fixture.d.layers[0].id,line([1.5,0],[1.5,1]),.012,'Independent offset source','offset-source');d=paint.createOffset(d,'offset-source');const offset=d.offsets[0],offsetBefore=offsetGeometry(d,offset);expect(offsetBefore.error).toBeUndefined();
  d=setDepthOffset(d,d.fills[0].id,1,'LAYER');d=paint.createFill(d,['a0','a1','a2'],'transparent');const cutout=d.fills.at(-1)!,before=JSON.stringify(d),order=queue(d),reader=createPaintProductReader(d,displayInkSampling(250));
  const protection=reader.fillBoundaryInk(d.fills[0]);expect(protection.diagnostics).toEqual([]);expect(protection.passes.length).toBeGreaterThan(0);
  expect([...new Set(protection.passes.flatMap(pass=>pass.ownerIds))]).toEqual(['a0']);expect(reader.fillBoundaryInk(cutout)).toEqual({passes:[],diagnostics:[]});
  expect(reader.fill(cutout)).toEqual(reader.fill(d.fills[0]));expect(reader.offset(offset)).toEqual(offsetBefore);
  const svg=scene(d,false,cutout.id),cutPath=pathOf(fillGeometry(d,cutout).shapes,screen,true);expect(tagged(svg,'drawing-owned-ink-clip').length).toBeGreaterThan(0);expect(tagged(svg,'drawing-cutout')).toHaveLength(1);
  expect(elements(svg).some(element=>element.tag==='path'&&element.attributes['clip-rule']==='evenodd'&&element.attributes.d.endsWith(cutPath))).toBe(true);
  expect(tagged(svg,'drawing-offset')).toHaveLength(1);expect(queue(d)).toEqual(order);expect(JSON.stringify(d)).toBe(before);
 });

 test('API ARC edit, undo and redo change only saved brush/interval authoring and replay identical derived fills',()=>{
  const {d,linkId}=twoFaces(),source=structuredClone(d),h=apiHarness(d),first=geometry(d),order=queue(d),result=value(h.api.execute({commands:[{op:'setLinkJoinBrush',linkId,brush:{kind:'ARC',trimDistance:.3}}]}));
  expect(result.applied).toBe(true);expect(h.state().past).toHaveLength(1);const edited=h.state().project.drawing,second=geometry(edited);expect(second).not.toEqual(first);
  for(const field of ['nodes','curves','joins','fills','layers','offsets'] as const)expect(edited[field]).toEqual(source[field]);
  expect(queue(edited)).toEqual(order);expect(parseDrawing(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
  value(h.api.undo());expect(h.state().project.drawing).toEqual(source);expect(geometry(h.state().project.drawing)).toEqual(first);
  value(h.api.redo());expect(geometry(h.state().project.drawing)).toEqual(second);expect(d).toEqual(source);
 });
});
