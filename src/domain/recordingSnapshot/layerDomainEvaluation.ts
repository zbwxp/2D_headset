import {placeDrawingAffines,drawingLayerObjectOwners} from '../drawing/affineDrawing';
import type {DrawingDocument} from '../drawing/model';
import {applyLayerCageDomain,applyLayerDomainPostShape} from './layerCageEvaluation';
import {isLayerCageDomain,layerDomainMatrices,validateLayerDomains,type SnapshotLayerDomain} from './layerDomains';
/** One authored order, with sparse control corrections immediately following
 * their own domain. Later members receive the same field and zero own delta. */
export function applyLayerDomains(input:DrawingDocument,domains:readonly SnapshotLayerDomain[]=[],options:{tolerance?:number;onFailure?:(domain:SnapshotLayerDomain,error:unknown)=>void}={}):DrawingDocument {
 validateLayerDomains(domains);if(!domains.length)return input;
 const owners=drawingLayerObjectOwners(input);
 if(domains.every(domain=>!isLayerCageDomain(domain)&&!domain.postShape))return placeDrawingAffines(input,layerDomainMatrices(domains,input.layers.map(layer=>layer.id)),id=>owners.get(id));
 let drawing=input;
 for(const domain of domains){const before=drawing;try{
  if(isLayerCageDomain(domain)){const {postShape,...cage}=domain;drawing=applyLayerCageDomain(drawing,cage,postShape,options.tolerance);continue;}
  if(domain.enabled!==false)drawing=placeDrawingAffines(drawing,Object.fromEntries(domain.layerIds.map(id=>[id,domain.matrix])),id=>owners.get(id));
  if(domain.enabled!==false&&domain.postShape)drawing=applyLayerDomainPostShape(drawing,domain.postShape,new Set(drawing.layers.filter(layer=>domain.layerIds.includes(layer.id)).flatMap(layer=>layer.items)),options.tolerance);
 }catch(error){if(!options.onFailure)throw error;options.onFailure(domain,error);drawing=before;}
 }
 return drawing;
}
