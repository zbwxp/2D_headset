import {composeAffine2D,identityAffine2D,validAffine2D,type Affine2D} from '../geometry/affine2d';

/** Ordered, post-placement, live layer scope. No member curves or evaluated
 * geometry are saved. Disabling/replacing one operation restores its input,
 * including after exact zero scale. IDs also identify inherited overrides. */
export interface SnapshotLayerAffineDomain {
 id:string;
 layerIds:string[];
 matrix:Affine2D;
 enabled?:boolean;
}
export function validateLayerDomains(domains:readonly SnapshotLayerAffineDomain[]):void {
 const id=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=16384;
 if(!Array.isArray(domains)||domains.length>1000||new Set(domains.map(domain=>domain?.id)).size!==domains.length)throw Error('Invalid layer affine domain list.');
 for(const domain of domains)if(!domain||!id(domain.id)||!Array.isArray(domain.layerIds)||!domain.layerIds.length||domain.layerIds.some((layer:unknown)=>!id(layer))||new Set(domain.layerIds).size!==domain.layerIds.length||!validAffine2D(domain.matrix)||domain.enabled!==undefined&&typeof domain.enabled!=='boolean')throw Error('Invalid layer affine domain.');
}
export function mergeLayerDomains(base:readonly SnapshotLayerAffineDomain[]=[],own:readonly SnapshotLayerAffineDomain[]=[]):SnapshotLayerAffineDomain[] {
 validateLayerDomains(base);validateLayerDomains(own);
 const replacements=new Map(own.map(domain=>[domain.id,domain])),ids=new Set(base.map(domain=>domain.id));
 return [...base.map(domain=>replacements.get(domain.id)??domain),...own.filter(domain=>!ids.has(domain.id))].map(domain=>structuredClone(domain));
}
/** One copy helper is used by independent cloning and source namespace remaps.
 * Filtering a scope preserves order and retains an empty source layer's domain. */
export function remapLayerDomains(domains:readonly SnapshotLayerAffineDomain[],id:(id:string)=>string,selected?:(layerId:string)=>boolean):SnapshotLayerAffineDomain[] {
 return domains.flatMap(domain=>{const layers=domain.layerIds.filter(layer=>!selected||selected(layer));return layers.length?[{...domain,id:id(domain.id),layerIds:layers.map(id),matrix:[...domain.matrix] as Affine2D}]:[];});
}
export function layerDomainMatrices(domains:readonly SnapshotLayerAffineDomain[]=[],layerIds?:readonly string[]):Record<string,Affine2D> {
 const available=layerIds&&new Set(layerIds),result:Record<string,Affine2D>=Object.create(null);
 for(const domain of domains)if(domain.enabled!==false)for(const id of domain.layerIds){if(available&&!available.has(id))continue;result[id]=composeAffine2D(domain.matrix,result[id]??identityAffine2D());}
 return result;
}
