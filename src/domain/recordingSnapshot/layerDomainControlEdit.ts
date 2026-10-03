import {isIdentityAffine2D} from '../geometry/affine2d';
import {nodeAt,sub,add,type Point2,type DrawingDocument} from '../drawing/model';
import {isLayerCageDomain,isNonlinearLayerDomain,type SnapshotLayerDomain} from './layerDomains';
import type {SceneShapeValue} from '../recordingScene/model';
const different=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1])>1e-12;
const clean=(p:Point2):Point2=>p.map(n=>Math.abs(n)<1e-12?0:n) as Point2;
export function layerUsesCage(domains:readonly SnapshotLayerDomain[]|undefined,layerId:string):boolean {return !!domains?.some(domain=>isNonlinearLayerDomain(domain)&&domain.enabled!==false&&domain.layerIds.includes(layerId));}
export const isLayerControlResponseDomain=(domain:SnapshotLayerDomain)=>!isLayerCageDomain(domain)&&!domain.materialProgram&&domain.postShape!==undefined&&isIdentityAffine2D(domain.matrix);
export function layerUsesOutputControls(domains:readonly SnapshotLayerDomain[]|undefined,layerId:string):boolean {return !!domains?.some(domain=>(isNonlinearLayerDomain(domain)||domain.postShape!==undefined)&&domain.enabled!==false&&domain.layerIds.includes(layerId));}
/** Diff explicit Drawing targets in the LAST domain's output coordinates. No
 * spatial inverse is applied to a fitted handle; new members have no entries. */
export function captureLayerDomainControls(before:DrawingDocument,wanted:DrawingDocument,evaluated:readonly SnapshotLayerDomain[],own:readonly SnapshotLayerDomain[]|undefined,layerIds:Iterable<string>){
 let domains=[...own??[]];const handledLayers=new Set<string>(),writes=new Map<string,SnapshotLayerDomain>(),nodes=new Map<string,Set<string>>();
 for(const layerId of layerIds){if(!layerUsesOutputControls(evaluated,layerId))continue;handledLayers.add(layerId);
  const last=[...evaluated].reverse().find(domain=>domain.enabled!==false&&domain.layerIds.includes(layerId))!;let changed=writes.get(last.id);if(!changed){changed=structuredClone(last);changed.postShape??={nodes:{},handles:{}};writes.set(last.id,changed);nodes.set(last.id,new Set());}
  const shape=changed.postShape as SceneShapeValue,layer=before.layers.find(layer=>layer.id===layerId);if(!layer)continue;
  for(const curve of before.curves.filter(curve=>layer.items.includes(curve.id))){const target=wanted.curves.find(value=>value.id===curve.id);if(!target)continue;
   for(const end of [0,1] as const){const a=nodeAt(before,{curveId:curve.id,end}),b=nodeAt(wanted,{curveId:curve.id,end});
    if(!nodes.get(last.id)!.has(a.id)&&different(a.position,b.position)){const delta=clean(add(shape.nodes[a.id]??[0,0],sub(b.position,a.position)));if(delta.some(Boolean))shape.nodes[a.id]=delta;else delete shape.nodes[a.id];nodes.get(last.id)!.add(a.id);}
    const oldVector=sub(curve.handles[end],a.position),vector=sub(target.handles[end],b.position);if(!different(oldVector,vector))continue;
    const pair=shape.handles[curve.id]??=[[0,0],[0,0]];pair[end]=clean(add(pair[end],sub(vector,oldVector)));if(pair.every(p=>p.every(n=>n===0)))delete shape.handles[curve.id];
   }
  }
 }
 for(const [id,domain] of writes)domains=domains.some(value=>value.id===id)?domains.map(value=>value.id===id?domain:value):[...domains,domain];
 return {domains,handledLayers};
}
