import {test,expect,vi} from 'vitest';
import {emptyDrawing,parseDrawing,type Point2} from '../../domain/drawing/model';
import {addLayer,createCurve,ellipse,moveHandle} from '../../domain/drawing/commands';
import {createFill} from '../../domain/drawing/paintCommands';
import {createAssembly,rotateLocal,worldPoint,locatorProjection,bindLayer,bindLayers,unbindLayer,assemblyDrawing,updateDrawing,layerTransform,parseAssembly,assemblySnapshots} from '../../domain/assembly/model';
import {saveDrawingSnapshot,restoreDrawingSnapshot} from '../../domain/drawing/snapshots';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {createLandmarkProject} from '../../domain/landmarks/presets';
import {serializeProject} from '../../app/autosave';
function fixture(){let d=addLayer(emptyDrawing(),'Eye');const e=ellipse(d,d.layers[0].id,[-.6,.15],[-.2,.5],.008);d=createFill(e.document,e.ids,'white');d.curves[0]={...d.curves[0],visible:false,inkEnds:[{taper:.04},{extension:.02}],depthOffset:-1,depthScope:'LAYER'};d=addLayer(d,'Collar');return createCurve(d,d.layers[0].id,[[-.4,-.8],[-.2,-.9],[.2,-.9],[.4,-.8]],.01,'Neck');}
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
test('planes remain perpendicular to the tilted main axis and yaw spins within those planes',()=>{
 const a=createAssembly();a.pose={...a.pose,yaw:90,pitch:30,roll:20,position:[.2,-.1,.3]};
 const up=rotateLocal([0,1,0],a.pose),x=rotateLocal([1,0,0],a.pose),z=rotateLocal([0,0,1],a.pose);
 expect(up.reduce((s,v,i)=>s+v*x[i],0)).toBeCloseTo(0,12);expect(up.reduce((s,v,i)=>s+v*z[i],0)).toBeCloseTo(0,12);
 near(worldPoint([0,0,0],a.pose),[.2,-.1,.3]);
 const noRoll={...a.pose,roll:0};near(rotateLocal([0,0,1],noRoll),[1,0,0]);
 near(rotateLocal([0,1,0],noRoll),[0,Math.cos(Math.PI/6),.5]);
 near(rotateLocal([0,0,1],{...noRoll,yaw:0}),[0,-.5,Math.cos(Math.PI/6)]);
});
test('binding is jump-free; yaw/pitch/roll only translate and uniformly scale the whole layer, leaving order and other layers intact',()=>{
 const source=fixture(),original=JSON.stringify(source),id=source.layers[1].id;
 let a=createAssembly(source);a=bindLayer(a,id,'eye-l');expect(assemblyDrawing(a)).toEqual(source);
 a={...a,pose:{...a.pose,yaw:50,pitch:25,roll:32}};const d=assemblyDrawing(a),t=layerTransform(a,id);
 expect(t.scale).not.toBe(1);expect(d.layers).toEqual(source.layers);expect(d.curves.map(c=>c.depthOffset)).toEqual(source.curves.map(c=>c.depthOffset));
 for(let i=0;i<4;i++){const c=source.curves[i],n=d.curves[i];expect(n.width).toBe(c.width);near(n.handles[0].map((v,j)=>v-n.handles[1][j]),c.handles[0].map((v,j)=>(v-c.handles[1][j])*t.scale));}
 expect(d.curves[0].visible).toBe(false);expect(d.fills[0].visible).toBe(true);expect(d.curves.at(-1)).toEqual(source.curves.at(-1));
 expect(JSON.stringify(source)).toBe(original);near(d.nodes[0].position,source.nodes[0].position.map((v,i)=>v*t.scale+t.translation[i]));
 const restored=assemblyDrawing({...a,pose:createAssembly().pose});restored.nodes.forEach((n,i)=>near(n.position,source.nodes[i].position));
});
test('editing under a rotated pose is inverse-mapped, preserving handles and complete appearance; unbind does not jump',()=>{
 let a=createAssembly(fixture());const id=a.drawing.layers[1].id;a=bindLayer(a,id,'eye-l');a={...a,pose:{...a.pose,yaw:60,pitch:20}};
 const view=assemblyDrawing(a),c=view.curves[0],edit=moveHandle(view,{curveId:c.id,end:0},[c.handles[0][0]+.1,c.handles[0][1]-.2],true);
 const next=updateDrawing(a,edit);expect(assemblyDrawing(next)).toBe(edit);expect(next.drawing.curves[0].handles).not.toEqual(edit.curves[0].handles);parseDrawing(next.drawing);
 const detached=unbindLayer(next,id),result=assemblyDrawing(detached);result.nodes.forEach((n,i)=>near(n.position,edit.nodes[i].position));near(result.curves[0].handles[0],edit.curves[0].handles[0]);expect(detached.bindings).toHaveLength(0);
});
test('depth scale is calibrated to the binding pose and is independent of layer occlusion',()=>{
 let a=createAssembly(fixture());a={...a,pose:{...a.pose,yaw:35}};a=bindLayer(a,a.drawing.layers[1].id,'eye-r');
 expect(layerTransform(a,a.drawing.layers[1].id).scale).toBe(1);
 const b={...a,pose:{...a.pose,position:[0,0,1] as [number,number,number]}};
 expect(layerTransform(b,a.drawing.layers[1].id).scale).toBeGreaterThan(1);expect(assemblyDrawing(b).layers).toBe(a.drawing.layers);expect(locatorProjection(b,'eye-r').depth-locatorProjection(a,'eye-r').depth).toBeCloseTo(1);
});
test('compact project persistence removes legacy hair even when malformed, retains assembly and main drawing',()=>{
 const a=createAssembly(fixture()),p={...createLandmarkProject(),drawing:fixture(),assembly:a,hairstyle:{studio:{baked:'x'.repeat(100000)}}} as any;
 const serialized=serializeProject(p);expect(serialized).not.toContain('hairstyle');expect(serialized).not.toContain('baked');expect(serialized).not.toContain('\n');
 const loaded=parseLandmarks(serialized);expect(loaded.assembly).toEqual(a);expect(loaded.drawing).toEqual(p.drawing);
 expect(parseLandmarks(JSON.stringify(p)).hairstyle).toBeUndefined();expect(p.hairstyle).toBeDefined();
 const invalid=structuredClone(a);invalid.locators[0].planeId='missing';expect(()=>parseAssembly(invalid)).toThrow();
});
test('snapshot save/restore captures pose and bindings as well as editable vectors; original drawing and undo stay isolated',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../../app/store'),{useDrawingWorkspace}=await import('../../ui/assemblyDrawing/workspace');
  const source=fixture(),main=saveDrawingSnapshot({drawing:source},'Original');let a=createAssembly(source);a=bindLayer(a,source.layers[1].id,'eye-l');
  useEditor.getState().load({...createLandmarkProject(),...main,assembly:a});const root=useEditor.getState().project,ws=useDrawingWorkspace();
  ws.commitDrawingSnapshot(s=>saveDrawingSnapshot(s,'Front'));const front=useEditor.getState().project.assembly!.drawingSnapshots!.activeId!;
  const saved=useEditor.getState().project.assembly!;useEditor.getState().setAssembly({...saved,pose:{...saved.pose,yaw:60},bindings:saved.bindings.map(b=>({...b,offset:[.1,0]}))});
  const turned=ws.editor.getState().project.drawing!;
  ws.commitDrawingSnapshot(s=>saveDrawingSnapshot(s,'Turn'));const turnedState=useEditor.getState().project.assembly!,turn=turnedState.drawingSnapshots!.activeId!;
  parseAssembly(turnedState);expect(assemblySnapshots(turnedState)!.items[1].drawing.nodes[0].position[0]).toBeCloseTo(turned.nodes[0].position[0]);
  ws.commitDrawingSnapshot(s=>restoreDrawingSnapshot(s,front));expect(useEditor.getState().project.assembly!.pose.yaw).toBe(0);near(ws.editor.getState().project.drawing!.nodes[0].position,source.nodes[0].position);
  useEditor.getState().undo();expect(useEditor.getState().project.assembly!.pose.yaw).toBe(60);useEditor.getState().redo();expect(useEditor.getState().project.assembly!.pose.yaw).toBe(0);
  ws.commitDrawingSnapshot(s=>restoreDrawingSnapshot(s,turn));near(ws.editor.getState().project.drawing!.nodes[0].position,turned.nodes[0].position);
  const p=useEditor.getState().project;expect(p.drawing).toBe(root.drawing);expect(p.drawingSnapshots).toBe(root.drawingSnapshots);
  const loaded=parseLandmarks(serializeProject(p));expect(loaded.assembly!.pose.yaw).toBe(60);near(assemblyDrawing(loaded.assembly!).nodes[0].position,turned.nodes[0].position);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
test('one locator drives multiple layers without merging them; independent detach, rebind and save preserve other attachments',()=>{
 const source=fixture(),ids=source.layers.map(l=>l.id),original=JSON.stringify(source);
 const bound=bindLayers(createAssembly(source),ids,'eye-l',[-.4,.35]);
 expect(bound.bindings.map(b=>b.locatorId)).toEqual(['eye-l','eye-l']);expect(assemblyDrawing(bound)).toEqual(source);
 const turned={...bound,pose:{...bound.pose,yaw:45,pitch:15}},view=assemblyDrawing(turned);
 expect(layerTransform(turned,ids[0])).toEqual(layerTransform(turned,ids[1]));expect(view.layers).toEqual(source.layers);
 expect(parseAssembly(JSON.parse(JSON.stringify(turned))).bindings).toEqual(turned.bindings);
 const moved={...turned,bindings:turned.bindings.map((b,i)=>i?b:{...b,offset:[.1,.2] as Point2})};
 const reselected=bindLayers(moved,[...ids,ids[0]],'eye-l');expect(reselected).toBe(moved);
 const detached=unbindLayer(moved,ids[0]);expect(detached.bindings).toEqual([moved.bindings[1]]);
 const kept=assemblyDrawing(detached),before=assemblyDrawing(moved);kept.nodes.forEach((n,i)=>near(n.position,before.nodes[i].position));
 const other=bindLayers(moved,[ids[0]],'eye-r');expect(other.bindings.find(b=>b.layerId===ids[1])).toEqual(moved.bindings[1]);
 expect(other.bindings.find(b=>b.layerId===ids[0])!.locatorId).toBe('eye-r');expect(JSON.stringify(source)).toBe(original);
});
test('batch attachment validation fails atomically without mutating an earlier successful layer',()=>{
 const a=createAssembly(fixture()),saved=JSON.stringify(a);
 expect(()=>bindLayers(a,[a.drawing.layers[0].id,'missing-layer'],'eye-l')).toThrow('请先选择图层');expect(JSON.stringify(a)).toBe(saved);
});
