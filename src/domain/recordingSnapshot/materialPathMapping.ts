import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import type {SnapshotScalarPropertyTarget} from './model';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {createSnapshotPathMaterialFrame,type SnapshotMaterialPathLineage} from './pathMaterialFrame';
const fail=(message:string):never=>{throw Error(`Path material mapping: ${message}`);};
const ownTrack=(drawing:DrawingDocument,id:string)=>drawing.displayIntervals?.find(track=>track.id===id)??fail(`live material ${id} is missing.`);
const full=(track:StrokeDisplayIntervals,rangeId:string,closed:boolean)=>{const range=track.ranges.find(range=>range.id===rangeId);return !!range&&closed&&Math.abs(range.end-range.start)>=1-1e-10;};
/** Enter the retained logical field through a material support, never by
 * reinterpreting the current path's numeric fraction in an older arc table. */
export function snapshotPathMaterialValue(lineages:readonly SnapshotMaterialPathLineage[]|undefined,drawing:DrawingDocument,target:SnapshotScalarPropertyTarget,value?:number):number|undefined {
 const lineage=lineages?.find(lineage=>lineage.sourceTrackId===target.sourceTrackId);if(!lineage)return undefined;
 const track=ownTrack(drawing,target.sourceTrackId),range=track.ranges.find(range=>range.id===target.rangeId);if(!range)fail('the logical path range is missing.');
 const actual=createSnapshotPathMaterialFrame(drawing,track),logical=createSnapshotPathMaterialFrame(drawing,track,lineage,true),coordinate=value??range![target.end];
 if(value===undefined&&full(track,target.rangeId,actual.closed))return coordinate;
 return logical.positionOf(actual.materialAt(coordinate));
}
export function createSnapshotPathMaterialBasis(lineages:readonly SnapshotMaterialPathLineage[]|undefined,bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument){
 return (target:SnapshotScalarPropertyTarget):{target:SnapshotScalarPropertyTarget;values:number[];project:(value:number)=>number;closed:boolean}|undefined=>{
  const lineage=lineages?.find(lineage=>lineage.sourceTrackId===target.sourceTrackId);if(!lineage)return undefined;
  const track=ownTrack(drawing,target.sourceTrackId),actual=createSnapshotPathMaterialFrame(drawing,track),logical=createSnapshotPathMaterialFrame(drawing,track,lineage,true);
  const values=bases.map(basis=>{const source=ownTrack(basis.drawing,target.sourceTrackId),range=source.ranges.find(range=>range.id===target.rangeId);if(!range)fail('a live path basis range is absent.');const frame=createSnapshotPathMaterialFrame(basis.drawing,source);return full(source,target.rangeId,frame.closed)?range![target.end]:logical.positionOf(frame.materialAt(range![target.end]),basis.drawing);});
  return {target,values,closed:actual.closed,project:value=>actual.positionOf(logical.materialAt(value))};
 };
}
