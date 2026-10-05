import type {DrawingDocument,DrawingLayer,DrawingCurve} from './model';
import {drawingControlDependencyIndex} from './controlDependencyIndex';
import {layerCageCurveIds,type LayerCageScope} from '../recordingSnapshot/layerCageScope';

/** Runtime addresses for one frozen gesture frame. Persisted domains continue
 * to contain live layer/stroke provenance, never this resolved membership. */
export interface DrawingLayerDomainPlan {
 readonly curveIds:readonly string[];
 readonly layers:readonly DrawingLayer[];
 readonly curves:readonly DrawingCurve[];
 readonly separatesLinkedLayers:boolean;
}
const plans=new WeakMap<DrawingDocument,Map<string,DrawingLayerDomainPlan>>();
const provenance=new WeakMap<DrawingLayerDomainPlan,{before:DrawingDocument;key:string}>();
const work={plans:0,membershipResolutions:0,incidentEndpoints:0,linkedEndpoints:0};
export const drawingLayerDomainPlanStats=()=>({...work});
const scopeKey=(scope:LayerCageScope)=>JSON.stringify([scope.layerIds,scope.strokeScope]);

/** The caller owns an immutable evaluated Drawing or frozen control gesture.
 * Changed topology, ownership or locks have a new frame; changed layer/stroke
 * provenance has a new key. Numeric cage parameters do not change addresses. */
export function prepareDrawingLayerDomainPlan(before:DrawingDocument,scope:LayerCageScope):DrawingLayerDomainPlan {
 let cache=plans.get(before);if(!cache){cache=new Map();plans.set(before,cache);}
 const key=scopeKey(scope),known=cache.get(key);if(known)return known;
 const index=drawingControlDependencyIndex(before),targets=new Set(scope.layerIds);
 const layers=scope.layerIds.map(id=>{const layer=index.layers.get(id);if(!layer)throw Error('A layer domain target no longer exists.');return layer;});
 work.membershipResolutions++;
 const curveIds=scope.strokeScope?[...layerCageCurveIds(before,scope)]:[...new Set(layers.flatMap(layer=>layer.items))].filter(id=>index.curves.has(id)).sort((a,b)=>index.curvePositions.get(a)!-index.curvePositions.get(b)!);
 const members=new Set(curveIds),curves=curveIds.map(id=>index.curves.get(id)!),nodeIds=new Set(curves.flatMap(curve=>curve.nodes)),links=new Set(curveIds.flatMap(id=>index.linksByCurve.get(id)??[]));
 const inside=(id:string)=>members.has(id)&&targets.has(index.curveOwners.get(id)??'');
 const mixed=(ids:readonly string[])=>ids.some(inside)&&ids.some(id=>!inside(id));
 let separatesLinkedLayers=false;
 for(const link of links){work.linkedEndpoints+=2;if(mixed([link.a.curveId,link.b.curveId]))separatesLinkedLayers=true;}
 for(const id of nodeIds){const incident=index.nodeIncidence.get(id)??[];work.incidentEndpoints+=incident.length;if(mixed(incident.map(endpoint=>endpoint.curveId)))separatesLinkedLayers=true;}
 const plan=Object.freeze({curveIds:Object.freeze(curveIds),layers:Object.freeze(layers),curves:Object.freeze(curves),separatesLinkedLayers});
 provenance.set(plan,{before,key});cache.set(key,plan);work.plans++;return plan;
}

/** Only the original frame and exact semantic scope can reuse addresses.
 * Copied/foreign descriptors fall back to the canonical live resolver. */
export function drawingLayerDomainPlanProof(before:DrawingDocument,scope:LayerCageScope,plan?:DrawingLayerDomainPlan):DrawingLayerDomainPlan|undefined {
 const source=plan&&provenance.get(plan);return source?.before===before&&source.key===scopeKey(scope)?plan:undefined;
}
