import {expect,test} from 'vitest';
import type {DeformProjection} from '../domain/deformation/cageField';
import {mappedParameter,sourceParameter} from '../domain/deformation/cubicDeformation';
import {createCageGeometryProjector,type FittedGeometry} from '../domain/drawing/cageGeometry';
import {cageSplitShapeRange,createCageSplitProjector,retainCageSplitShapeRange,type CageSplitLineage} from '../domain/drawing/cageSplitProjector';
import {copyCurveSource,curveSamples,tagCurve} from '../domain/drawing/curveProvenance';
import type {Cubic,Point2} from '../domain/drawing/model';
import {subcurve} from '../domain/drawing/roundedJoin';
import {point} from '../domain/drawing/sampling';

const field:DeformProjection={map:([x,y])=>[x+.22*y*y,y+.18*x*x],vector:([x,y],[dx,dy])=>[dx+.44*y*dy,dy+.36*x*dx],denominator:()=>1,affine:false};
const root:Cubic=[[-.8,-.5],[-.6,.4],[.3,-.2],[.7,.6]];
const near=(a:Point2,b:Point2)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(1e-9);
const sameShape=(actual:Cubic,wanted:Cubic)=>actual.forEach((point,i)=>near(point,wanted[i]));
function fixture(cuts=[0,.373,1]){
 const lineage:CageSplitLineage={id:'parent',parts:cuts.slice(1).map((hi,i)=>({curveId:`child-${i}`,parameterRange:[cuts[i],hi]}))},ids=new Set(lineage.parts.map(part=>part.curveId));
 const pieces=lineage.parts.map(part=>({owners:[part.curveId],shape:tagCurve(subcurve(root,...part.parameterRange).map(point=>[...point]) as Cubic,part.curveId)}));
 const geometry:FittedGeometry={pieces,shapes:pieces.map(piece=>piece.shape)},base=createCageGeometryProjector(field,ids),projector=createCageSplitProjector(base,[lineage]);
 return {lineage,ids,geometry,base,projector};
}
function tangency(shapes:Cubic[]){for(let i=1;i<shapes.length;i++){const a=shapes[i-1],b=shapes[i];near(a[3],b[0]);const u=[a[3][0]-a[2][0],a[3][1]-a[2][1]],v=[b[1][0]-b[0][0],b[1][1]-b[0][1]];expect((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v))).toBeGreaterThan(1-1e-10);}}

test('coherent children share one parent fit and exact mapped split, provenance and G1 seam',()=>{
 const {lineage,geometry,base}=fixture();let calls=0;
 const projector=createCageSplitProjector({...base,fit:shape=>{calls++;return base.fit(shape);}},[lineage]),output=projector.projectGeometry(geometry),parent=base.fit(root);
 expect(calls).toBe(1);tangency(output.geometry.shapes);
 for(const [i,part] of lineage.parts.entries()){
  const fit=output.fits[i]!,[lo,hi]=part.parameterRange,qlo=mappedParameter(lo,parent.parameters),qhi=mappedParameter(hi,parent.parameters);
  sameShape(fit.shape,subcurve(parent.shape,qlo,qhi));
  expect(cageSplitShapeRange(fit.shape)?.id).toBe('parent');
  expect(cageSplitShapeRange(fit.shape)!.parameterRange[0]).toBeCloseTo(qlo,10);
  expect(cageSplitShapeRange(fit.shape)!.parameterRange[1]).toBeCloseTo(qhi,10);
  for(const t of [0,.12,.37,.73,1]){const q=mappedParameter(t,fit.parameters);expect(sourceParameter(q,fit.parameters)).toBeCloseTo(t,12);const sample=curveSamples(fit.shape,q);expect(sample).toHaveLength(1);expect(sample[0].id).toBe(part.curveId);expect(sample[0].weight).toBe(1);expect(sample[0].t).toBeCloseTo(t,12);}
 }
});

test('trimmed native children restrict the original trimmed parent fit',()=>{
 const {lineage,geometry,projector,base}=fixture(),lo=.12,hi=.86,cut=lineage.parts[0].parameterRange[1];
 const pieces=geometry.pieces.map((piece,i)=>({...piece,shape:subcurve(piece.shape,i===0?lo/cut:0,i===0?1:(hi-cut)/(1-cut))})),output=projector.projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)}),parent=base.fit(subcurve(root,lo,hi)),q=mappedParameter((cut-lo)/(hi-lo),parent.parameters);
 sameShape(output.geometry.shapes[0],subcurve(parent.shape,0,q));sameShape(output.geometry.shapes[1],subcurve(parent.shape,q,1));tangency(output.geometry.shapes);
 expect(curveSamples(output.geometry.shapes[0],0)[0].t).toBeCloseTo(lo/cut,12);
 expect(curveSamples(output.geometry.shapes[1],1)[0].t).toBeCloseTo((hi-cut)/(1-cut),12);
});

test('reversed native traversal preserves oriented geometry and material maps',()=>{
 const {geometry,projector}=fixture(),forward=projector.projectGeometry(geometry),pieces=[...geometry.pieces].reverse().map(piece=>({...piece,shape:copyCurveSource(piece.shape,[...piece.shape].reverse() as Cubic,1,0)})),reversed=projector.projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)});
 tangency(reversed.geometry.shapes);
 for(let i=0;i<pieces.length;i++){
  sameShape(reversed.geometry.shapes[i],[...forward.geometry.shapes[pieces.length-1-i]].reverse() as Cubic);
  for(const t of [0,.13,.57,1]){const q=mappedParameter(t,reversed.fits[i]!.parameters),sample=curveSamples(reversed.geometry.shapes[i],q)[0];expect(sample.id).toBe(pieces[i].owners[0]);expect(sample.t).toBeCloseTo(1-t,12);}
 }
});

test('repeated split families retain all original native intervals',()=>{
 const {lineage,geometry,projector,base}=fixture([0,.373*.219,.373,.373+(1-.373)*.731,1]),output=projector.projectGeometry(geometry),parent=base.fit(root);
 tangency(output.geometry.shapes);
 lineage.parts.forEach((part,i)=>sameShape(output.geometry.shapes[i],subcurve(parent.shape,mappedParameter(part.parameterRange[0],parent.parameters),mappedParameter(part.parameterRange[1],parent.parameters))));
});

test('successive cages use the prior fitted parent ranges, including re-tagged controls',()=>{
 const {lineage,geometry,projector,base}=fixture(),first=projector.projectGeometry(geometry),second=projector.projectGeometry(first.geometry),parentA=base.fit(root),parentB=base.fit(parentA.shape),ranges=new Map(lineage.parts.map((part,i)=>[part.curveId,cageSplitShapeRange(first.geometry.shapes[i])!.parameterRange]));
 const pieces=first.geometry.pieces.map(piece=>({...piece,shape:tagCurve(piece.shape.map(point=>[...point]) as Cubic,piece.owners[0])})),retagged=createCageSplitProjector(base,[lineage],{currentRanges:ranges}).projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)});
 lineage.parts.forEach((part,i)=>{
  const q=part.parameterRange.map(t=>mappedParameter(mappedParameter(t,parentA.parameters),parentB.parameters));
  sameShape(second.geometry.shapes[i],subcurve(parentB.shape,q[0],q[1]));sameShape(retagged.geometry.shapes[i],second.geometry.shapes[i]);
 });
 tangency(second.geometry.shapes);
});

test('explicit runtime range retention follows trims and reversal between cage stages',()=>{
 const {geometry,projector}=fixture(),first=projector.projectGeometry(geometry),a=first.geometry.shapes[0],b=first.geometry.shapes[1],lo=.13,hi=.84;
 const trimmedA=retainCageSplitShapeRange(a,subcurve(a,lo,1),lo,1),trimmedB=retainCageSplitShapeRange(b,subcurve(b,0,hi),0,hi);
 expect(cageSplitShapeRange(trimmedA)!.parameterRange[0]).toBeCloseTo(cageSplitShapeRange(a)!.parameterRange[1]*lo,12);
 const pieces=first.geometry.pieces.map((piece,i)=>({...piece,shape:i===0?trimmedA:trimmedB})),output=projector.projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)});tangency(output.geometry.shapes);
 const flipped=retainCageSplitShapeRange(trimmedA,copyCurveSource(trimmedA,[...trimmedA].reverse() as Cubic,1,0),1,0);
 expect(cageSplitShapeRange(flipped)!.parameterRange).toEqual([...cageSplitShapeRange(trimmedA)!.parameterRange].reverse());
});

test('ARC bridge pieces still use the existing ordinary cage fitter',()=>{
 const {lineage,geometry,ids}=fixture(),bridge:Cubic=[[.1,.1],[.2,.3],[.4,.3],[.5,.1]],base=createCageGeometryProjector(field,new Set([...ids,'other'])),projector=createCageSplitProjector(base,[lineage]),piece={owners:['child-1','other'],joinId:'arc',shape:bridge},pieces=[...geometry.pieces,piece],output=projector.projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)});
 sameShape(output.geometry.shapes.at(-1)!,base.fit(bridge).shape);expect(cageSplitShapeRange(output.geometry.shapes.at(-1)!)).toBeUndefined();expect(output.geometry.pieces.at(-1)!.joinId).toBe('arc');
});

test('divergent source controls fail with a precise lineage diagnostic',()=>{
 const {geometry,projector}=fixture(),broken=geometry.pieces.map((piece,i)=>({...piece,shape:i===0?tagCurve(piece.shape.map((point,j)=>j===1?[point[0]+.04,point[1]]:[...point]) as Cubic,piece.owners[0]):piece.shape}));
 expect(()=>projector.projectGeometry({pieces:broken,shapes:broken.map(piece=>piece.shape)})).toThrow(/Cage split lineage parent: declared native piece .* no longer belongs to one coherent cubic/);

});

test('opt-in live residual keeps untouched splits exact and independently edited shared seams together',()=>{
 const {lineage,geometry,base,projector}=fixture(),residual=createCageSplitProjector(base,[lineage],{residual:true,targetPoint:(shape,t)=>field.map(point(shape,t))}),original=residual.projectGeometry(geometry);
 expect(original.geometry.shapes).toEqual(projector.projectGeometry(geometry).geometry.shapes);
 const changed=(amount:number)=>{const pieces=geometry.pieces.map((piece,i)=>({...piece,shape:tagCurve(piece.shape.map((p,j)=>(i===0&&j===3||i===1&&j===0)?[p[0]+amount,p[1]+amount*.4]:[...p]) as Cubic,piece.owners[0])}));return {pieces,shapes:pieces.map(piece=>piece.shape)};};
 const input=changed(.006),output=residual.projectGeometry(input);near(output.geometry.shapes[0][3],output.geometry.shapes[1][0]);
 expect(output.geometry.shapes).not.toEqual(original.geometry.shapes);
 for(const [i,fit] of output.fits.entries()){
  expect(fit!.parameters).toEqual(original.fits[i]!.parameters);
  let error=0;for(let k=0;k<=256;k++){const t=k/256,p=point(fit!.shape,mappedParameter(t,fit!.parameters)),target=field.map(point(input.shapes[i],t));error=Math.max(error,Math.hypot(p[0]-target[0],p[1]-target[1]));}
  expect(fit!.maxError).toBe(error);
  for(const t of [0,.17,.67,1])expect(curveSamples(fit!.shape,mappedParameter(t,fit!.parameters))[0].t).toBeCloseTo(t,12);
 }
 const small=residual.projectGeometry(changed(.000001)),smaller=residual.projectGeometry(changed(.0000005));
 const distance=(a:Cubic,b:Cubic)=>Math.hypot(...a.flatMap((p,i)=>p.map((n,axis)=>n-b[i][axis])));
 for(let i=0;i<geometry.shapes.length;i++){expect(distance(small.geometry.shapes[i],original.geometry.shapes[i])).toBeLessThan(.00002);expect(distance(smaller.geometry.shapes[i],original.geometry.shapes[i])).toBeLessThan(distance(small.geometry.shapes[i],original.geometry.shapes[i]));}
 expect(()=>createCageSplitProjector(base,[lineage],{residual:true})).toThrow(/actual field target/);
});


test('a partial render uses its live family inputs without rendering dependencies',()=>{
 const {lineage,geometry,base}=fixture(),projector=createCageSplitProjector(base,[lineage],{inputPieces:geometry.pieces}),whole=projector.projectGeometry(geometry);
 for(const index of [0,1]){const piece=geometry.pieces[index],result=projector.projectGeometry({pieces:[piece],shapes:[piece.shape]});expect(result.geometry.pieces).toHaveLength(1);expect(result.geometry.pieces[0].owners).toEqual(piece.owners);sameShape(result.geometry.shapes[0],whole.geometry.shapes[index]);}
});

test('retired intervals continue the longest surviving live polynomial on the original axis',()=>{
 const {lineage,geometry,base}=fixture([0,.21,.67,1]),parent=base.fit(root);
 for(const indices of [[1],[0,2]]){const parts=indices.map(i=>lineage.parts[i]),pieces=indices.map(i=>geometry.pieces[i]),result=createCageSplitProjector(base,[{...lineage,parts}]).projectGeometry({pieces,shapes:pieces.map(piece=>piece.shape)});parts.forEach((part,i)=>sameShape(result.geometry.shapes[i],subcurve(parent.shape,mappedParameter(part.parameterRange[0],parent.parameters),mappedParameter(part.parameterRange[1],parent.parameters))));}
});
