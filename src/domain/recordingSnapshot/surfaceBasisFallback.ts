import {sub,type DrawingDocument,type Point2} from '../drawing/model';
import {endpointPairNodeAuthorities} from './endpointPair';
import {captureSnapshotControlTargets,assertSnapshotControlTargetReplay} from './controlTargets';
import {prepareRecordingContext,resolveRecordingSnapshotBasis,snapshotSurfaceRequiredBases,retainSnapshotSavedEvaluationIdentity,type SnapshotEvaluation} from './evaluation';
import {assertSnapshotObjectsUnlocked} from './objectLocks';
import {emptySnapshotDeformationState,type Angle,type RecordingSnapshot,type RecordingSnapshotWorkspace,type SnapshotAngleGraph,type SnapshotRecording} from './model';
import {createSnapshotSurfaceResponseSampler,effectiveSnapshotSurfaceResponses,prepareSnapshotSurfaceTargetEdit,snapshotSurfaceOwnsBasisDraft} from './surfaceTargets';
import {locateSnapshotSimplex} from './triangulation';
import {type SnapshotScalarTarget} from './simplexGeometry';
import {solveBoundedSnapshotBasisAdjustment,SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS,type BoundedBasisScalar,type BasisDisplacementRow} from './boundedBasisInverse';

export class SnapshotBasisFallbackError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotBasisFallbackError(code,message);};
const sameAngle=(a:Angle,b:Angle)=>a.x===b.x&&a.y===b.y;
const key=(target:SnapshotScalarTarget,axis:0|1)=>JSON.stringify(target.kind==='node'?['node',target.nodeId,axis]:['handle',target.curveId,target.end,axis]);
const index=(drawing:DrawingDocument)=>({nodes:new Map(drawing.nodes.map(n=>[n.id,n.position])),curves:new Map(drawing.curves.map(c=>[c.id,c]))});
const vector=(drawing:ReturnType<typeof index>,curveId:string,end:0|1)=>{const curve=drawing.curves.get(curveId)!;return sub(curve.handles[end],drawing.nodes.get(curve.nodes[end])!);};
const changed=(a:number,b:number)=>Math.abs(a-b)>64*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));

/** Actual scalar constraints, including unmarked legacy knots, are protection
 * targets. Saved frame markers alone are not the source of those targets. */
function calibrationAngles(graph:SnapshotAngleGraph,active:Angle):Angle[] {
 const effective=effectiveSnapshotSurfaceResponses(graph),vertices=new Map(graph.mesh.vertices.map(v=>[v.id,v.angle])),angles=new Map<string,Angle>();
 const add=(angle:Angle)=>{if(!sameAngle(angle,active))angles.set(JSON.stringify(angle),angle);};
 for(const frame of graph.correctionFrames??[])add(frame.angle);
 for(const edge of graph.mesh.edges){const response=effective.edgeResponses[edge.id];if(!response)continue;const a=vertices.get(edge.vertexIds[0])!,b=vertices.get(edge.vertexIds[1])!;
  for(const control of [...Object.values(response.nodes),...Object.values(response.handles).flat()])for(const knots of Object.values(control))for(const [t] of knots??[])add({x:a.x*(1-t)+b.x*t,y:a.y*(1-t)+b.y*t});
 }
 for(const triangle of graph.mesh.triangles){const response=effective.triangleResponses[triangle.id];if(!response)continue;const points=triangle.vertexIds.map(id=>vertices.get(id)!);
  for(const control of [...Object.values(response.nodes),...Object.values(response.handles).flat()])for(const samples of Object.values(control))for(const {at} of samples??[])add({x:points.reduce((sum,p,i)=>sum+p.x*at[i],0),y:points.reduce((sum,p,i)=>sum+p.y*at[i],0)});
 }
 return [...angles.values()];
}

/** Joint nodes and relative handles, with a soft node penalty. This bounded
 * generalization is deliberately a cardinal-edge fallback; triangle and live
 * inherited-expression inverses continue to use the original exact solver. */
export function prepareSnapshotSurfaceBasisFallback(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,evaluation:SnapshotEvaluation,wanted:DrawingDocument,fresh:()=>string,options:{immutableInputs?:boolean}={}):{graph:SnapshotAngleGraph;snapshots:RecordingSnapshot[]} {
 const frozen=prepareRecordingContext(workspace,{useDraft:true,immutableInputs:options.immutableInputs,diagnostics:'preview'}).beginGesture();
 const graph=recording.angleGraph!,surface=evaluation.angleSurface!,location=surface.simplex!,vertices=location.snapshotIds.map(id=>graph.mesh.vertices.find(v=>v.snapshotId===id)!);
 const zero=vertices.find(v=>v.angle.x===0&&v.angle.y===0),side=vertices.find(v=>(Math.abs(v.angle.x)===90&&v.angle.y===0)||(Math.abs(v.angle.y)===90&&v.angle.x===0));
 if(location.kind!=='edge'||!zero||!side)fail('SURFACE_BASIS_FALLBACK_UNSUPPORTED','The fixed-basis inverse is unavailable here. Bounded basis adjustment currently supports only an edge from 0° to a cardinal ±90° view; this triangle or other edge needs an explicit saved-basis edit.');
 const effective=effectiveSnapshotSurfaceResponses(graph);
 if(Object.keys(effective.responseExpressions).length)fail('SURFACE_BASIS_FALLBACK_UNSUPPORTED','The fixed-basis inverse is unavailable here. Bounded basis adjustment does not yet support inherited response expressions; edit the responsible saved basis explicitly.');
 const owner=workspace.snapshots.find(s=>s.id===side!.snapshotId)!;
 if(owner.draft&&!snapshotSurfaceOwnsBasisDraft(graph,owner.id))fail('SURFACE_BASIS_DRAFT_CONFLICT','The 90° view already has a separate draft. Save or discard that draft before using the coupled correction.');
 const sideIndex=location.snapshotIds.indexOf(side!.snapshotId),zeroIndex=location.snapshotIds.indexOf(zero!.snapshotId),sideDrawing=surface.bases[sideIndex].drawing,zeroDrawing=surface.bases[zeroIndex].drawing;
 const before=index(evaluation.drawing),target=index(wanted),basis=index(sideDrawing),fixed=index(zeroDrawing),authorities=endpointPairNodeAuthorities(evaluation.drawing);
 const affected=wanted.curves.filter(c=>{const old=before.curves.get(c.id)!;return c.handles.some((p,e)=>p.some((v,a)=>changed(v,old.handles[e][a])))||c.nodes.some(id=>target.nodes.get(id)!.some((v,a)=>changed(v,before.nodes.get(id)![a])));});
 const nodeIds=new Set(affected.flatMap(c=>c.nodes.map(id=>authorities.get(id)??id))),curveIds=new Set(affected.map(c=>c.id));
 const implicated=sideDrawing.curves.filter(c=>curveIds.has(c.id)||c.nodes.some(id=>nodeIds.has(authorities.get(id)??id)));
 assertSnapshotObjectsUnlocked(sideDrawing,implicated.map(c=>c.id));
 const weights=createSnapshotSurfaceResponseSampler(graph,location),variables:{target:SnapshotScalarTarget;axis:0|1;scalar:BoundedBasisScalar}[]=[],indices=new Map<string,number>();
 const add=(control:SnapshotScalarTarget,axis:0|1,baseline:number,start:number,prior:number,desired:number)=>{
  const coordinates=location.snapshotIds.map((_,i)=>i===sideIndex?baseline:start),weight=weights(control,axis,coordinates,location.geometricWeights)[sideIndex];
  // Current-minus-native is frozen inherited/mirror residual. Native handle
  // vectors remain H-P throughout; absolute handles never become weight axes.
  const residual=prior-(start+weight*(baseline-start));
  indices.set(key(control,axis),variables.length);variables.push({target:control,axis,scalar:{span:baseline-start,target:desired-residual-start,weight,kind:control.kind}});
 };
 for(const nodeId of nodeIds)for(const axis of [0,1] as const)add({kind:'node',nodeId},axis,basis.nodes.get(nodeId)![axis],fixed.nodes.get(nodeId)![axis],before.nodes.get(nodeId)![axis],target.nodes.get(nodeId)![axis]);
 for(const curveId of curveIds)for(const end of [0,1] as const)for(const axis of [0,1] as const)add({kind:'handle',curveId,end},axis,vector(basis,curveId,end)[axis],vector(fixed,curveId,end)[axis],vector(before,curveId,end)[axis],vector(target,curveId,end)[axis]);
 const points=[...sideDrawing.nodes.map(n=>n.position),...sideDrawing.curves.flatMap(c=>c.handles),...zeroDrawing.nodes.map(n=>n.position),...zeroDrawing.curves.flatMap(c=>c.handles)],extent=(axis:0|1)=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis])),scale=Math.max(1e-6,extent(0),extent(1));
 const rows:BasisDisplacementRow[]=[];
 for(const curve of implicated)for(let sample=0;sample<=8;sample++){const t=sample/8,u=1-t,b=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];
  for(const axis of [0,1] as const){const terms:{index:number;coefficient:number}[]=[];for(const end of [0,1] as const){const node=indices.get(key({kind:'node',nodeId:authorities.get(curve.nodes[end])??curve.nodes[end]},axis)),handle=indices.get(key({kind:'handle',curveId:curve.id,end},axis));if(node!==undefined)terms.push({index:node,coefficient:end===0?b[0]+b[1]:b[2]+b[3]});if(handle!==undefined)terms.push({index:handle,coefficient:end===0?b[1]:b[2]});}rows.push({terms,weight:1/(9*Math.max(1,implicated.length))});}
 }
 const solution=solveBoundedSnapshotBasisAdjustment(variables.map(v=>v.scalar),rows,scale);
 if(!solution)fail('SURFACE_BASIS_TRUST_LIMIT','The target cannot be reached inside this correction’s finite response/basis trust region. Use a smaller drag or explicitly edit the 90° basis.');
 const delta=(control:SnapshotScalarTarget,axis:0|1)=>{const i=indices.get(key(control,axis));return i===undefined?0:solution!.deltas[i];};
 const nodeDelta=(id:string,axis:0|1)=>delta({kind:'node',nodeId:authorities.get(id)??id},axis);
 const desiredBasis:DrawingDocument={...sideDrawing,nodes:sideDrawing.nodes.map(n=>({...n,position:([0,1] as const).map(axis=>n.position[axis]+nodeDelta(n.id,axis)) as Point2})),curves:sideDrawing.curves.map(c=>({...c,handles:([0,1] as const).map(end=>([0,1] as const).map(axis=>c.handles[end][axis]+nodeDelta(c.nodes[end],axis)+delta({kind:'handle',curveId:c.id,end},axis)) as Point2) as [Point2,Point2]}))};
 const basisRecording={...recording,angle:{...side!.angle}},basisEvaluation=resolveRecordingSnapshotBasis(workspace,basisRecording,side!.snapshotId,{useDraft:true,immutableInputs:options.immutableInputs,diagnostics:'preview'}),prior=owner.draft??{angle:{...owner.angle},deformation:emptySnapshotDeformationState(),channels:[]},deformation=captureSnapshotControlTargets(basisEvaluation,desiredBasis,prior.deformation,fresh),snapshot={...owner,draft:{...prior,deformation}};
 if(options.immutableInputs)retainSnapshotSavedEvaluationIdentity(snapshot,owner);
 const frameId=effective.draft?.id??fresh(),layerIds=[...new Set([...effective.draft?.basisAdjustment?.layerIds??[],...evaluation.drawing.layers.filter(l=>implicated.some(c=>l.items.includes(c.id))).map(l=>l.id)])],snapshotIds=[...new Set([...effective.draft?.basisAdjustment?.snapshotIds??[],owner.id])];
 const frame={...effective.draft,id:frameId,angle:{...recording.angle},status:'draft' as const,basisAdjustment:{snapshotIds,layerIds,...solution!.boundActive?{trustRegionLimited:true}:{}}};
 let nextGraph:SnapshotAngleGraph={...graph,correctionFrames:effective.draft?graph.correctionFrames!.map(f=>f===effective.draft?frame:f):[...graph.correctionFrames??[],frame]};
 const snapshots=workspace.snapshots.map(s=>s===owner?snapshot:s);let stagedGraph:SnapshotAngleGraph|undefined,stagedWorkspace:RecordingSnapshotWorkspace|undefined;
 const nextWorkspace=():RecordingSnapshotWorkspace=>{if(stagedGraph!==nextGraph){stagedGraph=nextGraph;stagedWorkspace={...workspace,snapshots,recordings:workspace.recordings.map(r=>r===recording?{...r,angleGraph:nextGraph}:r)};}return stagedWorkspace!;};
 const candidate=()=>frozen.fork(nextWorkspace());
 const basisReplay=candidate().resolveBasis(recording.id,side!.snapshotId);assertSnapshotControlTargetReplay(basisReplay.drawing,desiredBasis);
 // Capture every old output BEFORE changing the bases. Responses may change
 // only in the companion draft to preserve those exact authored outputs.
 const protections=calibrationAngles(graph,recording.angle).map(angle=>({angle,drawing:frozen.sample(recording.id,{angle}).drawing}));
 const targets=[...protections,{angle:recording.angle,drawing:wanted}];
 for(const protection of targets){
  const context=candidate(),current=context.sample(recording.id,{angle:protection.angle,products:'controls'}),support=current.angleSurface;
  if(!support?.simplex||support.simplex.kind==='vertex'){assertSnapshotControlTargetReplay(current.drawing,protection.drawing);continue;}
  if(options.immutableInputs){nextGraph=context.prepareSurfaceTargetEdit(recording.id,current,protection.drawing,{angle:protection.angle,frameId,preserveDraftOwner:true}).graph;continue;}
  const temporary={...nextGraph,correctionFrames:nextGraph.correctionFrames!.map(f=>f.status==='draft'?{...f,angle:{...protection.angle}}:f)};
  const result=prepareSnapshotSurfaceTargetEdit(temporary,support.simplex,support.bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:graph.mesh.vertices.find(v=>v.snapshotId===base.snapshotId)!.angle})),current.drawing,protection.drawing,{immutableInputs:options.immutableInputs,angle:protection.angle,frameId,allBases:snapshotSurfaceRequiredBases(support,protection.angle),mirror:support.mirrorContext});
  nextGraph={...result.graph,correctionFrames:result.graph.correctionFrames!.map(f=>f.status==='draft'?{...f,angle:{...recording.angle},basisAdjustment:frame.basisAdjustment}:f)};
 }
 // Verify the entire coupled workspace after all constraints have been added;
 // nonlinear projection and adjacent-triangle interactions can reject a solve.
 for(const protection of targets)assertSnapshotControlTargetReplay(candidate().sample(recording.id,{angle:protection.angle}).drawing,protection.drawing);
 assertResponseTrustRegion(graph,nextGraph);
 const zeroBefore=frozen.resolveBasis(recording.id,zero!.snapshotId).drawing,zeroReplay=candidate().resolveBasis(recording.id,zero!.snapshotId).drawing;
 if(JSON.stringify(zeroReplay.nodes)!==JSON.stringify(zeroBefore.nodes)||JSON.stringify(zeroReplay.curves)!==JSON.stringify(zeroBefore.curves))fail('SURFACE_ZERO_BASIS_CONFLICT','This correction would change the fixed 0° controls through inheritance. Edit the responsible basis explicitly.');
 return {graph:nextGraph,snapshots:[snapshot]};
}

function assertResponseTrustRegion(before:SnapshotAngleGraph,after:SnapshotAngleGraph):void {
 const draft=effectiveSnapshotSurfaceResponses(after).draft!,vertices=new Map(before.mesh.vertices.map(v=>[v.id,v.angle]));
 const check=(angle:Angle,target:SnapshotScalarTarget,axis:0|1)=>{const location=locateSnapshotSimplex(before.mesh,angle);if(!location||location.kind==='vertex')return;const coordinates=location.geometricWeights.map(()=>0),a=createSnapshotSurfaceResponseSampler(before,location)(target,axis,coordinates,location.geometricWeights),b=createSnapshotSurfaceResponseSampler(after,location)(target,axis,coordinates,location.geometricWeights);if(b.some((w,i)=>!Number.isFinite(w)||Math.abs(w-a[i])>SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS+1e-7))fail('SURFACE_BASIS_TRUST_LIMIT','Preserving the authored angles would exceed this correction’s finite response trust region. Use a smaller drag or explicitly edit the 90° basis.');};
 for(const [edgeId,responses] of Object.entries(draft.edgeResponses??{})){const edge=before.mesh.edges.find(e=>e.id===edgeId)!,a=vertices.get(edge.vertexIds[0])!,b=vertices.get(edge.vertexIds[1])!;const controls:[SnapshotScalarTarget,{x?:readonly (readonly [number,number])[];y?:readonly (readonly [number,number])[]}][]=[...Object.entries(responses.nodes).map(([nodeId,control])=>[{kind:'node',nodeId},control] as [SnapshotScalarTarget,typeof control]),...Object.entries(responses.handles).flatMap(([curveId,pair])=>pair.map((control,end)=>[{kind:'handle',curveId,end:end as 0|1},control] as [SnapshotScalarTarget,typeof control]))];for(const [target,control] of controls)for(const axis of [0,1] as const)for(const [t] of control[axis===0?'x':'y']??[])check({x:a.x*(1-t)+b.x*t,y:a.y*(1-t)+b.y*t},target,axis);}
 for(const [triangleId,responses] of Object.entries(draft.triangleResponses??{})){const triangle=before.mesh.triangles.find(t=>t.id===triangleId)!,points=triangle.vertexIds.map(id=>vertices.get(id)!);const controls=[...Object.entries(responses.nodes).map(([nodeId,control])=>[{kind:'node',nodeId} as SnapshotScalarTarget,control] as const),...Object.entries(responses.handles).flatMap(([curveId,pair])=>pair.map((control,end)=>[{kind:'handle',curveId,end:end as 0|1} as SnapshotScalarTarget,control] as const))];for(const [target,control] of controls)for(const axis of [0,1] as const)for(const sample of control[axis===0?'x':'y']??[])check({x:points.reduce((sum,p,i)=>sum+p.x*sample.at[i],0),y:points.reduce((sum,p,i)=>sum+p.y*sample.at[i],0)},target,axis);}
}
