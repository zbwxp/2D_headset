import {emptyDrawing,layerFor,type DrawingDocument,type CurveUse,type Endpoint,type Cubic,type Point2} from '../drawing/model';
import {mapDisplayRouteReferences,createDisplayRouteField,resolveDisplayRoute} from '../drawing/displayRoutes';
import {scaleEvaluatedDisplayRouteBrush} from '../drawing/displayRouteBrush';
import {registerEvaluatedAffine,type EvaluatedAffine} from '../drawing/evaluatedAffine';
import {planArtworkLayerImport} from '../drawing/importArtworkLayers';
import {depthContext,depthPaintBatches,type PaintBatch} from '../drawing/depth';
import {paintItems} from '../drawing/strokes';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {cloneIntervalTracks,applyIntervalOverrides,applyIntervalEnableFlags} from '../vectorRecording/intervals';
import {drawingSignature} from '../vectorRecording/model';
import {deformDrawing,type DeformedDrawing,type WarpFitOptions,type WarpFitDiagnostic} from '../vectorWarp/evaluation';
import {identityScenePlacement,instanceObjectId,sceneObjectKey,sceneLayerKey,type RecordingScene,type SceneSourceResolver,type SceneInstance,type SceneLayerRef,type SceneDiagnostic,type SceneSourceObject,type WarpGrid,type Angle,type ScenePlacementValue} from './model';
import {evaluateWarpTrack,evaluateVisibilityTrack,evaluateIntervalTrack,evaluateDepthTrack,evaluatePlacementTrack,applyScenePlacement,isScenePlacementSimilarity,scenePlacementScales,scenePlacementMaxScale} from './tracks';
import {validateScene} from './validation';
import {applySceneShapes} from './shapes';
import {clampAngle} from '../vectorRecording/interpolation';

export interface SceneEvaluationOptions extends Omit<WarpFitOptions,'endpoints'> {
 angle?:Angle;useDraft?:boolean;
 /** Edit in this Warp's output space: all layers in its parent's input domain
  * omit that parent and its ancestors. Unrelated domains are isolated. */
 stopAtWarpId?:string;
 /** Explicit common-space helper. Local Warp editing keeps placement by default. */
 omitPlacements?:boolean;
 /** Omit direct Bezier pose offsets when inspecting the live Warp baseline. */
 omitShapes?:boolean;
}
export interface SceneLayerView extends SceneLayerRef {compiledLayerId:string;instanceName:string;name:string;included:boolean;inLocalDomain:boolean}
export interface SceneEvaluation {
 source:DrawingDocument;drawing:DrawingDocument;preShapeDrawing:DrawingDocument;prePlacementDrawing:DrawingDocument;angle:Angle;warpGrids:Record<string,WarpGrid>;
 /** Authored evaluated placements, even when omitPlacements hides their effect. */
 placements:Record<string,ScenePlacementValue>;
 layerMap:Record<string,string>;objectMap:Record<string,string>;provenance:Record<string,SceneSourceObject>;layers:SceneLayerView[];
 chains:Record<string,string[]>;diagnostics:SceneDiagnostic[];paintBatches:PaintBatch[];
 fitDiagnostics:Array<WarpFitDiagnostic&{sourceCurveId:string;/** Anisotropic placement uses a conservative norm bound, not a newly sampled maximum. */placementErrorBound?:true;placementPeakError?:number}>;warningCurveIds:string[];intervalTransportErrors:DeformedDrawing['intervalTransportErrors'];
 maxError:number;diagnosticStage:'preview'|'full';conflictingNodeIds:string[];
}

/** A layer has one explicit leaf. Parents are followed exactly once, child first. */
export function sceneWarpChain(scene:RecordingScene,ref:SceneLayerRef,stopAtWarpId?:string):string[]{
 const selected=stopAtWarpId?scene.warps.find(w=>w.id===stopAtWarpId):undefined;if(stopAtWarpId&&!selected)throw Error('Missing local editing Warp');
 const boundary=selected?.parentId;
 const result:string[]=[],seen=new Set<string>();let id=scene.bindings.find(b=>sceneLayerKey(b)===sceneLayerKey(ref))?.warpId;
 while(id&&id!==boundary){if(seen.has(id))throw Error('Warp parent cycle');seen.add(id);const warp=scene.warps.find(w=>w.id===id);if(!warp)throw Error('Missing Warp');result.push(id);id=warp.parentId;}
 return result;
}

/** Closed source dependencies are required for subset instances. This is the
 * same explicit dependency planner as Drawing import, never nearest geometry. */
export function sceneInstanceLayerPlan(source:DrawingDocument,layerIds:readonly string[]){return planArtworkLayerImport(source,layerIds);}

function selectedSource(source:DrawingDocument,selected:Set<string>,invalidTracks:Set<string>):DrawingDocument {
 const items=new Set(source.layers.filter(l=>selected.has(l.id)).flatMap(l=>l.items)),curves=source.curves.filter(c=>items.has(c.id)),ids=new Set(curves.map(c=>c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
 const fills=source.fills.filter(f=>items.has(f.id)&&f.boundary.every(u=>ids.has(u.id))),offsets=source.offsets.filter(o=>items.has(o.id)&&o.source.every(u=>ids.has(u.id))),allowedItems=new Set([...ids,...fills.map(f=>f.id),...offsets.map(o=>o.id)]);
 return {version:3,curves,nodes:source.nodes.filter(n=>nodes.has(n.id)),
  // Empty source layer slots preserve the reference context of element offsets.
  layers:source.layers.map(l=>({...l,items:selected.has(l.id)?l.items.filter(id=>allowedItems.has(id)):[]})),fills,offsets,
  joins:source.joins.filter(j=>ids.has(j.a.curveId)&&ids.has(j.b.curveId)),endpointLinks:source.endpointLinks?.filter(l=>ids.has(l.a.curveId)&&ids.has(l.b.curveId)),
  groups:source.groups?.filter(g=>g.curveIds.some(id=>ids.has(id))),displayIntervals:source.displayIntervals?.filter(t=>ids.has(t.anchor.id)&&!invalidTracks.has(t.id)),
 };
}
function namespace(source:DrawingDocument,instance:SceneInstance):DrawingDocument {
 const d=structuredClone(source),id=(s:string)=>instanceObjectId(instance.id,s),use=(u:CurveUse):CurveUse=>({...u,id:id(u.id)}),end=(e:Endpoint):Endpoint=>({curveId:id(e.curveId),end:e.end});
 return {version:3,
  nodes:d.nodes.map(n=>({...n,id:id(n.id)})),curves:d.curves.map(c=>({...c,id:id(c.id),nodes:[id(c.nodes[0]),id(c.nodes[1])]})),
  layers:d.layers.map(l=>({...l,id:id(l.id),items:l.items.map(id)})),fills:d.fills.map(f=>({...f,id:id(f.id),boundary:f.boundary.map(use)})),offsets:d.offsets.map(o=>({...o,id:id(o.id),source:o.source.map(use)})),
  joins:d.joins.map(j=>({...j,id:id(j.id),a:end(j.a),b:end(j.b)})),endpointLinks:d.endpointLinks?.map(l=>({...l,id:id(l.id),a:end(l.a),b:end(l.b)})),groups:d.groups?.map(g=>({...g,id:id(g.id),curveIds:g.curveIds.map(id)})),
  displayIntervals:cloneIntervalTracks(source.displayIntervals??[]).map(t=>({...t,id:id(t.id),anchor:use(t.anchor),...(t.displayRoute?{displayRoute:mapDisplayRouteReferences(t.displayRoute,id,id)}:{}),ranges:t.ranges.map(r=>withIntervalPinch({...r,id:id(r.id),...(r.originId?{originId:id(r.originId)}:{})},intervalPinch(r)))})),
 };
}
function combine(drawings:DrawingDocument[]):DrawingDocument {
 const result=emptyDrawing();for(const d of drawings){result.nodes.push(...d.nodes);result.curves.push(...d.curves);result.layers.push(...d.layers);result.fills.push(...d.fills);result.offsets.push(...d.offsets);result.joins.push(...d.joins);(result.endpointLinks??=[]).push(...(d.endpointLinks??[]));(result.groups??=[]).push(...(d.groups??[]));(result.displayIntervals??=[]).push(...(d.displayIntervals??[]));}return result;
}

/** Apply instance placement to the already-deformed transient document.
 * Unlike Drawing's editing transform this includes hidden/locked geometry and
 * all geometry, without authoring clamps or source mutation. Ink width, mist,
 * taper/extension and offset distance keep Drawing's fixed logical units. ARC
 * construction is similarity-equivariant when its trim distance also scales;
 * interval fractions/material positions therefore require no second transport.
 * Nonuniform/reflected/singular placement resolves derived ARC and material
 * coordinates before the affine, then constructs fixed-width ink afterward. */
function placeDrawing(result:DeformedDrawing,placements:Record<string,ScenePlacementValue>,provenance:Record<string,SceneSourceObject>):DeformedDrawing {
 const identity=identityScenePlacement(),value=(id:string)=>placements[provenance[id]?.instanceId]??identity;
 const active=(v:ScenePlacementValue)=>scenePlacementScales(v).some(s=>s!==1)||v.rotation!==0||v.translation[0]!==0||v.translation[1]!==0;
 if(!Object.values(placements).some(active))return result;
 const map=(id:string,p:Point2)=>{const v=value(id);return active(v)?applyScenePlacement(v,p):p;};
 const drawing:DrawingDocument={...result.drawing,
  nodes:result.drawing.nodes.map(n=>active(value(n.id))?{...n,position:map(n.id,n.position)}:n),
  curves:result.drawing.curves.map(c=>active(value(c.id))?{...c,handles:c.handles.map(point=>map(c.id,point)) as [Point2,Point2]}:c),
  // Derived offset distance stays fixed; its authored translation is a vector
  // in instance space and therefore follows the placement's rotation/scale.
  offsets:result.drawing.offsets.map(o=>{const p=value(o.id);return !active(p)||!o.translation?o:{...o,translation:applyScenePlacement({...p,translation:[0,0]},o.translation)};}),
  joins:result.drawing.joins.map(j=>j.radius!==undefined&&active(value(j.a.curveId))&&isScenePlacementSimilarity(value(j.a.curveId))?{...j,radius:j.radius*scenePlacementMaxScale(value(j.a.curveId))}:j),
  ...(result.drawing.endpointLinks?{endpointLinks:result.drawing.endpointLinks.map(l=>l.joinBrush?.kind==='ARC'&&active(value(l.a.curveId))&&isScenePlacementSimilarity(value(l.a.curveId))?{...l,joinBrush:scaleEvaluatedDisplayRouteBrush(l.joinBrush,scenePlacementMaxScale(value(l.a.curveId)))}:l)}:{}),
 };
 const affines=new Map<string,EvaluatedAffine>();for(const [id,p] of Object.entries(placements))if(!isScenePlacementSimilarity(p))affines.set(id,{point:point=>applyScenePlacement(p,point),maxScale:scenePlacementMaxScale(p)});
 if(affines.size)registerEvaluatedAffine(drawing,result.drawing,id=>affines.get(provenance[id]?.instanceId));
 const diagnostics=result.diagnostics.map(d=>{
  const p=value(d.sourceCurveId!);if(!active(p))return d;
  const maxError=d.maxError*scenePlacementMaxScale(p),endpointMismatchError=d.endpointMismatchError*scenePlacementMaxScale(p),exceedsTolerance=maxError>d.tolerance,endpointConflict=d.endpointConflict||endpointMismatchError>1e-8;
  const cubic=d.cubic.map(point=>applyScenePlacement(p,point)) as Cubic,peakExpected=applyScenePlacement(p,d.peakExpected),peakActual=applyScenePlacement(p,d.peakActual),affine=!isScenePlacementSimilarity(p),degenerate=affine&&[0,1].some(end=>Math.hypot(cubic[end?3:0][0]-cubic[end?2:1][0],cubic[end?3:0][1]-cubic[end?2:1][1])<1e-12);
  return {...d,cubic,peakExpected,peakActual,maxError,endpointMismatchError,exceedsTolerance,endpointConflict,tangentStatus:endpointConflict?'endpoint-conflict' as const:degenerate?'degenerate' as const:d.tangentStatus,warning:exceedsTolerance||endpointConflict||d.nonFinite||!!d.appearanceWarning,...(affine?{placementErrorBound:true as const,placementPeakError:Math.hypot(peakExpected[0]-peakActual[0],peakExpected[1]-peakActual[1])}:{})};
 });
 return {...result,drawing,diagnostics,maxError:diagnostics.reduce((m,d)=>Math.max(m,d.maxError),0),warningCurveIds:diagnostics.filter(d=>d.warning).map(d=>d.sourceCurveId!)};
}

/** Paint positions resolve source offsets inside their original instance first.
 * The target neighbor side survives scene layer reordering and interleaving. */
function scenePaintBatches(drawing:DrawingDocument,originals:Map<string,DrawingDocument>,provenance:Record<string,SceneSourceObject>):PaintBatch[]{
 const plain={...drawing,curves:drawing.curves.map(c=>c.depthOffset?{...c,depthOffset:0,localPaintOrder:true}:c)},base=depthPaintBatches(plain),positions=new Map<string,number>(),slots=new Map<string,number>();
 for(const b of base){positions.set(b.owner??b.item.id,b.position);if(!b.owner)for(const s of b.item.stroke?.segments??[])positions.set(s.id,b.position);}
 let cursor=0;for(const layer of drawing.layers){slots.set(layer.id,cursor);for(const item of paintItems(drawing,layer.id))cursor+=item.stroke?item.stroke.segments.length:1;cursor++;}
 const result=base.map(batch=>{
  if(!batch.owner)return batch;const p=provenance[batch.owner],source=p&&originals.get(p.instanceId),curve=source?.curves.find(c=>c.id===p.sourceId);if(!source||!curve?.depthOffset)return batch;
  const context=depthContext(source,curve.id);if(!context.effective)return batch;
  const targets=context.target.ids.map(id=>positions.get(instanceObjectId(p.instanceId,id))).filter((n):n is number=>n!==undefined);
  const position=targets.length?(curve.depthOffset>0?Math.min(...targets)-.5:Math.max(...targets)+.5):(slots.get(instanceObjectId(p.instanceId,context.target.id))??batch.position);
  return {...batch,position};
 });
 const originalOrder=new Map(base.map((b,i)=>[b.owner??b.item.id,i]));return result.sort((a,b)=>a.position-b.position||originalOrder.get(a.owner??a.item.id)!-originalOrder.get(b.owner??b.item.id)!);
}

export function evaluateScene(scene:RecordingScene,resolve:SceneSourceResolver,options:SceneEvaluationOptions={}):SceneEvaluation {
 validateScene(scene);
 const requested=options.angle??scene.angle;if(![requested.x,requested.y].every(Number.isFinite))throw Error('Scene angle must be finite.');
 const editingWarp=options.stopAtWarpId?scene.warps.find(w=>w.id===options.stopAtWarpId):undefined;if(options.stopAtWarpId&&!editingWarp)throw Error('Missing local editing Warp');
 const localParentId=editingWarp?.parentId;
 const angle={x:clampAngle(requested.x),y:clampAngle(requested.y)},useDraft=options.useDraft!==false,diagnostics:SceneDiagnostic[]=[],layers:SceneLayerView[]=[],layerMap:Record<string,string>={},objectMap:Record<string,string>={},provenance:Record<string,SceneSourceObject>={},chains:Record<string,string[]>={};
 const warpGrids=Object.fromEntries(scene.warps.map(w=>[w.id,evaluateWarpTrack(w,angle,useDraft)])),sources:DrawingDocument[]=[],inputs:DrawingDocument[]=[],originals=new Map<string,DrawingDocument>(),resolvedSources=new Map<string,DrawingDocument|undefined>();
 const placements=Object.fromEntries(scene.instances.map(instance=>{const track=scene.placementTracks?.find(t=>t.instanceId===instance.id);return [instance.id,track?evaluatePlacementTrack(track,angle,useDraft):identityScenePlacement()];}));
 if(scene.legacy?.appearancePending)diagnostics.push({code:'SOURCE_MATERIAL',message:'Legacy appearance is retained in the original rig and awaits its referenced source before migration.'});
 for(const instance of scene.instances){
  if(!resolvedSources.has(instance.artworkId))resolvedSources.set(instance.artworkId,resolve(instance.artworkId));
  const source=resolvedSources.get(instance.artworkId);if(!source){diagnostics.push({code:'MISSING_SOURCE',instanceId:instance.id,message:`Source artwork ${instance.artworkId} is missing; this instance is retained.`});continue;}
  originals.set(instance.id,source);
  const included=new Set(instance.layerIds??source.layers.map(l=>l.id)),selected=new Set(included),inDomain=new Set<string>();
  for(const id of selected)if(!source.layers.some(l=>l.id===id)){diagnostics.push({code:'MISSING_LAYER',instanceId:instance.id,sourceLayerId:id,message:`Source layer ${id} is missing.`});selected.delete(id);}
  for(const layer of source.layers){const ref={instanceId:instance.id,sourceLayerId:layer.id},full=sceneWarpChain(scene,ref);if(!localParentId||full.includes(localParentId))inDomain.add(layer.id);else if(selected.delete(layer.id))diagnostics.push({code:'LOCAL_SPACE',...ref,message:'This layer is outside the selected parent input domain and is omitted from local editing. Parent and external links apply in global preview.'});}
  const selectedCurves=new Set(source.curves.filter(c=>selected.has(layerFor(source,c.id)!.id)).map(c=>c.id)),invalidTracks=new Set<string>();
  for(const link of source.endpointLinks??[])if(selectedCurves.has(link.a.curveId)!==selectedCurves.has(link.b.curveId))diagnostics.push({code:localParentId?'LOCAL_SPACE':'PARTIAL_INSTANCE',instanceId:instance.id,sourceObjectId:link.id,message:localParentId?`External endpoint link ${link.id} is isolated in local editing; parent and external links apply only in global preview.`:`Endpoint link ${link.id} crosses an unselected source layer and is inactive here. Include its dependency to restore the connection.`});
  for(const track of source.displayIntervals??[])if(track.displayRoute){
   const resolved=resolveDisplayRoute(source,track.displayRoute),refs=new Set([track.anchor.id,...track.displayRoute.seed.segments.map(u=>u.id),...resolved.path.segments.map(u=>u.id)]);
   if([...refs].some(id=>selectedCurves.has(id))&&(resolved.diagnostics.length||[...refs].some(id=>!selectedCurves.has(id)))){invalidTracks.add(track.id);diagnostics.push({code:localParentId?'LOCAL_SPACE':'PARTIAL_INSTANCE',instanceId:instance.id,trackId:track.id,message:localParentId?`Display route ${track.id} crosses local coordinate domains. Local editing shows selected base curves; parent and external links apply only in global preview.`:`Display route ${track.id} cannot apply to this subset. Its authored data is retained; selected source curves use their base ink, which may reveal previously clipped closure lines. Include the missing dependency to restore this channel.`});}
  }
  const local=selectedSource(source,selected,invalidTracks);let input=local;
  const localItems=new Set(local.layers.flatMap(l=>l.items));for(const object of [...source.fills,...source.offsets])if(selected.has(layerFor(source,object.id)!.id)&&!localItems.has(object.id))diagnostics.push({code:'PARTIAL_INSTANCE',instanceId:instance.id,sourceObjectId:object.id,message:`Paint object ${object.id} depends on unselected curves and is inactive; its source data is retained.`});
  const layerGates=new Map<string,boolean>(),flags=new Map<string,boolean>();
  for(const track of scene.visibilityTracks.filter(t=>t.target.instanceId===instance.id)){
   const target=track.target,layer=source.layers.find(l=>l.id===target.sourceLayerId);
   if(!layer){diagnostics.push({code:'MISSING_LAYER',instanceId:instance.id,sourceLayerId:target.sourceLayerId,trackId:track.id,message:'The visibility layer is missing; its keys are retained.'});continue;}
   if(target.sourceObjectId&&!layer.items.includes(target.sourceObjectId)){diagnostics.push({code:'MISSING_OBJECT',instanceId:instance.id,sourceLayerId:layer.id,sourceObjectId:target.sourceObjectId,trackId:track.id,message:'The visibility object is missing from its source layer; its keys are retained.'});continue;}
   const value=evaluateVisibilityTrack(track,angle,useDraft);if(value===null)continue;
   if(target.sourceObjectId)flags.set(target.sourceObjectId,value);else layerGates.set(layer.id,value);
  }
  // A layer is a container gate. Opening it does not resurrect intentionally
  // hidden source members; explicit member tracks can show those individually.
  // Drawing's retired layer.visible field is not an inherited source gate.
  const enabled=(id:string,base:boolean)=>layerGates.get(layerFor(source,id)!.id)!==false&&(flags.get(id)??base);
  input={...input,curves:input.curves.map(c=>({...c,visible:enabled(c.id,c.visible)})),fills:input.fills.map(f=>({...f,visible:enabled(f.id,f.visible)})),offsets:input.offsets.map(o=>({...o,visible:enabled(o.id,o.visible)}))};
  for(const track of scene.intervalTracks.filter(t=>t.instanceId===instance.id)){
   const base=source.displayIntervals?.find(t=>t.id===track.sourceTrackId);
   if(!base){diagnostics.push({code:'MISSING_INTERVAL',instanceId:instance.id,trackId:track.id,message:`Source interval ${track.sourceTrackId} is missing; its keys are retained.`});continue;}
   if(invalidTracks.has(track.sourceTrackId))continue;
   if(!selected.has(layerFor(source,base.anchor.id)!.id))continue;
   if(track.materialIssue&&track.materialIssue.sourceSignature!==drawingSignature(source)){diagnostics.push({code:'SOURCE_MATERIAL',instanceId:instance.id,trackId:track.id,message:track.materialIssue.message});continue;}
   try{const value=evaluateIntervalTrack(track,source,angle,useDraft),appearance=value.appearance??base;input=applyIntervalOverrides(input,applyIntervalEnableFlags([appearance],value.enabled));}
   catch(error){diagnostics.push({code:'INTERVAL_APPEARANCE',instanceId:instance.id,trackId:track.id,message:error instanceof Error?error.message:String(error)});}
  }
  for(const layer of source.layers){const ref={instanceId:instance.id,sourceLayerId:layer.id},compiledLayerId=instanceObjectId(instance.id,layer.id);layers.push({...ref,compiledLayerId,instanceName:instance.name,name:layer.name,included:included.has(layer.id),inLocalDomain:inDomain.has(layer.id)});layerMap[sceneLayerKey(ref)]=compiledLayerId;chains[sceneLayerKey(ref)]=inDomain.has(layer.id)?sceneWarpChain(scene,ref,options.stopAtWarpId):[];}
  for(const binding of scene.bindings.filter(b=>b.instanceId===instance.id))if(!source.layers.some(l=>l.id===binding.sourceLayerId))diagnostics.push({code:'MISSING_LAYER',instanceId:instance.id,sourceLayerId:binding.sourceLayerId,message:'The bound source layer is missing; the binding and Warp keys are retained.'});
  const owner=new Map(source.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const)));for(const l of source.layers)owner.set(l.id,l.id);for(const c of source.curves)for(const id of c.nodes)owner.set(id,owner.get(c.id)!);for(const g of source.groups??[])if(g.curveIds.length)owner.set(g.id,owner.get(g.curveIds[0])!);for(const t of input.displayIntervals??[]){owner.set(t.id,owner.get(t.anchor.id)!);for(const r of t.ranges)owner.set(r.id,owner.get(t.anchor.id)!);}
  for(const entity of [...local.layers,...local.nodes,...local.curves,...local.fills,...local.offsets,...local.joins,...(local.endpointLinks??[]),...(local.groups??[]),...(input.displayIntervals??[]),...(input.displayIntervals??[]).flatMap(t=>t.ranges)]){const id=instanceObjectId(instance.id,entity.id);objectMap[sceneObjectKey(instance.id,entity.id)]=id;provenance[id]={instanceId:instance.id,artworkId:instance.artworkId,sourceId:entity.id,...(owner.has(entity.id)?{sourceLayerId:owner.get(entity.id)}:{})};}
  sources.push(namespace(local,instance));inputs.push(namespace(input,instance));
 }
 const source=combine(sources),input=combine(inputs),depths=new Map<string,number>();
 for(const track of scene.depthTracks??[]){const id=layerMap[sceneLayerKey(track.target)];if(!id){diagnostics.push({code:'MISSING_LAYER',...track.target,trackId:track.id,message:'The depth layer is missing; its keys are retained.'});continue;}depths.set(id,evaluateDepthTrack(track,angle,useDraft));}
 const originalIndices=new Map(input.layers.map((l,i)=>[l.id,i]));input.layers.sort((a,b)=>(originalIndices.get(a.id)!-(depths.get(a.id)??0))-(originalIndices.get(b.id)!-(depths.get(b.id)??0))||originalIndices.get(a.id)!-originalIndices.get(b.id)!);
 const deformed=deformDrawing(input,id=>{const p=provenance[id];return p?.sourceLayerId?(chains[sceneLayerKey({instanceId:p.instanceId,sourceLayerId:p.sourceLayerId})]??[]).map(id=>warpGrids[id]):[];},{...options,tolerance:options.tolerance??scene.tolerance??1/250});
 const shaped=options.omitShapes?deformed:applySceneShapes(deformed,scene,angle,useDraft,provenance,diagnostics);
 const result=options.omitPlacements?shaped:placeDrawing(shaped,placements,provenance);
 const routes=new Set<string>();for(const track of result.drawing.displayIntervals??[])if(track.displayRoute){const key=JSON.stringify(track.displayRoute);if(routes.has(key))continue;routes.add(key);for(const diagnostic of createDisplayRouteField(result.drawing,track.displayRoute).diagnostics){const p=provenance[track.id];diagnostics.push({code:'ROUTE',instanceId:p?.instanceId,trackId:p?.sourceId,message:diagnostic.message});}}
 return {source,drawing:result.drawing,preShapeDrawing:deformed.drawing,prePlacementDrawing:shaped.drawing,angle,warpGrids,placements,layerMap,objectMap,provenance,layers,chains,diagnostics,paintBatches:scenePaintBatches(result.drawing,originals,provenance),fitDiagnostics:result.diagnostics as SceneEvaluation['fitDiagnostics'],warningCurveIds:result.warningCurveIds,intervalTransportErrors:result.intervalTransportErrors,maxError:result.maxError,diagnosticStage:result.diagnosticStage,conflictingNodeIds:result.conflictingNodeIds};
}
