import {depthContext} from '../drawing/depth';
import {layerFor,type DrawingDocument} from '../drawing/model';
import type {SnapshotDeformationState,SnapshotElementProvenance} from './model';

/** A local depth property uses the siblings at its actual authoring Snapshot.
 * Descendants inherit these live addresses, never a copied Drawing or numeric
 * index reinterpreted against unrelated destination neighbours. */
export interface SnapshotDepthAppearanceContext {offset:number;effective:number;targetId:string;targetIds:string[]}
export function snapshotDepthAppearanceProvenance(drawing:DrawingDocument,state:SnapshotDeformationState,provenance:Record<string,SnapshotElementProvenance>):Record<string,SnapshotElementProvenance> {
 let result=provenance;
 for(const curve of drawing.curves){const layerId=layerFor(drawing,curve.id)?.id,patch=layerId?state.layers[layerId]?.curveAppearance?.[curve.id]:undefined;
  if(!patch||!Object.hasOwn(patch,'depthOffset')&&!Object.hasOwn(patch,'depthScope'))continue;
  const prior=provenance[curve.id];if(!prior)continue;const context=depthContext(drawing,curve.id);if(result===provenance)result={...provenance};
  result[curve.id]={...prior,depthContext:{offset:curve.depthOffset??0,effective:context.effective,targetId:context.target.id,targetIds:[...context.target.ids]}};
 }
 return result;
}
export function remapSnapshotDepthContext(context:SnapshotDepthAppearanceContext,map:(id:string)=>string):SnapshotDepthAppearanceContext{return {...context,targetId:map(context.targetId),targetIds:context.targetIds.map(map)};}
