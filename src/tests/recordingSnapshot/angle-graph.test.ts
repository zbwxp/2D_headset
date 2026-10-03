import {describe,it,expect} from 'vitest';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording,type SnapshotAngleGraph,type SnapshotEndpointResponses} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {validateRecordingSnapshots} from '../../domain/recordingSnapshot/validation';
import {createSnapshotAngleGraph,validateSnapshotAngleGraph,createTriangulatedRecordingCopy,mapEndpointPairToAngleGraph,reverseSnapshotEndpointResponses,reconcileSnapshotAngleGraphMesh} from '../../domain/recordingSnapshot/angleGraph';
import {createSnapshotTriangulation,removeSnapshotVertex,rebindSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import {evaluateEndpointResponse,interpolateEndpointPairGeometry} from '../../domain/recordingSnapshot/endpointPair';
import {evaluateRecordingSnapshot,resolveEndpointPairBasis} from '../../domain/recordingSnapshot/evaluation';

function drawing():DrawingDocument{return {...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'c',name:'Curve',nodes:['a','b'],handles:[[.2,.3],[.8,.3]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]};}
function pair(side=90){
 const w=emptyRecordingSnapshotWorkspace(),d=drawing();w.library.nodes=Object.fromEntries(d.nodes.map(n=>[n.id,n]));w.library.curves=Object.fromEntries(d.curves.map(c=>[c.id,c]));
 const start=emptyRecordingSnapshot('start','Front'),end=emptyRecordingSnapshot('end','Side','view',{x:side,y:0});for(const snapshot of [start,end])snapshot.layers=d.layers.map(layer=>({...layer,kind:'original'}));
 const r=emptySnapshotRecording('recording');r.mode='endpoint-pair';r.snapshotIds=['start','end'];r.activeSnapshotId='end';r.angle={x:side/2,y:0};r.endpointPair={axis:'x',startSnapshotId:'start',endSnapshotId:'end'};
 r.tracks=[{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'end-key',angle:{x:side,y:0},value:{nodes:{a:[2,4],b:[4,2]},handles:{c:[[1,2],[3,1]]}}}],draft:{angle:{x:side,y:0},value:{nodes:{a:[3,5]},handles:{c:[[2,1],[2,3]]}}}}];
 end.authored=[{trackId:'shape',keyId:'end-key'}];end.draft={angle:{...end.angle},deformation:structuredClone(end.deformation),channels:[...end.authored]};
 w.snapshots=[start,end];w.recordings=[r];w.activeRecordingId=r.id;return {w,r,start,end};
}
const responses=():SnapshotEndpointResponses=>({nodes:{a:{x:[[.25,-2],[.5,3],[.75,1.5]],y:[[.25,2],[.75,-1]]}},handles:{c:[{x:[[.5,3]],y:[[.25,-1],[.75,2]]},{x:[[.5,-2]]}]}});
function triangle(){const graph=createSnapshotAngleGraph([{snapshotId:'a',angle:{x:0,y:0}},{snapshotId:'b',angle:{x:90,y:0}},{snapshotId:'c',angle:{x:0,y:90}}]);return {graph,edge:graph.mesh.edges[0],face:graph.mesh.triangles[0]};}

describe('opt-in recorder angle graph persistence',()=>{
 it('round-trips old data without adding a mode, mesh or parent defaults',()=>{
  const {w,r}=pair();delete r.mode;delete r.endpointPair;const before=JSON.stringify(w),parsed=parseRecordingSnapshots(JSON.parse(before));
  expect(JSON.stringify(parsed)).toBe(before);expect(parsed.recordings[0].angleGraph).toBeUndefined();expect(parsed.recordings[0].mode).toBeUndefined();expect(parsed.snapshots[0].parentSnapshotId).toBeUndefined();
 });
 it('round-trips the explicit graph, shared edges, signed interior samples and recorder correction drafts',()=>{
  const {w,r}=pair();const third=emptyRecordingSnapshot('third','Up','view',{x:0,y:90});w.snapshots.push(third);r.snapshotIds.push(third.id);r.mode='triangulated';delete r.endpointPair;
  const graph=createSnapshotAngleGraph(w.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle}))),edge=graph.mesh.edges[0].id,face=graph.mesh.triangles[0].id;
  graph.edgeResponses[edge]=responses();graph.triangleResponses[face]={nodes:{a:{x:[{id:'node-sample',at:[.2,.3,.5],weights:[-1,3,-1]}]}},handles:{c:[{y:[{id:'handle-sample',at:[.5,.25,.25],weights:[2,-2,1]}]},{}]}};
  graph.correctionFrames=[{id:'draft',angle:{x:30,y:30},status:'draft',triangleResponses:{[face]:structuredClone(graph.triangleResponses[face])}}];r.angleGraph=graph;
  const before=JSON.stringify(w),parsed=parseRecordingSnapshots(JSON.parse(before));expect(JSON.stringify(parsed)).toBe(before);expect(parsed).not.toBe(w);expect(parsed.recordings[0].angleGraph!.mesh.vertices).toHaveLength(3);
 });
 it('treats the recorder vertex angle separately from the legacy saved snapshot angle',()=>{
  const {w}=pair(),copy=createTriangulatedRecordingCopy(w,'recording',{id:'copy'});expect(copy.ok).toBe(true);if(!copy.ok)return;
  const recording=copy.workspace.recordings.at(-1)!,graph=recording.angleGraph!,vertex=graph.mesh.vertices.find(vertex=>vertex.snapshotId===copy.snapshotIdMap.end)!;
  graph.mesh=rebindSnapshotVertex(graph.mesh,vertex.snapshotId,{x:80,y:10});
  expect(()=>parseRecordingSnapshots(JSON.parse(JSON.stringify(copy.workspace)))).not.toThrow();expect(copy.workspace.snapshots.find(snapshot=>snapshot.id===vertex.snapshotId)!.angle).toEqual({x:90,y:0});
 });
 it('requires explicit graph mode and exactly one mesh binding for every real view',()=>{
  const {w,r}=pair();r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));expect(()=>parseRecordingSnapshots(w)).toThrow(/explicit triangulated/);
  r.mode='triangulated';delete r.endpointPair;r.angleGraph=createSnapshotAngleGraph([{snapshotId:'start',angle:{x:0,y:0}}]);expect(()=>parseRecordingSnapshots(w)).toThrow(/every real recording snapshot/);
 });
 it('rejects unknown persisted geometry, bad shared-edge references and invalid interior support',()=>{
  const {graph,edge,face}=triangle();const bad=structuredClone(graph) as SnapshotAngleGraph&{geometry?:unknown};bad.geometry={nodes:{}};expect(()=>validateSnapshotAngleGraph(bad)).toThrow(/unknown field/);
  graph.edgeResponses.missing=responses();expect(()=>validateSnapshotAngleGraph(graph)).toThrow(/missing simplex/);delete graph.edgeResponses.missing;
  graph.edgeResponses[edge.id]=responses();graph.triangleResponses[face.id]={nodes:{a:{x:[{id:'bad',at:[.5,.5,0],weights:[1,0,0]}]}},handles:{}};expect(()=>validateSnapshotAngleGraph(graph)).toThrow(/strictly inside/);
 });
 it('preserves a single semantic parent independently from multiple layer source addresses',()=>{
  const {w,start,end}=pair();const source=emptyRecordingSnapshot('source','Source','drawing');w.snapshots.push(source);end.parentSnapshotId=start.id;end.layers.push({kind:'reference',id:'second-source',name:'Other source',baseSnapshotId:source.id,baseLayerId:'source-layer'});
  expect(parseRecordingSnapshots(w).snapshots[1].parentSnapshotId).toBe(start.id);start.parentSnapshotId=end.id;expect(()=>validateRecordingSnapshots(w)).toThrow(/parent cycle/);delete start.parentSnapshotId;end.parentSnapshotId='missing';expect(()=>parseRecordingSnapshots(w)).toThrow(/missing snapshot parent/);
 });
});

describe('explicit endpoint-pair working-copy migration',()=>{
 it.each([-90,90])('keeps original yaw %s data byte-identical and canonical geometry identities stable',side=>{
  const {w,r,start,end}=pair(side);r.endpointPair!.responses=responses();r.endpointPair!.draft={angle:{x:side/3,y:0},responses:responses()};end.parentSnapshotId=start.id;
  end.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:start.id,baseLayerId:'layer'}];
  const before=JSON.stringify(w),sourceJSON=JSON.stringify(r),snapshotsJSON=JSON.stringify(w.snapshots),copy=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});
  expect(copy.ok).toBe(true);if(!copy.ok)throw Error(JSON.stringify(copy.diagnostics));const next=copy.workspace,recording=next.recordings.at(-1)!,graph=recording.angleGraph!;
  expect(JSON.stringify(w)).toBe(before);expect(JSON.stringify(next.recordings[0])).toBe(sourceJSON);expect(JSON.stringify(next.snapshots.slice(0,2))).toBe(snapshotsJSON);expect(next.library).toBe(w.library);
  expect(Object.keys(next.library.curves)).toEqual(['c']);expect(Object.keys(next.library.nodes)).toEqual(['a','b']);expect(recording.tracks).toEqual(r.tracks);expect(recording.tracks).not.toBe(r.tracks);
  expect(next.snapshots.at(-1)!.authored).toEqual(end.authored);expect(next.snapshots.at(-1)!.draft).toEqual(end.draft);expect(next.snapshots.at(-1)!.parentSnapshotId).toBe(copy.snapshotIdMap.start);
  expect(next.snapshots.at(-1)!.layers[0]).toMatchObject({id:'layer',baseSnapshotId:copy.snapshotIdMap.start,baseLayerId:'layer'});expect(recording.activeSnapshotId).toBe(copy.snapshotIdMap.end);
  expect(graph.migration).toEqual({sourceRecordingId:r.id,sourceMode:'endpoint-pair',sourceRecordingJSON:sourceJSON,sourceSnapshotsJSON:snapshotsJSON});expect(graph.correctionFrames?.[0].angle).toEqual({x:side/3,y:0});
  expect(graph.mesh.vertices).toHaveLength(2);expect(graph.mesh.edges).toHaveLength(1);expect(graph.mesh.triangles).toEqual([]);expect(parseRecordingSnapshots(JSON.parse(JSON.stringify(next)))).toEqual(next);
 });
 it.each([false,true])('preserves signed node and H-P response trajectories with reversed orientation=%s',reverse=>{
  const {w,r}=pair();r.endpointPair!.responses=responses();r.endpointPair!.draft={angle:{x:30,y:0},responses:responses()};
  const copy=createTriangulatedRecordingCopy(w,r.id,{id:'copy',snapshotIdMap:{start:reverse?'z-copy':'a-copy',end:reverse?'a-copy':'z-copy'}});expect(copy.ok).toBe(true);if(!copy.ok)return;
  const graph=copy.workspace.recordings.at(-1)!.angleGraph!,edge=graph.mesh.edges[0],mapped=graph.edgeResponses[edge.id],basis=resolveEndpointPairBasis(w,r.id,{useDraft:false});
  expect(graph.mesh.vertices.find(vertex=>vertex.id===edge.vertexIds[0])!.snapshotId).toBe(reverse?copy.snapshotIdMap.end:copy.snapshotIdMap.start);
  for(const progress of [0,.125,.25,.375,.5,.625,.75,.875,1]){
   const old=interpolateEndpointPairGeometry(basis.start.drawing,basis.end.drawing,progress,r.endpointPair!.responses).drawing;
   const migrated=interpolateEndpointPairGeometry(reverse?basis.end.drawing:basis.start.drawing,reverse?basis.start.drawing:basis.end.drawing,reverse?1-progress:progress,mapped).drawing;
   old.nodes.forEach((node,i)=>node.position.forEach((value,axis)=>expect(migrated.nodes[i].position[axis]).toBeCloseTo(value,13)));
   old.curves.forEach((curve,i)=>curve.handles.forEach((handle,end)=>handle.forEach((value,axis)=>expect(migrated.curves[i].handles[end][axis]).toBeCloseTo(value,13))));
  }
  expect(graph.correctionFrames![0].edgeResponses![edge.id]).toEqual(mapped);
 });
 it('reverses both coordinates without response clamping',()=>{
  const original=responses(),before=JSON.stringify(original),reversed=reverseSnapshotEndpointResponses(original);
  expect(reversed.nodes.a.x).toEqual([[.25,-.5],[.5,-2],[.75,3]]);expect(reverseSnapshotEndpointResponses(reversed)).toEqual(original);expect(JSON.stringify(original)).toBe(before);
  for(const t of [.125,.25,.5,.75,.875])expect(evaluateEndpointResponse(reversed.nodes.a.x,t)).toBeCloseTo(1-evaluateEndpointResponse(original.nodes.a.x,1-t),14);
 });
 it('refuses a split pair edge instead of losing or restricting an old nonlinear response',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'start',angle:{x:0,y:0}},{snapshotId:'middle',angle:{x:45,y:0}},{snapshotId:'end',angle:{x:90,y:0}}]),before=JSON.stringify(mesh);
  const result=mapEndpointPairToAngleGraph(mesh,{axis:'x',startSnapshotId:'start',endSnapshotId:'end',responses:responses()});expect(result.ok).toBe(false);expect(result.diagnostics[0].code).toBe('PAIR_EDGE_UNREPRESENTABLE');expect(JSON.stringify(mesh)).toBe(before);
 });
 it('refuses simultaneous pitch rebinding during an old yaw response migration',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'start',angle:{x:0,y:0}},{snapshotId:'end',angle:{x:90,y:20}}]);
  expect(mapEndpointPairToAngleGraph(mesh,{axis:'x',startSnapshotId:'start',endSnapshotId:'end',responses:responses()})).toMatchObject({ok:false,diagnostics:[{code:'PAIR_EDGE_UNREPRESENTABLE'}]});
 });
 it('bounds the default copy name while retaining a maximum-length original name',()=>{
  const {w,r}=pair();r.name='r'.repeat(256);const copy=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});expect(copy.ok).toBe(true);if(!copy.ok)return;
  expect(copy.workspace.recordings.at(-1)!.name).toHaveLength(256);expect(copy.workspace.recordings[0].name).toHaveLength(256);expect(()=>parseRecordingSnapshots(JSON.parse(JSON.stringify(copy.workspace)))).not.toThrow();
 });
 it('refuses reversing an unrepresentable IEEE progress without losing the original knot',()=>{
  const original={nodes:{a:{x:[[Number.MIN_VALUE,2] as [number,number]]}},handles:{}};expect(()=>reverseSnapshotEndpointResponses(original)).toThrow(/progress/);expect(original.nodes.a.x[0]).toEqual([Number.MIN_VALUE,2]);
 });
 it('refuses legacy keyed conversion with actionable diagnostics and no source changes',()=>{
  const {w,r}=pair();r.mode='tracks';delete r.endpointPair;const before=JSON.stringify(w),result=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});
  expect(result).toMatchObject({ok:false,diagnostics:[{code:'UNSUPPORTED_LEGACY_INTERPOLATION'}]});expect(result.diagnostics[0].message).toMatch(/faithful adapter/);expect(JSON.stringify(w)).toBe(before);
 });
 it('refuses colliding IDs, unsupported legacy data and invalid original pose drafts atomically',()=>{
  const {w,r}=pair();expect(createTriangulatedRecordingCopy(w,r.id,{id:r.id})).toMatchObject({ok:false,diagnostics:[{code:'ID_COLLISION'}]});expect(createTriangulatedRecordingCopy(w,r.id,{id:'copy',snapshotIdMap:{start:'end'}})).toMatchObject({ok:false,diagnostics:[{code:'ID_COLLISION'}]});
  r.tracks[0].draft!.angle={x:45,y:0};const before=JSON.stringify(w),result=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});expect(result.ok).toBe(false);expect(result.diagnostics[0].message).toMatch(/intermediate pose keys or geometry drafts/);expect(JSON.stringify(w)).toBe(before);
 });
 it('refuses incompatible evaluated endpoints instead of reinterpreting the old pair as partial coverage',()=>{
  const {w,r,end}=pair();const layer=end.layers[0];if(layer.kind!=='original')throw Error('original');layer.items=[];
  const before=JSON.stringify(w),result=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});expect(result).toMatchObject({ok:false,diagnostics:[{code:'INCOMPATIBLE_ENDPOINT_BASIS'}]});expect(result.diagnostics[0].message).toMatch(/Repair the original endpoint topology/);expect(JSON.stringify(w)).toBe(before);
 });
});

describe('migrated endpoint-pair runtime compatibility',()=>{
 it.each([false,true])('retains endpoint draft gating and correction responses with useDraft=%s',useDraft=>{
  const {w,r}=pair();r.endpointPair!.responses=responses();r.endpointPair!.draft={angle:{x:30,y:0},responses:{nodes:{a:{x:[[.25,4]],y:[[.5,-2]]}},handles:{}}};
  for(const cursor of [45,90]){
   r.angle={x:cursor,y:0};const copy=createTriangulatedRecordingCopy(w,r.id,{id:'copy'});expect(copy.ok).toBe(true);if(!copy.ok)return;
   for(const x of [0,22.5,45,67.5,90]){
    const expected=evaluateRecordingSnapshot(w,r.id,{angle:{x,y:0},useDraft}).drawing,actual=evaluateRecordingSnapshot(copy.workspace,'copy',{angle:{x,y:0},useDraft}).drawing;
    expected.nodes.forEach(node=>node.position.forEach((value,axis)=>expect(actual.nodes.find(candidate=>candidate.id===node.id)!.position[axis]).toBeCloseTo(value,12)));
    expected.curves.forEach(curve=>curve.handles.forEach((handle,end)=>handle.forEach((value,axis)=>expect(actual.curves.find(candidate=>candidate.id===curve.id)!.handles[end][axis]).toBeCloseTo(value,12))));
   }
  }
 });
 it('preserves the lower-yaw discrete winner at the exact midpoint independent of clone ID order',()=>{
  const {w,r}=pair();r.tracks.push({id:'visibility',channel:'visibility',targetId:'layer',elementId:'c',keys:[{id:'visible',angle:{x:0,y:0},value:true},{id:'hidden',angle:{x:90,y:0},value:false}]});
  const copy=createTriangulatedRecordingCopy(w,r.id,{id:'copy',snapshotIdMap:{start:'z-front',end:'a-side'}});expect(copy.ok).toBe(true);if(!copy.ok)return;
  const expected=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0},useDraft:false}),actual=evaluateRecordingSnapshot(copy.workspace,'copy',{angle:{x:45,y:0},useDraft:false});
  expect(expected.drawing.curves[0].visible).toBe(true);expect(actual.drawing.curves[0].visible).toBe(expected.drawing.curves[0].visible);
 });
});

describe('constraint retirement and unresolved coordinate rebinds',()=>{
 it('archives orphaned edge, triangle and correction-frame constraints with their exact old mesh',()=>{
  const {graph,edge,face}=triangle();graph.edgeResponses[edge.id]=responses();graph.triangleResponses[face.id]={nodes:{a:{x:[{id:'sample',at:[.25,.25,.5],weights:[2,-1,0]}]}},handles:{}};
  graph.correctionFrames=[{id:'draft',angle:{x:30,y:30},status:'draft',triangleResponses:{[face.id]:structuredClone(graph.triangleResponses[face.id])}}];const before=JSON.stringify(graph),removed=graph.mesh.vertices.find(vertex=>vertex.id===edge.vertexIds[0])!;
  const result=reconcileSnapshotAngleGraphMesh(graph,removeSnapshotVertex(graph.mesh,removed.snapshotId),{id:'deleted',reason:'deleted-view',message:'Deleted a genuine view.'});expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.graph.edgeResponses).toEqual({});expect(result.graph.triangleResponses).toEqual({});expect(result.graph.correctionFrames).toEqual([]);expect(result.diagnostics).toHaveLength(3);
  const archive=result.graph.orphanedResponses![0];expect(archive.mesh).toEqual(graph.mesh);expect(archive.edgeResponses).toEqual(graph.edgeResponses);expect(archive.triangleResponses).toEqual(graph.triangleResponses);expect(archive.correctionFrames).toEqual(graph.correctionFrames);expect(JSON.stringify(graph)).toBe(before);expect(()=>validateSnapshotAngleGraph(JSON.parse(JSON.stringify(result.graph)))).not.toThrow();
 });
 it('keeps unaffected mesh responses live and rejects implicit rebind of any nonempty constraints',()=>{
  const {graph,edge}=triangle();graph.edgeResponses[edge.id]=responses();const before=JSON.stringify(graph),mesh=rebindSnapshotVertex(graph.mesh,'b',{x:80,y:0});
  const result=reconcileSnapshotAngleGraphMesh(graph,mesh,{id:'rebind',reason:'unhandled-rebind',message:'Move view.'});expect(result).toMatchObject({ok:false,diagnostics:[{code:'UNHANDLED_REBIND'}]});expect(JSON.stringify(graph)).toBe(before);
  const unchanged=reconcileSnapshotAngleGraphMesh(graph,structuredClone(graph.mesh),{id:'noop',reason:'mesh-change',message:'Unchanged mesh.'});expect(unchanged.ok).toBe(true);if(unchanged.ok){expect(unchanged.graph.edgeResponses).toEqual(graph.edgeResponses);expect(unchanged.graph.orphanedResponses).toBeUndefined();}
 });
 it('allows an unconstrained coordinate rebind without changing any snapshot geometry',()=>{
  const {graph}=triangle(),mesh=rebindSnapshotVertex(graph.mesh,'b',{x:80,y:0}),result=reconcileSnapshotAngleGraphMesh(graph,mesh,{id:'unused',reason:'mesh-change',message:'Unconstrained rebind.'});expect(result.ok).toBe(true);if(result.ok){expect(result.graph.mesh).toEqual(mesh);expect(result.diagnostics).toEqual([]);}
 });
});
