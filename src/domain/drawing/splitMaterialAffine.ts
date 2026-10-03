import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine,type EvaluatedAffine} from './evaluatedAffine';
import {shapeOf,type DrawingDocument,type Point2} from './model';
import {subcurve} from './roundedJoin';
import type {CurveSplitIntent} from './layerEditIntent';

/** Runtime material provenance follows the very same de Casteljau split as
 * final controls. A nonuniform placement must not change the meaning of saved
 * material fractions when new node/curve arrays replace its old identity. */
export function retainSplitMaterialAffine(before:DrawingDocument,after:DrawingDocument,intent:CurveSplitIntent|undefined):DrawingDocument {
 const source=intent&&evaluatedAffineSource(before);if(!source||!intent)return after;
 const original=source.curves.find(curve=>curve.id===intent.curveId);if(!original)return after;
 const parent=shapeOf(source,intent.curveId),children=[subcurve(parent,0,intent.t),subcurve(parent,intent.t,1)],nodes=new Map(source.nodes.map(node=>[node.id,node])),curves=new Map(source.curves.map(curve=>[curve.id,curve]));
 const material:DrawingDocument={...after,nodes:after.nodes.map(node=>node.id===intent.seamNodeId?{...node,position:[...children[0][3]] as Point2}:nodes.has(node.id)?{...node,position:[...nodes.get(node.id)!.position] as Point2}:node),curves:after.curves.map(curve=>{const child=intent.childCurveIds.indexOf(curve.id);return child>=0?{...curve,handles:[children[child][1],children[child][2]]}:curves.has(curve.id)?{...curve,handles:curves.get(curve.id)!.handles}:curve;})};
 const parentAffine=evaluatedAffine(before,intent.curveId),affines=new Map<string,EvaluatedAffine>();
 for(const item of [...after.nodes,...after.curves,...after.fills,...after.offsets]){const affine=intent.childCurveIds.includes(item.id)||item.id===intent.seamNodeId?parentAffine:evaluatedAffine(before,item.id);if(affine)affines.set(item.id,affine);}
 if(affines.size)registerEvaluatedAffine(after,material,id=>affines.get(id));return after;
}
