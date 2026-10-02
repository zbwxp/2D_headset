import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {addLayer,connect,createCurve,linkEndpoints,ellipse} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {emptyDrawing,shapeOf,type Cubic,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {derivedUses,roundedJoins} from '../domain/drawing/roundedJoin';
import {strokeInk,fillGeometry,offsetGeometry} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {displayRouteInk} from '../domain/drawing/displayRouteInk';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {emptyRecordingScene,identityScenePlacement,instanceObjectId,type ScenePlacementValue,type RecordingScene} from '../domain/recordingScene/model';
import {applyScenePlacement} from '../domain/recordingScene/tracks';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {createWarpGrid,moveWarpNode} from '../domain/vectorWarp/model';
import PaintScene from '../ui/drawing/PaintScene';

const near=(a:Point2,b:Point2,digits=7)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],digits));
const placement=(change:Partial<ScenePlacementValue>):ScenePlacementValue=>({...identityScenePlacement(),...change});
const scene=(value:ScenePlacementValue):RecordingScene=>({...emptyRecordingScene('scene'),instances:[{id:'one',artworkId:'art',name:'One'}],placementTracks:[{id:'placement',instanceId:'one',keys:[{id:'key',angle:{x:0,y:0},value}]}]});
function line(shape:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]]){const d=addLayer(emptyDrawing(),'A');return createCurve(d,d.layers[0].id,shape,.02,'A','a');}
function corner(routed=false){
 let d=line();if(routed)d=addLayer(d,'B');d=createCurve(d,d.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.02,'B','b');
 if(!routed)return connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.3);
 d=linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});
 return {...d,endpointLinks:d.endpointLinks!.map(link=>({...link,throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.3}})),displayIntervals:[{id:'route',anchor:{id:'a',reverse:false},displayRoute:{seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:[d.endpointLinks![0].id]},ranges:[{id:'cut',start:.2,end:.85}]}]};
}
const render=(d:DrawingDocument,paintBatches?:ReturnType<typeof evaluateScene>['paintBatches'])=>renderToStaticMarkup(createElement(PaintScene,{d,paintBatches,screen:(p:Point2)=>p,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}}));

test('nonuniform placement applies to original ARC cubics and material cuts without source mutation',()=>{
 const source={...corner(),displayIntervals:[{id:'interval',anchor:{id:'a',reverse:false},ranges:[{id:'cut',start:.39,end:.73}]}]},value=placement({translation:[2,-1],rotation:27,scaleX:3,scaleY:.4}),s=scene(value),snapshot=JSON.stringify([source,s]);
 const plain=evaluateScene(s,()=>source,{omitPlacements:true}),placed=evaluateScene(s,()=>source),id=instanceObjectId('one','a'),path=strokeFor(plain.drawing,id),before=derivedUses(plain.drawing,path.segments),after=derivedUses(placed.drawing,path.segments);
 expect(before.pieces.some(piece=>piece.joinId)).toBe(true);expect(after.shapes).toHaveLength(before.shapes.length);
 after.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(value,before.shapes[i][j]))));
 const a=strokeInk(plain.drawing,path),b=strokeInk(placed.drawing,path);expect(b).toHaveLength(a.length);expect(b[0].shapes).toHaveLength(a[0].shapes.length);
 b[0].shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(value,a[0].shapes[i][j]))));
 const originalField=displayField(plain.drawing,displayPath(plain.drawing,id)),placedField=displayField(placed.drawing,displayPath(placed.drawing,id));
 for(const s of [.39,.5,.73])near(placedField.at(s).p,applyScenePlacement(value,originalField.at(s).p));
 expect([...roundedJoins(placed.drawing).values()].every(g=>!g.error)).toBe(true);expect(placed.diagnostics).toEqual([]);expect(JSON.stringify([source,s])).toBe(snapshot);
});

test('routed ARC centerlines, owner fragments and SVG all preserve affine material placement',()=>{
 const source=corner(true),value=placement({translation:[.3,-.2],rotation:-23,scaleX:2.5,scaleY:.35}),s=scene(value),plain=evaluateScene(s,()=>source,{omitPlacements:true}),placed=evaluateScene(s,()=>source),route=plain.drawing.displayIntervals![0].displayRoute!,positions=new Map(placed.paintBatches.filter(b=>b.owner).map(b=>[b.owner!,b.position]));
 const before=displayRouteInk(plain.drawing,route,positions),after=displayRouteInk(placed.drawing,route,positions);expect(after.diagnostics).toEqual([]);
 for(const [id,runs] of before.runs){const actual=after.runs.get(id)!;expect(actual).toHaveLength(runs.length);actual.forEach((run,i)=>run.shapes.forEach((shape,j)=>shape.forEach((point,k)=>near(point,applyScenePlacement(value,runs[i].shapes[j][k])))));}
 const a=createDisplayRouteField(plain.drawing,route),b=createDisplayRouteField(placed.drawing,route);expect(b.diagnostics).toEqual([]);b.geometry.shapes.forEach((shape,i)=>shape.forEach((point,j)=>near(point,applyScenePlacement(value,a.geometry.shapes[i][j]))));
 expect(placed.paintBatches).toEqual(plain.paintBatches);const svg=render(placed.drawing,placed.paintBatches);expect(svg).toContain('drawing-route-ink');expect(svg).not.toMatch(/drawing-route-error|NaN|Infinity/);expect(svg).toContain('stroke-width="5"');
});

test('nonuniform ink keeps world-unit width, taper, extensions and offset distance',()=>{
 let source=line();source=createOffset(source,'a');source={...source,curves:source.curves.map(c=>({...c,inkEnds:[{extension:.1,taper:.15},{extension:.1,taper:.15}]})),offsets:source.offsets.map(o=>({...o,distance:.2,taper:0,start:0,end:1}))};
 const placed=evaluateScene(scene(placement({scaleX:3,scaleY:2})),()=>source),runs=strokeInk(placed.drawing,strokeFor(placed.drawing,instanceObjectId('one','a'))),points=runs.flatMap(r=>r.outline);
 expect(Math.min(...points.map(p=>p[0]))).toBeCloseTo(-.1,8);expect(Math.max(...points.map(p=>p[0]))).toBeCloseTo(3.1,8);expect(Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))).toBeCloseTo(.02,8);
 const offset=offsetGeometry(placed.drawing,placed.drawing.offsets[0]);expect(offset.error).toBeUndefined();offset.shapes.flat().forEach(p=>expect(Math.abs(p[1])).toBeCloseTo(.2,6));
});

test('actual zero width collapses curved geometry and ARC routes safely, including reopened recovery',()=>{
 const curved=line([[.2,0],[1.6,.25],[-.6,.8],[.8,1]]),value=placement({translation:[.7,-.2],scaleX:0,scaleY:2}),collapsed=evaluateScene(scene(value),()=>curved),id=instanceObjectId('one','a');
 shapeOf(collapsed.drawing,id).forEach(p=>expect(p[0]).toBe(.7));const runs=strokeInk(collapsed.drawing,strokeFor(collapsed.drawing,id));expect(runs.length).toBeGreaterThan(0);runs.flatMap(r=>r.shapes.flat()).forEach(p=>expect(p[0]).toBe(.7));expect(render(collapsed.drawing,collapsed.paintBatches)).not.toMatch(/NaN|Infinity/);
 const source=corner(true);for(const scaleX of [0,2]){const s=scene(placement({scaleX,scaleY:1})),placed=evaluateScene(s,()=>source);expect(placed.diagnostics).toEqual([]);const svg=render(placed.drawing,placed.paintBatches);expect(svg).toContain('drawing-route-ink');expect(svg).not.toMatch(/drawing-route-error|NaN|Infinity/);}
 const point=evaluateScene(scene(placement({scaleX:0,scaleY:0})),()=>source);expect(point.diagnostics).toEqual([]);expect(render(point.drawing,point.paintBatches)).not.toMatch(/NaN|Infinity/);
});

test('affine fill geometry and visibility-only renderer clones retain the evaluated placement',()=>{
 const d=addLayer(emptyDrawing(),'Ellipse'),e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.02),source=createFill(e.document,e.ids,'white'),value=placement({rotation:13,scaleX:.25,scaleY:2}),plain=evaluateScene(scene(value),()=>source,{omitPlacements:true}),placed=evaluateScene(scene(value),()=>source),before=fillGeometry(plain.drawing,plain.drawing.fills[0]),after=fillGeometry(placed.drawing,placed.drawing.fills[0]);
 after.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,applyScenePlacement(value,before.shapes[i][j]))));
 const hidden={...placed.drawing,curves:placed.drawing.curves.map((c,i)=>i===0?{...c,visible:false}:c)};expect(render(hidden,placed.paintBatches)).not.toMatch(/NaN|Infinity|drawing-route-error/);
});

test('anisotropic diagnostic error is explicitly a conservative bound with a transformed peak',()=>{
 const source=line([[-.85,-.3],[-.35,.8],[.7,-.8],[.9,.4]]),rest=createWarpGrid({min:[-1,-1],max:[1,1]},4,4),grid=moveWarpNode(rest,12,[.65,.75]),value=placement({translation:[2,-1],rotation:67,scaleX:3,scaleY:.2}),s:RecordingScene={...scene(value),warps:[{id:'warp',name:'Warp',restGrid:rest,keys:[{id:'w',angle:{x:0,y:0},value:grid}]}],bindings:[{instanceId:'one',sourceLayerId:source.layers[0].id,warpId:'warp'}]};
 const plain=evaluateScene(s,()=>source,{omitPlacements:true,diagnostics:'preview'}),placed=evaluateScene(s,()=>source,{diagnostics:'preview'}),a=plain.fitDiagnostics[0],b=placed.fitDiagnostics[0];
 expect(b.placementErrorBound).toBe(true);expect(b.maxError).toBeCloseTo(a.maxError*3,10);expect(b.placementPeakError).toBeLessThanOrEqual(b.maxError+1e-12);near(b.peakExpected,applyScenePlacement(value,a.peakExpected));near(b.peakActual,applyScenePlacement(value,a.peakActual));
});
