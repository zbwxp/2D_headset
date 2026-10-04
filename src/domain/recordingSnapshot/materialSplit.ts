import {createSnapshotPathMaterialBasis,snapshotPathMaterialValue} from './materialPathMapping';
import {createSnapshotPathMaterialFrame,type SnapshotMaterialPathLineage} from './pathMaterialFrame';
import {curveMaterialParameterMap} from '../drawing/materialParameter';
import {resolveSnapshotFitParameter,snapshotSplitParameterParts,snapshotSplitUsesCurrentMaterialFrame} from './splitParameterField';
import {shapeOf,type DrawingDocument,type StrokeDisplayIntervals,type DisplayIntervalMode,type InkEnds,type Cubic} from '../drawing/model';
import {arcField} from '../drawing/sampling';
import {subcurve} from '../drawing/roundedJoin';
import {evaluatedMaterialSource} from '../drawing/evaluatedDeformation';
import {displayPath} from '../drawing/displayIntervals';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import {endpointPairDisplayField,transportEndpointPairMaterial} from './endpointPairMaterial';
import {snapshotIntervalMaterialSource,snapshotRouteMaterialSource} from './routeMaterialSource';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import type {SceneIntervalValue,SnapshotAngleGraph,SnapshotScalarPropertyTarget} from './model';

/** A split keeps one logical material range and its existing property fields.
 * The rendered child ranges are exact restrictions of that range. Only live
 * topology/range identities and the original orientation are persisted. */
export interface SnapshotMaterialPartition {
 sourceTrackId:string;reverse:boolean;
 parts:{curveId:string;sourceTrackId:string;parameterRange:[number,number];ranges:{rangeId:string;sourceRangeId:string}[]}[];
}
export interface SnapshotMaterialPartitionAddress {
 partition:SnapshotMaterialPartition;part:number;target:SnapshotScalarPropertyTarget;
}
const fail=(message:string):never=>{throw Error(`Material split: ${message}`);};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const own=(value:unknown,keys:readonly string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('expected plain data.');for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!))fail('unknown or accessor field.');return value as Record<string,unknown>;};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)return fail('array limit.');return value;};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>16384)fail('invalid identity.');};
export function validateSnapshotMaterialPartitions(value:unknown):asserts value is SnapshotMaterialPartition[]{
 const tracks=new Set<string>(),roots=new Set<string>();
 for(const raw of list(value,16384)){
  const partition=own(raw,['sourceTrackId','reverse','parts']);id(partition.sourceTrackId);if(roots.has(String(partition.sourceTrackId))||typeof partition.reverse!=='boolean')fail('duplicate logical material or missing direction.');roots.add(String(partition.sourceTrackId));
  const parts=list(partition.parts,256);if(parts.length<2)fail('a partition needs at least two live pieces.');let expected:string[]|undefined;
  for(const raw of parts){const part=own(raw,['curveId','sourceTrackId','parameterRange','ranges']);const domain=list(part.parameterRange,2);if(domain.length!==2||!domain.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)||!(Number(domain[0])<Number(domain[1])))fail('invalid source parameter partition.');id(part.curveId);id(part.sourceTrackId);if(tracks.has(String(part.sourceTrackId)))fail('a child material may belong to only one partition.');tracks.add(String(part.sourceTrackId));const ranges=list(part.ranges,16384),ids:string[]=[],targets=new Set<string>();for(const raw of ranges){const range=own(raw,['rangeId','sourceRangeId']);id(range.rangeId);id(range.sourceRangeId);if(ids.includes(String(range.rangeId))||targets.has(String(range.sourceRangeId)))fail('duplicate material range mapping.');ids.push(String(range.rangeId));targets.add(String(range.sourceRangeId));}if(expected&&JSON.stringify(ids)!==JSON.stringify(expected))fail('each piece must preserve the same logical ranges.');expected=ids;}
  let boundary=0;for(const part of parts as {parameterRange:[number,number]}[]){if(part.parameterRange[0]!==boundary)fail('material parameter pieces must partition the source exactly.');boundary=part.parameterRange[1];}if(boundary!==1)fail('material parameter pieces must cover the source.');
  if((parts[0] as {sourceTrackId:string}).sourceTrackId!==partition.sourceTrackId)fail('the first child must retain the logical material identity.');
 }
}
export function snapshotMaterialPartitionAddress(partitions:readonly SnapshotMaterialPartition[]|undefined,target:SnapshotScalarPropertyTarget):SnapshotMaterialPartitionAddress|undefined {
 for(const partition of partitions??[])for(let part=0;part<partition.parts.length;part++){const piece=partition.parts[part];if(piece.sourceTrackId!==target.sourceTrackId)continue;const range=piece.ranges.find(range=>range.sourceRangeId===target.rangeId);if(range)return {partition,part,target:{...target,sourceTrackId:partition.sourceTrackId,rangeId:range.rangeId}};}
 return undefined;
}
type PartitionMetric={parameter:(fraction:number)=>number;fraction:(parameter:number)=>number};
const metrics=new WeakMap<DrawingDocument,WeakMap<SnapshotMaterialPartition,PartitionMetric>>();
const metricSource=(drawing:DrawingDocument)=>snapshotSplitUsesCurrentMaterialFrame(drawing)?drawing:evaluatedMaterialSource(drawing);
const metricParts=(partition:SnapshotMaterialPartition,drawing:DrawingDocument)=>snapshotSplitParameterParts(metricSource(drawing),partition.parts);
function fittedMetricParameter(partition:SnapshotMaterialPartition,drawing:DrawingDocument,parameter:number):number {
 if(snapshotSplitUsesCurrentMaterialFrame(drawing))return parameter;
 const parts=metricParts(partition,drawing),found=parts.findIndex(part=>parameter<=part.parameterRange[1]),index=found<0?parts.length-1:found,domain=parts[index].parameterRange,native=partition.parts[index].parameterRange,t=native[0]+clamp((parameter-domain[0])/(domain[1]-domain[0]))*(native[1]-native[0]);
 return resolveSnapshotFitParameter(drawing,partition.parts,t)??parameter;
}
/** Recover maximal exact cubic runs from the live native parameter pieces.
 * Independently edited children remain separate, while a subsequent split of
 * one of those children still uses that child's original material arc table.
 * Every recovered control is verified; no historical geometry is retained. */
function partitionMetric(partition:SnapshotMaterialPartition,drawing:DrawingDocument):PartitionMetric {
 let cache=metrics.get(drawing);if(!cache){cache=new WeakMap();metrics.set(drawing,cache);}const known=cache.get(partition);if(known)return known;
 const measure=metricSource(drawing);
 const currentParts=metricParts(partition,drawing);
 const children=partition.parts.map((part,i)=>{if(!measure.curves.some(curve=>curve.id===part.curveId))fail(`parameter piece ${part.curveId} is missing from [${measure.curves.map(curve=>curve.id).join(', ')}].`);const shape=shapeOf(measure,part.curveId),path=displayPath(measure,part.curveId),field=endpointPairDisplayField(measure,path),index=field.geometry.pieces.findIndex(piece=>!piece.joinId&&piece.owners[0]===part.curveId);if(index<0)fail('a split material curve has no native material piece.');const raw=field.geometry.pieces[index].sourceRange??[0,1],range=path.segments.find(use=>use.id===part.curveId)!.reverse?[1-raw[1],1-raw[0]]:raw;return {shape,range,domain:currentParts[i].parameterRange};});
 const globalRange=(child:typeof children[number])=>child.range.map(t=>t<=0?child.domain[0]:t>=1?child.domain[1]:child.domain[0]+t*(child.domain[1]-child.domain[0])) as [number,number];
 const recompose=(start:number,end:number):Cubic|undefined=>{
  const first=children[start],last=children[end-1],lo=first.domain[0],span=last.domain[1]-lo,left=span/(first.domain[1]-lo),right=span/(last.domain[1]-last.domain[0]),parent:Cubic=[first.shape[0],first.shape[0].map((n,axis)=>n+(first.shape[1][axis]-n)*left) as [number,number],last.shape[3].map((n,axis)=>n+(last.shape[2][axis]-n)*right) as [number,number],last.shape[3]];
  return children.slice(start,end).every(child=>{const expected=subcurve(parent,(child.domain[0]-lo)/span,(child.domain[1]-lo)/span);return child.shape.every((point,i)=>point.every((value,axis)=>Math.abs(value-expected[i][axis])<=1e-11*Math.max(1,Math.abs(value),Math.abs(expected[i][axis]))));})?parent:undefined;
 };
 const domains:[number,number][]=[],shapes:Cubic[]=[];
 for(let start=0;start<children.length;){
  let end=start+1,shape=children[start].shape;
  // A live ARC trim at an interior seam is an authored material boundary,
  // even when the underlying untrimmed controls still compose one cubic.
  while(end<children.length&&children[end-1].range[1]===1&&children[end].range[0]===0){const candidate=recompose(start,end+1);if(!candidate)break;shape=candidate;end++;}
  const lo=children[start].domain[0],span=children[end-1].domain[1]-lo,domain:[number,number]=[globalRange(children[start])[0],globalRange(children[end-1])[1]];
  domains.push(domain);shapes.push(subcurve(shape,clamp((domain[0]-lo)/span),clamp((domain[1]-lo)/span)));start=end;
 }
 const field=arcField(shapes);
 if(!(field.total>0))fail('the live parent material curve is degenerate.');
 const metric:PartitionMetric={parameter:fraction=>{
  if(fraction<=0)return domains[0][0];if(fraction>=1)return domains.at(-1)![1];
  // Exact normalized run boundaries must keep their exact parameter label;
  // multiplying/dividing a table boundary again can move it by one ULP.
  for(const [index,part] of field.parts.entries()){if(fraction===part.start/field.total)return domains[index][0];if(fraction===(part.start+part.length)/field.total)return domains[index][1];}
  const distance=fraction*field.total,found=field.parts.findIndex(part=>distance<=part.start+part.length),index=found<0?field.parts.length-1:found,part=field.parts[index],local=distance-part.start;
  let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
  const t=part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);return domains[index][0]+(domains[index][1]-domains[index][0])*t;
 },fraction:parameter=>{
  if(parameter<=domains[0][0])return 0;if(parameter>=domains.at(-1)![1])return 1;
  let index=domains.findIndex(domain=>parameter<=domain[1]);if(index<0)index=domains.length-1;const part=field.parts[index],domain=domains[index];
  if(parameter===domain[0])return part.start/field.total;if(parameter===domain[1])return (part.start+part.length)/field.total;
  const t=clamp((parameter-domain[0])/(domain[1]-domain[0]));let lo=0,hi=part.pts.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.pts[mid].t<=t)lo=mid;else hi=mid;}
  return (part.start+part.dist[lo]+(part.dist[hi]-part.dist[lo])*clamp((t-part.pts[lo].t)/(part.pts[hi].t-part.pts[lo].t||1)))/field.total;
 }};
 cache.set(partition,metric);return metric;
}
function pieceParameter(partition:SnapshotMaterialPartition,drawing:DrawingDocument,index:number){const part=partition.parts[index],track=drawing.displayIntervals?.find(track=>track.id===part.sourceTrackId);if(!track)fail('a material partition piece is missing.');const source=snapshotRouteMaterialSource(drawing,track!),path=displayPath(source,part.curveId),field=endpointPairDisplayField(source,path);return curveMaterialParameterMap(snapshotSplitUsesCurrentMaterialFrame(drawing)?{...field,sourcePieceParameter:undefined,fittedPieceParameter:undefined}:field,path,part.curveId);}
export function snapshotMaterialPartitionParentValue(address:SnapshotMaterialPartitionAddress,drawing:DrawingDocument,childValue:number):number {
 const domain=metricParts(address.partition,drawing)[address.part].parameterRange,local=pieceParameter(address.partition,drawing,address.part).parameterAt(childValue),parameter=domain[0]+local*(domain[1]-domain[0]),native=partitionMetric(address.partition,drawing).fraction(parameter);return address.partition.reverse?1-native:native;
}
export function snapshotMaterialPartitionChildValue(address:SnapshotMaterialPartitionAddress,drawing:DrawingDocument,parentValue:number):number {
 const domain=metricParts(address.partition,drawing)[address.part].parameterRange,native=address.partition.reverse?1-parentValue:parentValue,parameter=partitionMetric(address.partition,drawing).parameter(native),local=clamp((parameter-domain[0])/(domain[1]-domain[0]));return pieceParameter(address.partition,drawing,address.part).valueAt(local);
}
/** An endpoint belongs to the first piece whose retained value has not yet
 * clamped to its far boundary. At an exact seam either neighboring native
 * parameter maps to the same logical point. */
export function snapshotMaterialPartitionValue(partitions:readonly SnapshotMaterialPartition[]|undefined,drawing:DrawingDocument,target:SnapshotScalarPropertyTarget,lineages?:readonly SnapshotMaterialPathLineage[]):number|undefined {
 const pathValue=snapshotPathMaterialValue(lineages,drawing,target);if(pathValue!==undefined)return pathValue;
 const partition=partitions?.find(partition=>partition.sourceTrackId===target.sourceTrackId&&partition.parts[0].ranges.some(range=>range.rangeId===target.rangeId));
 if(!partition)return drawing.displayIntervals?.find(track=>track.id===target.sourceTrackId)?.ranges.find(range=>range.id===target.rangeId)?.[target.end];
 let selected=partition.parts.length-1,value=1;
 for(let index=0;index<partition.parts.length;index++){const part=partition.parts[index],rangeId=part.ranges.find(range=>range.rangeId===target.rangeId)?.sourceRangeId,range=drawing.displayIntervals?.find(track=>track.id===part.sourceTrackId)?.ranges.find(range=>range.id===rangeId);if(!range)fail('a logical material endpoint lost a child range.');value=range![target.end];selected=index;if(value<1)break;}
 return snapshotMaterialPartitionParentValue({partition,part:selected,target},drawing,value);
}
/** Child endpoint brushes are restrictions too. Gather the original labeled
 * brushes from the live child ranges, then expose them only on the piece that
 * currently contains the independently sampled parent endpoint. */
export function snapshotMaterialPartitionInkEnds(partitions:readonly SnapshotMaterialPartition[]|undefined,drawing:DrawingDocument,sourceTrackId:string,rangeId:string,values?:{start:number;end:number}):InkEnds|undefined {
 const address=snapshotMaterialPartitionAddress(partitions,{kind:'interval-endpoint',layerId:'material',sourceTrackId,rangeId,end:'start'});if(!address)return undefined;
 const styles=([0,1] as const).map(end=>{const candidates=address.partition.parts.flatMap(part=>{const id=part.ranges.find(range=>range.rangeId===address.target.rangeId)?.sourceRangeId,range=drawing.displayIntervals?.find(track=>track.id===part.sourceTrackId)?.ranges.find(range=>range.id===id);return range?.inkEnds?.[end]?[range.inkEnds[end]]:[];});return candidates.find(style=>Object.keys(style).length)??{};}) as InkEnds;
 if(!values)return styles;
 const domain=metricParts(address.partition,drawing)[address.part].parameterRange,metric=partitionMetric(address.partition,drawing);return (['start','end'] as const).map((end,index)=>{const native=address.partition.reverse?1-values[end]:values[end],parameter=metric.parameter(native);return parameter>=domain[0]&&parameter<=domain[1]?styles[index]:{};}) as InkEnds;
}
export function createSnapshotMaterialPartitionBasis(partitions:readonly SnapshotMaterialPartition[]|undefined,bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,diagnostics:string[]=[],lineages?:readonly SnapshotMaterialPathLineage[]){
 const pathBasis=createSnapshotPathMaterialBasis(lineages,bases,drawing);
 const transported=new Map<string,StrokeDisplayIntervals>();
 const track=(basis:SnapshotSimplexBasis,trackId:string)=>{const key=JSON.stringify([basis.snapshotId,trackId]);let result=transported.get(key);if(result)return result;const source=basis.drawing.displayIntervals?.find(track=>track.id===trackId);if(!source)return fail(`live basis ${basis.snapshotId} has no material ${trackId}.`);result=transportEndpointPairMaterial(basis.drawing,source,drawing,diagnostics);transported.set(key,result);return result;};
 return (target:SnapshotScalarPropertyTarget):{target:SnapshotScalarPropertyTarget;values:number[];project:(value:number)=>number;closed?:boolean}=>{
  const path=pathBasis(target);if(path)return path;
  const address=snapshotMaterialPartitionAddress(partitions,target);if(!address)return {target,values:bases.map(basis=>{const range=track(basis,target.sourceTrackId).ranges.find(range=>range.id===target.rangeId);if(!range)fail('a live material range is absent.');return range![target.end];}),project:value=>value};
  const finalMetric=partitionMetric(address.partition,drawing),values=bases.map(basis=>{const value=snapshotMaterialPartitionValue(partitions,basis.drawing,address.target);if(value===undefined)fail('a logical material basis lost a child range.');const sourceMetric=partitionMetric(address.partition,basis.drawing),native=address.partition.reverse?1-value!:value!,parameter=sourceMetric.parameter(native),fitted=fittedMetricParameter(address.partition,basis.drawing,parameter),mapped=finalMetric.fraction(fitted);return address.partition.reverse?1-mapped:mapped;});
  return {target:address.target,values,project:value=>snapshotMaterialPartitionChildValue(address,drawing,value)};
 };
}
/** Same explicit split identities are used in every descendant. Further splits
 * replace a single live piece; the original logical field stays unchanged. */
export function remapSnapshotMaterialPartitions(existing:readonly SnapshotMaterialPartition[]|undefined,intent:CurveSplitIntent,sourceTracks:readonly StrokeDisplayIntervals[]):SnapshotMaterialPartition[] {
 const partitions=structuredClone(existing??[]) as SnapshotMaterialPartition[];
 for(const plan of intent.intervals){
  const prior=partitions.find(partition=>partition.parts.some(part=>part.sourceTrackId===plan.trackId));
  if(prior){const index=prior.parts.findIndex(part=>part.sourceTrackId===plan.trackId),part=prior.parts[index];if(part.curveId!==intent.curveId)fail('split track and curve disagree.');const cut=part.parameterRange[0]+(part.parameterRange[1]-part.parameterRange[0])*intent.t;prior.parts.splice(index,1,{...part,curveId:intent.childCurveIds[0],parameterRange:[part.parameterRange[0],cut]},{curveId:intent.childCurveIds[1],sourceTrackId:plan.rightTrackId,parameterRange:[cut,part.parameterRange[1]],ranges:part.ranges.map(range=>{const mapped=plan.ranges.find(value=>value.rangeId===range.sourceRangeId);if(!mapped)fail('missing descendant split range identity.');return {rangeId:range.rangeId,sourceRangeId:mapped!.rightRangeId};})});continue;}
  const tracks=sourceTracks.filter(track=>track.id===plan.trackId);if(!tracks.length)continue;const reverse=tracks[0].anchor.reverse;if(tracks.some(track=>track.anchor.reverse!==reverse))fail('different real bases need an explicit direction correspondence for this material split.');
  partitions.push({sourceTrackId:plan.trackId,reverse,parts:[{curveId:intent.childCurveIds[0],sourceTrackId:plan.trackId,parameterRange:[0,intent.t],ranges:plan.ranges.map(range=>({rangeId:range.rangeId,sourceRangeId:range.rangeId}))},{curveId:intent.childCurveIds[1],sourceTrackId:plan.rightTrackId,parameterRange:[intent.t,1],ranges:plan.ranges.map(range=>({rangeId:range.rangeId,sourceRangeId:range.rightRangeId}))}]});
 }
 validateSnapshotMaterialPartitions(partitions);return partitions;
}
export interface SnapshotPartitionIntervalEdit {layerId:string;sourceTrackId:string;value:SceneIntervalValue}
/** Edit a visible child endpoint in the same logical field. Each real basis
 * stores ordinary local interval overrides; all pieces are updated together
 * and inverse-transported through the existing material law. */
export function prepareSnapshotPartitionIntervalEdit(graph:SnapshotAngleGraph,evaluation:{source:DrawingDocument;drawing:DrawingDocument;state:{layers:Record<string,{intervals?:Record<string,SceneIntervalValue>}>}},target:SnapshotScalarPropertyTarget,changes:{start?:number;end?:number;mode?:DisplayIntervalMode;fullLoop?:boolean}):SnapshotPartitionIntervalEdit[]|undefined {
 const path=graph.materialPathLineages?.find(lineage=>lineage.sourceTrackId===target.sourceTrackId);
 if(path){
  const track=evaluation.drawing.displayIntervals?.find(track=>track.id===target.sourceTrackId),range=track?.ranges.find(range=>range.id===target.rangeId);if(!track||!range)fail('the edited path material range is missing.');
  for(const end of ['start','end'] as const)if(changes[end]!==undefined&&(!Number.isFinite(changes[end])||changes[end]!<0||changes[end]!>1))fail('path endpoint must be finite within 0…1.');
  if((['start','end'] as const).every(end=>changes[end]===undefined||changes[end]===range![end])&&(changes.mode===undefined||changes.mode===range!.mode)&&(changes.fullLoop===undefined||changes.fullLoop===range!.fullLoop))return [];
  const source=snapshotIntervalMaterialSource(evaluation,target.sourceTrackId),input=source.displayIntervals?.find(track=>track.id===target.sourceTrackId);if(!input)fail('the path material source is missing.');const visible=createSnapshotPathMaterialFrame(evaluation.drawing,track!),material=createSnapshotPathMaterialFrame(source,input!);if(changes.fullLoop&&!visible.closed)fail('only a closed path can be a full loop.');
  const value=(end:'start'|'end')=>{const coordinate=changes[end]??range![end];if(visible.closed&&Math.abs((changes.end??range!.end)-(changes.start??range!.start))>=1-1e-10)return coordinate;return material.positionOf(visible.materialAt(coordinate));},start=value('start'),end=changes.fullLoop?start:value('end'),layerId=source.layers.find(layer=>layer.items.includes(input!.anchor.id))?.id;if(!layerId)fail('the path material lost its layer.');
  const prior=evaluation.state.layers[layerId!]?.intervals?.[target.sourceTrackId],appearance={...(prior?.appearance??input!),ranges:(prior?.appearance??input!).ranges.map(range=>range.id===target.rangeId?{...range,...changes.mode?{mode:changes.mode}:{},...changes.fullLoop!==undefined?{fullLoop:changes.fullLoop}:{fullLoop:undefined},start,end}:range)};
  return [{layerId:layerId!,sourceTrackId:target.sourceTrackId,value:{appearance,enabled:{...prior?.enabled}}}];
 }
 const address=snapshotMaterialPartitionAddress(graph.materialPartitions,target);if(!address)return undefined;if(changes.fullLoop)fail('a curve-local material partition cannot be a full loop.');
 const current=evaluation.drawing.displayIntervals?.find(track=>track.id===target.sourceTrackId)?.ranges.find(range=>range.id===target.rangeId);if(!current)fail('the edited material range is missing.');
 const parent={start:snapshotMaterialPartitionValue(graph.materialPartitions,evaluation.drawing,{...address.target,end:'start'})!,end:snapshotMaterialPartitionValue(graph.materialPartitions,evaluation.drawing,{...address.target,end:'end'})!};
 if((['start','end'] as const).every(end=>changes[end]===undefined||changes[end]===current![end])&&(changes.mode===undefined||changes.mode===current!.mode)&&(changes.fullLoop===undefined||changes.fullLoop===current!.fullLoop))return [];
 for(const end of ['start','end'] as const)if(changes[end]!==undefined){if(!Number.isFinite(changes[end])||changes[end]!<0||changes[end]!>1)fail('child endpoint must be finite within 0…1.');if(changes[end]!==current![end])parent[end]=snapshotMaterialPartitionParentValue(address,evaluation.drawing,changes[end]!);}
 return address.partition.parts.map((part,index)=>{
  const actual=evaluation.drawing.displayIntervals?.find(track=>track.id===part.sourceTrackId);if(!actual)fail('edited child material is missing.');const rangeId=part.ranges.find(range=>range.rangeId===address.target.rangeId)!.sourceRangeId,partAddress={...address,part:index};
  const desired={...actual!,ranges:actual!.ranges.map(range=>range.id===rangeId?{...range,...changes.mode?{mode:changes.mode}:{},...changes.fullLoop===false?{fullLoop:false}:{},start:snapshotMaterialPartitionChildValue(partAddress,evaluation.drawing,parent.start),end:snapshotMaterialPartitionChildValue(partAddress,evaluation.drawing,parent.end)}:range)};
  const source=snapshotIntervalMaterialSource(evaluation,part.sourceTrackId),appearance=transportEndpointPairMaterial(evaluation.drawing,desired,source,[]),layerId=source.layers.find(layer=>layer.items.includes(part.curveId))?.id;if(!layerId)fail('edited material lost its owning layer.');
  const prior=evaluation.state.layers[layerId!]?.intervals?.[part.sourceTrackId];return {layerId:layerId!,sourceTrackId:part.sourceTrackId,value:{appearance,enabled:{...prior?.enabled}}};
 });
}

/** Deletion retires a partition with its original scalar frame. A surviving
 * child does not silently acquire the old parent's percentages. */
export function retireSnapshotMaterialPartitions(graph:SnapshotAngleGraph,removed:ReadonlySet<string>):{graph:SnapshotAngleGraph;retiredTargets:ReadonlySet<string>} {
 const retired=(graph.materialPartitions??[]).filter(partition=>removed.has(partition.sourceTrackId)||partition.parts.some(part=>removed.has(part.curveId)||removed.has(part.sourceTrackId)||part.ranges.some(range=>removed.has(range.sourceRangeId))));
 const retiredTargets=new Set(retired.map(partition=>partition.sourceTrackId));if(!retired.length)return {graph,retiredTargets};
 const properties=(value:NonNullable<SnapshotAngleGraph['propertyResponses']>)=>({edges:Object.fromEntries(Object.entries(value.edges).map(([id,values])=>[id,values.filter(value=>retiredTargets.has(value.target.sourceTrackId))]).filter(([,values])=>values.length)),triangles:Object.fromEntries(Object.entries(value.triangles).map(([id,values])=>[id,values.filter(value=>retiredTargets.has(value.target.sourceTrackId))]).filter(([,values])=>values.length))});
 let id='deleted-material-partition',index=0;while(graph.orphanedResponses?.some(archive=>archive.id===id))id=`deleted-material-partition:${++index}`;
 const archive={id,reason:'mesh-change' as const,message:'The logical material field and split mapping were archived because a live source piece or range was deleted. Remaining pieces keep their own material coordinates.',mesh:structuredClone(graph.mesh),edgeResponses:{},triangleResponses:{},materialPartitions:structuredClone(retired),...(graph.materialRecipes?{materialRecipes:structuredClone(graph.materialRecipes)}:{}),...(graph.materialBasisRecipes?{materialBasisRecipes:structuredClone(graph.materialBasisRecipes)}:{}),...(graph.propertyResponses?{propertyResponses:structuredClone(properties(graph.propertyResponses))}:{}),correctionFrames:(graph.correctionFrames??[]).filter(frame=>frame.propertyResponses).map(frame=>({id:frame.id,angle:{...frame.angle},status:frame.status,propertyResponses:structuredClone(properties(frame.propertyResponses!))}))};
 return {graph:{...graph,materialPartitions:graph.materialPartitions!.filter(partition=>!retiredTargets.has(partition.sourceTrackId)),orphanedResponses:[...graph.orphanedResponses??[],archive]},retiredTargets};
}
