import type {DeformProjection} from '../deformation/cageField';
import {fitDeformedCubic,mappedParameter,sourceParameter,sourceParameterSlope,curveParameterSourceKnots} from '../deformation/cubicDeformation';
import {derivative} from '../geometry/bezier';
import {arcField,point,type ArcSampling} from './sampling';
import {length,sub,type Cubic,type Point2} from './model';
import type {DrawingPiece} from './roundedJoin';
import {mapCurveSource} from './curveProvenance';
import {deformMaterialDistanceAt} from './deformMaterial';

export interface CageFitDiagnostic {
 owners:string[];
 joinId?:string;
 pieceIndex?:number;
 /** Existing 257-sample fit diagnostic; not a certified global bound. */
 maxError:number;
 tolerance:number;
 exceedsTolerance:boolean;
}
export type GeometryFit=ReturnType<typeof fitDeformedCubic>;
type Fit=GeometryFit;
export type FittedGeometry={shapes:Cubic[];pieces:DrawingPiece[];error?:string};
type Geometry=FittedGeometry;
type MaterialField=ReturnType<typeof arcField>&{geometry:Geometry;sourcePieceParameter?:(piece:number,t:number)=>number;fittedPieceParameter?:(piece:number,t:number)=>number};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));

/** A single field's reusable cubic projector. It accepts current geometry from
 * any prior stage, including already-derived ARC/route pieces. It never rebuilds
 * a round join from deformed authoring controls or installs affine metadata. */
export function createCageGeometryProjector(field:DeformProjection,curveIds:ReadonlySet<string>,tolerance=.00004){
 if(!Number.isFinite(tolerance)||tolerance<=0)throw Error('Cage fit tolerance must be finite and positive.');
 const cache=new Map<string,Fit>();
 const fit=(shape:Cubic)=>{const key=JSON.stringify(shape);let value=cache.get(key);if(!value){value=fitDeformedCubic(shape,field);cache.set(key,value);}
  // Identical coordinates can belong to different source IDs. Cache numeric
  // fitting only; each returned cubic retains its own material provenance.
  const parameters=value.parameters;return {...value,shape:mapCurveSource(shape,value.shape.map(p=>[...p]) as Cubic,t=>sourceParameter(t,parameters),t=>sourceParameterSlope(t,parameters))};
 };
 const selected=(piece:DrawingPiece)=>{
  const chosen=piece.owners.filter(id=>curveIds.has(id));
  if(chosen.length&&chosen.length!==piece.owners.length)throw Error(`Derived piece ${piece.joinId??piece.owners.join(', ')} crosses incompatible cage scopes.`);
  return chosen.length>0;
 };
 return createFittedGeometryProjector(piece=>selected(piece)?fit(piece.shape):undefined,fit,tolerance);
}

/** Shared geometry and material transport for field fits and sparse cubic corrections. */
export function createFittedGeometryProjector(fitPiece:(piece:DrawingPiece)=>Fit|undefined,fit:(shape:Cubic)=>Fit,tolerance=.00004,refine?:(geometry:Geometry,fits:(Fit|undefined)[])=>(Fit|undefined)[]){
 function projectGeometry<G extends Geometry>(geometry:G,include:(piece:DrawingPiece)=>boolean=()=>true){
  if(geometry.error)throw Error(geometry.error);
  if(geometry.pieces.length!==geometry.shapes.length)throw Error('Cage geometry has inconsistent piece membership.');
  const initial=geometry.pieces.map(piece=>include(piece)?fitPiece(piece):undefined),fits=refine?.(geometry,initial)??initial,diagnostics:CageFitDiagnostic[]=[];
  const pieces=geometry.pieces.map((piece,i)=>{const result=fits[i];if(!result)return piece;
   diagnostics.push({owners:[...piece.owners],joinId:piece.joinId,pieceIndex:i,maxError:result.maxError,tolerance,exceedsTolerance:result.maxError>tolerance});
   return {...piece,shape:result.shape};
  });
  return {geometry:{...geometry,pieces,shapes:pieces.map(piece=>piece.shape)} as G,fits,diagnostics};
 }
 function projectMaterialField<F extends MaterialField>(before:F,include:(piece:DrawingPiece)=>boolean=()=>true){
  if(before.parts.length!==before.geometry.pieces.length)throw Error('Cage material has inconsistent piece membership.');
  const route=before as F&Partial<import('./displayRoutes').DisplayRouteField>;
  if(route.diagnostics?.length)throw Error(route.diagnostics[0].message);
  const projected=projectGeometry(before.geometry,include),parts=before.parts.map((part,index)=>{
   const result=projected.fits[index];if(!result)return part;
   const fitted=arcField([result.shape]).parts[0],parameter=(t:number)=>mappedParameter(t,result.parameters);
   // Keep every source arc-table and fit-map breakpoint. Then interpolation in
   // the transported table exactly composes the two piecewise-linear maps.
   const table={...part,start:0},distance=(t:number)=>deformMaterialDistanceAt(table,t);
   const samples=(quality?:ArcSampling)=>{
    const parameters=[...new Set([...part.pts.map(p=>p.t),...curveParameterSourceKnots(result.parameters),...fitted.renderSamples(quality).map(p=>sourceParameter(p.t,result.parameters))])].sort((a,b)=>a-b);
    return parameters.map(t=>{const mapped=parameter(t);return {p:point(result.shape,mapped),t:mapped,distance:distance(t)};});
   };
   const points=samples();return {...part,shape:result.shape,pts:points.map(({p,t})=>({p,t})),dist:points.map(p=>p.distance),renderSamples:samples};
  });
  const at=(s:number)=>{
   const old=before.at(s),distance=clamp(s)*before.total,index=before.parts.findIndex(part=>distance<=part.start+part.length),i=index<0?before.parts.length-1:index,result=projected.fits[i];
   if(!result)return old;
   const t=mappedParameter(old.t,result.parameters),p=point(result.shape,t),v=derivative(result.shape.map(([x,y])=>[x,y,0]),t);let direction:Point2=[v[0],v[1]];
   if(length(direction)<1e-10)direction=sub(point(result.shape,Math.min(1,t+1e-5)),point(result.shape,Math.max(0,t-1e-5)));
   const size=length(direction);return {...old,p,t,shape:result.shape,tangent:[direction[0]/(size||1),direction[1]/(size||1)] as Point2};
  };
  // Generic display frame/span and route identities remain in source material
  // units. Only a method accepting fitted-piece t needs inverse correspondence.
  const projectedField={...before,parts,geometry:projected.geometry,at,
   sourcePieceParameter:(piece:number,t:number)=>{const source=sourceParameter(t,projected.fits[piece]?.parameters);return before.sourcePieceParameter?.(piece,source)??source;},
   fittedPieceParameter:(piece:number,t:number)=>mappedParameter(before.fittedPieceParameter?.(piece,t)??t,projected.fits[piece]?.parameters),
   ...(route.materialAtPiece?{materialAtPiece:(piece:number,t:number)=>route.materialAtPiece!(piece,sourceParameter(t,projected.fits[piece]?.parameters))}:{}),
   ...(route.brushes?{brushes:{...route.brushes,links:route.brushes.links.map(link=>{
    const affected=before.geometry.pieces.some((piece,i)=>piece.joinId===link.joinId&&projected.fits[i]);
    const pieces=projected.geometry.pieces.filter(piece=>piece.joinId===link.joinId);
    return {...link,...(affected&&link.geometry?{geometry:{...link.geometry,shapes:pieces.length===link.geometry.shapes.length?pieces.map(piece=>piece.shape):link.geometry.shapes.map(shape=>fit(shape).shape)}}:{})};
   })}}:{}),
  } as F;
  return {field:projectedField,fits:projected.fits,diagnostics:projected.diagnostics};
 }
 return {fit,projectGeometry,projectMaterialField};
}
