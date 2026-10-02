import {readFileSync} from 'node:fs';
import {Children,createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import type {SceneCommand} from '../domain/recordingScene/commands';
import {sceneSelectionPayload} from '../ui/vectorRecording/sceneSelection';
import {sceneLayerWarpSelection,sceneWarpAction,type SceneWarpAction} from '../ui/vectorRecording/sceneWarpSelection';
import {SceneWarpSelectionControl} from '../ui/vectorRecording/SceneRecordingWorkspace';

const txt=(cn:string)=>cn;
function fixture(){
 let project=parseLandmarks(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'));
 const run=(commands:SceneCommand[])=>{const result=prepareSceneBatch(project,{commands});project={...project,recordingScenes:result.recordingScenes};return project.recordingScenes!.scenes[0];};
 return {get scene(){return project.recordingScenes!.scenes[0];},run};
}
function click(action:SceneWarpAction,currentView:boolean,onCreate:()=>void,onShow:(id:string)=>void){
 const tree=SceneWarpSelectionControl({action,currentView,onCreate,onShow,txt});
 const button=Children.toArray(tree.props.children)[0] as ReactElement<{onClick:()=>void}>;
 button.props.onClick();
}

test('create, blank, reselect and repeated show preserve the existing Warp and explicit save semantics',()=>{
 const f=fixture(),refs=f.scene.bindings.slice(0,2).map(({instanceId,sourceLayerId})=>({instanceId,sourceLayerId}));
 f.run([{op:'rebindLayers',layerRefs:refs,warpId:null}]);
 expect(sceneWarpAction(f.scene,refs)).toEqual({kind:'create'});
 const count=f.scene.warps.length;
 f.run([{op:'createWarp',layerRefs:refs,rows:2,columns:2}]);
 const warp=f.scene.warps.at(-1)!;
 f.run([{op:'saveSelected',warpIds:[warp.id]}]);
 const p=warp.restGrid.nodes[0].position;
 f.run([{op:'editWarpNodes',warpId:warp.id,edits:[{index:0,position:[p[0]+.02,p[1]]}]}]);
 const before=JSON.stringify(f.scene);
 let selected=sceneLayerWarpSelection(f.scene,[],warp.id);
 expect(selected.activeWarpId).toBe(warp.id);expect(selected.warpIds).toEqual([]);
 selected=sceneLayerWarpSelection(f.scene,refs,selected.activeWarpId);
 expect(selected.activeWarpId).toBe(warp.id);expect(sceneSelectionPayload(selected.warpIds,selected.layerRefs)).not.toHaveProperty('warpIds');
 const onCreate=vi.fn(),onShow=vi.fn();
 for(let i=0;i<3;i++)click(sceneWarpAction(f.scene,refs),false,onCreate,onShow);
 expect(onCreate).not.toHaveBeenCalled();expect(onShow).toHaveBeenCalledTimes(3);expect(onShow).toHaveBeenLastCalledWith(warp.id);
 expect(f.scene.warps).toHaveLength(count+1);expect(JSON.stringify(f.scene)).toBe(before);
 const savedWarp=structuredClone(f.scene.warps.at(-1));
 f.run([{op:'saveSelected',...sceneSelectionPayload(selected.warpIds,selected.layerRefs)}]);
 expect(f.scene.warps.at(-1)).toEqual(savedWarp);
 f.run([{op:'saveSelected',...sceneSelectionPayload([warp.id],[])}]);
 expect(f.scene.warps.at(-1)!.draft).toBeUndefined();
});

test('different direct bindings and partly bound layers cannot create or replace a Warp',()=>{
 const f=fixture(),refs=f.scene.bindings.map(({instanceId,sourceLayerId})=>({instanceId,sourceLayerId}));
 for(const selected of [refs,[refs[0],refs[2]]])expect(sceneWarpAction(f.scene,selected)).toEqual({kind:'blocked'});
 f.run([{op:'rebindLayers',layerRefs:[refs[1]],warpId:null}]);
 const action=sceneWarpAction(f.scene,refs.slice(0,2)),before=JSON.stringify(f.scene),onCreate=vi.fn(),onShow=vi.fn();
 expect(action).toEqual({kind:'blocked'});click(action,true,onCreate,onShow);
 expect(onCreate).not.toHaveBeenCalled();expect(onShow).not.toHaveBeenCalled();expect(JSON.stringify(f.scene)).toBe(before);
 expect(sceneLayerWarpSelection(f.scene,refs.slice(0,2),f.scene.warps[0].id).activeWarpId).toBe('');
 expect(sceneLayerWarpSelection(f.scene,[refs[1]],f.scene.warps[0].id).activeWarpId).toBe('');
});

test('shared parent never substitutes for actual leaf and display remains available in preview',()=>{
 const f=fixture(),refs=f.scene.bindings.slice(0,2).map(({instanceId,sourceLayerId})=>({instanceId,sourceLayerId})),parent=f.scene.warps[0].id;
 f.run([{op:'createChild',parentWarpId:parent,layerRefs:[refs[0]],rows:1,columns:1}]);
 const child=f.scene.warps.at(-1)!.id;
 expect(sceneWarpAction(f.scene,[refs[0]])).toEqual({kind:'show',warpId:child});
 expect(sceneWarpAction(f.scene,refs)).toEqual({kind:'blocked'});
 const render=(action:SceneWarpAction,currentView=false)=>renderToStaticMarkup(createElement(SceneWarpSelectionControl,{action,currentView,onCreate:()=>{},onShow:()=>{},txt}));
 const shown=render({kind:'show',warpId:child});expect(shown).toContain('显示已有 Warp');expect(shown.match(/<button[^>]*>/)?.[0]).not.toContain('disabled');
 expect(render({kind:'create'}).match(/<button[^>]*>/)?.[0]).toContain('disabled');
 const blocked=render({kind:'blocked'},true);expect(blocked).toContain('不能重复建立');expect(blocked).toContain('明确挂接');expect(blocked.match(/<button[^>]*>/)?.[0]).toContain('disabled');
});
