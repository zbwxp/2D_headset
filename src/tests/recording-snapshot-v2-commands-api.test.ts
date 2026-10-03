import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {prepareSnapshotBatch,evaluateRecordingSnapshot,snapshotOverview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {identityScenePlacement,emptyRecordingScene} from '../domain/recordingScene/model';
const angle=(x:number)=>({x,y:0});
const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function harness(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:[0,1]},{id:'d',position:[1,1]}],curves:[{id:'curve-a',name:'A',nodes:['a','b'],handles:[[.25,0],[.75,0]],visible:true,locked:false,width:.02},{id:'curve-b',name:'B',nodes:['c','d'],handles:[[.25,1],[.75,1]],visible:true,locked:false,width:.02}],layers:[{id:'layer-a',name:'A',items:['curve-a'],visible:true,locked:false},{id:'layer-b',name:'B',items:['curve-b'],visible:true,locked:false}]};
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing}),mode:'drawing'|'recording'='recording';const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(){throw Error('Unexpected source write');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const p=past.pop();if(p){future.push(project);project=p;}},redo(){const p=future.pop();if(p){past.push(project);project=p;}}});
 const apply=(...commands:SnapshotCommand[])=>value(api.snapshot({commands}));apply({op:'createRecording',name:'Test'});const source=drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!;
 return {api,apply,sourceId:source.id,project:()=>project,replace:(p:LandmarkProject)=>project=p,workspace:()=>project.recordingSnapshots!,recording:()=>project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!,current:()=>project.recordingSnapshots!.snapshots.find(s=>s.id===project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!.activeSnapshotId)!,past:()=>past,mode:(v:typeof mode)=>mode=v};
}
const paste=(h:ReturnType<typeof harness>)=>{const result=h.apply({op:'pasteLayers',sourceSnapshotId:h.sourceId});return result.created.filter(c=>c.kind==='layer').map(c=>c.id);};

test('first view is empty, reference paste has no geometry copies, interpolated view creation authors no keys',()=>{
 const h=harness();expect(h.current().layers).toEqual([]);expect(h.recording().tracks).toEqual([]);const count=Object.keys(h.workspace().library.curves).length,[a,b]=paste(h),originalSlots=structuredClone(h.current().layers);
 h.apply({op:'setLayerPlacement',layerId:a,value:{...identityScenePlacement(),translation:[2,0]}},{op:'updateSnapshot'});const authored=structuredClone(h.recording().tracks);
 h.apply({op:'setAngle',angle:angle(45)},{op:'createSnapshot',name:'Middle'});
 expect(h.current().authored).toEqual([]);expect(h.current().layers).toEqual(originalSlots);expect(h.recording().tracks).toEqual(authored);expect(Object.keys(h.workspace().library.curves)).toHaveLength(count);expect(evaluateRecordingSnapshot(h.project()).placements[b]).toEqual(identityScenePlacement());expect(evaluateRecordingSnapshot(h.project()).placements[a].translation).toEqual([2,0]);expect(h.current().inheritedState?.layers[a].placement?.translation).toEqual([2,0]);
});

test('independent layer edits preserve true zero axis scales, source geometry and unrelated authored channels',()=>{
 const h=harness(),[a,b]=paste(h),drawing=h.project().drawing;
 h.apply({op:'setLayerPlacement',layerId:a,value:{...identityScenePlacement(),scaleX:0,scaleY:0}},{op:'updateSnapshot'});
 expect(h.recording().tracks).toHaveLength(1);expect(h.recording().tracks[0].targetId).toBe(a);expect(h.recording().tracks[0].keys).toHaveLength(1);expect(evaluateRecordingSnapshot(h.project()).placements[a]).toMatchObject({scaleX:0,scaleY:0});expect(evaluateRecordingSnapshot(h.project()).placements[b]).toEqual(identityScenePlacement());expect(h.project().drawing).toBe(drawing);expect(parseRecordingSnapshots(h.workspace())).toEqual(h.workspace());
});

test('direct shape offsets move handles with nodes and new live curves have no inherited ID correction',()=>{
 const h=harness(),[a]=paste(h),nodeId=canonicalElementId('$working','a'),curveId=canonicalElementId('$working','curve-a');
 h.apply({op:'moveShapeNode',layerId:a,nodeId,position:[.2,.1]},{op:'moveShapeHandle',layerId:a,curveId,end:0,position:[.6,.4]},{op:'updateSnapshot'});
 const e=evaluateRecordingSnapshot(h.project());expect(e.drawing.nodes.find(n=>n.id===nodeId)?.position).toEqual([.2,.1]);expect(e.drawing.curves.find(c=>c.id===curveId)?.handles[0]).toEqual([.6,.4]);
 const d=structuredClone(h.project().drawing!);d.nodes.push({id:'new-a',position:[0,-1]},{id:'new-b',position:[1,-1]});d.curves.push({id:'new',name:'New',nodes:['new-a','new-b'],handles:[[.25,-1],[.75,-1]],visible:true,locked:false,width:.02});d.layers[0].items.push('new');h.replace(syncRecordingSnapshotSources({...h.project(),drawing:d}));const next=evaluateRecordingSnapshot(h.project());expect(next.drawing.nodes.find(n=>n.id===canonicalElementId('$working','new-a'))?.position).toEqual([0,-1]);expect(h.recording().tracks[0].keys).toHaveLength(1);
});

test('clone creates a current-shape independent base with new canonical IDs',()=>{
 const h=harness(),[a]=paste(h);h.apply({op:'setLayerPlacement',layerId:a,value:{...identityScenePlacement(),translation:[3,2]}},{op:'updateSnapshot'});const source=h.current().id,oldCurve=canonicalElementId('$working','curve-a'),before=Object.keys(h.workspace().library.curves).length;
 const result=h.apply({op:'cloneLayers',sourceSnapshotId:source,layerIds:[a]}),map=result.idMaps[0].idMap;
 expect(Object.keys(h.workspace().library.curves)).toHaveLength(before+1);expect(map[oldCurve]).not.toBe(oldCurve);expect(h.workspace().library.curves[map[oldCurve]].handles).toEqual([[3.25,2],[3.75,2]]);expect(h.workspace().library.curves[oldCurve].handles).toEqual([[.25,0],[.75,0]]);const e=evaluateRecordingSnapshot(h.project());expect(e.drawing.nodes.find(n=>n.id===map[canonicalElementId('$working','a')])?.position).toEqual([3,2]);expect(e.drawing.curves.find(c=>c.id===map[oldCurve])?.nodes).toEqual([map[canonicalElementId('$working','a')],map[canonicalElementId('$working','b')]]);
});

test('failed and dry-run batches leave the project and history unchanged; facade checks mode, revision and unknown fields',()=>{
 const h=harness(),[a]=paste(h),before=h.project(),past=h.past().length,revision=h.api.inspectSnapshots().revision;
 const commands:SnapshotCommand[]=[{op:'setLayerPlacement',layerId:a,value:{...identityScenePlacement(),translation:[4,0]}}];
 expect(h.api.snapshot({commands,dryRun:true})).toMatchObject({ok:true,value:{changed:true,applied:false}});expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);
 expect(h.api.snapshot({commands:[...commands,{op:'setVisibility',layerId:'missing',visible:false}]})).toMatchObject({ok:false,error:{commandIndex:1}});expect(h.project()).toBe(before);
 expect(h.api.snapshot({commands:[{...commands[0],unexpected:true}] as unknown as SnapshotCommand[]})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST',commandIndex:0}});
 h.mode('drawing');expect(h.api.snapshot({commands})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});h.mode('recording');h.apply(...commands);expect(h.api.snapshot({commands,expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});expect(h.api.scene({commands:[]})).toMatchObject({ok:false,error:{code:'LEGACY_SCENE_RETIRED'}});expect(h.api.help().snapshotCommands).toContain('cloneLayers');
});

test('Warp creation seeds only its own established-view track and node edits preserve U/V/twist',()=>{
 const h=harness(),[a,b]=paste(h);h.apply({op:'createSnapshot',angle:angle(45)});const result=h.apply({op:'createWarp',layerIds:[a],rows:1,columns:1,ref:'warp'}),warpId=result.created.find(x=>x.ref==='warp')!.id;
 expect(h.recording().tracks).toHaveLength(1);expect(h.recording().tracks[0].keys.map(k=>k.angle.x)).toEqual([0,45]);h.apply({op:'editWarpNodes',warpId,moveHandles:false,edits:[{index:0,position:[-.2,-.1],handleU:[.1,-.1],handleV:[-.2,.2],twist:[.02,.03]}]});const e=evaluateRecordingSnapshot(h.project());expect(e.warpGrids[warpId].nodes[0]).toEqual({position:[-.2,-.1],handleU:[.1,-.1],handleV:[-.2,.2],twist:[.02,.03]});expect(e.state.bindings.some(x=>x.layerId===b)).toBe(false);
});

test('read-only snapshot overview and clean SVG preview use the native evaluator',()=>{
 const h=harness();paste(h);const before=h.project(),past=h.past().length;expect(snapshotOverview(before)).toMatchObject({exists:true,sourceReadOnly:true});const preview=value(h.api.previewSnapshot({showFills:false}));expect(preview.svg).toContain('<svg');expect(preview.snapshotId).toBe(h.current().id);expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);expect(()=>prepareSnapshotBatch(before,{commands:[],stray:true})).toThrow('Unknown fields');
});


test('one Warp remains editable at every established view sharing its live slots',()=>{
 const h=harness(),[a]=paste(h);h.apply({op:'createSnapshot',angle:angle(90)});const result=h.apply({op:'createWarp',layerIds:[a],rows:1,columns:1,ref:'same'}),warpId=result.created.find(x=>x.ref==='same')!.id;
 h.apply({op:'setAngle',angle:angle(0)});expect(evaluateRecordingSnapshot(h.project()).state.bindings).toContainEqual({layerId:a,warpId});h.apply({op:'editWarpNodes',warpId,edits:[{index:0,position:[-.3,.1]}]},{op:'updateSnapshot'});h.apply({op:'setAngle',angle:angle(90)});expect(evaluateRecordingSnapshot(h.project()).warpGrids[warpId].nodes[0].position).not.toEqual([-.3,.1]);h.apply({op:'setAngle',angle:angle(0)});expect(evaluateRecordingSnapshot(h.project()).warpGrids[warpId].nodes[0].position).toEqual([-.3,.1]);
});

test('migrated linked endpoint drag authors its relation-position channel and preserves each linked endpoint',()=>{
 const h=harness(),drawing=structuredClone(h.project().drawing!);drawing.nodes.find(n=>n.id==='c')!.position=[1,0];drawing.nodes.find(n=>n.id==='d')!.position=[2,0];drawing.curves[1].handles=[[1.25,0],[1.75,0]];drawing.endpointLinks=[{id:'chin-link',a:{curveId:'curve-a',end:1},b:{curveId:'curve-b',end:0}}];const scene={...emptyRecordingScene('legacy-linked'),instances:[{id:'instance',artworkId:'$working',name:'Linked face'}],shapeTracks:[{id:'shape',instanceId:'instance',keys:[{id:'shape-key',angle:angle(0),value:{nodes:{b:[.1,.2] as [number,number],c:[.1,.2] as [number,number]},handles:{}}}]}]};const legacy:LandmarkProject={...createEmptyProject(),drawing,recordingScenes:{version:1,activeSceneId:scene.id,scenes:[scene]}};
 let project=ensureRecordingSnapshots(legacy);const workspace=project.recordingSnapshots,recording=workspace.recordings.find(r=>!r.legacy&&r.snapshotIds.some(id=>Object.keys(workspace.snapshots.find(s=>s.id===id)!.deformation.relationPositions).length))!;expect(recording).toBeDefined();const view=workspace.snapshots.find(s=>recording.snapshotIds.includes(s.id)&&Object.keys(s.deformation.relationPositions).length)!;
 project={...project,recordingSnapshots:{...workspace,activeRecordingId:recording.id,recordings:workspace.recordings.map(r=>r===recording?{...r,activeSnapshotId:view.id,angle:view.angle}:r)}};
 const before=evaluateRecordingSnapshot(project,{snapshotId:view.id}),relation=Object.values(before.state.relationPositions)[0],link=before.source.endpointLinks!.find(l=>relation.sourceLinkIds.includes(l.id))!,curve=before.source.curves.find(c=>c.id===link.a.curveId)!,nodeId=curve.nodes[link.a.end],layerId=before.source.layers.find(l=>l.items.includes(curve.id))!.id,current=before.prePlacementDrawing.nodes.find(n=>n.id===nodeId)!.position,position:[number,number]=[current[0]+.03,current[1]+.02];
 const plan=prepareSnapshotBatch(project,{commands:[{op:'moveShapeNode',layerId,nodeId,position},{op:'updateSnapshot'}]});const after=evaluateRecordingSnapshot({...project,recordingSnapshots:plan.recordingSnapshots},{snapshotId:view.id});expect(after.prePlacementDrawing.nodes.find(n=>n.id===nodeId)!.position[0]).toBeCloseTo(position[0],8);expect(after.prePlacementDrawing.nodes.find(n=>n.id===nodeId)!.position[1]).toBeCloseTo(position[1],8);const other=after.source.curves.find(c=>c.id===link.b.curveId)!.nodes[link.b.end];expect(after.prePlacementDrawing.nodes.find(n=>n.id===other)!.position).toEqual(after.prePlacementDrawing.nodes.find(n=>n.id===nodeId)!.position);expect(plan.created.some(c=>c.kind==='key')).toBe(true);
});

test('cross-layer SMOOTH handle editing keeps the grabbed handle as the authoring driver',()=>{
 const h=harness();const drawing=structuredClone(h.project().drawing!);drawing.nodes.find(n=>n.id==='c')!.position=[1,0];drawing.nodes.find(n=>n.id==='d')!.position=[2,0];drawing.curves[1].handles=[[1.25,0],[1.75,0]];drawing.endpointLinks=[{id:'smooth-link',a:{curveId:'curve-a',end:1},b:{curveId:'curve-b',end:0},joinBrush:{kind:'SMOOTH'}}];h.replace(syncRecordingSnapshotSources({...h.project(),drawing}));const [,b]=paste(h),curveId=canonicalElementId('$working','curve-b'),partnerId=canonicalElementId('$working','curve-a');
 h.apply({op:'moveShapeHandle',layerId:b,curveId,end:0,position:[1.2,.3]},{op:'updateSnapshot'});const e=evaluateRecordingSnapshot(h.project()),grabbed=e.prePlacementDrawing.curves.find(c=>c.id===curveId)!.handles[0],partner=e.prePlacementDrawing.curves.find(c=>c.id===partnerId)!.handles[1];expect(grabbed[0]).toBeCloseTo(1.2,10);expect(grabbed[1]).toBeCloseTo(.3,10);expect(partner[0]).toBeLessThan(1);expect(partner[1]).toBeLessThan(0);expect((grabbed[0]-1)*partner[1]-grabbed[1]*(partner[0]-1)).toBeCloseTo(0,10);expect(h.recording().tracks.filter(t=>t.channel==='shape')).toHaveLength(2);
});


test('deleting an accidental nearby view preserves the surviving inherited pose with only necessary channel keys',()=>{
 const h=harness(),[a,b]=paste(h),nodeId=canonicalElementId('$working','a');h.apply({op:'moveShapeNode',layerId:a,nodeId,position:[.1,0]},{op:'updateSnapshot'},{op:'createSnapshot',angle:{x:-60,y:0}},{op:'moveShapeNode',layerId:a,nodeId,position:[.6,.2]},{op:'updateSnapshot'});const accidental=h.current().id;h.apply({op:'createSnapshot',angle:{x:-59.9,y:0}});const survivor=h.current().id,before=evaluateRecordingSnapshot(h.project(),{snapshotId:survivor,useDraft:false}),library=JSON.stringify(h.workspace().library),otherTracks=h.recording().tracks.filter(t=>t.targetId===b);
 const result=h.apply({op:'deleteSnapshot',snapshotId:accidental});const after=evaluateRecordingSnapshot(h.project(),{snapshotId:survivor,useDraft:false});expect(after.drawing).toEqual(before.drawing);expect(JSON.stringify(h.workspace().library)).toBe(library);expect(h.recording().tracks.filter(t=>t.targetId===b)).toEqual(otherTracks);expect(result.created.filter(c=>c.kind==='key')).toHaveLength(1);expect(h.current().authored).toHaveLength(1);
});

test('angle navigation and new snapshots use the deterministic visible structure instead of the previously active view',()=>{
 const h=harness(),[a,b]=paste(h);h.apply({op:'createSnapshot',angle:angle(90)},{op:'removeLayers',layerIds:[b]});const right=h.current().id;h.apply({op:'setAngle',angle:angle(0)});expect(h.current().layers.map(l=>l.id)).toEqual([a,b]);h.apply({op:'setAngle',angle:angle(90)});expect(h.current().id).toBe(right);h.apply({op:'setAngle',angle:angle(60)},{op:'createSnapshot'});expect(h.current().layers.map(l=>l.id)).toEqual([a]);expect(evaluateRecordingSnapshot(h.project()).drawing.layers.map(l=>l.id)).toEqual([a]);
});

const externalFixture=process.env.CONTOUR_USER_TURNING_FIXTURE;
test.skipIf(!externalFixture)('actual turning fixture preserves geometry and SVG when the accidental -60/1.1 view is deleted',()=>{
 const text=readFileSync(externalFixture!,'utf8'),digest=createHash('sha256').update(text).digest('hex');expect(digest).toBe('db551675ce94bcdd69d744f8962e6413dd81d460f5dfb19cc5d17a63a3f3a6d6');let project=ensureRecordingSnapshots(parseLandmarks(text),text);const workspace=project.recordingSnapshots,recording=workspace.recordings.find(r=>r.snapshotIds.some(sid=>{const s=workspace.snapshots.find(s=>s.id===sid)!;return s.angle.x===-60&&Math.abs(s.angle.y-1.1)<1e-6;}))!,accidental=workspace.snapshots.find(s=>recording.snapshotIds.includes(s.id)&&s.angle.x===-60&&Math.abs(s.angle.y-1.1)<1e-6)!,survivor=workspace.snapshots.find(s=>recording.snapshotIds.includes(s.id)&&s.angle.x===-60&&s.angle.y===0)!;expect(survivor).toBeDefined();project={...project,recordingSnapshots:{...workspace,activeRecordingId:recording.id,recordings:workspace.recordings.map(r=>r===recording?{...r,activeSnapshotId:survivor.id,angle:survivor.angle}:r)}};
 const api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=> 'recording',commitDrawing(){throw Error('source write');},commitRecordingSnapshots(recordingSnapshots){project={...project,recordingSnapshots};},undo(){},redo(){}}),before=evaluateRecordingSnapshot(project,{snapshotId:survivor.id,useDraft:false}),svg=value(api.previewSnapshot({snapshotId:survivor.id,useDraft:false,showFills:false})).svg,library=JSON.stringify(workspace.library),archive=workspace.legacyArchive;
 value(api.snapshot({commands:[{op:'deleteSnapshot',snapshotId:accidental.id}]}));expect(evaluateRecordingSnapshot(project,{snapshotId:survivor.id,useDraft:false}).drawing).toEqual(before.drawing);expect(value(api.previewSnapshot({snapshotId:survivor.id,useDraft:false,showFills:false})).svg).toBe(svg);expect(JSON.stringify(project.recordingSnapshots.library)).toBe(library);expect(project.recordingSnapshots.legacyArchive).toEqual(archive);expect(createHash('sha256').update(readFileSync(externalFixture!)).digest('hex')).toBe(digest);
});


test('placement closure is checked after the complete batch and names only linked layers',()=>{
 const h=harness(),drawing=structuredClone(h.project().drawing!);drawing.nodes.find(n=>n.id==='c')!.position=[1,0];drawing.nodes.find(n=>n.id==='d')!.position=[2,0];drawing.curves[1].handles=[[1.25,0],[1.75,0]];drawing.endpointLinks=[{id:'shared',a:{curveId:'curve-a',end:1},b:{curveId:'curve-b',end:0}}];h.replace(syncRecordingSnapshotSources({...h.project(),drawing}));const [a,b]=paste(h),before=h.project(),v={...identityScenePlacement(),translation:[.3,.2] as [number,number]};
 expect(h.api.snapshot({commands:[{op:'setLayerPlacement',layerId:a,value:v}]})).toMatchObject({ok:false,error:{code:'LINKED_LAYER_PLACEMENT',message:expect.stringContaining('A and B')}});expect(h.project()).toBe(before);
 expect(h.api.snapshot({commands:[{op:'setLayerPlacement',layerId:a,value:v},{op:'setLayerPlacement',layerId:b,value:v},{op:'updateSnapshot'}]})).toMatchObject({ok:true,value:{applied:true}});
});


test('element V transform operates in world coordinates, preserves unrelated curves and rejects only affected singular placements',()=>{
 const h=harness(),[a,b]=paste(h),curveId=canonicalElementId('$working','curve-a'),otherId=canonicalElementId('$working','curve-b');h.apply({op:'setLayerPlacement',layerId:a,value:{translation:[3,2],rotation:35,scale:2}},{op:'setLayerPlacement',layerId:b,value:{...identityScenePlacement(),scaleX:0}},{op:'updateSnapshot'});const before=evaluateRecordingSnapshot(h.project()),nodeId=before.drawing.curves.find(c=>c.id===curveId)!.nodes[0],point=before.drawing.nodes.find(n=>n.id===nodeId)!.position;
 h.apply({op:'transformShapeElements',curveIds:[curveId],value:{...identityScenePlacement(),translation:[.4,-.2]}},{op:'updateSnapshot'});const after=evaluateRecordingSnapshot(h.project());expect(after.drawing.nodes.find(n=>n.id===nodeId)!.position[0]).toBeCloseTo(point[0]+.4,10);expect(after.drawing.nodes.find(n=>n.id===nodeId)!.position[1]).toBeCloseTo(point[1]-.2,10);expect(after.drawing.curves.find(c=>c.id===otherId)).toEqual(before.drawing.curves.find(c=>c.id===otherId));expect(after.placements[a]).toEqual(before.placements[a]);expect(h.api.snapshot({commands:[{op:'transformShapeElements',curveIds:[otherId],value:{...identityScenePlacement(),translation:[.4,0]}}]})).toMatchObject({ok:false,error:{code:'SINGULAR_PLACEMENT'}});
});

test('element V transform keeps linked endpoint position and cross-layer SMOOTH direction coherent',()=>{
 const h=harness(),drawing=structuredClone(h.project().drawing!);drawing.nodes.find(n=>n.id==='c')!.position=[1,0];drawing.nodes.find(n=>n.id==='d')!.position=[2,0];drawing.curves[1].handles=[[1.25,0],[1.75,0]];drawing.endpointLinks=[{id:'smooth-link',a:{curveId:'curve-a',end:1},b:{curveId:'curve-b',end:0},joinBrush:{kind:'SMOOTH'}}];h.replace(syncRecordingSnapshotSources({...h.project(),drawing}));const [a]=paste(h),curveId=canonicalElementId('$working','curve-a'),otherId=canonicalElementId('$working','curve-b');h.apply({op:'transformShapeElements',curveIds:[curveId],value:{translation:[.2,.3],rotation:20,scale:1}},{op:'saveSelected',layerIds:[a]});
 const e=evaluateRecordingSnapshot(h.project()),first=e.drawing.curves.find(c=>c.id===curveId)!,second=e.drawing.curves.find(c=>c.id===otherId)!,p=e.drawing.nodes.find(n=>n.id===first.nodes[1])!.position,q=e.drawing.nodes.find(n=>n.id===second.nodes[0])!.position;expect(p).toEqual(q);expect(e.drawing.nodes.find(n=>n.id===second.nodes[1])!.position).toEqual([2,0]);const va=[first.handles[1][0]-p[0],first.handles[1][1]-p[1]],vb=[second.handles[0][0]-p[0],second.handles[0][1]-p[1]];expect(va[0]*vb[1]-va[1]*vb[0]).toBeCloseTo(0,10);expect(h.recording().tracks.find(t=>t.channel==='relationPosition')?.keys).toHaveLength(1);
});
