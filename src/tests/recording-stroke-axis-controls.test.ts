import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import type {SnapshotEvaluation} from '../domain/recordingSnapshot/evaluation';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {applyScenePlacement,scenePlacementScales} from '../domain/recordingScene/tracks';
import SceneInstanceTransformBox,{instanceAxisScaleValue} from '../ui/vectorRecording/SceneInstanceTransformBox';
import {snapshotStrokeTransformFrame,snapshotStrokeDeltaCommands,snapshotStrokeValueCommands} from '../ui/vectorRecording/snapshotStrokeTransform';

function fixture(value:ScenePlacementValue=identityScenePlacement()){
 let material=addLayer(emptyDrawing(),'Profile');material=createCurve(material,material.layers[0].id,[[0,0],[.35,.8],[.8,.9],[1,2]],.01,'Edited profile');
 const curve=material.curves[0],drawing={...material,nodes:material.nodes.map(node=>({...node,position:applyScenePlacement(value,node.position)})),curves:material.curves.map(curve=>({...curve,handles:curve.handles.map(point=>applyScenePlacement(value,point)) as [Point2,Point2]}))};
 const evaluation={drawing,placements:{},preElementPlacementDrawing:material,elementPlacements:{[curve.id]:value}} as SnapshotEvaluation;
 return {evaluation,curve,material};
}

test('selected stroke exposes all four axis handles through the shared transform box',()=>{
 const {evaluation,curve}=fixture(),before=JSON.stringify(evaluation),frame=snapshotStrokeTransformFrame(evaluation,[curve.id])!;
 const html=renderToStaticMarkup(createElement(SceneInstanceTransformBox,{bounds:frame.bounds,materialBounds:frame.materialBounds,basePlacement:frame.placement,screen:(point:Point2)=>point,editable:true,label:'Stroke transform',onBegin(){},onBeginAxis(){}}));
 expect(html.match(/data-testid="vr-instance-scale-x"/g)).toHaveLength(2);expect(html.match(/data-testid="vr-instance-scale-y"/g)).toHaveLength(2);
 expect(snapshotStrokeValueCommands([curve.id],{...identityScenePlacement(),scaleX:0})).toEqual([{op:'setShapeElementPlacement',curveIds:[curve.id],value:{translation:[0,0],rotation:0,scale:1,scaleX:0}}]);
 expect(JSON.stringify(evaluation)).toBe(before);
});

test('zero-width stroke retains its actual edited material and restores width without touching height',()=>{
 const value={...identityScenePlacement(),translation:[.4,.2] as Point2,scaleX:0,scaleY:.7},h=fixture(value),frame=snapshotStrokeTransformFrame(h.evaluation,[h.curve.id])!;
 expect(frame.bounds.max[0]-frame.bounds.min[0]).toBe(0);expect(frame.materialBounds.max[0]-frame.materialBounds.min[0]).toBe(1);
 expect(h.material.curves[0].handles).toEqual([[.35,.8],[.8,.9]]);
 const restored=instanceAxisScaleValue({axis:'x',start:[.4,.9],anchor:[0,1],extent:1,placement:frame.placement!},[.9,.9]);
 expect(scenePlacementScales(restored)).toEqual([.5,.7]);expect(applyScenePlacement(restored,[0,1])).toEqual(applyScenePlacement(value,[0,1]));
 const moved=snapshotStrokeDeltaCommands(h.evaluation,[h.curve.id],{...identityScenePlacement(),translation:[.1,0]})[0];
 expect(moved.op).toBe('setShapeElementPlacement');if(moved.op!=='setShapeElementPlacement')throw Error('wrong route');expect(scenePlacementScales(moved.value)).toEqual([0,.7]);
});

test('correction-position frame remains visibly read-only instead of enabling intermediate transforms',()=>{
 const {evaluation,curve}=fixture(),frame=snapshotStrokeTransformFrame(evaluation,[curve.id])!;
 const html=renderToStaticMarkup(createElement(SceneInstanceTransformBox,{bounds:frame.bounds,materialBounds:frame.materialBounds,basePlacement:frame.placement,screen:(point:Point2)=>point,editable:false,label:'Stroke transform',onBegin(){},onBeginAxis(){}}));
 expect(html).toContain('data-editable="false"');expect(html).toContain('data-testid="vr-instance-scale-x"');
});
