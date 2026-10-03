import type {DrawingDocument} from '../drawing/model';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import {displayPath} from '../drawing/displayIntervals';
import {snapshotRouteMaterialSource} from './routeMaterialSource';
import type {SnapshotAngleGraph} from './model';
import type {SnapshotMaterialPathLineage} from './pathMaterialFrame';
export type {SnapshotMaterialPathLineage} from './pathMaterialFrame';
const fail=(message:string):never=>{throw Error(`Path material lineage: ${message}`);};
const object=(value:unknown,keys:readonly string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('expected plain data.');if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))fail('unknown or accessor field.');return value as Record<string,unknown>;};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)return fail('array limit.');return value;};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>16384)fail('invalid identifier.');};
/** Only live leaf IDs and their native parameter domains are retained. The root
 * identity labels a scalar measurement lineage, never stored original controls. */
export function validateSnapshotMaterialPathLineages(value:unknown):asserts value is SnapshotMaterialPathLineage[]{
 const tracks=new Set<string>();let leaves=0;
 for(const raw of list(value,16384)){const lineage=object(raw,['sourceTrackId','curves']);id(lineage.sourceTrackId);if(tracks.has(String(lineage.sourceTrackId)))fail('duplicate path target.');tracks.add(String(lineage.sourceTrackId));const used=new Set<string>(),roots=new Set<string>();
  for(const raw of list(lineage.curves,4096)){const curve=object(raw,['sourceCurveId','parts']);id(curve.sourceCurveId);if(roots.has(String(curve.sourceCurveId)))fail('duplicate logical curve.');roots.add(String(curve.sourceCurveId));const parts=list(curve.parts,256);if(parts.length<2)fail('a split lineage requires at least two pieces.');leaves+=parts.length;if(leaves>65536)fail('total live piece limit.');let boundary=0;
   for(const raw of parts){const part=object(raw,['curveId','parameterRange']);id(part.curveId);if(used.has(String(part.curveId)))fail('a live curve belongs to only one measurement lineage per track.');used.add(String(part.curveId));const range=list(part.parameterRange,2);if(range.length!==2||!range.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)||range[0]!==boundary||!(Number(range[1])>boundary))fail('native parameter pieces must be finite, contiguous and ordered.');boundary=Number(range[1]);}if(boundary!==1)fail('the native parameter pieces must cover the original domain.');
  }
 }
}
/** All path-scoped tracks touched by the same source split share its identities.
 * A repeated split replaces its live leaf; splitting another path member adds
 * another independent lineage. No material values or old geometry are captured. */
export function remapSnapshotMaterialPathLineages(existing:readonly SnapshotMaterialPathLineage[]|undefined,intent:CurveSplitIntent,drawings:readonly DrawingDocument[]):SnapshotMaterialPathLineage[]{
 const lineages=structuredClone(existing??[]) as SnapshotMaterialPathLineage[],updated=new Set<string>();
 for(const lineage of lineages)for(const curve of lineage.curves){const index=curve.parts.findIndex(part=>part.curveId===intent.curveId);if(index<0)continue;const part=curve.parts[index],cut=part.parameterRange[0]+(part.parameterRange[1]-part.parameterRange[0])*intent.t;curve.parts.splice(index,1,{curveId:intent.childCurveIds[0],parameterRange:[part.parameterRange[0],cut]},{curveId:intent.childCurveIds[1],parameterRange:[cut,part.parameterRange[1]]});updated.add(lineage.sourceTrackId);}
 const targets=new Set<string>();for(const drawing of drawings)for(const track of drawing.displayIntervals??[]){if(track.scope==='CURVE'&&!track.displayRoute)continue;const source=snapshotRouteMaterialSource(drawing,track);if(displayPath(source,track.anchor.id)?.segments.some(use=>use.id===intent.curveId))targets.add(track.id);}
 for(const sourceTrackId of targets){if(updated.has(sourceTrackId))continue;let lineage=lineages.find(value=>value.sourceTrackId===sourceTrackId);if(!lineage){lineage={sourceTrackId,curves:[]};lineages.push(lineage);}lineage.curves.push({sourceCurveId:intent.curveId,parts:[{curveId:intent.childCurveIds[0],parameterRange:[0,intent.t]},{curveId:intent.childCurveIds[1],parameterRange:[intent.t,1]}]});}
 validateSnapshotMaterialPathLineages(lineages);return lineages;
}
export function retireSnapshotMaterialPathLineages(graph:SnapshotAngleGraph,removed:ReadonlySet<string>):{graph:SnapshotAngleGraph;retiredTargets:ReadonlySet<string>} {
 const retired=(graph.materialPathLineages??[]).filter(lineage=>removed.has(lineage.sourceTrackId)||lineage.curves.some(curve=>curve.parts.some(part=>removed.has(part.curveId)))),retiredTargets=new Set(retired.map(lineage=>lineage.sourceTrackId));if(!retired.length)return {graph,retiredTargets};
 const properties=(value:NonNullable<SnapshotAngleGraph['propertyResponses']>)=>({edges:Object.fromEntries(Object.entries(value.edges).map(([id,values])=>[id,values.filter(value=>retiredTargets.has(value.target.sourceTrackId))]).filter(([,values])=>values.length)),triangles:Object.fromEntries(Object.entries(value.triangles).map(([id,values])=>[id,values.filter(value=>retiredTargets.has(value.target.sourceTrackId))]).filter(([,values])=>values.length))});
 let id='deleted-material-path',index=0;while(graph.orphanedResponses?.some(archive=>archive.id===id))id=`deleted-material-path:${++index}`;
 const archive={id,reason:'mesh-change' as const,message:'The path material field was archived because a live measurement piece was deleted. Remaining paths keep their own current material coordinates.',mesh:structuredClone(graph.mesh),edgeResponses:{},triangleResponses:{},materialPathLineages:structuredClone(retired),...(graph.materialRecipes?{materialRecipes:structuredClone(graph.materialRecipes)}:{}),...(graph.materialBasisRecipes?{materialBasisRecipes:structuredClone(graph.materialBasisRecipes)}:{}),...(graph.propertyResponses?{propertyResponses:structuredClone(properties(graph.propertyResponses))}:{}),correctionFrames:(graph.correctionFrames??[]).filter(frame=>frame.propertyResponses).map(frame=>({id:frame.id,angle:{...frame.angle},status:frame.status,propertyResponses:structuredClone(properties(frame.propertyResponses!))}))};
 return {graph:{...graph,materialPathLineages:graph.materialPathLineages!.filter(lineage=>!retiredTargets.has(lineage.sourceTrackId)),orphanedResponses:[...graph.orphanedResponses??[],archive]},retiredTargets};
}
