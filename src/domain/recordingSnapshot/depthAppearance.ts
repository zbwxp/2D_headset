import {depthContext} from '../drawing/depth';
import {layerFor,type DrawingDocument} from '../drawing/model';
import type {SnapshotDeformationState,SnapshotElementProvenance} from './model';

/** A local depth property uses the siblings at its actual authoring Snapshot.
 * Descendants inherit these live addresses, never a copied Drawing or numeric
 * index reinterpreted against unrelated destination neighbours. */
export interface SnapshotDepthAppearanceContext {offset:number;effective:number;targetId:string;targetIds:string[]}
export function snapshotDepthAppearanceProvenance(drawing:DrawingDocument,state:SnapshotDeformationState,provenance:Record<string,SnapshotElementProvenance>):Record<string,SnapshotElementProvenance> {
 let result=provenance;
 for(const object of [...drawing.curves,...drawing.fills]){const layerId=layerFor(drawing,object.id)?.id,layer=layerId?state.layers[layerId]:undefined,patch='color' in object?layer?.paintAppearance?.[object.id]:layer?.curveAppearance?.[object.id];
  if(!patch||!Object.hasOwn(patch,'depthOffset')&&!Object.hasOwn(patch,'depthScope'))continue;
  const prior=provenance[object.id];if(!prior)continue;const context=depthContext(drawing,object.id);if(result===provenance)result={...provenance};
  result[object.id]={...prior,depthContext:{offset:object.depthOffset??0,effective:context.effective,targetId:context.target.id,targetIds:[...context.target.ids]}};
 }
 return result;
}
export function remapSnapshotDepthContext(context:SnapshotDepthAppearanceContext,map:(id:string)=>string):SnapshotDepthAppearanceContext{return {...context,targetId:map(context.targetId),targetIds:context.targetIds.map(map)};}
