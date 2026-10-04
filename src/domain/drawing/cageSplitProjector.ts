import {curveParameterSourceKnots,mappedParameter,sourceParameter,sourceParameterSlope,type CurveParameterMap} from '../deformation/cubicDeformation';
import {restrictCurveParameterMap} from '../deformation/curveParameterRestriction';
import {continueCubicRange} from './cubicRangeContinuation';
import {createFittedGeometryProjector,type FittedGeometry,type GeometryFit} from './cageGeometry';
import {curveSamples,mapCurveSource} from './curveProvenance';
import type {Cubic,Point2} from './model';
import {subcurve,type DrawingPiece} from './roundedJoin';
import {point} from './sampling';
import {curveFitRange,setCurveFitRange,retainCurveFitRange,type CurveFitRange} from './curveFitRange';

export interface CageSplitLineage {id:string;parts:{curveId:string;parameterRange:readonly [number,number]}[]}
export type CageSplitShapeRange=CurveFitRange;
export interface CageSplitProjectorOptions {
 tolerance?:number;
 curveIds?:ReadonlySet<string>;
 /** Same-stage live canonical inputs, including non-rendered family siblings.
  * They supply fitting dependencies only and never enter projected geometry. */
 inputPieces?:readonly DrawingPiece[];
 /** Current common-parent control parameters, after preceding cage stages.
  * These are runtime correspondence, never persisted source split parameters. */
 currentRanges?:ReadonlyMap<string,readonly [number,number]>;
 parentParameter?:(curveId:string,t:number)=>number;
 /** Keep independently edited source controls as a live cubic residual from
  * their declared parent's ideal restriction. Never persisted as geometry. */
 residual?:boolean;
 /** Actual field target, used to measure the complete residual output's
  * sampled error at the same material correspondence as the renderer. */
 targetPoint?:(shape:Cubic,t:number)=>Point2;
}
type Projector=ReturnType<typeof createFittedGeometryProjector>;
/** The actual oriented interval in this output cubic's fitted parent. */
export const cageSplitShapeRange=curveFitRange;
/** Copy range metadata only for an explicitly known affine cubic restriction. */
export const retainCageSplitShapeRange=retainCurveFitRange;
const fail=(id:string,message:string):never=>{throw Error(`Cage split lineage ${id}: ${message}`);};
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
const reverseMap=(map:CurveParameterMap):CurveParameterMap=>({sourceKnots:[...curveParameterSourceKnots(map)].reverse().map(t=>1-t),values:[...map.values].reverse().map(t=>1-t)});
const coordinate=(point:Point2,handle:Point2,scale:number):Point2=>[point[0]+(handle[0]-point[0])*scale,point[1]+(handle[1]-point[1])*scale];
interface Member {index:number;piece:DrawingPiece;range:readonly [number,number];lo:number;hi:number;shape:Cubic;reverse:boolean}

/** Adapt the existing field fitter to declared split families. Only native
 * pieces are contracted; ARC/route bridges still use the same ordinary fitter.
 * The shared parent is reconstructed and verified from today's live controls,
 * then fitted once. No prior controls, samples, or parent drawing are retained. */
export function createCageSplitProjector(base:Projector,lineages:readonly CageSplitLineage[],options:CageSplitProjectorOptions={}):Projector {
 if(options.residual&&!options.targetPoint)throw Error('A cage split residual requires its actual field target for fit diagnostics.');
 const leaves=new Map<string,{lineage:CageSplitLineage;range:readonly [number,number]}>(),roots=new Set<string>();
 for(const lineage of lineages){
  if(!lineage.id||roots.has(lineage.id)||!lineage.parts.length)fail(lineage.id,'a distinct identity and at least one live declared piece are required.');roots.add(lineage.id);let boundary=0;
  for(const part of lineage.parts){const [lo,hi]=part.parameterRange;if(!part.curveId||leaves.has(part.curveId)||!Number.isFinite(lo)||!Number.isFinite(hi)||lo<boundary||!(hi>lo)||hi>1)fail(lineage.id,'declared native pieces must have unique ordered intervals within 0…1.');leaves.set(part.curveId,{lineage,range:part.parameterRange});boundary=hi;}
 }
 const native=(piece:DrawingPiece)=>!piece.joinId&&piece.owners.length===1?leaves.get(piece.owners[0]):undefined;
 const pieceRange=(piece:DrawingPiece,leaf:NonNullable<ReturnType<typeof native>>):readonly [number,number]=>{
  const retained=curveFitRange(piece.shape);if(retained){if(retained.id!==leaf.lineage.id)fail(leaf.lineage.id,'the input piece belongs to a different fitted parent.');return retained.parameterRange;}
  const material=([0,1] as const).map(t=>{const samples=curveSamples(piece.shape,t);if(samples.length!==1||samples[0].id!==piece.owners[0]||samples[0].weight!==1||!Number.isFinite(samples[0].t))fail(leaf.lineage.id,`native piece ${piece.owners[0]} has no unambiguous material parameter provenance.`);return samples[0].t;});
  const [lo,hi]=options.currentRanges?.get(piece.owners[0])??leaf.range;
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||!(hi>lo))fail(leaf.lineage.id,`current parameter range for ${piece.owners[0]} is invalid.`);
  return [lo+(hi-lo)*material[0],lo+(hi-lo)*material[1]];
 };
 const asMember=(piece:DrawingPiece,index:number):Member|undefined=>{
  const leaf=native(piece);if(!leaf)return;
  const range=pieceRange(piece,leaf),reverse=range[1]<range[0],lo=Math.min(...range),hi=Math.max(...range);
  if(!(hi>lo)||lo<0||hi>1)fail(leaf.lineage.id,`native piece ${piece.owners[0]} has a degenerate or invalid parameter interval.`);
  return {index,piece,range,lo,hi,shape:reverse?[...piece.shape].reverse() as Cubic:piece.shape,reverse};
 };
 const dependencies=new Map<string,Member[]>();
 for(const piece of options.inputPieces??[]){const member=asMember(piece,-1),leaf=native(piece);if(!member||!leaf)continue;const list=dependencies.get(leaf.lineage.id)??[];list.push(member);dependencies.set(leaf.lineage.id,list);}
 const refine=(geometry:FittedGeometry,initial:(GeometryFit|undefined)[])=>{
  const grouped=new Map<string,{lineage:CageSplitLineage;members:Member[]}>();
  geometry.pieces.forEach((piece,index)=>{
   const leaf=native(piece);if(!leaf||!initial[index])return;
   const member=asMember(piece,index)!;
   let group=grouped.get(leaf.lineage.id);if(!group){group={lineage:leaf.lineage,members:[]};grouped.set(leaf.lineage.id,group);}
   group.members.push(member);
  });
  const result=[...initial];
  for(const {lineage,members} of grouped.values()){
   // A render path can contain only one child or an ARC-trimmed child. The
   // parent fit still uses its complete current input, when available.
   const allDeclared=lineage.parts.every(part=>members.some(member=>member.piece.owners[0]===part.curveId));
   const support=allDeclared?members:dependencies.get(lineage.id)??members;
   const ordered=[...support].sort((a,b)=>a.lo-b.lo),first=ordered[0],last=ordered.at(-1)!;
   if(new Set(support.map(member=>member.piece.owners[0])).size!==support.length)fail(lineage.id,'a native dependency is repeated.');
   const complete=lineage.parts[0].parameterRange[0]===0&&lineage.parts.at(-1)!.parameterRange[1]===1&&lineage.parts.every((part,i)=>!i||part.parameterRange[0]===lineage.parts[i-1].parameterRange[1])&&lineage.parts.every(part=>support.some(member=>member.piece.owners[0]===part.curveId));
   const lo=complete?first.lo:0,hi=complete?last.hi:1,span=hi-lo;
   let parent!:Cubic;
   if(complete||near(first.lo,0)&&near(last.hi,1))parent=[first.shape[0],coordinate(first.shape[0],first.shape[1],span/(first.hi-first.lo)),coordinate(last.shape[3],last.shape[2],span/(last.hi-last.lo)),last.shape[3]];
   else {
    // A source deletion retires parts, not the parent parameter axis. Choose
    // the widest surviving interval (stable order breaks ties), then exactly
    // continue that live cubic polynomial to the original parent domain.
    const longest=ordered.reduce((best,member)=>member.hi-member.lo>best.hi-best.lo?member:best);
    try{parent=continueCubicRange(longest.shape,longest.lo,longest.hi);}catch(error){fail(lineage.id,(error as Error).message);}
   }
   const ideal=new Map(members.map(member=>[member,subcurve(parent,(member.lo-lo)/span,(member.hi-lo)/span)])),changed=new Set(members.filter(member=>member.shape.some((point,index)=>point.some((value,axis)=>!near(value,ideal.get(member)![index][axis])))));
   if(!options.residual&&changed.size)fail(lineage.id,`declared native piece ${[...changed][0].piece.owners[0]} no longer belongs to one coherent cubic; its controls require an explicit residual policy.`);
   const fitted=base.fit(parent);
   for(const member of members){
    const a=(member.lo-lo)/span,b=(member.hi-lo)/span,qa=mappedParameter(a,fitted.parameters),qb=mappedParameter(b,fitted.parameters),forward=restrictCurveParameterMap(fitted.parameters,a,b),parameters=member.reverse?reverseMap(forward):forward,restricted=subcurve(fitted.shape,qa,qb),oriented=member.reverse?[...restricted].reverse() as Cubic:restricted;
    let output=oriented;
    if(options.residual&&changed.has(member)){
     const expected=ideal.get(member)!,actualFit=base.fit(member.piece.shape),idealFit=base.fit(member.reverse?[...expected].reverse() as Cubic:expected);
     output=oriented.map((p,i)=>[p[0]+(actualFit.shape[i][0]-idealFit.shape[i][0]),p[1]+(actualFit.shape[i][1]-idealFit.shape[i][1])]) as Cubic;
    }
    const shape=mapCurveSource(member.piece.shape,output,t=>sourceParameter(t,parameters),t=>sourceParameterSlope(t,parameters));
    setCurveFitRange(shape,{id:lineage.id,parameterRange:member.reverse?[qb,qa]:[qa,qb],sourceRange:leaves.get(member.piece.owners[0])!.range,parentParameter:t=>mappedParameter(((options.parentParameter?.(member.piece.owners[0],t)??t)-lo)/span,fitted.parameters)});
    let maxError=fitted.maxError;
    if(options.targetPoint){maxError=0;for(let i=0;i<=256;i++){const t=i/256,p=point(shape,mappedParameter(t,parameters)),target=options.targetPoint(member.piece.shape,t);maxError=Math.max(maxError,Math.hypot(p[0]-target[0],p[1]-target[1]));}if(!Number.isFinite(maxError))fail(lineage.id,'the actual field target produced a non-finite fit diagnostic.');}
    result[member.index]={...fitted,shape,parameters,maxError};
   }
  }
  return result;
 };
 return createFittedGeometryProjector(piece=>{
  if(native(piece))return options.curveIds&&!options.curveIds.has(piece.owners[0])?undefined:{shape:piece.shape,parameters:{values:[0,1]},maxError:0};
  return base.projectGeometry({shapes:[piece.shape],pieces:[piece]}).fits[0];
 },base.fit,options.tolerance??.00004,refine);
}
