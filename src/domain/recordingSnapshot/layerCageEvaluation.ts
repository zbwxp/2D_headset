import {displayField,displayPath} from '../drawing/displayIntervals';
import {derivedUses} from '../drawing/roundedJoin';
import {strokes,strokePaths} from '../drawing/strokes';
import {appendEvaluatedDeformation,evaluatedControlParameter,evaluatedControlParameterSlope} from '../drawing/evaluatedDeformation';
import {applyDrawingShapeValue} from '../drawing/sparseShape';
import {createCubicCorrectionProjector} from '../drawing/cubicCorrection';
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
 return {controlDrawing,curveIds:curves,fits,diagnostics,projector,
  maxError:diagnostics.reduce((maximum,item)=>Math.max(maximum,item.maxError),0),
  projectGeometry:projector.projectGeometry,projectMaterialField:projector.projectMaterialField,
 };
}

/** Runtime consumer used by the ordered Snapshot domain pipeline. */
export function applyLayerCageDomain(input:DrawingDocument,domain:SnapshotLayerCageDomain,postShape?:import('../recordingScene/model').SceneShapeValue,tolerance=.00004):DrawingDocument {
 if(domain.enabled===false){layerCageDomainProjection(domain);return input;}
 const evaluated=evaluateLayerCageDomain(input,domain,tolerance);
 let drawing=appendEvaluatedDeformation(evaluated.controlDrawing,input,evaluated.curveIds,evaluated.projector,JSON.stringify(domain),new Map([...evaluated.fits].map(([id,fit])=>[id,fit.parameters])),{kind:'cage',domain});
 if(postShape)drawing=applyLayerDomainPostShape(drawing,postShape,new Set(input.layers.filter(layer=>domain.layerIds.includes(layer.id)).flatMap(layer=>layer.items)),tolerance);
 for(const layer of drawing.layers)for(const stroke of strokes(drawing,layer.id))for(const path of strokePaths(stroke))if(path.segments.some(use=>evaluated.curveIds.has(use.id))){const geometry=derivedUses(drawing,path.segments,path.closed);if(geometry.error)throw Error(geometry.error);}
 for(const fill of drawing.fills)if(fill.boundary.some(use=>evaluated.curveIds.has(use.id))){const geometry=derivedUses(drawing,fill.boundary,true);if(geometry.error)throw Error(geometry.error);}
 for(const track of drawing.displayIntervals??[]){const path=displayPath(drawing,track.anchor.id);if(path.segments.some(use=>evaluated.curveIds.has(use.id)))displayField(drawing,path);}
 return drawing;
}
/** Same sparse-control engine as Scene, followed by the same derived fitter. */
export function applyLayerDomainPostShape(input:DrawingDocument,value:import('../recordingScene/model').SceneShapeValue,scope:ReadonlySet<string>,tolerance=.00004):DrawingDocument {
 const availableCurves=new Set(input.curves.filter(curve=>scope.has(curve.id)).map(curve=>curve.id)),availableNodes=new Set(input.curves.filter(curve=>availableCurves.has(curve.id)).flatMap(curve=>curve.nodes));
 if(Object.keys(value.handles).some(id=>input.curves.some(curve=>curve.id===id)&&!availableCurves.has(id))||Object.keys(value.nodes).some(id=>input.nodes.some(node=>node.id===id)&&!availableNodes.has(id)))throw Error('A post-domain correction targets controls outside its live layer scope.');
 const shaped=applyDrawingShapeValue(input,value);if(shaped.issues.length)throw Error(shaped.issues[0].message);if(!shaped.changed)return input;
 const projector=createCubicCorrectionProjector(input,shaped.drawing,(id,t)=>evaluatedControlParameter(input,id,t),(id,t)=>evaluatedControlParameterSlope(input,id,t),tolerance);
 const curves=new Set(input.curves.filter(curve=>scope.has(curve.id)||projector.curveIds.has(curve.id)).map(curve=>curve.id));
 return appendEvaluatedDeformation(shaped.drawing,input,curves,projector,JSON.stringify(['post-shape',value]),new Map(),{kind:'post-shape',value});
}
