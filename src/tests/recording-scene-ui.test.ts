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
  const slider=html.match(/<input[^>]*aria-label="Angle X slider"[^>]*>/)?.[0];expect(slider).toBeTruthy();expect(slider).not.toContain('disabled');
  const number=html.match(/<input[^>]*aria-label="Angle X"[^>]*>/)?.[0];expect(number).toContain('type="text"');expect(number).toContain('inputMode="decimal"');
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
