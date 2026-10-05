import {evaluatedDeformationSource,projectEvaluatedGeometry,projectEvaluatedMaterial} from './evaluatedDeformation';
import {curveSamples} from './curveProvenance';
import {arcField} from './sampling';
import {curveById,visible,nodeAt,length,sub,type DrawingDocument as Doc} from './model';
import {resolveDisplayRoute,deriveDisplayRouteCornerGeometry,type DisplayRoute} from './displayRoutes';
import {compileDisplayRouteBrushes} from './displayRouteBrush';
import {partitionedUses} from './roundedJoin';
import {inkRuns,strokeEnds,type InkRun,type InkSampling} from './appearance';
import {displayField,localDisplayPath} from './displayIntervals';
import {evaluatedAffine,evaluatedAffineSource,affineGeometry} from './evaluatedAffine';

/** First authoring slice: uniform equal-width chains. Reject unsupported style
 * combinations rather than silently borrowing the first layer's appearance. */
export function displayRouteInkSupport(d:Doc,route:DisplayRoute):string[] {
 const deformationSource=evaluatedDeformationSource(d);if(deformationSource)return displayRouteInkSupport(deformationSource,route);
 if(evaluatedAffine(d,route.seed.segments[0]?.id))return displayRouteInkSupport(evaluatedAffineSource(d)!,route);
 const resolved=resolveDisplayRoute(d,route);if(resolved.diagnostics.length)return resolved.diagnostics.map(x=>x.message);
 const curves=resolved.path.segments.map(u=>curveById(d,u.id));if(!curves.length)return ['显示路径为空。'];
 const problems:string[]=[];
 if(curves.some(c=>Math.abs(c.width-curves[0].width)>1e-10))problems.push('贯通显示的首版要求同等线宽；不会修改各自的源线宽。');
 if(curves.some(c=>(c.profile??'UNIFORM')!=='UNIFORM'))problems.push('此笔画使用变化线宽；当前贯通显示不会重分配其轮廓。');
 if(curves.some(c=>c.inkEnds?.some(e=>e.interior)))problems.push('此路径含显式内部末端笔触；请先关闭该内部笔触再贯通。');
 problems.push(...compileDisplayRouteBrushes(d,resolved).diagnostics.filter(x=>x.severity==='error').map(x=>x.message));return problems;
}
export interface DisplayRouteInkPlan {runs:Map<string,InkRun[]>;pieces:ReturnType<typeof partitionedUses>['pieces'];curveIds:Set<string>;diagnostics:string[]}
/** Compile ink once, partition only after measuring/tapering the complete route,
 * then paint fragments at their original member/layer/depth slots. */
export function displayRouteInk(d:Doc,route:DisplayRoute,positions:ReadonlyMap<string,number>,sampling?:InkSampling):DisplayRouteInkPlan {
 const deformationSource=evaluatedDeformationSource(d);if(deformationSource){
  const plan=displayRouteInk(deformationSource,route,positions,{tolerance:.00004,maxStep:1/32,taperSteps:24,...sampling,materialDeformation:shapes=>projectEvaluatedMaterial(d,{...arcField(shapes),geometry:{shapes,pieces:shapes.map(shape=>({shape,owners:[...new Set([0,.5,1].flatMap(t=>curveSamples(shape,t).map(sample=>sample.id)))]}))}})});
  return {...plan,pieces:projectEvaluatedGeometry(d,{pieces:plan.pieces,shapes:plan.pieces.map(piece=>piece.shape)}).pieces};
 }
 const affine=evaluatedAffine(d,route.seed.segments[0]?.id);if(affine){
  const plan=displayRouteInk(evaluatedAffineSource(d)!,route,positions,{tolerance:.00004,maxStep:1/32,taperSteps:24,...sampling,materialAffine:affine});
  return {...plan,pieces:affineGeometry({pieces:plan.pieces,shapes:plan.pieces.map(p=>p.shape)},affine).pieces};
 }
 const diagnostics=displayRouteInkSupport(d,route),runs=new Map<string,InkRun[]>(),resolved=resolveDisplayRoute(d,route),curveIds=new Set(resolved.path.segments.map(u=>u.id));
 if(diagnostics.length)return {runs,pieces:[],curveIds,diagnostics};
 const corners=deriveDisplayRouteCornerGeometry(d,route),compiled=corners.brushes,g=corners.geometry,field=displayField(d,resolved.path);
 if(g.error)return {runs,pieces:[],curveIds,diagnostics:[g.error]};
 const c=curveById(d,resolved.path.segments[0].id),owner=(i:number)=>g.pieces[i].inkOwner!,enabled=g.pieces.map(p=>p.owners.every(id=>visible(d,id)&&curveById(d,id).inkVisible!==false));
 const sharpAfter=g.pieces.flatMap((p,i)=>{const q=g.pieces[(i+1)%g.pieces.length];if(!resolved.path.closed&&i===g.pieces.length-1)return [];return compiled.inkDocument.joins.some(j=>j.mode==='CUSP'&&((p.owners.includes(j.a.curveId)&&q.owners.includes(j.b.curveId))||(p.owners.includes(j.b.curveId)&&q.owners.includes(j.a.curveId)))&&length(sub(p.shape[3],nodeAt(d,j.a).position))<1e-7)?[i]:[];});
 for(const run of inkRuns(g.shapes,c.width,'UNIFORM',false,enabled,resolved.path.closed,strokeEnds(d,resolved.path).map(e=>e.style) as import('./model').InkEnds,sharpAfter,field.mask,field.inkSpans,undefined,true,sampling,field.pinches)){
  for(const fragment of run.fragments??[]){const a=owner(fragment.pieceIndex),b=fragment.jointWith===undefined?a:owner(fragment.jointWith),id=(positions.get(a)??0)<=(positions.get(b)??0)?a:b,list=runs.get(id)??[];list.push({shapes:fragment.shapes,outline:fragment.outline,tips:fragment.tips,uniform:run.uniform&&fragment.jointWith===undefined,closed:false,clipped:run.clipped});runs.set(id,list);}
  for(const extension of run.extensions??[]){const list=runs.get(owner(extension.pieceIndex));if(list?.length)(list[0].extensions??=[]).push(extension);}
 }
 return {runs,pieces:g.pieces,curveIds,diagnostics:compiled.diagnostics.filter(x=>x.severity!=='info').map(x=>x.message)};
}

export function assertDisplayRouteSupport(d:Doc):void {const seen=new Set<string>();for(const t of d.displayIntervals??[])if(t.displayRoute){const key=JSON.stringify(t.displayRoute);if(seen.has(key))continue;seen.add(key);const issues=displayRouteInkSupport(d,t.displayRoute);if(issues.length)throw Error(issues[0]);}}

export function displayRouteDiagnostics(d:Doc):string[]{const seen=new Set<string>(),messages=new Set<string>();for(const t of d.displayIntervals??[])if(t.displayRoute){const key=JSON.stringify(t.displayRoute);if(seen.has(key))continue;seen.add(key);for(const issue of displayRouteInkSupport(d,t.displayRoute))messages.add(issue);for(const issue of compileDisplayRouteBrushes(d,resolveDisplayRoute(d,t.displayRoute)).diagnostics)if(issue.severity!=='info')messages.add(issue.message);}return [...messages];}
