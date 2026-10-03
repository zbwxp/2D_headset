import {expect,test} from 'vitest';
import * as commands from '../../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type Point2} from '../../domain/drawing/model';
import {createCageGeometryProjector} from '../../domain/drawing/cageGeometry';
import {curveSamples,tagCurve} from '../../domain/drawing/curveProvenance';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {createDisplayRouteField,captureRouteCoverage,remapRouteCoverage,projectRouteSpansToPieces,type DisplayRoute} from '../../domain/drawing/displayRoutes';
import {derivedUses,roundedJoins} from '../../domain/drawing/roundedJoin';
import {point} from '../../domain/drawing/sampling';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../../domain/drawing/affineDrawing';
import {createFill,createOffset} from '../../domain/drawing/paintCommands';
import {neutralBend} from '../../domain/deformation/coons';
import {fitDeformedCubic,mappedParameter,sourceParameter} from '../../domain/deformation/cubicDeformation';
import {evaluateLayerCageDomain} from '../../domain/recordingSnapshot/layerCageEvaluation';
import {layerCageDomainProjection,type SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';
import type {Affine2D} from '../../domain/geometry/affine2d';

const shape:Cubic=[[-.8,-.5],[-.6,.4],[.3,-.2],[.7,.6]];
const near=(a:Point2,b:Point2,tolerance=1e-9)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(tolerance);
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function domain(layerIds:string[]):SnapshotLayerCageDomain{
 const bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.2;bend.handles[0][1][1]=-.1;
 return {kind:'h-coons',id:'cage',layerIds,restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.85,-.8],[.5,1],[-.9,.8]],bend};
}
function standalone(){let d=commands.addLayer(emptyDrawing(),'Source');const layer=d.layers[0].id;d=commands.createCurve(d,layer,shape,.013,'A','a');return {d,layer};}
function routeFixture(){
 let d=commands.addLayer(emptyDrawing(),'A');d=commands.createCurve(d,d.layers[0].id,line([-.8,0],[0,0]),.013,'A','a');
 d=commands.addLayer(d,'B');d=commands.createCurve(d,d.layers[0].id,line([0,0],[0,.8]),.013,'B','b');
 d=commands.linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});const link=d.endpointLinks![0].id;
 d={...d,endpointLinks:d.endpointLinks!.map(value=>({...value,throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.2}}))};
 const route:DisplayRoute={seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:[link]};
 return {d,route};
}
function frozen<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))frozen(child);}return value;}
function sameMaterial(a:ReturnType<typeof captureRouteCoverage>,b:ReturnType<typeof captureRouteCoverage>){
 expect(b).toHaveLength(a.length);a.forEach((span,i)=>{
  for(const end of ['from','to'] as const){const x=span[end],y=b[i][end];expect(y.kind).toBe(x.kind);if(x.kind==='curve'&&y.kind==='curve'){expect(y.curveId).toBe(x.curveId);expect(y.t).toBeCloseTo(x.t,11);}else if(x.kind==='join'&&y.kind==='join'){expect(y.joinId).toBe(x.joinId);expect(y.s).toBeCloseTo(x.s,11);}}
  expect(b[i].ends).toEqual(span.ends);expect(b[i].continuesBefore).toBe(span.continuesBefore);expect(b[i].continuesAfter).toBe(span.continuesAfter);
 });
}

test('a fixed authored cage evaluates current members including later additions and hidden locked curves',()=>{
 const {d,layer}=standalone(),cage=frozen(domain([layer])),snapshot=JSON.stringify(d),first=evaluateLayerCageDomain(d,cage);
 let later=commands.createCurve(d,layer,[[.3,-.7],[.4,-.2],[.6,.4],[.8,.5]],.02,'Later','later');later={...later,curves:later.curves.map(c=>({...c,visible:false,locked:true}))};
 const next=evaluateLayerCageDomain(later,cage),field=layerCageDomainProjection(cage);
 expect(shapeOf(next.controlDrawing,'a')).toEqual(shapeOf(first.controlDrawing,'a'));
 expect(next.curveIds).toEqual(new Set(['a','later']));expect(shapeOf(next.controlDrawing,'later')).toEqual(fitDeformedCubic(shapeOf(later,'later'),field).shape);
 expect(next.controlDrawing.curves.map(c=>[c.width,c.visible,c.locked])).toEqual(later.curves.map(c=>[c.width,c.visible,c.locked]));
 expect(JSON.stringify(d)).toBe(snapshot);expect(cage.restRect).toEqual({min:[-1,-1],max:[1,1]});
 const empty={...d,curves:[],nodes:[],layers:d.layers.map(l=>({...l,items:[]}))};expect(evaluateLayerCageDomain(empty,cage).controlDrawing).toBe(empty);
 expect(evaluateLayerCageDomain(d,cage).controlDrawing).toEqual(first.controlDrawing);
});

test('disabled domains recover their exact input and replacement evaluations do not accumulate fitting',()=>{
 const {d,layer}=standalone(),cage=domain([layer]),first=evaluateLayerCageDomain(d,cage),changed=structuredClone(cage);changed.quad[2][0]+=.1;
 evaluateLayerCageDomain(d,changed);expect(evaluateLayerCageDomain(d,cage).controlDrawing).toEqual(first.controlDrawing);
 expect(evaluateLayerCageDomain(d,{...cage,enabled:false}).controlDrawing).toBe(d);
 expect(first.maxError).toBeGreaterThan(0);expect(first.diagnostics.some(value=>value.exceedsTolerance)).toBe(true);
});

test('linked endpoint scope is checked while unrelated layers and paint metadata do not lock a cage',()=>{
 const {d,route}=routeFixture(),firstLayer=d.layers.find(l=>l.items.includes('a'))!.id;
 expect(()=>evaluateLayerCageDomain(d,domain([firstLayer]))).toThrow(/endpoint link/);
 expect(()=>evaluateLayerCageDomain(d,domain(d.layers.map(l=>l.id)))).not.toThrow();
 const {d:plain,layer}=standalone(),added=commands.ellipse(plain,layer,[-.5,-.4],[.5,.4],.013),withPaint=createOffset(createFill(added.document,added.ids,'white'),'a');
 const painted=evaluateLayerCageDomain(withPaint,domain([layer]));expect(painted.controlDrawing.fills).toBe(withPaint.fills);expect(painted.controlDrawing.offsets).toBe(withPaint.offsets);
 expect(createDisplayRouteField(d,route).diagnostics).toEqual([]);
});

test('true source ARC pieces are fitted with their original owners and trims, not rebuilt from output handles',()=>{
 let d=commands.addLayer(emptyDrawing(),'ARC');const layer=d.layers[0].id;
 d=commands.createCurve(d,layer,line([-.8,0],[0,0]),.013,'A','a');d=commands.createCurve(d,layer,line([0,0],[0,.8]),.013,'B','b');
 d=commands.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 const cage=domain([layer]),stage=evaluateLayerCageDomain(frozen(d),cage),input=derivedUses(d,[{id:'a',reverse:false},{id:'b',reverse:false}]),result=stage.projectGeometry(input),field=layerCageDomainProjection(cage);
 expect(input.pieces.some(p=>p.joinId)).toBe(true);
 input.pieces.forEach((piece,i)=>{const {shape:old,...metadata}=piece,{shape:actual,...nextMetadata}=result.geometry.pieces[i];expect(nextMetadata).toEqual(metadata);expect(actual).toEqual(fitDeformedCubic(old,field).shape);
  for(const t of [.17,.5,.83])expect(curveSamples(actual,mappedParameter(t,result.fits[i]!.parameters))).toEqual(curveSamples(old,t));
 });
 const rebuilt=roundedJoins(stage.controlDrawing).get(d.joins[0].id)!.shapes,projected=result.geometry.pieces.filter(p=>p.joinId).map(p=>p.shape);
 expect(rebuilt).not.toEqual(projected);expect(result.diagnostics.some(value=>value.joinId)).toBe(true);
 for(let i=1;i<result.geometry.shapes.length;i++)near(result.geometry.shapes[i-1][3],result.geometry.shapes[i][0]);
});

test('route material stays in the original frame while cuts and tangents follow the fitted geometry',()=>{
 const {d,route}=routeFixture(),cage=domain(d.layers.map(l=>l.id)),source=createDisplayRouteField(d,route),stage=evaluateLayerCageDomain(d,cage),projected=stage.projectMaterialField(source),out=projected.field;
 expect(out.total).toBe(source.total);expect(out.parts.map(p=>[p.start,p.length])).toEqual(source.parts.map(p=>[p.start,p.length]));
 expect(out.geometry.pieces.map(({shape,...metadata})=>metadata)).toEqual(source.geometry.pieces.map(({shape,...metadata})=>metadata));
 for(const s of [.03,.2,.45,.51,.67,.92]){
  const old=source.at(s),index=source.parts.findIndex(part=>s*source.total<=part.start+part.length),fit=projected.fits[index]!,actual=out.at(s),t=mappedParameter(old.t,fit.parameters);
  near(actual.p,point(fit.shape,t));expect(actual.t).toBe(t);expect(Math.hypot(...actual.tangent)).toBeCloseTo(1,12);
 }
 const spans=[{start:.17,end:.86,ends:[{taper:.017},{extension:.023}]}] as Parameters<typeof captureRouteCoverage>[1];
 sameMaterial(captureRouteCoverage(source,spans),captureRouteCoverage(out,spans));
 expect(remapRouteCoverage(captureRouteCoverage(source,spans),out).unmapped).toEqual([]);
 const ink=projectRouteSpansToPieces(out,spans);near(ink[0].shape[0],out.at(.17).p);near(ink.at(-1)!.shape[3],out.at(.86).p);
 expect(out.brushes.links[0].geometry!.distance).toBe(source.brushes.links[0].geometry!.distance);
 expect(out.brushes.links[0].geometry!.shapes).not.toEqual(source.brushes.links[0].geometry!.shapes);
});

test('every transported material table includes the fit-map knots and returns reversible source parameters',()=>{
 const {d,layer}=standalone(),stage=evaluateLayerCageDomain(d,domain([layer])),before=displayField(d,displayPath(d,'a')),projected=stage.projectMaterialField(before),part=projected.field.parts[0],fit=projected.fits[0]!;
 for(let i=0;i<=100;i++){const t=i/100,u=mappedParameter(t,fit.parameters);expect(sourceParameter(u,fit.parameters)).toBeCloseTo(t,12);}
 const render=part.renderSamples({tolerance:.000001,maxStep:1/64});expect(render.length).toBeGreaterThan(128);
 expect(render.every(p=>p.distance>=0&&p.distance<=part.length+1e-12)).toBe(true);
 for(const p of render){near(p.p,point(part.shape,p.t));expect(p.t).toBeGreaterThanOrEqual(0);expect(p.t).toBeLessThanOrEqual(1);}
 const coarse=part.renderSamples({tolerance:.01,maxStep:.5});expect(render.length).toBeGreaterThanOrEqual(coarse.length);
});

test('nonlinear material projection composes after an affine including reflection and exact zero without inverse',()=>{
 const {d,route}=routeFixture(),owners=drawingLayerObjectOwners(d),cage=domain(d.layers.map(l=>l.id)),source=createDisplayRouteField(d,route);
 for(const matrix of [[1.3,0,.2,.7,0,0],[-1,0,0,1,0,0],[0,0,0,0,0,0]] as Affine2D[]){
  const affine=placeDrawingAffines(d,Object.fromEntries(d.layers.map(l=>[l.id,matrix])),id=>owners.get(id)),before=createDisplayRouteField(affine,route),stage=evaluateLayerCageDomain(affine,cage),result=stage.projectMaterialField(before);
  expect(result.field.total).toBe(source.total);expect(result.field.geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);
  for(const s of [.2,.5,.8])expect(result.field.positionOf(source.materialAt(s)!)).toBeCloseTo(s,12);
 }
});

test('successive cage stages retain route material identities and preserve operation order',()=>{
 const {d,route}=routeFixture(),first=domain(d.layers.map(l=>l.id)),second=structuredClone(first);second.id='later';second.quad=second.quad.map(([x,y])=>[x*.9+.08,y*1.1]) as typeof second.quad;second.bend!.handles[2][0][1]+=.08;
 const a=evaluateLayerCageDomain(d,first),b=evaluateLayerCageDomain(a.controlDrawing,second),input=createDisplayRouteField(d,route),afterA=a.projectMaterialField(input).field,afterB=b.projectMaterialField(afterA).field;
 const reverseA=evaluateLayerCageDomain(d,second),reverseB=evaluateLayerCageDomain(reverseA.controlDrawing,first);
 expect(b.controlDrawing).not.toEqual(reverseB.controlDrawing);expect(afterB.total).toBe(input.total);
 const span=[{start:.19,end:.87,ends:[{},{}]}] as Parameters<typeof captureRouteCoverage>[1];sameMaterial(captureRouteCoverage(input,span),captureRouteCoverage(afterB,span));
});

test('numeric fitting cache does not merge distinct source identities with identical geometry',()=>{
 const cage=domain(['layer']),field=layerCageDomainProjection(cage),projector=createCageGeometryProjector(field,new Set(['a','b']));
 const a=projector.fit(tagCurve(structuredClone(shape),'a')),b=projector.fit(tagCurve(structuredClone(shape),'b'));
 expect(a.shape).toEqual(b.shape);expect(a.shape).not.toBe(b.shape);
 for(const t of [.1,.5,.9]){expect(curveSamples(a.shape,mappedParameter(t,a.parameters))[0].id).toBe('a');expect(curveSamples(b.shape,mappedParameter(t,b.parameters))[0].id).toBe('b');}
});

test('material projection rejects only an actually incompatible derived piece rather than unrelated geometry',()=>{
 const {d,route}=routeFixture(),field=createDisplayRouteField(d,route),projector=createCageGeometryProjector(layerCageDomainProjection(domain(d.layers.map(l=>l.id))),new Set(['a']));
 expect(()=>projector.projectMaterialField(field)).toThrow(/incompatible cage scopes/);
 const plain={shapes:[shape],pieces:[{shape,owners:['unrelated']}]};expect(projector.projectGeometry(plain).geometry.pieces[0]).toBe(plain.pieces[0]);
 const malformed={...field,diagnostics:[{code:'GEOMETRY' as const,message:'test invalid route'}]};expect(()=>projector.projectMaterialField(malformed)).toThrow('test invalid route');
});


test('a cage preserves an existing true-zero SMOOTH collapse without requiring an inverse',()=>{
 let d=commands.addLayer(emptyDrawing(),'Smooth');const layer=d.layers[0].id;
 d=commands.createCurve(d,layer,line([-.8,0],[0,0]),.013,'A','a');d=commands.createCurve(d,layer,line([0,0],[.8,0]),.013,'B','b');
 d=commands.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');
 const owners=drawingLayerObjectOwners(d),collapsed=placeDrawingAffines(d,{[layer]:[0,0,0,0,0,0]},id=>owners.get(id)),cage=domain([layer]),result=evaluateLayerCageDomain(collapsed,cage),expected=layerCageDomainProjection(cage).map([0,0]);
 for(const curve of result.controlDrawing.curves)for(const p of shapeOf(result.controlDrawing,curve.id))near(p,expected);
 expect(result.controlDrawing.joins).toEqual(d.joins);
 expect(evaluateLayerCageDomain(d,cage).controlDrawing.curves).not.toEqual(result.controlDrawing.curves);
});


test('an identity cage preserves linked endpoints inside the existing Drawing tolerance',()=>{
 const {d}=routeFixture(),node=d.curves.find(curve=>curve.id==='b')!.nodes[0],nearLinked={...d,nodes:d.nodes.map(n=>n.id===node?{...n,position:[5e-8,0] as Point2}:n)};
 expect(()=>parseDrawing(nearLinked)).not.toThrow();
 const cage=domain(d.layers.map(l=>l.id));cage.quad=[[-1,-1],[1,-1],[1,1],[-1,1]];delete cage.bend;
 expect(()=>evaluateLayerCageDomain(nearLinked,cage)).not.toThrow();
});
