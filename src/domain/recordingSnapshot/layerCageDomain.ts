import {validateCageSplitLineages,remapCageSplitLineages,type CageSplitLineage} from './cageSplitLineage';
import {drawingDeformProjection,rectQuad,type DeformProjection,type DeformRect,type Quad} from '../deformation/cageField';
import {assertBend,type BendValue} from '../deformation/coons';
import type {Point2} from '../drawing/model';
import {validateLayerCageStrokeScope,remapLayerCageStrokeScope,type LayerCageStrokeScope} from './layerCageScope';

/** An authored H(Coons) field over a fixed rest rectangle and a live layer scope.
 * Membership and evaluated geometry belong to the caller, never this DTO.
 * This standalone value is not yet a recording-snapshot deformation stage. */
export interface SnapshotLayerCageDomain {
 kind:'h-coons';
 id:string;
 layerIds:string[];
 strokeScope?:LayerCageStrokeScope;
 restRect:DeformRect;
 quad:Quad;
 bend?:BendValue;
 enabled?:boolean;
 fitLineages?:CageSplitLineage[];
}

const maxDomains=1000,maxScope=16384;
const fail=():never=>{throw Error('Invalid layer cage domain.');};
const object=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))return fail();
 return value as Record<string,unknown>;
};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=16384;
const point=(value:unknown):value is Point2=>Array.isArray(value)&&value.length===2&&typeof value[0]==='number'&&Number.isFinite(value[0])&&typeof value[1]==='number'&&Number.isFinite(value[1]);

/** Validate both JSON shape and the existing cage kernel's orientation/horizon
 * constraints. Disabling a domain never makes malformed authored data valid. */
export function validateLayerCageDomain(value:unknown):asserts value is SnapshotLayerCageDomain {
 const domain=object(value,['kind','id','layerIds','strokeScope','restRect','quad','bend','enabled','fitLineages']);
 if(domain.kind!=='h-coons'||!id(domain.id)||!Array.isArray(domain.layerIds)||!domain.layerIds.length||domain.layerIds.length>maxScope||Array.from(domain.layerIds).some(layer=>!id(layer))||new Set(domain.layerIds).size!==domain.layerIds.length||domain.enabled!==undefined&&typeof domain.enabled!=='boolean')fail();
 if(domain.fitLineages!==undefined)validateCageSplitLineages(domain.fitLineages);
 if(domain.strokeScope!==undefined)validateLayerCageStrokeScope(domain.strokeScope);
 const rect=object(domain.restRect,['min','max']);
 if(!point(rect.min)||!point(rect.max))fail();
 const restRect=rect as unknown as DeformRect,w=restRect.max[0]-restRect.min[0],h=restRect.max[1]-restRect.min[1];
 // Match cageField's minimum size while also rejecting subtraction overflow.
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<1e-7||h<1e-7)fail();
 if(!Array.isArray(domain.quad)||domain.quad.length!==4||Array.from(domain.quad).some(p=>!point(p)))fail();
 if(domain.bend!==undefined){
  const bend=object(domain.bend,['handles','enabled']);
  if(typeof bend.enabled!=='boolean'||!Array.isArray(bend.handles)||bend.handles.length!==4||Array.from(bend.handles).some(edge=>!Array.isArray(edge)||edge.length!==2||Array.from(edge).some(p=>!point(p))))fail();
  assertBend(bend as unknown as BendValue);
 }
 const projection=drawingDeformProjection(restRect,domain.quad as Quad,domain.bend as BendValue|undefined);
 // Finite JSON numbers can still overflow intermediate homography arithmetic.
 for(const p of [...rectQuad(restRect),[restRect.min[0]+w/2,restRect.min[1]+h/2] as Point2]){
  if(!point(projection.map(p))||!point(projection.vector(p,[1,0]))||!point(projection.vector(p,[0,1]))||!Number.isFinite(projection.denominator(p)))fail();
 }
}

export function validateLayerCageDomains(domains:unknown):asserts domains is readonly SnapshotLayerCageDomain[] {
 if(!Array.isArray(domains)||domains.length>maxDomains)throw Error('Invalid layer cage domain list.');
 const ids=new Set<string>();
 for(const domain of domains){validateLayerCageDomain(domain);if(ids.has(domain.id))throw Error('Duplicate layer cage domain ID.');ids.add(domain.id);}
}

/** A replacement retains its inherited position; new IDs append in own order. */
export function mergeLayerCageDomains(base:readonly SnapshotLayerCageDomain[]=[],own:readonly SnapshotLayerCageDomain[]=[]):SnapshotLayerCageDomain[] {
 validateLayerCageDomains(base);validateLayerCageDomains(own);
 const replacements=new Map(own.map(domain=>[domain.id,domain])),ids=new Set(base.map(domain=>domain.id));
 const merged=[...base.map(domain=>replacements.get(domain.id)??domain),...own.filter(domain=>!ids.has(domain.id))];
 if(merged.length>maxDomains)throw Error('Invalid layer cage domain list.');
 return merged.map(domain=>structuredClone(domain));
}

/** Filter source layer IDs before namespace remapping. Scope depends only on
 * layer identity, so an empty layer keeps its cage until that layer is removed. */
export function remapLayerCageDomains(domains:readonly SnapshotLayerCageDomain[],id:(id:string)=>string,selected?:(layerId:string)=>boolean):SnapshotLayerCageDomain[] {
 validateLayerCageDomains(domains);
 const remapped=domains.flatMap(domain=>{
  const layers=domain.layerIds.filter(layer=>!selected||selected(layer));
  return layers.length?[{...structuredClone(domain),id:id(domain.id),layerIds:layers.map(id),...(domain.strokeScope?{strokeScope:remapLayerCageStrokeScope(domain.strokeScope,id)}:{}),...(domain.fitLineages?{fitLineages:remapCageSplitLineages(domain.fitLineages,id)}:{})}]:[];
 });
 validateLayerCageDomains(remapped);return remapped;
}

/** Build a field from authored coordinates only. Callers resolve current layer
 * members and apply geometry/material fitting separately. Capturing a copy
 * keeps this field stable if a later edit changes the authored cage. */
export function layerCageDomainProjection(domain:SnapshotLayerCageDomain):DeformProjection {
 validateLayerCageDomain(domain);
 if(domain.enabled===false)return {map:p=>[...p],vector:(_p,v)=>[...v],denominator:()=>1,affine:true};
 const copy=structuredClone(domain);
 return drawingDeformProjection(copy.restRect,copy.quad,copy.bend);
}
