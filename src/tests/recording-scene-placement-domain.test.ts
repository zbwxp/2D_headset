import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {addLayer,createCurve,connect,linkEndpoints} from '../domain/drawing/commands';
import {createOffset} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {roundedJoins} from '../domain/drawing/roundedJoin';
import {createWarpGrid,moveWarpNode,type WarpGrid} from '../domain/vectorWarp/model';
import {emptyRecordingScene,identityScenePlacement,instanceObjectId,type RecordingScene,type ScenePlacementTrack,type ScenePlacementValue,type SceneKey} from '../domain/recordingScene/model';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {applyScenePlacement,composePlacementSimilarity,evaluatePlacementTrack,inverseScenePlacement,placementMatrix} from '../domain/recordingScene/tracks';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import PaintScene from '../ui/drawing/PaintScene';

const zero={x:0,y:0},line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]];
const near=(a:Point2,b:Point2,digits=8)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],digits));
const key=<T>(id:string,x:number,value:T,y=0):SceneKey<T>=>({id,angle:{x,y},value});
const placement=(change:Partial<ScenePlacementValue>={}):ScenePlacementValue=>({...identityScenePlacement(),...change});
const placementTrack=(value:ScenePlacementValue):ScenePlacementTrack=>({id:'placement',instanceId:'one',keys:[key('placement-key',0,value)]});
function drawing(shape=line){const d=addLayer(emptyDrawing(),'Ink');return createCurve(d,d.layers[0].id,shape,.02,'Curve','curve');}
function scene(value?:ScenePlacementValue):RecordingScene {return {...emptyRecordingScene('scene'),instances:[{id:'one',artworkId:'art',name:'One'}],...(value?{placementTracks:[placementTrack(value)]}:{})};}
const affine=(g:WarpGrid,x:number,y:number):WarpGrid=>({...g,nodes:g.nodes.map(n=>({...n,position:[n.position[0]+x,n.position[1]+y],handleU:[n.handleU[0]+x,n.handleU[1]+y],handleV:[n.handleV[0]+x,n.handleV[1]+y]}))});

test('placement interpolation retains full rotations, independent XY coordinates and angle-local drafts',()=>{
 const t:ScenePlacementTrack={id:'p',instanceId:'one',keys:[key('front',0,placement()),key('right',90,placement({translation:[4,2],rotation:360,scale:3}))]};
 expect(evaluatePlacementTrack(t,{x:45,y:0})).toEqual(placement({translation:[2,1],rotation:180,scale:2}));
 near(applyScenePlacement(evaluatePlacementTrack(t,{x:45,y:0}),[1,0]),[0,1]);
 t.keys.push(key('up',0,placement({translation:[0,3],rotation:90,scale:.1}),90));
 const xy=evaluatePlacementTrack(t,{x:90,y:90});expect(xy.translation).toEqual([4,5]);expect(xy.rotation).toBe(450);expect(xy.scale).toBeCloseTo(.3);
 t.draft={angle:{x:30,y:0},value:placement({translation:[9,8]})};const before=JSON.stringify(t);
 expect(evaluatePlacementTrack(t,{x:30,y:0}).translation).toEqual([9,8]);expect(evaluatePlacementTrack(t,{x:30,y:0},false).translation[0]).toBeCloseTo(4/3);
 expect(evaluatePlacementTrack(t,{x:15,y:0}).translation[0]).toBeCloseTo(2/3);expect(JSON.stringify(t)).toBe(before);
 const shrinking:ScenePlacementTrack={...t,keys:[key('x',90,placement({scale:.1})),key('y',0,placement({scale:.1}),90)]};
 expect(evaluatePlacementTrack(shrinking,{x:90,y:90}).scale).toBeCloseTo(.01);
});

test('world gestures compose after existing placement and inverse returns the original point',()=>{
 const base=placement({translation:[2,-3],rotation:400,scale:1.5}),delta=placement({translation:[-.4,.7],rotation:35,scale:.6}),p:Point2=[.9,-.2],next=composePlacementSimilarity(base,delta);
 near(applyScenePlacement(next,p),applyScenePlacement(delta,applyScenePlacement(base,p)));expect(next.rotation).toBe(435);
 near(applyScenePlacement(inverseScenePlacement(next),applyScenePlacement(next,p)),p);
 const [a,b,c,d,e,f]=placementMatrix(next);near([a*p[0]+c*p[1]+e,b*p[0]+d*p[1]+f],applyScenePlacement(next,p));
});

test('per-instance placement follows shared Warp once, preserves latest sources, and remains visible during local editing',()=>{
 const source=drawing(),g=createWarpGrid({min:[-1,-1],max:[2,2]},2,2),value=placement({translation:[5,-2],rotation:90,scale:2});
 const s:RecordingScene={...scene(value),instances:[...scene().instances,{id:'two',artworkId:'art',name:'Two'}],warps:[{id:'warp',name:'Warp',restGrid:g,keys:[key('w',0,affine(g,.2,.3))]}],bindings:['one','two'].map(instanceId=>({instanceId,sourceLayerId:source.layers[0].id,warpId:'warp'}))};
 const before=JSON.stringify([source,s]),result=evaluateScene(s,()=>source,{diagnostics:'preview'}),one=instanceObjectId('one','curve'),two=instanceObjectId('two','curve');
 shapeOf(result.drawing,two).forEach((p,i)=>{near(p,[line[i][0]+.2,line[i][1]+.3]);near(shapeOf(result.drawing,one)[i],applyScenePlacement(value,p));});
 expect(evaluateScene(s,()=>source,{stopAtWarpId:'warp',diagnostics:'preview'}).drawing).toEqual(result.drawing);
 const omitted=evaluateScene(s,()=>source,{omitPlacements:true,diagnostics:'preview'});expect(shapeOf(omitted.drawing,one)).toEqual(shapeOf(omitted.drawing,two));expect(omitted.placements.one).toEqual(value);
 expect(result.placements.two).toEqual(identityScenePlacement());expect(shapeOf(result.source,one)).toEqual(line);expect(JSON.stringify([source,s])).toBe(before);
 const latest={...source,curves:source.curves.map(c=>({...c,handles:[[.1,.5],[.9,.5]] as [Point2,Point2]}))};
 const updated=evaluateScene(s,()=>latest,{diagnostics:'preview'});expect(shapeOf(updated.drawing,one)).not.toEqual(shapeOf(result.drawing,one));
 expect(evaluateScene(scene(),()=>source)).toEqual(evaluateScene({...scene(),placementTracks:[]},()=>source));
});

test('placement preserves material cuts and ARC shape while keeping Drawing ink and offset distances fixed',()=>{
 let source=drawing();source=createCurve(source,source.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');source=connect(source,{curveId:'curve',end:1},{curveId:'b',end:0},'ARC',.2);source=createOffset(source,'curve');
 source={...source,curves:source.curves.map(c=>({...c,locked:true,inkEnds:[{taper:.04,extension:.02},{taperWidthScale:12}],mist:{enabled:true,width:.005,density:.5}})),offsets:source.offsets.map(o=>({...o,translation:[.2,-.1]})),displayIntervals:[{id:'cuts',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.4,end:.6,inkEnds:[{taper:.03},{extension:.02}]}]}]};
 const value=placement({translation:[2,-1],rotation:27,scale:3}),s=scene(value),before=JSON.stringify([source,s]),placed=evaluateScene(s,()=>source),plain=evaluateScene(s,()=>source,{omitPlacements:true});
 const originalArc=[...roundedJoins(plain.drawing).values()][0],placedArc=[...roundedJoins(placed.drawing).values()][0];
 expect(placedArc.distance).toBeCloseTo(originalArc.distance*3);placedArc.shapes.forEach((c,i)=>c.forEach((p,j)=>near(p,applyScenePlacement(value,originalArc.shapes[i][j]))));
 const id=instanceObjectId('one','curve'),a=displayField(plain.drawing,displayPath(plain.drawing,id)),b=displayField(placed.drawing,displayPath(placed.drawing,id)),ta=plain.drawing.displayIntervals![0],tb=placed.drawing.displayIntervals![0];
 expect(tb.ranges).toEqual(ta.ranges);for(const cut of [.4,.5,.6])near(b.at(b.native(tb,cut)).p,applyScenePlacement(value,a.at(a.native(ta,cut)).p),4);
 expect(placed.drawing.curves.map(c=>[c.width,c.mist,c.inkEnds])).toEqual(plain.drawing.curves.map(c=>[c.width,c.mist,c.inkEnds]));
 expect(placed.drawing.offsets[0].distance).toBe(source.offsets[0].distance);expect(placed.drawing.offsets[0].width).toBe(source.offsets[0].width);near(placed.drawing.offsets[0].translation!,applyScenePlacement({...value,translation:[0,0]},source.offsets[0].translation!));
 expect(JSON.stringify([source,s])).toBe(before);
});

test('scaled routed ARC renders above the authoring trim limit while raw source and overrides still reject it',()=>{
 let source=drawing();source=addLayer(source,'B');source=createCurve(source,source.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');source=linkEndpoints(source,{curveId:'curve',end:1},{curveId:'b',end:0});
 source={...source,endpointLinks:source.endpointLinks!.map(l=>({...l,throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.8}})),displayIntervals:[{id:'route',anchor:{id:'curve',reverse:false},displayRoute:{seed:{segments:[{id:'curve',reverse:false}],closed:false},throughLinkIds:[source.endpointLinks![0].id]},ranges:[{id:'range',start:.1,end:.9}]}]};
 const value=placement({translation:[2,-1],rotation:35,scale:3}),s=scene(value),plain=evaluateScene(s,()=>source,{omitPlacements:true}),placed=evaluateScene(s,()=>source),track=placed.drawing.displayIntervals![0];
 const a=createDisplayRouteField(plain.drawing,plain.drawing.displayIntervals![0].displayRoute!),b=createDisplayRouteField(placed.drawing,track.displayRoute!);
 expect(placed.diagnostics).toEqual([]);expect(b.diagnostics).toEqual([]);expect(b.brushes.links[0].geometry!.distance).toBeCloseTo(2.4);expect(b.geometry.shapes).toHaveLength(a.geometry.shapes.length);
 b.geometry.shapes.forEach((c,i)=>c.forEach((p,j)=>near(p,applyScenePlacement(value,a.geometry.shapes[i][j]))));
 const noop=()=>{},svg=renderToStaticMarkup(createElement(PaintScene,{d:placed.drawing,paintBatches:placed.paintBatches,screen:p=>p,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop}));
 expect(svg).toContain('drawing-route-ink');expect(svg).not.toContain('drawing-route-error');expect(svg).not.toMatch(/NaN|Infinity/);
 const raw={...source,endpointLinks:source.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC' as const,trimDistance:2.4}}))};expect(()=>parseDrawing(raw)).toThrow();
 const linkId=placed.drawing.endpointLinks![0].id;expect(createDisplayRouteField(placed.drawing,track.displayRoute!,{[linkId]:{kind:'ARC',trimDistance:2.4}}).diagnostics.length).toBeGreaterThan(0);
});

test('placement maps diagnostic geometry and scales error before checking the world tolerance',()=>{
 const curve:Cubic=[[-.85,-.3],[-.35,.8],[.7,-.8],[.9,.4]],source=drawing(curve),rest=createWarpGrid({min:[-1,-1],max:[1,1]},4,4),grid=moveWarpNode(rest,12,[.65,.75]),value=placement({translation:[2,-1],rotation:67,scale:3});
 const s:RecordingScene={...scene(value),warps:[{id:'warp',name:'Warp',restGrid:rest,keys:[key('w',0,grid)]}],bindings:[{instanceId:'one',sourceLayerId:source.layers[0].id,warpId:'warp'}]};
 const initial=evaluateScene(s,()=>source,{omitPlacements:true,diagnostics:'preview'}),tolerance=initial.maxError*1.5;
 const plain=evaluateScene(s,()=>source,{omitPlacements:true,tolerance,diagnostics:'preview'}),placed=evaluateScene(s,()=>source,{tolerance,diagnostics:'preview'}),a=plain.fitDiagnostics[0],b=placed.fitDiagnostics[0];
 expect(a.warning).toBe(false);expect(b.warning).toBe(true);expect(b.maxError).toBeCloseTo(a.maxError*3);expect(placed.maxError).toBeCloseTo(plain.maxError*3);expect(b.endpointMismatchError).toBeCloseTo(a.endpointMismatchError*3);
 near(b.peakExpected,applyScenePlacement(value,a.peakExpected));near(b.peakActual,applyScenePlacement(value,a.peakActual));b.cubic.forEach((p,i)=>near(p,applyScenePlacement(value,a.cubic[i])));
 expect(placed.warningCurveIds).toEqual([instanceObjectId('one','curve')]);
});

test('strict persistence preserves optional placement keys and drafts and rejects singular or unknown data',()=>{
 const s=scene(placement({translation:[2,3],rotation:720,scale:2}));s.placementTracks![0].draft={angle:{x:30,y:-20},value:placement({scale:.5})};
 const data={version:1 as const,activeSceneId:s.id,scenes:[s]},parsed=parseRecordingScenes(JSON.parse(JSON.stringify(data)));expect(parsed).toEqual(data);expect(parsed).not.toBe(data);
 for(const scale of [0,-1,NaN,Infinity,1e-7,1e7]){const invalid=structuredClone(data);invalid.scenes[0].placementTracks![0].keys[0].value.scale=scale;expect(()=>parseRecordingScenes(invalid)).toThrow();}
 const duplicate=structuredClone(data);duplicate.scenes[0].placementTracks!.push({...placementTrack(placement()),id:'other'});expect(()=>parseRecordingScenes(duplicate)).toThrow(/duplicate placement/);
 const unknown=structuredClone(data) as typeof data & any;unknown.scenes[0].placementTracks[0].keys[0].value.shear=0;expect(()=>parseRecordingScenes(unknown)).toThrow(/unknown field/);
 expect(parseRecordingScenes({version:1,scenes:[scene()]}).scenes[0].placementTracks).toBeUndefined();
});
