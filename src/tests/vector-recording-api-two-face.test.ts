import {expect,test,vi} from 'vitest';
import rawSource from '../assets/hairless-symmetric-two-face.json';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecording,type RecordingCommand} from '../app/vectorRecordingApi';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {nodeAt,parseDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {displayRouteInk} from '../domain/drawing/displayRouteInk';
import {depthPaintBatches} from '../domain/drawing/depth';
import {drawingBounds} from '../domain/vectorRecording/model';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';

// The actual user-approved two-face source, with independent white fills,
// persistent chin link, one routed SHOW and the left-jaw +1 layer paint offset.
const source=parseDrawing(rawSource),sourceJSON=JSON.stringify(source),link=source.endpointLinks!.find(l=>l.throughDisplay)!;
const track=source.displayIntervals!.find(t=>t.displayRoute)!,route=track.displayRoute!,owners=[link.a.curveId,link.b.curveId];
const faceLayers=source.layers.filter(l=>l.items.some(id=>owners.includes(id))).map(l=>l.id),rest=createWarpGrid(drawingBounds(source),2,2);
const camera={width:600,height:600,center:[-.33,.22] as Point2,pixelsPerUnit:250,showFills:false};
const val=<T>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function initial():LandmarkProject{return {...createEmptyProject(),...saveDrawingSnapshot({drawing:source},'Actual two-face')};}
function keyCommands():RecordingCommand[]{
 const commands:RecordingCommand[]=[{op:'ensureRig'},{op:'createDeformer',layerIds:[],name:'Shared face',rows:2,columns:2,ref:'face'},{op:'bindLayers',layerIds:faceLayers,deformerId:'$face'},{op:'saveKeyform',name:'Front'}];
 for(const x of [30,60,90]){const k=x/90;commands.push({op:'setAngle',angle:{x,y:0}},{op:'editGridNodes',deformerId:'$face',edits:[3,4,5].map((index,i)=>{const n=rest.nodes[index],dx=.03*k*(i+1)/3,dy=.006*k;return {index,position:[n.position[0]+dx,n.position[1]+dy] as Point2,handleU:[n.handleU[0]+dx,n.handleU[1]+dy+.003*k] as Point2,handleV:[n.handleV[0]+dx,n.handleV[1]+dy] as Point2,twist:[.002*k,0] as Point2};})},{op:'saveKeyform',name:`${x} degree`});}
 return commands;
}
function harness(p=initial()){
 let project=p,past:LandmarkProject[]=[],future:LandmarkProject[]=[],commits=0,mode:'drawing'|'recording'='recording';
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(){throw Error('Recording attempted a source commit');},commitRecording(value){past.push(project);future=[];project={...project,vectorRecording:value};commits++;},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}});
 return {api,project:()=>project,past:()=>past,commits:()=>commits,mode:(m:typeof mode)=>{mode=m;}};
}
function setup(){const h=harness(),result=val(h.api.recording({commands:keyCommands()})),id=result.created.find(c=>c.ref==='face')!.id;return {...h,id};}
function assertJaw(d:DrawingDocument,appearance=source){
 expect(d.curves).toHaveLength(source.curves.length);expect(d.layers).toEqual(source.layers);expect(d.fills).toEqual(source.fills);expect(d.endpointLinks).toEqual(source.endpointLinks);
 expect(distance(nodeAt(d,link.a).position,nodeAt(d,link.b).position)).toBe(0);
 const field=displayField(d,displayPath(d,track.anchor.id)),from=createDisplayRouteField(appearance,route),to=createDisplayRouteField(d,route);
 expect(field.mask).toHaveLength(1);const parts=field.geometry.pieces.flatMap((p,i)=>p.joinId?[field.parts[i]]:[]);expect(parts).toHaveLength(2);
 expect(distance(parts[0].shape[3],parts[1].shape[0])).toBe(0);expect(field.mask![0][0]).toBeLessThan(parts[0].start/field.total);expect(field.mask![0][1]).toBeGreaterThan((parts[1].start+parts[1].length)/field.total);
 for(const range of appearance.displayIntervals!.find(t=>t.id===track.id)!.ranges){const actual=d.displayIntervals!.find(t=>t.id===track.id)!.ranges.find(r=>r.id===range.id)!;for(const side of ['start','end'] as const)expect(actual[side]).toBeCloseTo(to.positionOf(from.materialAt(range[side])!)!,11);}
 const batches=depthPaintBatches(d),positions=new Map(batches.filter(b=>b.owner).map(b=>[b.owner!,b.position]));expect(displayRouteInk(d,route,positions).diagnostics).toEqual([]);
 for(const fill of source.fills.filter(f=>source.layers.some(l=>faceLayers.includes(l.id)&&l.items.includes(f.id))))for(const owner of owners)expect(positions.get(owner)!).toBeLessThan(batches.find(b=>b.item.id===fill.id)!.position);
}

test('actual face creation/binding/node-handle batch and four saved angles are one source-read-only Undo',()=>{
 const h=harness(),before=h.project(),library=JSON.stringify(before.drawingSnapshots),revision=h.api.inspect().revision;
 val(h.api.recording({commands:keyCommands(),dryRun:true,expectedRevision:revision}));expect(h.project()).toBe(before);expect(h.commits()).toBe(0);expect(h.api.inspect().revision).toBe(revision);
 val(h.api.recording({commands:keyCommands(),expectedRevision:revision}));const saved=h.project(),rig=saved.vectorRecording!.rigs[0];expect(h.commits()).toBe(1);expect(h.past()).toHaveLength(1);expect(saved.drawing).toBe(before.drawing);expect(saved.drawingSnapshots).toBe(before.drawingSnapshots);expect(rig.artworkId).toBe(before.drawingSnapshots!.activeId);expect(rig.keys).toHaveLength(7);expect(rig.draft).toBeUndefined();expect(rig.angle).toEqual({x:90,y:0});expect(parseVectorRecording(JSON.parse(JSON.stringify(saved.vectorRecording)))).toEqual(saved.vectorRecording);
 expect(h.api.recording({commands:[],expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
 val(h.api.undo());expect(h.project()).toBe(before);val(h.api.redo());expect(h.project()).toBe(saved);expect(JSON.stringify(source)).toBe(sourceJSON);expect(JSON.stringify(saved.drawingSnapshots)).toBe(library);
});

test.each([0,15,30,45,60,75,90])('actual saved-key preview at%s degrees preserves linked ARC/material coverage and remains pure',x=>{
 const h=setup(),before=h.project(),serialized=JSON.stringify(before),revision=h.api.inspect().revision,evaluated=evaluateRecording(before,{angle:{x,y:0}});
 assertJaw(evaluated.drawing);expect(evaluated.routeDiagnostics).toEqual([]);expect(evaluated.intervalTransportErrors).toEqual([]);expect(evaluated.conflictingNodeIds).toEqual([]);expect(evaluated.maxError*250).toBeLessThan(1.2);
 const preview=val(h.api.previewRecording({...camera,angle:{x,y:0}}));expect(preview.usedDraft).toBe(false);expect(preview.svg).toContain('<svg');expect(preview.svg).not.toContain('drawing-route-error');expect(preview.fitDiagnostics).toHaveLength(source.curves.length);expect(h.project()).toBe(before);expect(JSON.stringify(before)).toBe(serialized);expect(h.api.inspect().revision).toBe(revision);expect(h.past()).toHaveLength(1);
 if(x===45){const rig=before.vectorRecording!.rigs[0],a=rig.keys.find(k=>k.angle.x===30&&k.angle.y===0)!,b=rig.keys.find(k=>k.angle.x===60&&k.angle.y===0)!;for(const axis of [0,1] as const)expect(evaluated.pose.grids[h.id].nodes[4].position[axis]).toBeCloseTo((a.grids[h.id].nodes[4].position[axis]+b.grids[h.id].nodes[4].position[axis])/2,12);}
});

test('actual face dirty draft, explicit saved preview, hypothetical preview and failed batches stay separate',()=>{
 const h=setup(),saved=h.project(),baseline=val(h.api.previewRecording({...camera,angle:{x:90,y:0}}));val(h.api.recording({commands:[{op:'editGridNodes',deformerId:h.id,edits:[{index:4,position:[rest.nodes[4].position[0]+.06,rest.nodes[4].position[1]+.02]}]}]}));
 const dirty=h.project(),json=JSON.stringify(dirty),revision=h.api.inspect().revision;
 expect(h.api.recording({commands:[{op:'setAngle',angle:{x:30,y:0}}]})).toMatchObject({ok:false,error:{code:'DIRTY_DRAFT'}});
 const keys=val(h.api.previewRecording({...camera,angle:{x:90,y:0}})),draft=val(h.api.previewRecording(camera));expect(keys.svg).toBe(baseline.svg);expect(keys.usedDraft).toBe(false);expect(keys.hasUnappliedDraft).toBe(true);expect(draft.usedDraft).toBe(true);expect(draft.svg).not.toBe(keys.svg);
 expect(h.api.previewRecording({angle:{x:30,y:0},useDraft:true})).toMatchObject({ok:false,error:{code:'DRAFT_ANGLE_MISMATCH'}});
 val(h.api.previewRecording({...camera,commands:[{op:'discardDraft'},{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:h.id,edits:[{index:4,position:[rest.nodes[4].position[0]+.08,rest.nodes[4].position[1]]}]}]}));
 expect(h.api.recording({commands:[{op:'discardDraft'},{op:'setAngle',angle:{x:60,y:0}},{op:'bindLayers',layerIds:['missing'],deformerId:h.id}]})).toMatchObject({ok:false,error:{code:'NOT_FOUND',commandIndex:2}});
 expect(h.project()).toBe(dirty);expect(JSON.stringify(dirty)).toBe(json);expect(h.api.inspect().revision).toBe(revision);expect(h.past()).toHaveLength(2);
 h.mode('drawing');expect(h.api.recording({commands:[]})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});val(h.api.previewRecording({...camera,angle:{x:45,y:0}}));h.mode('recording');expect(h.api.execute({commands:[]})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});
 val(h.api.undo());expect(h.project()).toBe(saved);expect(JSON.stringify(source)).toBe(sourceJSON);
});

test('actual routed appearance edits are transported once without changing source ranges or fills',()=>{
 const h=setup(),range=track.ranges[0];val(h.api.recording({commands:[{op:'changePoseInterval',rangeId:range.id,start:.4,end:.6},{op:'setPoseIntervalEnd',rangeId:range.id,end:0,style:{taperWidthScale:12}},{op:'saveKeyform',name:'90 with narrower jaw'}]}));
 const evaluated=evaluateRecording(h.project(),{angle:{x:90,y:0}}),appearance={...source,displayIntervals:evaluated.pose.intervalOverrides};expect(appearance.displayIntervals).toBeDefined();assertJaw(evaluated.drawing,appearance);expect(evaluated.intervalTransportErrors).toEqual([]);expect(evaluated.routeDiagnostics).toEqual([]);expect(JSON.stringify(source)).toBe(sourceJSON);
});

test('one-sided independent face cage through the API keeps the chin linked and explicitly reports field conflict',()=>{
 const h=setup(),created=val(h.api.recording({commands:[{op:'createDeformer',layerIds:[faceLayers[0]],parentId:h.id,rows:2,columns:2,name:'One side',ref:'side'}]})),id=created.created.find(c=>c.ref==='side')!.id,rig=h.project().vectorRecording!.rigs[0],grid=rig.deformers.find(d=>d.id===id)!.grid;
 val(h.api.recording({commands:[{op:'editGridNodes',deformerId:id,edits:grid.nodes.map((n,index)=>({index,position:[n.position[0]+.01,n.position[1]]}))}]}));
 const evaluated=evaluateRecording(h.project());assertJaw(evaluated.drawing);expect(evaluated.conflictingNodeIds.slice().sort()).toEqual([nodeAt(source,link.a).id,nodeAt(source,link.b).id].sort());expect(evaluated.diagnostics.filter(d=>d.endpointConflict)).toHaveLength(4);expect(evaluated.routeDiagnostics).toEqual([]);expect(evaluated.intervalTransportErrors).toEqual([]);expect(JSON.stringify(source)).toBe(sourceJSON);
});

test('actual mist-filled source reports headless full-SVG limitation without changing recording state',()=>{
 const h=setup(),before=h.project(),revision=h.api.inspect().revision;expect(h.api.previewRecording({...camera,showFills:true})).toMatchObject({ok:false,error:{code:'BROWSER_REQUIRED'}});expect(h.project()).toBe(before);expect(h.api.inspect().revision).toBe(revision);expect(h.past()).toHaveLength(1);
});

test('default store adapter keeps the actual face/source library identical and undoes the complete angle batch',()=>{
 const old=useEditor.getState(),oldMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{const p=initial();useEditor.setState({project:p,past:[],future:[]});useWorkspaceMode.getState().setMode('recording');const api=createVectorEditingApi();val(api.recording({commands:keyCommands()}));expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.drawing).toBe(p.drawing);expect(useEditor.getState().project.drawingSnapshots).toBe(p.drawingSnapshots);val(api.undo());expect(useEditor.getState().project).toEqual(p);expect(JSON.stringify(source)).toBe(sourceJSON);}
 finally{vi.runAllTimers();useEditor.setState(old,true);useWorkspaceMode.getState().setMode(oldMode);vi.unstubAllGlobals();vi.useRealTimers();}
});
