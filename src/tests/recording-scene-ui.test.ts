import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {emptyRecordingScene,type RecordingScene} from '../domain/recordingScene/model';
import RecordingWorkspace from '../ui/vectorRecording/RecordingWorkspace';

vi.mock('../app/store',async importOriginal=>{const m=await importOriginal<typeof import('../app/store')>();return {...m,useEditor:Object.assign((select?:(s:ReturnType<typeof m.useEditor.getState>)=>unknown)=>select?select(m.useEditor.getState()):m.useEditor.getState(),m.useEditor)};});
function fixture(){
 let source=addLayer(emptyDrawing(),'Mouth layer');source=createCurve(source,source.layers[0].id,[[0,0],[.1,.1],[.2,.1],[.3,0]],.008,'Mouth');
 const saved=saveDrawingSnapshot({drawing:source},'Reusable mouth'),artworkId=saved.drawingSnapshots!.activeId!,rest=createWarpGrid({min:[-.1,-.1],max:[.4,.2]},1,1);
 const scene:RecordingScene={...emptyRecordingScene('scene','Scene assembly'),angle:{x:60,y:0},instances:[{id:'a',artworkId,name:'Near mouth'},{id:'b',artworkId,name:'Far mouth'}],warps:[{id:'wa',name:'Two-key Warp',restGrid:rest,keys:[0,90].map(x=>({id:'a'+x,angle:{x,y:0},value:rest}))},{id:'wb',name:'Four-key Warp',restGrid:rest,keys:[0,30,60,90].map(x=>({id:'b'+x,angle:{x,y:0},value:rest})),draft:{angle:{x:30,y:0},value:rest}}],bindings:[{instanceId:'a',sourceLayerId:source.layers[0].id,warpId:'wa'},{instanceId:'b',sourceLayerId:source.layers[0].id,warpId:'wb'}]};
 return {project:{...createEmptyProject(),...saved,recordingScenes:{version:1 as const,activeSceneId:scene.id,scenes:[scene]}},source,scene};
}

test('scene UI renders source instances and independent object key counts without a global draft angle lock',()=>{
 const previous=useEditor.getState(),{project}=fixture();
 try{
  useEditor.setState({project,past:[],future:[]});const before=JSON.stringify(project),html=renderToStaticMarkup(createElement(RecordingWorkspace));
  expect(html).toContain('data-testid="recording-scene"');expect(html).toContain('data-testid="vr-scene-canvas"');
  expect(html).toContain('Near mouth');expect(html).toContain('Far mouth');expect(html).toContain('Two-key Warp');expect(html).toContain('Four-key Warp');
  expect(html).toContain('2 键');expect(html).toContain('4 键');
  const pad=html.match(/<div[^>]*data-testid="scene-angle-pad"[^>]*>/)?.[0];expect(pad).toBeTruthy();expect(pad).not.toContain('disabled');expect(html).not.toContain('aria-label="Angle X slider"');
  const number=html.match(/<input[^>]*aria-label="Angle X"[^>]*>/)?.[0];expect(number).toContain('type="text"');expect(number).toContain('inputMode="decimal"');
  expect(html).toContain('data-testid="recording-reference-controls"');expect(html).toContain('data-testid="scene-onion-controls"');expect(html).toContain('aria-label="Active Warp"');
  expect(html).toContain('data-testid="scene-save-selected"');expect(JSON.stringify(project)).toBe(before);
 }finally{useEditor.setState(previous,true);}
});

test('AI scene labels distinguish instances using the original source identity',()=>{
 const previous=useEditor.getState(),{project,source}=fixture();
 try{
  useEditor.setState({project,past:[],future:[]});const html=renderToStaticMarkup(createElement<{aiGuides?:boolean}>(RecordingWorkspace,{aiGuides:true}));
  expect(html).toContain('data-testid="ai-guide-overlay"');expect(html).toContain(`Near mouth · ${source.curves[0].id.slice(0,8)} P0`);
  expect(html).not.toContain('scene:1:a: P0');expect(html).not.toContain('scene:…');
 }finally{useEditor.setState(previous,true);}
});

test('viewpoint workflow places angle recording on the left and reused Drawing layers on the right',()=>{
 const previous=useEditor.getState(),{project}=fixture();
 try{
  useEditor.setState({project,past:[],future:[]});const html=renderToStaticMarkup(createElement(RecordingWorkspace));
  const left=html.indexOf('data-testid="scene-viewpoint-panel"'),canvas=html.indexOf('data-testid="vr-scene-canvas"'),right=html.indexOf('data-testid="scene-source-layer-panel"');
  expect(left).toBeGreaterThan(0);expect(left).toBeLessThan(canvas);expect(canvas).toBeLessThan(right);
  const leftContent=html.slice(left,html.indexOf('</aside>',left));expect(leftContent.indexOf('scene-angle-pad')).toBeLessThan(leftContent.indexOf('scene-update-viewpoint'));expect(leftContent.indexOf('scene-update-viewpoint')).toBeLessThan(leftContent.indexOf('scene-onion-controls'));expect(leftContent.indexOf('scene-onion-controls')).toBeLessThan(leftContent.indexOf('scene-reference-toggle'));expect(leftContent).not.toContain('data-testid="recording-reference-controls"');expect(html).toContain('id="recording-reference-panel"');expect(html.match(/data-testid="scene-reference-toggle"/g)).toHaveLength(1);
  expect(html).toContain('data-testid="scene-layer-panel"');expect(html).toContain('data-testid="drawing-layer-select"');
  expect(html).toContain('data-testid="drawing-curve-row"');expect(html).toContain('data-testid="drawing-toggle-fills"');
  expect(html).toContain('data-testid="scene-update-viewpoint"');expect(html).toContain('data-testid="vr-tool-direct"');expect(html).toContain('data-testid="vr-tool-zoom"');
 }finally{useEditor.setState(previous,true);}
});

test('a new unkeyed angle is preview-only, while viewpoints can exist without any Warp',()=>{
 const previous=useEditor.getState(),{project,scene}=fixture();
 try{
  let current={...scene,angle:{x:45,y:0}};useEditor.setState({project:{...project,recordingScenes:{...project.recordingScenes,scenes:[current]}},past:[],future:[]});
  let html=renderToStaticMarkup(createElement(RecordingWorkspace));expect(html).toContain('data-testid="scene-create-viewpoint"');expect(html).not.toContain('data-testid="scene-update-viewpoint"');expect(html).toContain('data-edit-enabled="false"');
  current={...current,warps:[],bindings:[],viewpoints:[{id:'zero-view',name:'Front',angle:{x:0,y:0}},{id:'right-view',name:'Profile',angle:{x:90,y:0}}],angle:{x:90,y:0}};
  useEditor.setState({project:{...project,recordingScenes:{...project.recordingScenes,scenes:[current]}}});html=renderToStaticMarkup(createElement(RecordingWorkspace));
  expect(html).toContain('Profile');expect(html).toContain('data-testid="scene-update-viewpoint"');expect(html).not.toContain('data-testid="scene-create-viewpoint"');
  const update=html.match(/<button[^>]*data-testid="scene-update-viewpoint"[^>]*>/)?.[0];expect(update).toBeTruthy();expect(update).not.toContain('disabled');
 }finally{useEditor.setState(previous,true);}
});
