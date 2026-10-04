import type {DrawingDocument} from '../drawing/model';
import type {SnapshotDeformationState} from './model';

const objectMaps=['elementPlacements','visibility','curveAppearance','paintAppearance'] as const;
/** Transfer complete sparse object records, including extension appearance
 * fields. Layer-wide placement/domain/depth continue to belong to the layer. */
export function transferSnapshotMemberState(state:SnapshotDeformationState,before:DrawingDocument,after:DrawingDocument,moves:readonly {id:string;from:string;to:string}[]):void {
 for(const {id,from,to} of moves){
  const source=state.layers[from];if(!source)continue;let target=state.layers[to];
  for(const kind of objectMaps){const map=(source as unknown as Record<string,Record<string,unknown>|undefined>)[kind];if(!map||!Object.hasOwn(map,id))continue;target??=state.layers[to]={};const owner=target as unknown as Record<string,Record<string,unknown>|undefined>;owner[kind]={...owner[kind],[id]:map[id]};delete map[id];}
  if(source.shape?.handles[id]){target??=state.layers[to]={};target.shape??={nodes:{},handles:{}};target.shape.handles[id]=source.shape.handles[id];delete source.shape.handles[id];}
  const curve=before.curves.find(curve=>curve.id===id);for(const nodeId of curve?.nodes??[]){if(!source.shape||!Object.hasOwn(source.shape.nodes,nodeId))continue;target??=state.layers[to]={};target.shape??={nodes:{},handles:{}};target.shape.nodes[nodeId]=source.shape.nodes[nodeId];if(!after.curves.some(curve=>after.layers.find(layer=>layer.id===from)?.items.includes(curve.id)&&curve.nodes.includes(nodeId)))delete source.shape.nodes[nodeId];}
  for(const track of before.displayIntervals??[])if(track.anchor.id===id&&source.intervals?.[track.id]){target??=state.layers[to]={};target.intervals={...target.intervals,[track.id]:source.intervals[track.id]};delete source.intervals[track.id];}
 }
}
