import {expect,test} from 'vitest';
import {addLayer,createCurve,connect,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,nodeAt,sub,length,type Cubic,type Point2} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {transportDeformedIntervals} from '../domain/drawing/deform';
import {createWarpGrid,moveWarpNode} from '../domain/vectorWarp/model';
import {emptyRecordingScene,instanceObjectId,identitySceneShape,type RecordingScene,type SceneShapeTrack,type SceneShapeValue} from '../domain/recordingScene/model';
import {evaluateShapeTrack,applyScenePlacement} from '../domain/recordingScene/tracks';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {deriveSceneShapeEdit} from '../domain/recordingScene/shapes';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
const line:Cubic=[[0,0],[.3,0],[.7,0],[1,0]],angle={x:0,y:0};
const near=(a:Point2,b:Point2)=>a.forEach((x,i)=>expect(x).toBeCloseTo(b[i],8));
function drawing(){const d=addLayer(emptyDrawing(),'Ink');return createCurve(d,d.layers[0].id,line,.02,'A','a');}
function scene():RecordingScene{return {...emptyRecordingScene('scene'),instances:[{id:'one',artworkId:'art',name:'One'}]};}
const track=(value:SceneShapeValue,x=0):SceneShapeTrack=>({id:'shape',instanceId:'one',keys:[{id:'key',angle:{x,y:0},value}]});
const set=(s:RecordingScene,value:SceneShapeValue,x=0):RecordingScene=>({...s,shapeTracks:[track(value,x)]});

test('sparse shape channels interpolate independently with zero missing entries, XY corners and local drafts',()=>{
 const t:SceneShapeTrack={...track({nodes:{node:[2,0]},handles:{}},90),keys:[...track({nodes:{node:[2,0]},handles:{}},90).keys,{id:'y',angle:{x:0,y:90},value:{nodes:{other:[0,4]},handles:{a:[[0,2],[0,0]]}}}]};
 expect(evaluateShapeTrack(t,{x:45,y:45})).toEqual({nodes:{node:[1,0],other:[0,2]},handles:{a:[[0,1],[0,0]]}});
 t.draft={angle:{x:30,y:0},value:{nodes:{node:[9,0]},handles:{}}};expect(evaluateShapeTrack(t,{x:30,y:0})).toEqual(t.draft.value);expect(evaluateShapeTrack(t,{x:30,y:0},false).nodes.node[0]).toBeCloseTo(2/3);
 const proto=JSON.parse('{"nodes":{"__proto__":[1,2]},"handles":{"constructor":[[3,4],[0,0]]}}');const result=evaluateShapeTrack(track(proto,90),{x:45,y:0});expect(Object.hasOwn(result.nodes,'__proto__')).toBe(true);expect(result.nodes['__proto__']).toEqual([.5,1]);expect(result.handles.constructor).toEqual([[1.5,2],[0,0]]);
});

test('node edits carry handles, leave source and other instances intact, and follow live source changes',()=>{
 const source=drawing(),s=scene();s.instances.push({id:'two',artworkId:'art',name:'Two'});const saved=JSON.stringify([source,s]),node=source.curves[0].nodes[0];
 const value=deriveSceneShapeEdit(s,()=>source,{instanceId:'one',kind:'node',nodeId:node,position:[.2,.4]});expect(value.nodes[node]).toEqual([.2,.4]);expect(value.handles).toEqual({});
 const shaped=set(s,value,90),at=evaluateScene(shaped,()=>source,{angle:{x:45,y:0}});near(shapeOf(at.drawing,instanceObjectId('one','a'))[0],[.1,.2]);near(shapeOf(at.drawing,instanceObjectId('one','a'))[1],[.4,.2]);expect(shapeOf(at.drawing,instanceObjectId('two','a'))).toEqual(line);expect(JSON.stringify([source,s])).toBe(saved);
 const latest={...source,nodes:source.nodes.map(n=>n.id===node?{...n,position:[1,2] as Point2}:n),curves:source.curves.map(c=>({...c,handles:[[1.3,2],c.handles[1]] as [Point2,Point2]}))};near(shapeOf(evaluateScene(shaped,()=>latest,{angle:{x:45,y:0}}).drawing,instanceObjectId('one','a'))[0],[1.1,2.2]);
 expect(evaluateScene(scene(),()=>source)).toEqual(evaluateScene({...scene(),shapeTracks:[]},()=>source));
});

test('shape follows Warp and precedes placement while fit errors measure only Warp approximation',()=>{
 const source=drawing(),g=createWarpGrid({min:[-1,-1],max:[2,2]},3,3),warped=moveWarpNode(g,4,[.6,.8]),s=scene();s.warps=[{id:'w',name:'W',restGrid:g,keys:[{id:'wkey',angle,value:warped}]}];s.bindings=[{instanceId:'one',sourceLayerId:source.layers[0].id,warpId:'w'}];const placement={translation:[2,3] as Point2,rotation:30,scale:2};s.placementTracks=[{id:'p',instanceId:'one',keys:[{id:'pkey',angle,value:placement}]}];
 const baseline=evaluateScene(s,()=>source),node=source.curves[0].nodes[0],target:Point2=[.5,.7],value=deriveSceneShapeEdit(s,()=>source,{instanceId:'one',kind:'node',nodeId:node,position:target}),result=evaluateScene(set(s,value),()=>source);
 near(shapeOf(result.prePlacementDrawing,instanceObjectId('one','a'))[0],target);near(shapeOf(result.drawing,instanceObjectId('one','a'))[0],applyScenePlacement(placement,target));expect(result.preShapeDrawing).toEqual(baseline.preShapeDrawing);expect(result.maxError).toBe(baseline.maxError);expect(result.fitDiagnostics[0].cubic).toEqual(shapeOf(result.drawing,instanceObjectId('one','a')));expect(evaluateScene(set(s,value),()=>source,{omitShapes:true}).drawing).toEqual(baseline.drawing);
});

test('shared and cross-layer linked nodes move together, hidden geometry follows and authoring locks are respected',()=>{
 let source=drawing();source=createCurve(source,source.layers[0].id,[[1,0],[1.3,0],[1.7,0],[2,0]],.02,'B','b');source=connect(source,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');source=addLayer(source,'Other');source=createCurve(source,source.layers[0].id,[[1,0],[1,.3],[1,.7],[1,1]],.02,'C','c');source=linkEndpoints(source,{curveId:'a',end:1},{curveId:'c',end:0});source={...source,curves:source.curves.map(c=>({...c,visible:false}))};
 const node=nodeAt(source,{curveId:'a',end:1}).id,linked=nodeAt(source,{curveId:'c',end:0}).id,value=deriveSceneShapeEdit(scene(),()=>source,{instanceId:'one',kind:'node',nodeId:node,position:[1.2,.5]});near(value.nodes[node],[.2,.5]);expect(value.nodes[node]).toEqual(value.nodes[linked]);expect(value.handles).toEqual({});
 const evaluated=evaluateScene(set(scene(),value),()=>source);for(const [curveId,end] of [['a',1],['b',0],['c',0]] as const)near(nodeAt(evaluated.drawing,{curveId:instanceObjectId('one',curveId),end}).position,[1.2,.5]);
 const locked={...source,curves:source.curves.map(c=>c.id==='c'?{...c,locked:true}:c)};expect(()=>deriveSceneShapeEdit(scene(),()=>locked,{instanceId:'one',kind:'node',nodeId:node,position:[1.2,.5]})).toThrow(/锁定/);expect(evaluateScene(set(scene(),value),()=>locked).drawing.nodes).toEqual(evaluated.drawing.nodes);
 const conflict=set(scene(),{nodes:{[node]:[.2,.5]},handles:{}}),bad=evaluateScene(conflict,()=>source);expect(bad.diagnostics.some(d=>d.code==='SHAPE'&&d.message.includes('conflict'))).toBe(true);near(nodeAt(bad.drawing,{curveId:instanceObjectId('one','a'),end:1}).position,[1,0]);
});

test('cross-layer SMOOTH follows either edited handle and remains G1 at intermediate angles',()=>{
 let source=drawing();source=addLayer(source,'B');source=createCurve(source,source.layers[0].id,[[1,0],[1.6,0],[1.8,0],[2,0]],.02,'B','b');source=linkEndpoints(source,{curveId:'a',end:1},{curveId:'b',end:0});source={...source,endpointLinks:source.endpointLinks!.map(l=>({...l,joinBrush:{kind:'SMOOTH' as const}}))};
 const value=deriveSceneShapeEdit(scene(),()=>source,{instanceId:'one',kind:'handle',curveId:'b',end:0,position:[1,1.2]});expect(Object.keys(value.handles).sort()).toEqual(['a','b']);const s=set(scene(),value,90),full=evaluateScene(s,()=>source,{angle:{x:90,y:0}});near(shapeOf(full.drawing,instanceObjectId('one','b'))[1],[1,1.2]);
 const mid=evaluateScene(s,()=>source,{angle:{x:45,y:0}}),a=shapeOf(mid.drawing,instanceObjectId('one','a')),b=shapeOf(mid.drawing,instanceObjectId('one','b')),va=sub(a[2],a[3]),vb=sub(b[1],b[0]);expect(va[0]*vb[1]-va[1]*vb[0]).toBeCloseTo(0,10);expect(va[0]*vb[0]+va[1]*vb[1]).toBeLessThan(0);expect(length(vb)).toBeCloseTo(Math.hypot(.3,.6));
});

test('shape transports mixed SHOW/HIDE material cuts across ARC geometry without changing ink metadata',()=>{
 let source=drawing();source=createCurve(source,source.layers[0].id,[[1,0],[1,.3],[1,.7],[1,1]],.02,'B','b');source=connect(source,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);source={...source,displayIntervals:[{id:'cut',anchor:{id:'a',reverse:false},ranges:[{id:'show',start:.1,end:.95,mode:'SHOW'},{id:'hide',start:.42,end:.6,mode:'HIDE',enabled:false}]}]};
 const value=deriveSceneShapeEdit(scene(),()=>source,{instanceId:'one',kind:'handle',curveId:'a',end:0,position:[.25,.8]}),result=evaluateScene(set(scene(),value),()=>source),expected=transportDeformedIntervals(result.preShapeDrawing,{...result.prePlacementDrawing,displayIntervals:undefined});
 expect(result.drawing.displayIntervals).toEqual(expected.displayIntervals);expect(result.drawing.displayIntervals![0].ranges.map(r=>[r.id,r.mode,r.enabled])).toEqual(result.preShapeDrawing.displayIntervals![0].ranges.map(r=>[r.id,r.mode,r.enabled]));expect(result.intervalTransportErrors).toEqual([]);const path=displayPath(result.drawing,instanceObjectId('one','a'));expect(displayField(result.drawing,path).total).toBeGreaterThan(0);expect(result.drawing.joins).toEqual(result.preShapeDrawing.joins);
});

test('orphans survive edits and strict persistence while malformed offsets and duplicate instance tracks are rejected',()=>{
 const source=drawing(),s=set(scene(),{nodes:{missing:[1,2]},handles:{lost:[[3,4],[5,6]]}});s.shapeTracks![0].draft={angle:{x:30,y:0},value:identitySceneShape()};const data={version:1 as const,scenes:[s]};expect(parseRecordingScenes(JSON.parse(JSON.stringify(data)))).toEqual(data);expect(evaluateScene(s,()=>source).diagnostics.filter(d=>d.code==='SHAPE')).toHaveLength(2);
 const value=deriveSceneShapeEdit(s,()=>source,{instanceId:'one',kind:'node',nodeId:source.curves[0].nodes[0],position:[.2,.3]});expect(value.nodes.missing).toEqual([1,2]);expect(value.handles.lost).toEqual([[3,4],[5,6]]);
 const invalid=structuredClone(data);invalid.scenes[0].shapeTracks![0].keys[0].value.nodes.missing=[NaN,2];expect(()=>parseRecordingScenes(invalid)).toThrow(/shape offsets/);const duplicate=structuredClone(data);duplicate.scenes[0].shapeTracks!.push({...track(identitySceneShape()),id:'other'});expect(()=>parseRecordingScenes(duplicate)).toThrow(/duplicate shape/);const unknown=structuredClone(data) as any;unknown.scenes[0].shapeTracks[0].keys[0].value.absolute={};expect(()=>parseRecordingScenes(unknown)).toThrow(/unknown field/);
});
