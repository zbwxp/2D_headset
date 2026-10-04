import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import type {SnapshotScalarTarget} from './simplexGeometry';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {createSnapshotResponseFieldWeightMapper} from './responseExpressionRegistry';
import {
 combineSnapshotResponseExpressions,createSnapshotResponseBasisValue,createSnapshotResponseConstant,createSnapshotResponseFitParameter,createSnapshotResponseMaterialParameter,divideSnapshotResponseExpressions,multiplySnapshotResponseExpressions,rebaseSnapshotResponseExpression,substituteSnapshotResponseBasisValues,withSnapshotResponseSourceBaseline,
 type SnapshotResponseBasisReference,type SnapshotResponseExpression,type SnapshotResponseExpressionField,type SnapshotCubicResponseExpressions,
} from './responseExpressions';
type E=SnapshotResponseExpression;
type Split=Pick<CurveSplitIntent,'curveId'|'sourceNodeIds'|'t'|'childCurveIds'|'seamNodeId'>;
const plain=(e:E):E=>({version:1,fields:e.fields,terms:e.terms,...e.operations?{operations:e.operations}:{}});
const sum=(a:E,b:E,coefficient=1)=>combineSnapshotResponseExpressions([{coefficient:1,expression:a},{coefficient,expression:b}]);
const product=multiplySnapshotResponseExpressions,one=()=>createSnapshotResponseConstant(1);
export const snapshotFitSplitParts=(intent:Split)=>[{curveId:intent.childCurveIds[0],parameterRange:[0,intent.t] as [number,number]},{curveId:intent.childCurveIds[1],parameterRange:[intent.t,1] as [number,number]}];
/** Ordinary basis controls remain live. Only the inverse restriction divisor
 * comes from the basis's current evaluated material-parameter program. */
export function rewriteSnapshotFittedSplitBases(expression:E,intent:Split):E {
 const replacement=(basis:SnapshotResponseBasisReference):E|undefined=>{
  if(basis.target.kind!=='handle'||basis.target.curveId!==intent.curveId)return;
  const end=basis.target.end,q=createSnapshotResponseFitParameter({snapshotId:basis.snapshotId,parts:snapshotFitSplitParts(intent),t:intent.t});
  return divideSnapshotResponseExpressions(createSnapshotResponseBasisValue({...basis,target:{kind:'handle',curveId:intent.childCurveIds[end],end}}),end===0?q:sum(one(),q,-1));
 };
 const mapped=substituteSnapshotResponseBasisValues(expression,replacement),parts=(values:ReturnType<typeof snapshotFitSplitParts>)=>values.flatMap(part=>part.curveId!==intent.curveId?[part]:snapshotFitSplitParts(intent).map(child=>({curveId:child.curveId,parameterRange:child.parameterRange.map(t=>part.parameterRange[0]+(part.parameterRange[1]-part.parameterRange[0])*t) as [number,number]})));
 const program=(ops:NonNullable<E['operations']>)=>ops.map(op=>op.kind==='fit-parameter'?{...op,reference:{...op.reference,parts:parts(op.reference.parts as ReturnType<typeof snapshotFitSplitParts>)}}:op.kind==='curve-material-parameter'&&op.domain?{...op,domain:{...op.domain,parts:parts(op.domain.parts as ReturnType<typeof snapshotFitSplitParts>)}}:op);
 return {...mapped,...mapped.operations?{operations:program(mapped.operations)}:{},...mapped.sourceBaselineOperations?{sourceBaselineOperations:program(mapped.sourceBaselineOperations)}:{}};
}

/** Capture the old parent scalar field, including its original nonlinear
 * projection, then restrict that one field with the existing material law.
 * Rebase at live corners so later explicit child edits remain authoritative. */
export function createSnapshotFittedSplitExpressions(mesh:SnapshotTriangulation,location:SnapshotSimplexLocation,intent:Split,capture:(target:SnapshotScalarTarget,axis:0|1)=>E,nodeAuthority:(id:string)=>string=id=>id):{left:[SnapshotCubicResponseExpressions,SnapshotCubicResponseExpressions];right:[SnapshotCubicResponseExpressions,SnapshotCubicResponseExpressions]} {
 const field:SnapshotResponseExpressionField={id:JSON.stringify(['fitted-split-field',intent.childCurveIds,location.simplexId]),vertexIds:[...location.vertexIds],edges:[],samples:[]},mapper=createSnapshotResponseFieldWeightMapper(mesh,location);
 const baseline=(target:SnapshotScalarTarget,axis:0|1):E=>({version:1,fields:[field],terms:location.snapshotIds.map((snapshotId,coordinate)=>({fieldId:field.id,coordinate:coordinate as 0|1|2,weight:'geometric',basis:[{coefficient:1,basis:{snapshotId,target,axis}}]}))});
 const targets:SnapshotScalarTarget[]=[{kind:'node',nodeId:nodeAuthority(intent.sourceNodeIds[0])},{kind:'handle',curveId:intent.curveId,end:0},{kind:'handle',curveId:intent.curveId,end:1},{kind:'node',nodeId:nodeAuthority(intent.sourceNodeIds[1])}];
 const values=([0,1] as const).map(axis=>targets.map(target=>plain(rewriteSnapshotFittedSplitBases(sum(baseline(target,axis),plain(capture(target,axis))),intent))));
 const controls=[0,1,2,3].map(index=>[0,1].map(axis=>index===1?sum(values[axis][0],values[axis][1]):index===2?sum(values[axis][3],values[axis][2]):values[axis][index]) as [E,E]);
 const parts=snapshotFitSplitParts(intent),q=createSnapshotResponseMaterialParameter(controls,location.snapshotIds.map(snapshotId=>createSnapshotResponseFitParameter({snapshotId,parts,t:intent.t})),field,{parts,t:intent.t});
 const mix=(a:E,b:E)=>sum(a,product(sum(b,a,-1),q));
 const restrict=(axis:0|1)=>{const [p0,p1,p2,p3]=controls.map(pair=>pair[axis]),a=mix(p0,p1),b=mix(p1,p2),c=mix(p2,p3),d=mix(a,b),e=mix(b,c),point=mix(d,e);return {left:[p0,sum(a,p0,-1),sum(d,point,-1),point] as unknown as SnapshotCubicResponseExpressions,right:[point,sum(e,point,-1),sum(c,p3,-1),p3] as unknown as SnapshotCubicResponseExpressions};};
 const rebase=(value:E,target:SnapshotScalarTarget,axis:0|1):E=>({...withSnapshotResponseSourceBaseline(rebaseSnapshotResponseExpression(value,field,(operand,index)=>mapper(operand,location.vertexIds.map((_,coordinate)=>coordinate===index?1:0))),baseline(target,axis)),smoothOwned:true});
 const left:SnapshotCubicResponseExpressions[]=[],right:SnapshotCubicResponseExpressions[]=[];
 for(const axis of [0,1] as const){const value=restrict(axis),child=(side:0|1)=>[{kind:'node',nodeId:side?intent.seamNodeId:intent.sourceNodeIds[0]},{kind:'handle',curveId:intent.childCurveIds[side],end:0},{kind:'handle',curveId:intent.childCurveIds[side],end:1},{kind:'node',nodeId:side?intent.sourceNodeIds[1]:intent.seamNodeId}] as SnapshotScalarTarget[];left.push(value.left.map((expression,i)=>rebase(expression,child(0)[i],axis)) as unknown as SnapshotCubicResponseExpressions);right.push(value.right.map((expression,i)=>rebase(expression,child(1)[i],axis)) as unknown as SnapshotCubicResponseExpressions);}
 return {left:left as [SnapshotCubicResponseExpressions,SnapshotCubicResponseExpressions],right:right as [SnapshotCubicResponseExpressions,SnapshotCubicResponseExpressions]};
}
