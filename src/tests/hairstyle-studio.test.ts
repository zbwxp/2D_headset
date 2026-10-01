import {test,expect,vi} from 'vitest';
import {createHairStudio,importHairStudio,hairBakeSource,hairBakeMesh,hairPaintBounds} from '../domain/hairstyle/studio';
import {defaultHairstyle,parseHairstyle} from '../domain/hairstyle/model';
import {defaultPumpkinProfile,hairShellField} from '../domain/hairstyle/profile';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {addLayer,ellipse,createCurve,transform} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {saveDrawingSnapshot,snapshotDrawing} from '../domain/drawing/snapshots';
import {hairBasis} from '../domain/hairstyle/projection';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
function fixture(){const d=addLayer(emptyDrawing(),'面发'),e=ellipse(d,d.layers[0].id,[-.4,-.2],[.4,.6],.008);return createFill(e.document,e.ids,'white');}

test('snapshot import creates an isolated full drawing, retaining the procedural workspace and saved checkpoints',()=>{
 const d=fixture(),library=saveDrawingSnapshot({drawing:d},'正面').drawingSnapshots!,h=defaultHairstyle(),original=JSON.stringify({d,library,h});
 const next=importHairStudio(h,snapshotDrawing(library,library.activeId!));
 expect(next.drawing).toBe(h.drawing);expect(next.strandSet).toBe(h.strandSet);expect(next.studio?.drawing).toEqual(d);expect(next.studio?.drawing).not.toBe(d);
 next.studio!.drawing.nodes[0].position[0]=9;expect(JSON.stringify({d,library,h})).toBe(original);
});
test('baking preserves solid fill even when all boundary ink is hidden, respects view fill toggles, excludes reference',()=>{
 const d=fixture();d.curves=d.curves.map(c=>({...c,visible:false,inkVisible:false}));
 d.reference={name:'Reference',dataUrl:'data:image/png;base64,AAAA',width:2,height:2,offset:[0,0],scale:1,rotation:0,opacity:.5,visible:true,locked:false};
 const source=hairBakeSource(d);expect(source.reference).toBeUndefined();expect(source.fills[0].visible).toBe(true);hairPaintBounds(source).forEach((v,i)=>expect(v).toBeCloseTo([-.425,-.225,.425,.625][i],10));
 expect(()=>hairPaintBounds(hairBakeSource(d,false))).toThrow(/没有/);
 expect(hairBakeSource(d,false,{[d.layers[0].id]:true}).fills[0].visible).toBe(true);
 expect(hairBakeSource(d,true,{[d.layers[0].id]:false}).fills[0].visible).toBe(false);
 expect(d.reference).toBeDefined();expect(d.fills[0].visible).toBe(true);
});
test('offscreen hidden curves do not enlarge bake bounds; visible endpoint extensions are included',()=>{
 let d=fixture();d=createCurve(d,d.layers[0].id,[[10,10],[11,11],[12,12],[13,13]],.01,'Hidden');
 d.curves=d.curves.map(c=>c.name==='Hidden'?{...c,visible:false}:c);expect(hairPaintBounds(d)[2]).toBeLessThan(1);
 let line=addLayer(emptyDrawing(),'Line');line=createCurve(line,line.layers[0].id,[[0,0],[.1,0],[.2,0],[.3,0]],.01);
 line.curves[0].inkEnds=[{}, {extension:.4}];expect(hairPaintBounds(line)[2]).toBeGreaterThanOrEqual(.7);
});
test('front UV projection stays exact on the pumpkin shell and independent of view; triangles face outward',()=>{
 const h=defaultHairstyle(),bounds:[number,number,number,number]=[-2,-2,2,2];h.net={...h.net,center:[.2,.1,-.3],radiusX:1.2,radiusY:.8,profile:defaultPumpkinProfile()};
 const mesh=hairBakeMesh(h.net,bounds,true,40,24),before=JSON.stringify(mesh);
 for(let i=0;i<mesh.vertices.length;i++){const p=mesh.vertices[i];expect(Math.abs(hairShellField(h.net,p))).toBeLessThan(1e-7);expect(mesh.uv[i][0]*4-2).toBeCloseTo(p[0],10);expect(mesh.uv[i][1]*4-2).toBeCloseTo(p[1],10);expect(p[2]).toBeGreaterThanOrEqual(h.net.center[2]-1e-8);}
 const tri=mesh.triangles[20*2+40*12*2],v=tri.map(i=>mesh.vertices[i]),a=v[1].map((x,i)=>x-v[0][i]),b=v[2].map((x,i)=>x-v[0][i]);expect(a[0]*b[1]-a[1]*b[0]).toBeGreaterThan(0);
 const p=mesh.vertices[500],project=(yaw:number)=>{const b=hairBasis({yaw,pitch:0});return p.reduce((s,v,i)=>s+v*b.right[i],0);};expect(project(45)).not.toBe(project(0));expect(JSON.stringify(mesh)).toBe(before);
});
test('source vectors, private snapshots and frozen bake survive save/load; invalid baked data rejects',()=>{
 let h=defaultHairstyle();h={...h,studio:createHairStudio(fixture())};const saved=saveDrawingSnapshot(h.studio!,'面发');h.studio={...h.studio!,...saved,drawing:saved.drawing!,baked:{version:1,net:structuredClone(h.net),drawing:hairBakeSource(h.studio!.drawing)}};
 const json=JSON.stringify(h),loaded=parseHairstyle(JSON.parse(json));expect(loaded.studio).toEqual(h.studio);
 const p=parseLandmarks(JSON.stringify({...createLandmarkProject(),hairstyle:h}));expect(p.hairstyle).toBeUndefined();
 const invalid=JSON.parse(json);invalid.studio.baked.net.radiusX=Infinity;expect(()=>parseHairstyle(invalid)).toThrow();
 const bad=JSON.parse(json);bad.studio.baked.drawing.nodes[0].position=[null,0];expect(()=>parseHairstyle(bad)).toThrow();
});
test('shared full editor routes edits, snapshots and undo only into the private studio',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../app/store'),{hairStudioWorkspace:ws}=await import('../ui/drawing/workspace');
  const d=fixture(),main=saveDrawingSnapshot({drawing:d},'Main'),h={...defaultHairstyle(),studio:createHairStudio(d)};
  useEditor.getState().load({...createLandmarkProject(),...main});useEditor.getState().setHairstyle(h);const initial=useEditor.getState().project;
  const changed=transform(h.studio.drawing,h.studio.drawing.curves.map(c=>c.id),([x,y])=>[x+.1,y]);ws.commitDrawing(changed);
  expect(useEditor.getState().project.drawing).toBe(initial.drawing);expect(useEditor.getState().project.drawingSnapshots).toBe(initial.drawingSnapshots);expect(useEditor.getState().project.hairstyle?.drawing).toBe(initial.hairstyle?.drawing);
  expect(useEditor.getState().project.hairstyle?.studio?.drawing).toBe(changed);useEditor.getState().undo();expect(useEditor.getState().project).toBe(initial);useEditor.getState().redo();expect(ws.editor.getState().project.drawing).toBe(changed);
  ws.commitDrawingSnapshot(s=>saveDrawingSnapshot(s,'Hair private'));expect(useEditor.getState().project.hairstyle?.studio?.drawingSnapshots?.items).toHaveLength(1);expect(useEditor.getState().project.drawingSnapshots?.items[0].name).toBe('Main');
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
