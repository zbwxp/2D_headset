import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {addLayer,connect,createCurve} from '../domain/drawing/commands';
import {addDisplayInterval,changeDisplayInterval} from '../domain/drawing/displayIntervals';
import {emptyDrawing,shapeOf,type Point2} from '../domain/drawing/model';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {emptyRecordingScene,instanceObjectId,type RecordingScene} from '../domain/recordingScene/model';
import {createWarpGrid,type WarpGrid} from '../domain/vectorWarp/model';
import SceneAnglePad from '../ui/vectorRecording/SceneAnglePad';
import SceneOnionSkin,{SceneOnionControls} from '../ui/vectorRecording/SceneOnionSkin';
import {DEFAULT_SCENE_ONION_SETTINGS,evaluateSceneOnionFrame,normalizeSceneOnionSettings,sampleSceneOnionAngles,sceneAngleFromPad,sceneAngleToPad,sceneOnionSavedSignature} from '../ui/vectorRecording/angleInspection';
import PaintScene from '../ui/drawing/PaintScene';

const settings={...DEFAULT_SCENE_ONION_SETTINGS,enabled:true};
const screen=([x,y]:Point2):Point2=>[20+x*100,120-y*100];
const shifted=(grid:WarpGrid,x:number):WarpGrid=>({...grid,nodes:grid.nodes.map(node=>({...node,position:[node.position[0]+x,node.position[1]],handleU:[node.handleU[0]+x,node.handleU[1]],handleV:[node.handleV[0]+x,node.handleV[1]]}))});
function fixture(){
 let drawing=addLayer(emptyDrawing(),'Contour');const layer=drawing.layers[0].id;
 drawing=createCurve(drawing,layer,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'A','a');
 drawing=createCurve(drawing,layer,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');
 drawing=connect(drawing,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 drawing=addDisplayInterval(drawing,'a','SHOW');let track=drawing.displayIntervals![0];drawing=changeDisplayInterval(drawing,track.id,track.ranges[0].id,{start:.1,end:.9});
 drawing=addDisplayInterval(drawing,'a','HIDE');track=drawing.displayIntervals![0];drawing=changeDisplayInterval(drawing,track.id,track.ranges.at(-1)!.id,{start:.2,end:.3});
 const grid=createWarpGrid({min:[-1,-1],max:[2,2]},2,2);
 const scene:RecordingScene={...emptyRecordingScene('inspection'),angle:{x:30,y:0},instances:[{id:'instance',artworkId:'source',name:'Source'}],
  warps:[{id:'parent',name:'Parent',restGrid:grid,keys:[{id:'parent-zero',angle:{x:0,y:0},value:shifted(grid,.5)}]},
   {id:'child',name:'Child',parentId:'parent',restGrid:grid,keys:[{id:'zero',angle:{x:0,y:0},value:grid},{id:'ninety',angle:{x:90,y:0},value:shifted(grid,.9)}],draft:{angle:{x:30,y:0},value:shifted(grid,4)}}],
  bindings:[{instanceId:'instance',sourceLayerId:layer,warpId:'child'}],
 };
 return {drawing,scene,resolve:()=>drawing};
}

test('XY inspection pad preserves screen-right yaw and upward pitch, including corners and clamping',()=>{
 expect(sceneAngleFromPad(0,0)).toEqual({x:-90,y:90});expect(sceneAngleFromPad(1,1)).toEqual({x:90,y:-90});expect(sceneAngleFromPad(.5,.5)).toEqual({x:0,y:0});
 expect(sceneAngleFromPad(-1,2)).toEqual({x:-90,y:-90});expect(sceneAngleFromPad(.501,.499)).toEqual({x:.2,y:.2});
 expect(sceneAngleToPad({x:45,y:45})).toEqual([.75,.25]);
 const html=renderToStaticMarkup(createElement(SceneAnglePad,{angle:{x:45,y:45},views:[{id:'view',name:'Side',angle:{x:90,y:0}}],onChange:()=>{throw Error('Rendering must not move the cursor');}}));
 expect(html).toContain('left:75%;top:25%');expect(html).toContain('data-view-id="view"');expect(html).toContain('data-angle-x="45"');
});

test('sweeps fix the other axis, omit current angles, honor 5/10-degree spacing, and cap at 37',()=>{
 const x=sampleSceneOnionAngles({x:0,y:17},{...settings,step:5});expect(x).toHaveLength(36);expect(x.every(a=>a.y===17&&a.x!==0)).toBe(true);expect(x.at(0)!.x).toBe(-90);expect(x.at(-1)!.x).toBe(90);
 expect(sampleSceneOnionAngles({x:.1,y:17},{...settings,step:5})).toHaveLength(37);
 expect(sampleSceneOnionAngles({x:12.5,y:0},{...settings,axis:'y',min:-20,max:20})).toEqual([-20,-10,10,20].map(y=>({x:12.5,y})));
 expect(sampleSceneOnionAngles({x:8,y:0},{...settings,min:3,max:17,step:5})).toEqual([{x:3,y:0},{x:13,y:0}]);
 expect(sampleSceneOnionAngles({x:0,y:0},{...settings,min:0,max:0})).toEqual([]);
 expect(normalizeSceneOnionSettings({...settings,min:200,max:-200})).toMatchObject({min:-90,max:90});
});

test('saved inspection cache ignores detached cursor/viewpoint/draft updates and invalidates saved keys',()=>{
 const {scene}=fixture(),signature=sceneOnionSavedSignature(scene),changed=structuredClone(scene);
 changed.angle={x:-60,y:75};changed.viewpoints=[{id:'new-view',name:'New',angle:{x:3,y:2}}];changed.warps[1].draft!.value.nodes[0].position=[50,50];
 expect(sceneOnionSavedSignature(changed)).toBe(signature);
 changed.warps[1].keys[0].value.nodes[0].position=[1,1];expect(sceneOnionSavedSignature(changed)).not.toBe(signature);
 const saved=JSON.parse(signature) as RecordingScene;expect(saved.warps.every(w=>!w.draft)).toBe(true);expect(saved.angle).toEqual({x:0,y:0});
});

test('onion evaluates saved keys in the active local coordinate space without changing source or scene',()=>{
 const {scene,drawing,resolve}=fixture(),before=JSON.stringify([scene,drawing]),angle={x:30,y:0};
 const frame=evaluateSceneOnionFrame(scene,resolve,angle,'child'),saved=evaluateScene(scene,resolve,{angle,useDraft:false,diagnostics:'preview',stopAtWarpId:'child'}),active=evaluateScene(scene,resolve,{angle,useDraft:true,diagnostics:'preview',stopAtWarpId:'child'});
 expect(frame.drawing).toEqual(saved.drawing);expect(frame.paintBatches).toEqual(saved.paintBatches);
 expect(shapeOf(frame.drawing,instanceObjectId('instance','a'))[0][0]).toBeCloseTo(.3,8);expect(shapeOf(active.drawing,instanceObjectId('instance','a'))[0][0]).toBeCloseTo(4,8);
 const global=evaluateSceneOnionFrame(scene,resolve,angle);expect(shapeOf(global.drawing,instanceObjectId('instance','a'))[0][0]).toBeCloseTo(.8,8);
 expect(JSON.stringify([scene,drawing])).toBe(before);
});

test('ghosts render the real SHOW/HIDE/ARC paint output with no fills or picking geometry and omit current frame',()=>{
 const {scene,resolve}=fixture(),frame=evaluateSceneOnionFrame(scene,resolve,{x:10,y:0}),current=evaluateSceneOnionFrame(scene,resolve,{x:30,y:0}),props={screen,unit:100};
 const actual=renderToStaticMarkup(createElement(SceneOnionSkin,{...props,frames:[frame,current],angle:scene.angle,opacity:.17}));
 const expected=renderToStaticMarkup(createElement(PaintScene,{...props,d:frame.drawing,paintBatches:frame.paintBatches,pixelsPerUnit:100,preview:true,showFills:false,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}}));
 const paths=(html:string)=>html.match(/<path[^>]*data-testid="drawing-(?:ink|cusp-tip)"[^>]*>/g)??[];
 expect(paths(actual).length).toBeGreaterThan(0);expect(paths(actual)).toEqual(paths(expected));expect(actual).toContain('data-frame-count="1"');expect(actual).toContain('opacity="0.17"');
 expect(actual).not.toContain('data-testid="drawing-fill"');expect(actual).not.toMatch(/data-testid="drawing-(?:hit|arc-hit|offset-hit|fill-hit)"/);expect(actual).toContain('pointer-events="none"');expect(actual).not.toContain('data-angle-x="30"');
 const controls=renderToStaticMarkup(createElement(SceneOnionControls,{settings:{...settings,enabled:false},onChange:()=>{throw Error('Controls must not author scene data');}}));expect(controls).toContain('disabled=""');expect(controls).toContain('hidden=""');
});
