import {validateLayerCageDomain,type SnapshotLayerCageDomain} from './layerCageDomain';
import {validateSceneShape} from '../recordingScene/validation';
import type {SceneShapeValue} from '../recordingScene/model';
import {composeAffine2D,identityAffine2D,validAffine2D,type Affine2D} from '../geometry/affine2d';

/** Ordered, post-placement, live layer scope. No member curves or evaluated
 * geometry are saved. Disabling/replacing one operation restores its input,
 * including after exact zero scale. IDs also identify inherited overrides. */
export interface SnapshotLayerAffineDomain {
 kind?:'affine';
 id:string;
 layerIds:string[];
 matrix:Affine2D;
 enabled?:boolean;
 postShape?:SceneShapeValue;
}
export type SnapshotLayerDomain=SnapshotLayerAffineDomain|(SnapshotLayerCageDomain&{postShape?:SceneShapeValue});
export const isLayerCageDomain=(domain:SnapshotLayerDomain):domain is SnapshotLayerCageDomain&{postShape?:SceneShapeValue}=>domain.kind==='h-coons';
export function validateLayerDomains(domains:readonly SnapshotLayerDomain[]):void {
 const id=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=16384;
 if(!Array.isArray(domains)||domains.length>1000||new Set(domains.map(domain=>domain?.id)).size!==domains.length)throw Error('Invalid layer affine domain list.');
 for(const domain of domains){
  if(domain&&isLayerCageDomain(domain)){const {postShape,...cage}=domain;validateLayerCageDomain(cage);}
  else if(!domain||domain.kind!==undefined&&domain.kind!=='affine'||!id(domain.id)||!Array.isArray(domain.layerIds)||!domain.layerIds.length||domain.layerIds.some((layer:unknown)=>!id(layer))||new Set(domain.layerIds).size!==domain.layerIds.length||!validAffine2D(domain.matrix)||domain.enabled!==undefined&&typeof domain.enabled!=='boolean')throw Error('Invalid layer affine domain.');
  if(domain.postShape!==undefined)validateSceneShape(domain.postShape);
 }
}
export function mergeLayerDomains(base:readonly SnapshotLayerDomain[]=[],own:readonly SnapshotLayerDomain[]=[]):SnapshotLayerDomain[] {
 validateLayerDomains(base);validateLayerDomains(own);
 const replacements=new Map(own.map(domain=>[domain.id,domain])),ids=new Set(base.map(domain=>domain.id));
 return [...base.map(domain=>replacements.get(domain.id)??domain),...own.filter(domain=>!ids.has(domain.id))].map(domain=>structuredClone(domain));
}
/** One copy helper is used by independent cloning and source namespace remaps.
 * Filtering a scope preserves order and retains an empty source layer's domain. */
export function remapLayerDomains(domains:readonly SnapshotLayerDomain[],id:(id:string)=>string,selected?:(layerId:string)=>boolean,keepObject?:(id:string)=>boolean):SnapshotLayerDomain[] {
 return domains.flatMap(domain=>{const layers=domain.layerIds.filter(layer=>!selected||selected(layer));if(!layers.length)return [];
  const copy=structuredClone(domain);if(copy.postShape)copy.postShape={nodes:Object.fromEntries(Object.entries(copy.postShape.nodes).filter(([key])=>!keepObject||keepObject(key)).map(([key,value])=>[id(key),value])),handles:Object.fromEntries(Object.entries(copy.postShape.handles).filter(([key])=>!keepObject||keepObject(key)).map(([key,value])=>[id(key),value]))};
  return [{...copy,id:id(domain.id),layerIds:layers.map(id)}];
 });
}
export function layerDomainMatrices(domains:readonly SnapshotLayerDomain[]=[],layerIds?:readonly string[]):Record<string,Affine2D> {
 const available=layerIds&&new Set(layerIds),result:Record<string,Affine2D>=Object.create(null);
 for(const domain of domains)if(!isLayerCageDomain(domain)&&domain.enabled!==false)for(const id of domain.layerIds){if(available&&!available.has(id))continue;result[id]=composeAffine2D(domain.matrix,result[id]??identityAffine2D());}
 return result;
}
