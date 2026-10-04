import {validateSnapshotPaintAppearance} from './paintAppearance';
import {validateSnapshotMemberSources} from './localMembership';
import {validateSnapshotMirrorMetadata} from './mirrorMetadata';
import {validateSnapshotObjectLocks} from './objectLocks';
import {validateLayerDomains} from './layerDomains';
import type {RecordingSnapshotWorkspace} from './model';
import {validateRecordingSnapshots} from './validation';
import {parseRecordingScenes} from '../recordingScene/persistence';
import {finitePoint,validInkEnds,validContourMist,validFillMist} from '../drawing/model';
import {validateRecordingReference} from '../recording/reference';
import {normalizeSnapshotNodeAliases,type SnapshotNodeAliases} from './nodeAliases';
import {validateSnapshotNodeForks} from './nodeForks';
import {validateSnapshotCurveAppearance} from './curveAppearance';

const fail=(message:string):never=>{throw Error(`Invalid recording snapshot JSON: ${message}`);};
const object=(value:unknown,allowed:readonly string[]):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('expected object');const data=value as Record<string,unknown>,extra=Object.keys(data).filter(key=>!allowed.includes(key));if(extra.length)fail(`unknown field ${extra.join(', ')}`);return data;};
const list=(value:unknown,max=16384):unknown[]=>{if(!Array.isArray(value)||value.length>max)return fail('array limit');return value;};
const map=(value:unknown,max=65536):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>max)return fail('map limit');return value as Record<string,unknown>;};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>16384)fail('identifier');};
const name=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>256)fail('name');};
const finite=(value:unknown,min=-Infinity,max=Infinity)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('finite numeric value');};
const boolean=(value:unknown)=>{if(typeof value!=='boolean')fail('boolean');};
const named=(data:Record<string,unknown>)=>{name(data.name);boolean(data.visible);boolean(data.locked);};
const ink=(data:Record<string,unknown>)=>{if(data.profile!==undefined&&!['UNIFORM','TAPER_END','TAPER_BOTH','EYELID'].includes(String(data.profile)))fail('ink profile');if(data.profileReverse!==undefined)boolean(data.profileReverse);if(!validInkEnds(data.inkEnds)||!validContourMist(data.mist))fail('ink appearance');};
const angle=(value:unknown)=>{object(value,['x','y']);};
const grid=(value:unknown)=>{const g=object(value,['rows','columns','bounds','nodes']);object(g.bounds,['min','max']);for(const node of list(g.nodes,10201))object(node,['position','handleU','handleV','twist']);};
const shape=(value:unknown)=>{const data=object(value,['nodes','handles']);map(data.nodes);map(data.handles);};
const placement=(value:unknown)=>{object(value,['translation','rotation','scale','scaleX','scaleY']);};
const endpoint=(value:unknown)=>{const data=object(value,['curveId','end','p','distance']);id(data.curveId);if(data.end!==0&&data.end!==1)fail('geometry endpoint');};
const uses=(value:unknown)=>{const values=list(value);if(!values.length)fail('empty curve uses');for(const raw of values){const use=object(raw,['id','reverse']);id(use.id);boolean(use.reverse);}};
const interval=(value:unknown)=>{
 const t=object(value,['id','anchor','ranges','displayRoute','scope','revealFrom','inferenceInkVersion']);id(t.id);uses([t.anchor]);
 if(t.scope!==undefined&&t.scope!=='CURVE'||t.revealFrom!==undefined&&(t.scope!=='CURVE'||t.revealFrom!==0&&t.revealFrom!==1)||t.inferenceInkVersion!==undefined&&t.inferenceInkVersion!==1)fail('interval metadata');
 for(const raw of list(t.ranges)){const range=object(raw,['id','originId','name','fullLoop','start','end','inkEnds','mode','enabled']);id(range.id);if(range.originId!==undefined)id(range.originId);finite(range.start,0,1);finite(range.end,0,1);if(range.mode!==undefined&&range.mode!=='SHOW'&&range.mode!=='HIDE')fail('interval mode');if(range.enabled!==undefined)boolean(range.enabled);if(range.fullLoop!==undefined)boolean(range.fullLoop);if(!validInkEnds(range.inkEnds))fail('interval brush');}
 if(t.displayRoute!==undefined){const route=object(t.displayRoute,['seed','throughLinkIds']),seed=object(route.seed,['segments','closed']);uses(seed.segments);list(route.throughLinkIds).forEach(id);}
};
const intervalValue=(value:unknown)=>{const data=object(value,['appearance','enabled']);if(data.appearance!==null)interval(data.appearance);map(data.enabled);};
const relation=(kind:string,value:unknown)=>{
 if(kind==='displayIntervals'){interval(value);return;}
 const data=object(value,kind==='groups'?['id','name','visible','locked','curveIds']:kind==='joins'?['id','a','b','mode','radius']:['id','a','b','throughDisplay','joinBrush']);id(data.id);
 if(kind==='groups'){named(data);list(data.curveIds).forEach(id);}else{endpoint(data.a);endpoint(data.b);}
 if(kind==='joins'){if(!['SMOOTH','CUSP','ARC'].includes(String(data.mode)))fail('join mode');if(data.mode==='ARC')finite(data.radius,Number.MIN_VALUE,2);}
 if(kind==='endpointLinks'){if(data.throughDisplay!==undefined)boolean(data.throughDisplay);if(data.joinBrush!==undefined){const brush=object(data.joinBrush,['kind','trimDistance']);if(!['SHARP','SMOOTH','ARC'].includes(String(brush.kind)))fail('endpoint brush');if(brush.kind==='ARC')finite(brush.trimDistance,Number.MIN_VALUE,2);}}
};
function relations(value:unknown){
 const data=object(value,['joins','endpointLinks','groups','displayIntervals','mirrorEditing']);
 if(data.mirrorEditing!==undefined)validateSnapshotMirrorMetadata(data.mirrorEditing);
 for(const [kind,raw] of Object.entries(data)){if(kind==='mirrorEditing')continue;const patch=object(raw,['add','update','disable']);for(const op of ['add','update'])if(patch[op]!==undefined)list(patch[op]).forEach(v=>relation(kind,v));if(patch.disable!==undefined)list(patch.disable).forEach(id);}
}
function deformation(value:unknown){
 const data=object(value,['warps','bindings','layers','relationPositions','intervalMaterialIssues','layerDomains']);
 if(data.layerDomains!==undefined){for(const raw of list(data.layerDomains,1000)){const domain=object(raw,(raw as {kind?:unknown})?.kind==='h-coons'?['kind','id','layerIds','restRect','quad','bend','enabled','postShape','fitLineages','shapeLineages']:['kind','id','layerIds','matrix','enabled','postShape','shapeLineages','materialProgram']);id(domain.id);list(domain.layerIds).forEach(id);if(domain.postShape!==undefined)shape(domain.postShape);}validateLayerDomains(data.layerDomains as Parameters<typeof validateLayerDomains>[0]);}
 if(data.intervalMaterialIssues!==undefined)for(const [trackId,issue] of Object.entries(map(data.intervalMaterialIssues))){id(trackId);materialIssue(issue);}
 for(const raw of list(data.warps,1000)){const warp=object(raw,['id','name','parentId','restGrid','grid']);id(warp.id);name(warp.name);if(warp.parentId!==undefined)id(warp.parentId);grid(warp.restGrid);grid(warp.grid);}
 for(const raw of list(data.bindings)){const binding=object(raw,['layerId','warpId']);id(binding.layerId);id(binding.warpId);}
 for(const [layerId,raw] of Object.entries(map(data.layers))){id(layerId);const layer=object(raw,['placement','elementPlacements','shape','visibility','curveAppearance','paintAppearance','intervals','depth']);if(layer.placement!==undefined)placement(layer.placement);if(layer.elementPlacements!==undefined)for(const [curveId,value] of Object.entries(map(layer.elementPlacements))){id(curveId);placement(value);}if(layer.curveAppearance!==undefined)validateSnapshotCurveAppearance(layer.curveAppearance);if(layer.paintAppearance!==undefined)validateSnapshotPaintAppearance(layer.paintAppearance);if(layer.shape!==undefined)shape(layer.shape);if(layer.visibility!==undefined)map(layer.visibility);if(layer.intervals!==undefined)Object.values(map(layer.intervals)).forEach(intervalValue);}
 for(const [relationId,raw] of Object.entries(map(data.relationPositions))){id(relationId);const relation=object(raw,['sourceLinkIds','offset']);list(relation.sourceLinkIds).forEach(id);}
}
function materialIssue(value:unknown){const data=object(value,['sourceSnapshotId','sourceSignature','message']);id(data.sourceSnapshotId);id(data.sourceSignature);if(typeof data.message!=='string'||data.message.length>4096)fail('material issue message');}
function endpointResponses(value:unknown){
 const data=object(value,['nodes','handles']),control=(value:unknown)=>{const response=object(value,['x','y']);for(const axis of ['x','y'])if(response[axis]!==undefined){let previous=0;for(const raw of list(response[axis],256)){const p=list(raw,2);if(p.length!==2)fail('response knot');finite(p[0],0,1);finite(p[1]);if((p[0] as number)<=previous||(p[0] as number)>=1)fail('response progress must increase strictly inside (0,1)');previous=p[0] as number;}}};
 for(const [key,value] of Object.entries(map(data.nodes))){id(key);control(value);}for(const [key,value] of Object.entries(map(data.handles))){id(key);const pair=list(value,2);if(pair.length!==2)fail('handle response pair');pair.forEach(control);}
}
const authored=(value:unknown)=>{for(const raw of list(value)){const ref=object(raw,['trackId','keyId']);id(ref.trackId);id(ref.keyId);}};

/** External JSON is checked before graph/value validation. No runtime object or
 * private evaluated geometry is accepted as an extra persisted field. */
export function parseRecordingSnapshots(value:unknown):RecordingSnapshotWorkspace{
 const root=object(value,['version','library','snapshots','recordings','activeRecordingId','legacyArchive']);if(root.activeRecordingId!==undefined)id(root.activeRecordingId);
 const library=object(root.library,['nodes','curves','fills','offsets']);
 const fields={nodes:['id','position'],curves:['id','name','strokeName','nodes','handles','visible','locked','width','inkVisible','inkEnds','profile','profileReverse','mist','depthOffset','depthScope','localPaintOrder'],fills:['id','name','visible','locked','color','mist','boundary','hiddenWithStroke'],offsets:['id','name','visible','locked','source','distance','start','end','taper','width','inkEnds','translation','profile','profileReverse','mist']};
 for(const category of ['nodes','curves','fills','offsets'] as const)for(const [key,raw] of Object.entries(map(library[category]))){
  id(key);const item=object(raw,fields[category]);id(item.id);if(category==='nodes'){if(!finitePoint(item.position))fail('node position');continue;}named(item);
  if(category==='curves'){ink(item);finite(item.width,Number.MIN_VALUE,1);const nodes=list(item.nodes,2),handles=list(item.handles,2);if(nodes.length!==2||handles.length!==2||handles.some(p=>!finitePoint(p)))fail('curve geometry');nodes.forEach(id);if(item.inkVisible!==undefined)boolean(item.inkVisible);if(item.strokeName!==undefined)name(item.strokeName);if(item.depthOffset!==undefined){finite(item.depthOffset,-10000,10000);if(!Number.isSafeInteger(item.depthOffset))fail('depth offset');}if(item.depthScope!==undefined&&item.depthScope!=='PARENT'&&item.depthScope!=='LAYER')fail('depth scope');if(item.localPaintOrder!==undefined)boolean(item.localPaintOrder);}
  if(category==='fills'){uses(item.boundary);if(!['white','black','transparent'].includes(String(item.color))||!validFillMist(item.mist)||item.color==='transparent'&&(item.mist as {enabled?:boolean}|undefined)?.enabled)fail('fill appearance');}
  if(category==='offsets'){ink(item);uses(item.source);finite(item.distance,-2,2);finite(item.start,0,1);finite(item.end,0,1);if((item.end as number)<=(item.start as number))fail('offset interval');finite(item.taper,0,.5);finite(item.width,Number.MIN_VALUE,1);if(item.translation!==undefined&&!finitePoint(item.translation))fail('offset translation');}
 }
 for(const raw of list(root.snapshots,10000)){
  const snapshot=object(raw,['id','name','kind','parentSnapshotId','inputMirror','parentLayers','angle','layers','relations','memberSources','nodeAliases','nodeForks','objectLocks','deformation','inheritedState','authored','source','draft']);id(snapshot.id);name(snapshot.name);angle(snapshot.angle);if(snapshot.parentSnapshotId!==undefined)id(snapshot.parentSnapshotId);
  if(snapshot.inputMirror!==undefined){const mirror=object(snapshot.inputMirror,['axisX','curvePairs','axisNodeIds']);finite(mirror.axisX);for(const raw of list(mirror.curvePairs)){const pair=object(raw,['id','a','b','reverse']);id(pair.id);id(pair.a);id(pair.b);boolean(pair.reverse);}if(mirror.axisNodeIds!==undefined)list(mirror.axisNodeIds).forEach(id);}
  if(snapshot.parentLayers!==undefined){const inherited=object(snapshot.parentLayers,['excludedLayerIds','orderOverride']);if(inherited.excludedLayerIds!==undefined)list(inherited.excludedLayerIds).forEach(id);if(inherited.orderOverride!==undefined)boolean(inherited.orderOverride);}
  for(const raw of list(snapshot.layers)){const layer=raw as Record<string,unknown>;const data=object(raw,layer?.kind==='original'?['kind','id','name','visible','locked','items','membership']:['kind','id','name','baseSnapshotId','baseLayerId','membership']);id(data.id);name(data.name);if(data.kind==='original')list(data.items).forEach(id);else{id(data.baseSnapshotId);id(data.baseLayerId);}if(data.membership!==undefined){const membership=object(data.membership,['addElementIds','excludeElementIds','orderOverride']);for(const key of ['addElementIds','excludeElementIds','orderOverride'])if(membership[key]!==undefined)list(membership[key]).forEach(id);}}
  if(snapshot.memberSources!==undefined)validateSnapshotMemberSources(snapshot.memberSources);
  if(snapshot.objectLocks!==undefined)validateSnapshotObjectLocks(snapshot.objectLocks);
  if(snapshot.nodeForks!==undefined)validateSnapshotNodeForks(snapshot.nodeForks);
  if(snapshot.nodeAliases!==undefined)normalizeSnapshotNodeAliases(snapshot.nodeAliases as SnapshotNodeAliases);
  relations(snapshot.relations);deformation(snapshot.deformation);if(snapshot.inheritedState!==undefined)deformation(snapshot.inheritedState);authored(snapshot.authored);
  if(snapshot.draft!==undefined){const draft=object(snapshot.draft,['angle','deformation','channels']);angle(draft.angle);deformation(draft.deformation);authored(draft.channels);}
  if(snapshot.source!==undefined){const source=object(snapshot.source,['artworkId','originIds','reference','mirrorAxisX','mirrorEditing']);id(source.artworkId);for(const [canonical,original] of Object.entries(map(source.originIds))){id(canonical);id(original);}if(source.mirrorAxisX!==undefined)finite(source.mirrorAxisX);validateRecordingReference(source.reference as Parameters<typeof validateRecordingReference>[0]);}
 }
 for(const raw of list(root.recordings,1000)){
  const recording=object(raw,['id','name','angle','snapshotIds','activeSnapshotId','tolerance','tracks','mode','endpointPair','angleGraph','interpolationWeights','legacy']);id(recording.id);name(recording.name);angle(recording.angle);list(recording.snapshotIds).forEach(id);if(recording.activeSnapshotId!==undefined)id(recording.activeSnapshotId);
  if(recording.mode!==undefined&&recording.mode!=='tracks'&&recording.mode!=='endpoint-pair'&&recording.mode!=='triangulated')fail('recording mode');
  if(recording.endpointPair!==undefined){const pair=object(recording.endpointPair,['axis','startSnapshotId','endSnapshotId','responses','draft']);if(pair.axis!=='x')fail('endpoint pair axis');id(pair.startSnapshotId);id(pair.endSnapshotId);if(pair.responses!==undefined)endpointResponses(pair.responses);if(pair.draft!==undefined){const draft=object(pair.draft,['angle','responses']);angle(draft.angle);endpointResponses(draft.responses);}}
  for(const raw of list(recording.tracks,65536)){
   const track=object(raw,['id','targetId','elementId','channel','sourceTrackId','keys','draft','interpolation','materialIssue']);id(track.id);id(track.targetId);if(track.elementId!==undefined)id(track.elementId);if(track.sourceTrackId!==undefined)id(track.sourceTrackId);if(track.materialIssue!==undefined){if(track.channel!=='interval')fail('material issue channel');materialIssue(track.materialIssue);}
   const check=(value:unknown)=>{if(track.channel==='placement')placement(value);if(track.channel==='shape')shape(value);if(track.channel==='warp')grid(value);if(track.channel==='interval')intervalValue(value);};
   for(const raw of list(track.keys,4096)){const key=object(raw,['id','name','angle','value']);id(key.id);if(key.name!==undefined)name(key.name);angle(key.angle);check(key.value);}
   if(track.draft!==undefined){const draft=object(track.draft,['angle','value']);angle(draft.angle);check(draft.value);}
  }
  if(recording.legacy!==undefined){const legacy=object(recording.legacy,['scene','readOnly','reason']);if(legacy.readOnly!==true||typeof legacy.reason!=='string'||!legacy.reason)fail('legacy fallback');parseRecordingScenes({version:1,scenes:[legacy.scene]});}
 }
 if(root.legacyArchive!==undefined){const archive=object(root.legacyArchive,['projectJSON','format','migrationVersion']);if(typeof archive.projectJSON!=='string'||archive.format!=='landmark-project-json'||archive.migrationVersion!==2)fail('legacy archive');try{const parsed=JSON.parse(archive.projectJSON as string);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('legacy project');}catch{fail('legacy project JSON');}}
 // v40's common layer/curve weights are retired. This is the sole accepted
 // obsolete registry field; all channel keys, drafts and archive strings survive.
 const normalized=structuredClone(value as RecordingSnapshotWorkspace);
 for(const recording of normalized.recordings)delete (recording as unknown as Record<string,unknown>).interpolationWeights;
 validateRecordingSnapshots(normalized);return normalized;
}
export const parseRecordingSnapshotWorkspace=parseRecordingSnapshots;
