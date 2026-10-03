import {applyMirrorEditing,mirrorWritesForCurves} from './mirrorEditing';
import {add,sub,length,shapeOf,curveById,type DrawingDocument as Doc} from './model';
import {transform} from './commands';
import {roundedJoins} from './roundedJoin';
import {isNeutralBend,type BendValue} from '../deformation/coons';
import {drawingDeformProjection,type DeformRect,type Quad} from '../deformation/cageField';
import {fitDeformedCubic,type CurveParameterMap} from '../deformation/cubicDeformation';
import {transportDeformedIntervals} from './deformMaterial';

// Existing callers keep their public entry points. Field, fit and material
// transport are independently reusable without executing an authoring command.
export {drawingDeformProjection,quadProjection,rectQuad,type DeformRect,type Quad,type DeformProjection as DrawingDeformProjection} from '../deformation/cageField';
export {deformParameter,mappedParameter,type CurveParameterMap} from '../deformation/cubicDeformation';
export {transportDeformedIntervals} from './deformMaterial';

export function deformDrawing(d:Doc,ids:string[],rect:DeformRect,quad:Quad,allowRelated=false,bend?:BendValue){
 if(ids.some(id=>curveById(d,id)?.locked))throw Error('所选曲线包含锁定成员，请先解锁。');
 const f=drawingDeformProjection(rect,quad,bend),curved=!!bend&&!isNeutralBend(bend),transformed=transform(d,ids,f.map,allowRelated);
 if(transformed===d&&(!curved||!ids.length))return {document:d,maxError:0,parameters:new Map<string,CurveParameterMap>()};
 // A curved field can fix every source control and still move its interior.
 const n=transformed===d?structuredClone(d):transformed;
 let maxError=0;const parameters=new Map<string,CurveParameterMap>();
 for(const id of ids){
  const result=fitDeformedCubic(shapeOf(d,id),f),fitted=result.shape,c=curveById(n,id);parameters.set(id,result.parameters);c.handles=[fitted[1],fitted[2]];
  maxError=Math.max(maxError,result.maxError);
 }
 // Under a nonlinear field a mapped control chord need not point along the
 // endpoint derivative. Keep partial Smooth neighbours on that exact ray.
 if(curved){const selected=new Set(ids);for(const j of n.joins)if(j.mode==='SMOOTH'&&selected.has(j.a.curveId)!==selected.has(j.b.curveId)){
  const e=selected.has(j.a.curveId)?j.b:j.a,s=shapeOf(d,e.curveId),p=s[e.end?3:0];
  curveById(n,e.curveId).handles[e.end]=add(f.map(p),f.vector(p,sub(s[e.end?2:1],p)));
 }}
 for(const j of n.joins)if(j.mode!=='CUSP')for(const e of [j.a,j.b]){const s=shapeOf(n,e.curveId);if(length(sub(s[e.end?2:1],s[e.end?3:0]))<1e-7)throw Error('变换会使连接柄退化。');}
 const oldArcs=roundedJoins(d),newArcs=roundedJoins(n);
 for(const [id,g] of newArcs)if(g.error&&!oldArcs.get(id)?.error)throw Error('变形会使圆弧接笔退化；已保留最后有效位置。');
 const mirrored=applyMirrorEditing(d,n,mirrorWritesForCurves(n,ids));
 if(d.mirrorEditing?.enabled)for(const pair of d.mirrorEditing.curvePairs){const a=parameters.get(pair.a),b=parameters.get(pair.b);if(!!a===!!b)continue;const from=a??b!,to=a?pair.b:pair.a;parameters.set(to,{values:pair.reverse?[...from.values].reverse().map(t=>1-t):[...from.values]});}
 return {document:transportDeformedIntervals(d,mirrored,parameters),maxError,parameters};
}
