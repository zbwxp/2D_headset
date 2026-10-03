import {createCageGeometryProjector,type CageFitDiagnostic} from '../drawing/cageGeometry';
import {shapeOf,length,sub,type DrawingDocument,type Point2,type Cubic} from '../drawing/model';
import {layerCageDomainProjection,type SnapshotLayerCageDomain} from './layerCageDomain';

/** Independent stage evaluation. controlDrawing is the fitted editing baseline,
 * not a render-ready replacement: ARC/route consumers must use projectGeometry
 * or projectMaterialField on the INPUT's derived geometry. Registration into the
 * shared Snapshot pipeline is intentionally a separate integration step. */
export function evaluateLayerCageDomain(input:DrawingDocument,domain:SnapshotLayerCageDomain,tolerance=.00004){
 const field=layerCageDomainProjection(domain);
 const layers=new Set(domain.layerIds),scope=new Set(input.layers.filter(layer=>layers.has(layer.id)).flatMap(layer=>layer.items)),curves=new Set(input.curves.filter(curve=>scope.has(curve.id)).map(curve=>curve.id));
 if(domain.enabled===false)curves.clear();
 const projector=createCageGeometryProjector(field,curves,tolerance),fits=new Map([...curves].map(id=>[id,projector.fit(shapeOf(input,id))])),positions=new Map<string,Point2>(),diagnostics:CageFitDiagnostic[]=[];
 for(const curve of input.curves){
  const result=fits.get(curve.id),shape=result?.shape??shapeOf(input,curve.id);
  if(result)diagnostics.push({owners:[curve.id],maxError:result.maxError,tolerance,exceedsTolerance:result.maxError>tolerance});
  for(const end of [0,1] as const){const id=curve.nodes[end],p=shape[end?3:0],existing=positions.get(id);if(existing&&length(sub(existing,p))>1e-8)throw Error(`Cage domain ${domain.id} separates shared node ${id}; its incident curves require a coherent scope.`);positions.set(id,p);}
 }
 const shape=(id:string):Cubic=>fits.get(id)?.shape??shapeOf(input,id),endpoint=(e:{curveId:string;end:0|1})=>shape(e.curveId)[e.end?3:0];
 for(const link of input.endpointLinks??[])if((curves.has(link.a.curveId)||curves.has(link.b.curveId))&&length(sub(endpoint(link.a),endpoint(link.b)))>1e-7)throw Error(`Cage domain ${domain.id} separates endpoint link ${link.id}.`);
 for(const join of input.joins){
  if(join.mode!=='SMOOTH'||!curves.has(join.a.curveId)&&!curves.has(join.b.curveId))continue;
  const a=sub(shape(join.a.curveId)[join.a.end?2:1],endpoint(join.a)),b=sub(shape(join.b.curveId)[join.b.end?2:1],endpoint(join.b)),size=length(a)*length(b);
  const oldA=shapeOf(input,join.a.curveId),oldB=shapeOf(input,join.b.curveId),oldSize=length(sub(oldA[join.a.end?2:1],oldA[join.a.end?3:0]))*length(sub(oldB[join.b.end?2:1],oldB[join.b.end?3:0]));
  // An earlier exact-zero affine may already collapse both tangent supports.
  // A following cage retains that state; only a newly introduced failure blocks it.
  if(size<1e-14?oldSize>=1e-14:(a[0]*b[0]+a[1]*b[1])/size>-1+1e-6)throw Error(`Cage domain ${domain.id} cannot preserve SMOOTH relation ${join.id} in this scope.`);
 }
 const controlDrawing:DrawingDocument=fits.size?{...input,nodes:input.nodes.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!}:node),curves:input.curves.map(curve=>{const result=fits.get(curve.id);return result?{...curve,handles:[result.shape[1],result.shape[2]]}:curve;})}:input;
 return {controlDrawing,curveIds:curves,fits,diagnostics,
  maxError:diagnostics.reduce((maximum,item)=>Math.max(maximum,item.maxError),0),
  projectGeometry:projector.projectGeometry,projectMaterialField:projector.projectMaterialField,
 };
}
