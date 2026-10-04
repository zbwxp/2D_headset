import {layerDomainMatrix,type LayerDomainIntent} from '../domain/drawing/layerDomainIntent';
import {isLayerCageDomain,type SnapshotLayerDomain} from '../domain/recordingSnapshot/layerDomains';

/** Both owner adapters preserve the operation's ordered slot and post-cage A
 * corrections. Presentation IDs are resolved by the caller before this step. */
export function writeLayerDomainOperation(domains:readonly SnapshotLayerDomain[]|undefined,evaluated:readonly SnapshotLayerDomain[],intent:LayerDomainIntent,layerIds:readonly string[]=intent.scope.layerIds):SnapshotLayerDomain[] {
 const prior=evaluated.find(domain=>domain.id===intent.operationId);
 if(intent.replace){if(!prior||prior.layerIds.length!==layerIds.length||prior.layerIds.some(id=>!layerIds.includes(id)))throw Error('The saved layer domain or its exact layer scope no longer exists.');}
 else if(prior)throw Error('The layer domain operation ID is already in use.');
 const operation:SnapshotLayerDomain=intent.domain.kind==='h-coons'?{...structuredClone(intent.domain),id:intent.operationId,layerIds:[...layerIds],...(prior?.kind==='h-coons'&&prior.fitLineages?{fitLineages:prior.fitLineages}:{}),...(prior?.postShape?{postShape:prior.postShape}:{}),...(prior?.shapeLineages?{shapeLineages:prior.shapeLineages}:{})}:{id:intent.operationId,layerIds:[...layerIds],matrix:layerDomainMatrix(intent),...(prior&&!isLayerCageDomain(prior)&&prior.materialProgram?{materialProgram:structuredClone(prior.materialProgram)}:{}),...(intent.domain.kind==='affine'&&intent.domain.enabled!==undefined?{enabled:intent.domain.enabled}:{}),...(prior?.postShape?{postShape:prior.postShape}:{}),...(prior?.shapeLineages?{shapeLineages:prior.shapeLineages}:{})};
 // Editing frame parameters or toggling a domain never silently widens its scope.
 if(isLayerCageDomain(operation)&&prior&&isLayerCageDomain(prior)&&prior.strokeScope)operation.strokeScope=structuredClone(prior.strokeScope);
 return domains?.some(domain=>domain.id===operation.id)?domains.map(domain=>domain.id===operation.id?operation:domain):[...domains??[],operation];
}
