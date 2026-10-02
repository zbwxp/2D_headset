import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {recordingSceneSources,resolveRecordingSceneSource} from '../app/recordingSceneSources';
import {emptyRecordingScene,instanceObjectId,sceneLayerKey,type SceneWarp,type RecordingScene,type RecordingScenes} from '../domain/recordingScene/model';
import {evaluateWarpTrack,evaluateVisibilityTrack,evaluateIntervalTrack} from '../domain/recordingScene/tracks';
import {migrateLegacyRecordingScenes} from '../domain/recordingScene/migration';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {evaluateRecording} from '../app/vectorRecordingApi';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import {createWarpGrid,moveWarpNode,type WarpGrid} from '../domain/vectorWarp/model';
import {mapPoint} from '../domain/vectorWarp/evaluation';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {moveHandle} from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type GeometryEndpoint,type Point2} from '../domain/drawing/model';
import {createEmptyProject} from '../app/emptyProject';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PaintScene from '../ui/drawing/PaintScene';
import type {PaintBatch} from '../domain/drawing/depth';
import {evaluatePose} from '../domain/vectorRecording/model';
import {intervalPinch} from '../domain/drawing/intervalPinch';

const example=()=>parseLandmarks(readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8'));
const translate=(grid:WarpGrid,x:number,y=0):WarpGrid=>({...grid,nodes:grid.nodes.map(n=>({...n,position:[n.position[0]+x,n.position[1]+y],handleU:[n.handleU[0]+x,n.handleU[1]+y],handleV:[n.handleV[0]+x,n.handleV[1]+y]}))});

test('instance namespaces cannot alias separators and preserve source traversal ordering',()=>{
 const instances=['a','a:b','a:b:c','scene:1:a','长实例'],ids=['a','a:b','b:c','%2F','/','__proto__','scene:1:a','末端'];
 const compiled=instances.flatMap(instance=>ids.map(id=>instanceObjectId(instance,id)));
 expect(new Set(compiled).size).toBe(instances.length*ids.length);
 expect(sceneLayerKey({instanceId:'a:b',sourceLayerId:'c'})).not.toBe(sceneLayerKey({instanceId:'a',sourceLayerId:'b:c'}));
 const ordered=[...ids].sort((a,b)=>a.localeCompare(b));
 for(const instance of instances)expect(ids.map(id=>instanceObjectId(instance,id)).sort((a,b)=>a.localeCompare(b))).toEqual(ordered.map(id=>instanceObjectId(instance,id)));
});

test('the live source resolver exposes an unsaved edit to every reference without replacing its saved artwork',()=>{
 const project=example(),before=JSON.stringify(project),id=project.drawingSnapshots!.activeId!,layer=project.drawing!.layers.find(l=>l.name==='嘴部')!,curve=project.drawing!.curves.find(c=>layer.items.includes(c.id))!,handle=curve.handles[0];
 const drawing=moveHandle(project.drawing!,{curveId:curve.id,end:0},[handle[0],handle[1]+.01]),edited={...project,drawing},sources=recordingSceneSources(edited);
 expect(sources[id]).toBe(drawing);expect(resolveRecordingSceneSource(edited,id)).toBe(drawing);
 const sameAssetInstances=[{id:'first',artworkId:id},{id:'second',artworkId:id}];
 expect(sameAssetInstances.map(i=>sources[i.artworkId])).toEqual([drawing,drawing]);
 expect(project.drawingSnapshots!.items.find(s=>s.id===id)!.drawing.curves.find(c=>c.id===curve.id)!.handles[0]).toEqual(handle);
 expect(JSON.stringify(project)).toBe(before);
 expect(resolveRecordingSceneSource(edited,'unknown-source')).toBeUndefined();
});

test('an independent sparse Warp has exact keys, a neutral origin, axis clamping and local missing-corner composition',()=>{
 const rest=createWarpGrid({min:[-1,-1],max:[1,1]},1,1),track:SceneWarp={id:'warp',name:'Warp',restGrid:rest,keys:[{id:'x',angle:{x:90,y:0},value:translate(rest,.8)},{id:'y',angle:{x:0,y:90},value:translate(rest,0,.6)}]},before=JSON.stringify(track);
 expect(evaluateWarpTrack(track,{x:0,y:0})).toEqual(rest);
 expect(evaluateWarpTrack(track,{x:90,y:0})).toBe(track.keys[0].value);
 expect(evaluateWarpTrack(track,{x:-45,y:0})).toEqual(rest);
 const midpoint=evaluateWarpTrack(track,{x:45,y:45});expect(midpoint.nodes[0].position[0]).toBeCloseTo(-.6,12);expect(midpoint.nodes[0].position[1]).toBeCloseTo(-.7,12);
 const corrected={...track,keys:[...track.keys,{id:'corner',angle:{x:45,y:45},value:translate(rest,2,3)}]};expect(evaluateWarpTrack(corrected,{x:45,y:45})).toBe(corrected.keys[2].value);
 expect(JSON.stringify(track)).toBe(before);
});

test('an object draft applies only at its own angle and preview can explicitly ignore it',()=>{
 const rest=createWarpGrid({min:[-1,-1],max:[1,1]},1,1),track:SceneWarp={id:'warp',name:'Warp',restGrid:rest,keys:[{id:'front',angle:{x:0,y:0},value:rest},{id:'side',angle:{x:90,y:0},value:translate(rest,.8)}],draft:{angle:{x:30,y:0},value:translate(rest,5)}},before=JSON.stringify(track);
 expect(evaluateWarpTrack(track,{x:30,y:0})).toBe(track.draft!.value);
 expect(evaluateWarpTrack(track,{x:30,y:0},false).nodes[0].position[0]).toBeCloseTo(-1+.8/3,12);
 expect(evaluateWarpTrack(track,{x:45,y:0}).nodes[0].position[0]).toBeCloseTo(-.6,12);
 expect(JSON.stringify(track)).toBe(before);
});

test.each(['yaw-turning-example','three-piece-starting-example'])('%s migrates as one source instance with all old per-object sampling angles and immutable legacy data',name=>{
 const project=parseLandmarks(readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8')),before=JSON.stringify(project),migrated=migrateLegacyRecordingScenes(project) as typeof project&{recordingScenes:RecordingScenes},scenes=migrated.recordingScenes;
 expect(scenes.scenes).toHaveLength(project.vectorRecording!.rigs.length);expect(migrated.vectorRecording).toBe(project.vectorRecording);expect(migrated.drawing).toBe(project.drawing);expect(migrated.drawingSnapshots).toBe(project.drawingSnapshots);
 for(const scene of scenes.scenes){const rig=project.vectorRecording!.rigs.find(r=>r.id===scene.legacy!.rigId)!;expect(scene.instances).toHaveLength(1);expect(scene.instances[0].artworkId).toBe(rig.artworkId);expect(scene.tolerance).toBe(project.vectorRecording!.tolerance);expect(scene.warps).toHaveLength(rig.deformers.length);
  for(const track of [...scene.warps,...scene.visibilityTracks,...scene.intervalTracks]){expect(track.interpolation).toBe('legacy');expect(track.keys.map(k=>k.angle)).toEqual(rig.keys.map(k=>k.angle));}
  expect(scene.warps.map(w=>w.restGrid)).toEqual(rig.deformers.map(d=>d.grid));expect(scene.bindings).toHaveLength(Object.keys(rig.bindings).length);
  expect(new Set(scene.intervalTracks.map(t=>t.sourceTrackId)).size).toBe(scene.intervalTracks.length);
 }
 expect(migrateLegacyRecordingScenes(migrated)).toBe(migrated);expect(JSON.stringify(project)).toBe(before);
});

test('a missing legacy source retains its exact reference and archived rig without inventing artwork ownership',()=>{
 const full=example(),project={...full,drawing:undefined,drawingSnapshots:undefined},before=JSON.stringify(project),migrated=migrateLegacyRecordingScenes(project) as typeof project&{recordingScenes:RecordingScenes};
 expect(migrated.recordingScenes.scenes[0].instances[0].artworkId).toBe(full.vectorRecording!.rigs[0].artworkId);
 expect(migrated.recordingScenes.scenes[0].instances).toHaveLength(1);expect(migrated.vectorRecording).toBe(project.vectorRecording);expect(migrated.drawing).toBeUndefined();expect(migrated.drawingSnapshots).toBeUndefined();expect(JSON.stringify(project)).toBe(before);
});

test('external scene data cannot alias a Warp track ID with an appearance track ID',()=>{
 const rest=createWarpGrid({min:[-1,-1],max:[1,1]},1,1),scene={...emptyRecordingScene('scene'),instances:[{id:'instance',artworkId:'source',name:'Source'}],warps:[{id:'track',name:'Warp',restGrid:rest,keys:[]}],visibilityTracks:[{id:'track',target:{instanceId:'instance',sourceLayerId:'layer'},keys:[]}]};
 expect(()=>parseRecordingScenes({version:1,scenes:[scene]})).toThrow(/track IDs/);
});

test('external scene data cannot declare two keys that the exact-angle evaluator treats as the same key',()=>{
 const rest=createWarpGrid({min:[-1,-1],max:[1,1]},1,1),scene={...emptyRecordingScene('scene'),warps:[{id:'warp',name:'Warp',restGrid:rest,keys:[{id:'zero',angle:{x:0,y:0},value:rest},{id:'near-zero',angle:{x:.000001,y:0},value:translate(rest,.1)}]}]};
 expect(()=>parseRecordingScenes({version:1,scenes:[scene]})).toThrow(/key angle/);
});

test.each(['yaw-turning-example','three-piece-starting-example'])('%s migrated object tracks reproduce old saved-key and fractional/XY pose values',name=>{
 const project=parseLandmarks(readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8')),before=JSON.stringify(project),migrated=migrateLegacyRecordingScenes(project) as typeof project&{recordingScenes:RecordingScenes},scene=migrated.recordingScenes.scenes[0],rig=project.vectorRecording!.rigs[0],source=project.drawing!;
 const angles=[...rig.keys.map(k=>k.angle),...[7.5,22.5,37.5,45.1,47.9,49,52.5,67.5,82.5].map(x=>({x,y:0})),{x:22.5,y:30},{x:45,y:-45},{x:72.123,y:12.34}];
 for(const angle of angles){const old=evaluatePose(rig,angle,source);
  scene.warps.forEach((track,i)=>expect(evaluateWarpTrack(track,angle,false)).toEqual(old.grids[rig.deformers[i].id]??rig.deformers[i].grid));
  for(const track of scene.visibilityTracks)expect(evaluateVisibilityTrack(track,angle,false)).toBe(old.visibility[track.target.sourceObjectId!]??null);
  for(const track of scene.intervalTracks){const actual=evaluateIntervalTrack(track,source,angle,false),base=source.displayIntervals!.find(t=>t.id===track.sourceTrackId)!,expected=old.intervalOverrides?.find(t=>t.id===track.sourceTrackId)??base;
   expect(actual.appearance??base).toEqual(expected);expect((actual.appearance??base).ranges.map(intervalPinch)).toEqual(expected.ranges.map(intervalPinch));
   for(const range of [...base.ranges,...expected.ranges])expect(actual.enabled[range.id]).toBe(old.intervals[range.id]);
  }
 }
 expect(JSON.stringify(project)).toBe(before);
});

const denamespace=<T,>(value:T,prefix:string):T=>JSON.parse(JSON.stringify(value),(_key,item)=>typeof item==='string'&&item.startsWith(prefix)?item.slice(prefix.length):item);
const endpoint=(e:GeometryEndpoint)=>({curveId:e.curveId,end:e.end});
// Old assets carry historical endpoint hit-test p/distance fields. They are not
// authored GeometryEndpoint data and the compiler intentionally drops them.
const semanticGeometry=(d:DrawingDocument)=>({...d,joins:d.joins.map(j=>({...j,a:endpoint(j.a),b:endpoint(j.b)})),endpointLinks:d.endpointLinks?.map(l=>({...l,a:endpoint(l.a),b:endpoint(l.b)}))});
test.each(['yaw-turning-example','three-piece-starting-example'])('%s evaluates the migrated scene to the same actual cubic geometry, fill ownership and routed coverage',name=>{
 const project=parseLandmarks(readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8')),before=JSON.stringify(project),migrated=migrateLegacyRecordingScenes(project) as typeof project&{recordingScenes:RecordingScenes},scene=migrated.recordingScenes.scenes[0],instance=scene.instances[0],sources=recordingSceneSources(project),prefix=instanceObjectId(instance.id,'');
 const angles=[0,15,30,45,45.1,48,60,75,90].map(x=>({x,y:0}));
 for(const angle of angles){const old=evaluateRecording(project,{angle}),next=evaluateScene(scene,id=>sources[id],{angle,useDraft:false}),actual=semanticGeometry(denamespace(next.drawing,prefix)),expected=semanticGeometry(old.drawing);
  for(const key of ['nodes','curves','layers','fills','offsets','joins','endpointLinks','groups','displayIntervals'] as const)expect(actual[key]??[]).toEqual(expected[key]??[]);
  expect(next.diagnostics).toEqual([]);expect(next.intervalTransportErrors).toEqual(old.intervalTransportErrors);expect(next.maxError).toBe(old.maxError);
  expect(next.drawing.displayIntervals?.flatMap(t=>t.ranges.map(intervalPinch))).toEqual(old.drawing.displayIntervals?.flatMap(t=>t.ranges.map(intervalPinch)));
 }
 expect(JSON.stringify(project)).toBe(before);
},20000);

function occlusionSource(neck:boolean):DrawingDocument {
 const d=emptyDrawing();d.layers=['front','back'].map(id=>({id,name:id,visible:true,locked:false,items:[]}));
 const rectangle=(layerId:string,prefix:string,box:[number,number,number,number],color:'white'|'black')=>{
  const [x0,y0,x1,y1]=box,points:Point2[]=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],layer=d.layers.find(l=>l.id===layerId)!;
  points.forEach((position,i)=>d.nodes.push({id:`${prefix}-n${i}`,position}));
  points.forEach((a,i)=>{const b=points[(i+1)%4],id=`${prefix}-c${i}`;d.curves.push({id,name:id,nodes:[`${prefix}-n${i}`,`${prefix}-n${(i+1)%4}`],handles:[[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3]],visible:false,locked:false,width:.008});layer.items.push(id);});
  const id=`${prefix}-fill`;d.fills.push({id,name:id,visible:true,locked:false,color,boundary:points.map((_p,i)=>({id:`${prefix}-c${i}`,reverse:false}))});layer.items.push(id);
 };
 rectangle('front','front',neck?[-.2,-.6,.2,.6]:[-.4,-.2,.4,.1],'white');
 if(neck){d.nodes.push({id:'line-a',position:[0,-.8]},{id:'line-b',position:[0,.8]});d.curves.push({id:'neck-line',name:'Neck line',nodes:['line-a','line-b'],handles:[[0,-.8/3],[0,.8/3]],visible:true,locked:false,width:.016,depthScope:'LAYER',depthOffset:100});d.layers[1].items.push('neck-line');}
 else rectangle('back','shirt',[-.5,-.6,.5,-.1],'black');
 return d;
}

test('source depth offsets stay inside their instance while explicit scene layer order lets a white collar cover the neck',()=>{
 const neck=occlusionSource(true),collar=occlusionSource(false),before=JSON.stringify({neck,collar}),scene={...emptyRecordingScene('clothes'),instances:[{id:'neck',artworkId:'neck-source',name:'Neck'},{id:'collar',artworkId:'collar-source',name:'Collar'}],depthTracks:[{id:'collar-front-depth',target:{instanceId:'collar',sourceLayerId:'front'},keys:[{id:'front-order',angle:{x:0,y:0},value:3}]},{id:'shirt-back-depth',target:{instanceId:'collar',sourceLayerId:'back'},keys:[{id:'back-order',angle:{x:0,y:0},value:2.5}]}]},resolve=(id:string)=>id==='neck-source'?neck:collar;
 const result=evaluateScene(scene,resolve),lineId=instanceObjectId('neck','neck-line'),neckFill=instanceObjectId('neck','front-fill'),collarFill=instanceObjectId('collar','front-fill'),index=(id:string)=>result.paintBatches.findIndex(b=>(b.owner??b.item.id)===id);
 expect(result.drawing.layers.map(l=>l.id)).toEqual([instanceObjectId('collar','front'),instanceObjectId('neck','front'),instanceObjectId('collar','back'),instanceObjectId('neck','back')]);
 expect(index(collarFill)).toBeLessThan(index(lineId));expect(index(lineId)).toBeLessThan(index(neckFill));expect(result.drawing.fills).toHaveLength(3);expect(result.drawing.fills.every(f=>f.visible)).toBe(true);
 const noop=()=>{},svg=renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d:result.drawing,paintBatches:result.paintBatches,screen:p=>p,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));
 expect(svg.match(/data-testid="drawing-fill"/g)).toHaveLength(3);expect(svg.indexOf(`data-id="${lineId}"`)).toBeLessThan(svg.indexOf(`data-id="${collarFill}"`));
 const reordered={...scene,depthTracks:scene.depthTracks.map((t,i)=>i? t:{...t,keys:[{...t.keys[0],value:1.5}]})},next=evaluateScene(reordered,resolve),nextIndex=(id:string)=>next.paintBatches.findIndex(b=>(b.owner??b.item.id)===id);
 expect(nextIndex(lineId)).toBeLessThan(nextIndex(collarFill));expect(JSON.stringify({neck,collar})).toBe(before);
});

const render=(d:DrawingDocument,paintBatches?:PaintBatch[])=>{const noop=()=>{};return renderToStaticMarkup(createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width:800,height:800,viewBox:'0 0 800 800'},createElement(PaintScene,{d,paintBatches,screen:p=>[400+(p[0]+.1)*300,400-(p[1]+.05)*300],unit:300,pixelsPerUnit:300,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));};
test('the actual three-piece starter retains identical full PaintScene SVG at seven angles after migration',()=>{
 const project=parseLandmarks(readFileSync(new URL('../assets/three-piece-starting-example.json',import.meta.url),'utf8')),migrated=migrateLegacyRecordingScenes(project) as typeof project&{recordingScenes:RecordingScenes},scene=migrated.recordingScenes.scenes[0],sources=recordingSceneSources(project),prefix=instanceObjectId(scene.instances[0].id,''),escaped=prefix.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 for(const x of [0,15,30,45,60,75,90]){const angle={x,y:0},old=evaluateRecording(project,{angle}),next=evaluateScene(scene,id=>sources[id],{angle,useDraft:false});expect(render(next.drawing,next.paintBatches).replaceAll(escaped,'').replaceAll(prefix,'')).toBe(render(old.drawing));}
},20000);

test('a dependency-broken legacy half-face reports a partial instance without averaging its moved chin with excluded geometry',()=>{
 const source=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8'))),project={...createEmptyProject(),drawing:source},link=source.endpointLinks!.find(l=>l.throughDisplay&&l.joinBrush?.kind==='ARC')!,layer=source.layers.find(l=>l.items.includes(link.a.curveId))!,artworkId='$working',before=JSON.stringify(project),rest=createWarpGrid({min:[-2,-2],max:[2,2]},1,1);
 const scene:RecordingScene={...emptyRecordingScene('partial-face'),angle:{x:90,y:0},instances:[{id:'half',artworkId,name:'Legacy partial selection',layerIds:[layer.id]}],warps:[{id:'warp',name:'Move visible half',restGrid:rest,keys:[{id:'side',angle:{x:90,y:0},value:translate(rest,.1)}]}],bindings:[{instanceId:'half',sourceLayerId:layer.id,warpId:'warp'}]};
 const result=evaluateScene(scene,()=>source),old=shapeOf(source,link.a.curveId)[link.a.end?3:0],actual=shapeOf(result.drawing,instanceObjectId('half',link.a.curveId))[link.a.end?3:0];
 expect(result.diagnostics.some(d=>d.code==='PARTIAL_INSTANCE')).toBe(true);expect(actual[0]-old[0]).toBeCloseTo(.1,10);expect(actual[1]).toBeCloseTo(old[1],10);expect(result.drawing.curves.some(c=>c.id===instanceObjectId('half',link.b.curveId))).toBe(false);expect(result.drawing.curves.some(c=>c.visible)).toBe(true);
 const current={...project,recordingScenes:{version:1 as const,activeSceneId:scene.id,scenes:[scene]}};
 expect(()=>prepareSceneBatch(current,{commands:[{op:'setInstanceLayers',instanceId:'half',sourceLayerIds:[layer.id]}]})).toThrow(/dependent source layers/);
 expect(()=>prepareSceneBatch(current,{commands:[{op:'addInstance',artworkId,sourceLayerIds:[layer.id]}]})).toThrow(/dependent source layers/);
 expect(JSON.stringify(project)).toBe(before);
});

test('a shared parent is applied once across two actual-source instances and ten keys on another object do not alter a two-key mouth track',()=>{
 const source=example().drawing!,layer=source.layers.find(l=>l.name==='嘴部')!,mouth=source.curves.find(c=>layer.items.includes(c.id))!,rest=createWarpGrid({min:[-2,-2],max:[2,2]},1,1),before=JSON.stringify(source);
 const parent:SceneWarp={id:'parent',name:'Shared parent',restGrid:rest,keys:[{id:'p0',angle:{x:0,y:0},value:rest},{id:'p90',angle:{x:90,y:0},value:translate(rest,.2)}]},child:SceneWarp={id:'child',name:'Two-key mouth',parentId:'parent',restGrid:rest,keys:[{id:'c0',angle:{x:0,y:0},value:rest},{id:'c90',angle:{x:90,y:0},value:translate(rest,0,.1)}]},other:SceneWarp={id:'other',name:'Ten-key mouth',parentId:'parent',restGrid:rest,keys:Array.from({length:10},(_,i)=>({id:`o${i}`,angle:{x:i*10,y:0},value:translate(rest,0,i%2?.2:-.1)}))};
 const scene:RecordingScene={...emptyRecordingScene('two-mouths'),angle:{x:45,y:0},instances:[{id:'first',artworkId:'source',name:'First'},{id:'second',artworkId:'source',name:'Second'}],warps:[parent,child,other],bindings:[{instanceId:'first',sourceLayerId:layer.id,warpId:'child'},{instanceId:'second',sourceLayerId:layer.id,warpId:'other'}]};
 const result=evaluateScene(scene,()=>source),shape=shapeOf(result.drawing,instanceObjectId('first',mouth.id)),original=shapeOf(source,mouth.id);
 expect(result.chains[sceneLayerKey({instanceId:'first',sourceLayerId:layer.id})]).toEqual(['child','parent']);expect(result.chains[sceneLayerKey({instanceId:'second',sourceLayerId:layer.id})]).toEqual(['other','parent']);
 for(let i=0;i<4;i++){expect(shape[i][0]-original[i][0]).toBeCloseTo(.1,10);expect(shape[i][1]-original[i][1]).toBeCloseTo(.05,10);}
 const sparse={...scene,warps:[parent,child,{...other,keys:[]}]};expect(shapeOf(evaluateScene(sparse,()=>source).drawing,instanceObjectId('first',mouth.id))).toEqual(shape);expect(JSON.stringify(source)).toBe(before);
});

test('one Warp spans two different real sources with overlapping canonical IDs without merging their jaw geometry',()=>{
 const front=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8'))),side=parseDrawing(JSON.parse(readFileSync(new URL('../assets/right90-reference.json',import.meta.url),'utf8'))),before=JSON.stringify({front,side}),rest=createWarpGrid({min:[-2,-2],max:[2,2]},1,1),jaw='65450d8d-7c62-4d87-b421-616dfbcab097';
 const scene:RecordingScene={...emptyRecordingScene('cross-source'),instances:[{id:'front',artworkId:'front-source',name:'Front'},{id:'side',artworkId:'side-source',name:'Side'}],warps:[{id:'shared',name:'Cross-source Warp',restGrid:rest,keys:[{id:'key',angle:{x:0,y:0},value:translate(rest,.2)}]}],bindings:[...front.layers.map(l=>({instanceId:'front',sourceLayerId:l.id,warpId:'shared'})),...side.layers.map(l=>({instanceId:'side',sourceLayerId:l.id,warpId:'shared'}))]};
 const result=evaluateScene(scene,id=>id==='front-source'?front:side);expect(result.diagnostics).toEqual([]);expect(result.drawing.curves).toHaveLength(front.curves.length+side.curves.length);expect(new Set(result.drawing.curves.map(c=>c.id)).size).toBe(result.drawing.curves.length);
 for(const [instance,source] of [['front',front],['side',side]] as const){const actual=shapeOf(result.drawing,instanceObjectId(instance,jaw)),old=shapeOf(source,jaw);for(let i=0;i<4;i++){expect(actual[i][0]-old[i][0]).toBeCloseTo(.2,10);expect(actual[i][1]).toBeCloseTo(old[i][1],10);}}
 expect(shapeOf(result.drawing,instanceObjectId('front',jaw))).not.toEqual(shapeOf(result.drawing,instanceObjectId('side',jaw)));expect(JSON.stringify({front,side})).toBe(before);
},15000);

test.each(['translation','nonlinear'] as const)('linked half-faces share the parent input coordinate frame during child-local editing with a %s parent',kind=>{
 const source=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8'))),before=JSON.stringify(source),link=source.endpointLinks!.find(l=>l.throughDisplay&&l.joinBrush?.kind==='ARC')!,a=source.layers.find(l=>l.items.includes(link.a.curveId))!,b=source.layers.find(l=>l.items.includes(link.b.curveId))!,rest=createWarpGrid({min:[-2,-2],max:[2,2]},2,2),parent=kind==='translation'?translate(rest,.2):moveWarpNode(rest,4,[.3,.1]);
 const scene:RecordingScene={...emptyRecordingScene('local-linked-face'),instances:[{id:'face',artworkId:'source',name:'Face'}],warps:[{id:'parent',name:'Parent',restGrid:rest,keys:[{id:'parent-key',angle:{x:0,y:0},value:parent}]},{id:'child',name:'Child',parentId:'parent',restGrid:rest,keys:[]}],bindings:[{instanceId:'face',sourceLayerId:a.id,warpId:'child'},{instanceId:'face',sourceLayerId:b.id,warpId:'parent'}]};
 const original=shapeOf(source,link.a.curveId)[link.a.end?3:0],local=evaluateScene(scene,()=>source,{stopAtWarpId:'child'}),global=evaluateScene(scene,()=>source),at=(d:DrawingDocument,e:GeometryEndpoint)=>shapeOf(d,instanceObjectId('face',e.curveId))[e.end?3:0];
 expect(local.chains[sceneLayerKey({instanceId:'face',sourceLayerId:a.id})]).toEqual(['child']);expect(local.chains[sceneLayerKey({instanceId:'face',sourceLayerId:b.id})]).toEqual([]);
 for(const end of [link.a,link.b]){expect(at(local.drawing,end)[0]).toBeCloseTo(original[0],12);expect(at(local.drawing,end)[1]).toBeCloseTo(original[1],12);const mapped=mapPoint(parent,original);expect(at(global.drawing,end)[0]).toBeCloseTo(mapped[0],12);expect(at(global.drawing,end)[1]).toBeCloseTo(mapped[1],12);}
 expect(local.conflictingNodeIds).toEqual([]);expect(local.drawing.endpointLinks!.some(l=>l.id===instanceObjectId('face',link.id))).toBe(true);expect(local.diagnostics.some(d=>d.code==='LOCAL_SPACE')).toBe(true);expect(JSON.stringify(source)).toBe(before);
});

test('identity parent wrapping and child insertion preserve every sampled actual-face frame under an existing animated ancestor',()=>{
 const source=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8'))),link=source.endpointLinks!.find(l=>l.throughDisplay&&l.joinBrush?.kind==='ARC')!,layerIds=[...new Set([link.a,link.b].map(e=>source.layers.find(l=>l.items.includes(e.curveId))!.id))],rest=createWarpGrid({min:[-2,-2],max:[2,2]},2,2),base=createEmptyProject();
 const ancestor:SceneWarp={id:'ancestor',name:'Existing nonidentity ancestor',restGrid:rest,keys:[{id:'a0',angle:{x:0,y:0},value:translate(rest,.1)},{id:'a90',angle:{x:90,y:0},value:moveWarpNode(translate(rest,.1),4,[.3,.1])}]};
 const child=(id:string,axis:0|1):SceneWarp=>({id,name:id,parentId:'ancestor',restGrid:rest,keys:[{id:id+'0',angle:{x:0,y:0},value:translate(rest,axis===0?.03:0,axis===1?-.04:0)},{id:id+'90',angle:{x:90,y:0},value:translate(rest,axis===0?.11:0,axis===1?.05:0)}]});
 const scene:RecordingScene={...emptyRecordingScene('insertions'),instances:[{id:'first',artworkId:'$working',name:'First face',layerIds},{id:'second',artworkId:'$working',name:'Second face',layerIds}],warps:[ancestor,child('first-child',0),child('second-child',1),{id:'foreign',name:'Other parent',restGrid:rest,keys:[]},{id:'foreign-child',name:'Other child',parentId:'foreign',restGrid:rest,keys:[]}],bindings:['first','second'].flatMap(instanceId=>layerIds.map(sourceLayerId=>({instanceId,sourceLayerId,warpId:instanceId+'-child'})))};
 const project={...base,drawing:source,recordingScenes:{version:1 as const,activeSceneId:scene.id,scenes:[scene]}},before=JSON.stringify(project);
 expect(()=>prepareSceneBatch(project,{commands:[{op:'wrapParent',warpIds:['ancestor','first-child']}]})).toThrow(/same immediate parent/);expect(()=>prepareSceneBatch(project,{commands:[{op:'wrapParent',warpIds:['first-child','foreign-child']}]})).toThrow(/same immediate parent/);expect(JSON.stringify(project)).toBe(before);
 const wrapped=prepareSceneBatch(project,{commands:[{op:'wrapParent',warpIds:['first-child','second-child'],ref:'wrapper'}]}),wrappedScene=wrapped.recordingScenes.scenes[0],wrapperId=wrapped.created.find(c=>c.ref==='wrapper')!.id;expect(wrappedScene.warps.find(w=>w.id===wrapperId)!.parentId).toBe('ancestor');
 const inserted=prepareSceneBatch({...project,recordingScenes:wrapped.recordingScenes},{commands:[{op:'createChild',parentWarpId:'first-child',layerRefs:layerIds.map(sourceLayerId=>({instanceId:'first',sourceLayerId})),ref:'leaf'}]}),insertedScene=inserted.recordingScenes.scenes[0];
 for(const x of [0,15,30,45,60,75,90]){const options={angle:{x,y:0},useDraft:false},old=evaluateScene(scene,()=>source,options),parentAdded=evaluateScene(wrappedScene,()=>source,options),childAdded=evaluateScene(insertedScene,()=>source,options);expect(parentAdded.drawing).toEqual(old.drawing);expect(childAdded.drawing).toEqual(old.drawing);expect(childAdded.paintBatches).toEqual(old.paintBatches);}
 for(const warp of scene.warps){expect(wrappedScene.warps.find(w=>w.id===warp.id)!.keys).toEqual(warp.keys);expect(insertedScene.warps.find(w=>w.id===warp.id)!.keys).toEqual(warp.keys);}expect(JSON.stringify(project)).toBe(before);
},20000);
