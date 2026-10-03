import {describe,it,expect} from 'vitest';
import {emptyDrawing,nodeAt,type DrawingDocument,type EndpointLink} from '../../domain/drawing/model';
import {createCurve,linkEndpoints,moveNode} from '../../domain/drawing/commands';
import {addDisplayInterval} from '../../domain/drawing/displayIntervals';
import {adoptDisplayRoute,detachDisplayRoute} from '../../domain/drawing/displayRouteAuthoring';
import {emptyRecordingSnapshot} from '../../domain/recordingSnapshot/model';
import {remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {createSnapshotRelationAuthoringIntent,mapSnapshotRelationAuthoringIntent,resolveSnapshotRelationAuthoringScope,snapshotLayerWriteOwner,snapshotRelationWriteOwner,patchSnapshotRelations} from '../../domain/recordingSnapshot/relationAuthoringIntent';
const a={curveId:'a',end:1 as const},b={curveId:'b',end:0 as const};
function fixture(){
 let drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'left',name:'Original',visible:true,locked:false,items:[]},{id:'right',name:'Reference',visible:true,locked:false,items:[]}]};
 drawing=createCurve(drawing,'left',[[-1,0],[-.7,0],[-.3,0],[0,0]],.01,'A','a');drawing=createCurve(drawing,'right',[[.2,.1],[.5,.1],[.8,.1],[1.1,.1]],.01,'B','b');
 const snapshot=emptyRecordingSnapshot('owner');snapshot.layers=[{...drawing.layers[0],kind:'original'},{kind:'reference',id:'right',name:'Reference',baseSnapshotId:'other',baseLayerId:'source-right'}];snapshot.source={artworkId:'A',originIds:Object.fromEntries(['left','a',...drawing.curves[0].nodes].map(id=>[id,id]))};
 return {drawing,snapshot};
}
describe('explicit Snapshot relation authorship',()=>{
 it('marks the source follower local in either link direction, while direct node writes acquire no relation intent',()=>{
  const {drawing,snapshot}=fixture(),unchanged=structuredClone(drawing);
  for(const [first,second] of [[a,b],[b,a]]){
   const next=linkEndpoints(drawing,first,second,true),intent=createSnapshotRelationAuthoringIntent(snapshot.id,drawing,next)!,scope=resolveSnapshotRelationAuthoringScope(intent,snapshot.id,drawing,next);
   expect(scope.curveIds).toEqual(new Set(['a','b']));expect(scope.nodeIds.has(nodeAt(drawing,a).id)).toBe(true);expect(nodeAt(next,second).position).toEqual(nodeAt(drawing,first).position);
   expect(snapshotRelationWriteOwner(snapshot,next,'endpointLinks',next.endpointLinks![0])).toBe('snapshot-local');
  }
  expect(createSnapshotRelationAuthoringIntent(snapshot.id,drawing,moveNode(drawing,nodeAt(drawing,a).id,[.3,.2]))).toBeUndefined();expect(drawing).toEqual(unchanged);
 });
 it('gives a new curve the target layer owner without allocating or renaming identities',()=>{
  const {drawing,snapshot}=fixture(),added=createCurve(drawing,'right',[[0,1],[.3,1],[.7,1],[1,1]],.01,'Local','new-canonical');
  expect(snapshotLayerWriteOwner(snapshot,'left')).toBe('source-original');expect(snapshotLayerWriteOwner(snapshot,'right')).toBe('snapshot-local');expect(added.curves.at(-1)!.id).toBe('new-canonical');expect(snapshot.source!.originIds).not.toHaveProperty('new-canonical');expect(createSnapshotRelationAuthoringIntent(snapshot.id,drawing,added)).toBeUndefined();
 });
 it('uses every resolved route member even when its anchor is an original, and keeps the old domain on detach',()=>{
  const {drawing,snapshot}=fixture(),linked=linkEndpoints(drawing,a,b,true),before=addDisplayInterval(linked,'a'),after=adoptDisplayRoute(before,before.displayIntervals![0].id,linked.endpointLinks![0].id).document;
  const intent=createSnapshotRelationAuthoringIntent(snapshot.id,before,after)!,scope=resolveSnapshotRelationAuthoringScope(intent,snapshot.id,before,after);
  expect(scope.curveIds).toEqual(new Set(['a','b']));expect(snapshotRelationWriteOwner(snapshot,after,'displayIntervals',after.displayIntervals![0])).toBe('snapshot-local');
  const detached=detachDisplayRoute(after,after.displayIntervals![0].id).document,detachIntent=createSnapshotRelationAuthoringIntent(snapshot.id,after,detached)!;
  expect(resolveSnapshotRelationAuthoringScope(detachIntent,snapshot.id,after,detached).curveIds).toEqual(new Set(['a','b']));
  const invalid={...after,endpointLinks:after.endpointLinks!.map(link=>({...link,throughDisplay:false}))};expect(()=>snapshotRelationWriteOwner(snapshot,invalid,'displayIntervals',invalid.displayIntervals![0])).toThrow(/Cannot resolve relation ownership/);
 });
 it('keeps cross-layer relations local even if both layers are source-owned',()=>{
  const {drawing,snapshot}=fixture();snapshot.layers=drawing.layers.map(layer=>({...layer,kind:'original'}));snapshot.source!.originIds=Object.fromEntries([...drawing.layers,...drawing.curves,...drawing.nodes].map(value=>[value.id,value.id]));
  const linked=linkEndpoints(drawing,a,b,true);expect(snapshotRelationWriteOwner(snapshot,linked,'endpointLinks',linked.endpointLinks![0])).toBe('snapshot-local');
  const oneLayer={...linked,layers:[{...linked.layers[0],items:['a','b']}]};expect(snapshotRelationWriteOwner(snapshot,oneLayer,'endpointLinks',oneLayer.endpointLinks![0])).toBe('source-original');
 });
 it('remaps explicit relation identities and rejects a stale owner or unrelated relation result',()=>{
  const {drawing,snapshot}=fixture(),next=linkEndpoints(drawing,a,b,true),intent=createSnapshotRelationAuthoringIntent(snapshot.id,drawing,next)!,id=(value:string)=>`canonical:${value}`;
  const scope=resolveSnapshotRelationAuthoringScope(mapSnapshotRelationAuthoringIntent(intent,id),snapshot.id,remapDrawingIdentities(drawing,id),remapDrawingIdentities(next,id));expect(scope.curveIds).toEqual(new Set(['canonical:a','canonical:b']));
  expect(()=>resolveSnapshotRelationAuthoringScope(intent,'other',drawing,next)).toThrow(/no longer agree/);expect(()=>resolveSnapshotRelationAuthoringScope(intent,snapshot.id,drawing,addDisplayInterval(next,'a'))).toThrow(/no longer agree/);
 });
});
describe('Snapshot relation patches preserve original baselines',()=>{
 const original:EndpointLink={id:'source-link',a,b},changed:EndpointLink={...original,joinBrush:{kind:'SHARP'}};
 it('updates, disables and restores a source-owned relation without overwriting its add entry',()=>{
  const owns=(id:string)=>id===original.id,patch={add:[original]},saved=structuredClone(patch),update=patchSnapshotRelations(patch,[original],[changed],owns)!;
  expect(update).toEqual({add:[original],update:[changed]});expect(patch).toEqual(saved);
  const disabled=patchSnapshotRelations(update,[changed],[],owns)!;expect(disabled).toEqual({add:[original],disable:[original.id]});expect(patchSnapshotRelations(disabled,[],[original],owns)).toEqual({add:[original],update:[original]});
 });
 it('keeps local additions local and restores disabled inherited IDs through update',()=>{
  const owns=()=>false;expect(patchSnapshotRelations({add:[original]},[original],[changed],owns)).toEqual({add:[changed]});expect(patchSnapshotRelations({add:[original]},[original],[],owns)).toBeUndefined();
  expect(patchSnapshotRelations({disable:[original.id]},[],[changed],owns)).toEqual({update:[changed]});expect(patchSnapshotRelations(undefined,[],[changed],owns)).toEqual({add:[changed]});
 });
});
