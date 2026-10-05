import type {Point2} from '../drawing/model';
import type {SceneShapeValue,SnapshotDeformationState} from './model';

/** The capture algorithms replace points; only shape maps, handle pairs and
 * relation-position maps are mutable below the deformation root. Domain capture
 * owns its separate copied output. Never enable sharing for mutable callers. */
export interface SnapshotControlTargetWriter {
 readonly state:SnapshotDeformationState;
 shapeFor(layerId:string):SceneShapeValue;
 handlePair(layerId:string,curveId:string):[Point2,Point2];
 relationPositions():SnapshotDeformationState['relationPositions'];
}
const work={sharedCaptures:0,detachedCaptures:0,layerMaps:0,layerStates:0,shapes:0,handlePairs:0,relationMaps:0,copiedSlots:0};
/** Shared capture work; copiedSlots counts shallow record entries/pair slots.
 * A dense layer map still copies its entries, while nested payloads stay shared. */
export const snapshotControlTargetWriteStats=()=>({...work});
export function createSnapshotControlTargetWriter(own:SnapshotDeformationState,evaluated:SnapshotDeformationState,immutableInputs=false):SnapshotControlTargetWriter {
 work[immutableInputs?'sharedCaptures':'detachedCaptures']++;
 const state=immutableInputs?{...own}:structuredClone(own),shapes=new Map<string,SceneShapeValue>(),pairs=new Map<string,Set<string>>();
 let copiedLayers=false,copiedRelations=false;
 const shapeFor=(layerId:string):SceneShapeValue=>{
  const known=shapes.get(layerId);if(known)return known;
  if(!immutableInputs){const layer=state.layers[layerId]??={};const shape=layer.shape??=structuredClone(evaluated.layers[layerId]?.shape??{nodes:{},handles:{}});shapes.set(layerId,shape);return shape;}
  if(!copiedLayers){state.layers={...state.layers};copiedLayers=true;work.layerMaps++;work.copiedSlots+=Object.keys(state.layers).length;}
  const prior=state.layers[layerId],source=prior?.shape??evaluated.layers[layerId]?.shape,shape={nodes:{...source?.nodes},handles:{...source?.handles}};
  state.layers[layerId]={...prior,shape};shapes.set(layerId,shape);work.layerStates++;work.shapes++;work.copiedSlots+=Object.keys(prior??{}).length+Object.keys(shape.nodes).length+Object.keys(shape.handles).length;
  return shape;
 };
 return {state,shapeFor,handlePair:(layerId,curveId)=>{
  const shape=shapeFor(layerId);
  if(!immutableInputs)return shape.handles[curveId]??=[[0,0],[0,0]];
  let copied=pairs.get(layerId);if(!copied){copied=new Set();pairs.set(layerId,copied);}
  if(!copied.has(curveId)){const pair=shape.handles[curveId];shape.handles[curveId]=pair?[...pair]:[[0,0],[0,0]];copied.add(curveId);work.handlePairs++;if(pair)work.copiedSlots+=pair.length;}
  return shape.handles[curveId];
 },relationPositions:()=>{
  if(immutableInputs&&!copiedRelations){state.relationPositions={...state.relationPositions};copiedRelations=true;work.relationMaps++;work.copiedSlots+=Object.keys(state.relationPositions).length;}
  return state.relationPositions;
 }};
}
