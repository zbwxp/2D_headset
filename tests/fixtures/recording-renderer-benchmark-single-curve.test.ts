import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import PaintScene from '../../src/ui/drawing/PaintScene';
import {prepareRecordingContext} from '../../src/domain/recordingSnapshot/evaluation';
import {moveHandle} from '../../src/domain/drawing/commands';
import {applyMirrorEditing} from '../../src/domain/drawing/mirrorEditing';
import {drawingControlEditStats} from '../../src/domain/drawing/controlEditPlan';
import {makeFixture,RECORDING_ID,screen} from './recording-renderer-benchmark-fixture';
import {prepareSingleCurveGesture,sampleSingleCurveGesture,assertSingleCurveTarget,singleCurvePosition,SINGLE_CURVE_ANGLE} from './recording-renderer-benchmark-single-curve';

test('public single-handle frames use the canonical producer without drift or unrelated changes',()=>{
 const {workspace}=makeFixture(),savedWorkspace=JSON.stringify(workspace),context=prepareRecordingContext(workspace,{immutableInputs:true,useDraft:true,diagnostics:'preview'}),main=context.sample(RECORDING_ID,{angle:SINGLE_CURVE_ANGLE});
 const gesture=prepareSingleCurveGesture(main.drawing),savedSource=JSON.stringify(gesture.source),rows=[];
 expect(Object.isFrozen(gesture.source)).toBe(true);expect(Object.isFrozen(gesture.source.curves[gesture.curveIndex].handles[0])).toBe(true);
 const noop=()=>{};
 for(const index of [0,1,28,52,0]){
  const before=drawingControlEditStats(),target=sampleSingleCurveGesture(gesture,index),after=drawingControlEditStats();
  expect(after.scopedAuthoring-before.scopedAuthoring).toBe(1);expect(after.fullAuthoring-before.fullAuthoring).toBe(0);expect(after.authoredCurves-before.authoredCurves).toBe(1);
  expect(assertSingleCurveTarget(gesture,target,index)).toMatchObject({changedCurves:1,unrelatedCurvesChanged:0,nodesChanged:0,relationOrMetadataChanges:0,targetFromGestureStart:true});
  const endpoint={curveId:gesture.curveId,end:0 as const},position=singleCurvePosition(gesture,index);
  expect(target).toEqual(applyMirrorEditing(gesture.source,moveHandle(gesture.source,endpoint,position),{handles:[{...endpoint,position}]}));
  const markup=renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d:target,paintBatches:main.paintBatches,screen,unit:250,pixelsPerUnit:250,preview:false,showFills:false,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));
  rows.push({index,sha256:createHash('sha256').update(markup).digest('hex'),characters:markup.length,paths:(markup.match(/<path/g)??[]).length});
 }
 expect(rows[0]).toEqual(rows.at(-1));expect(rows[0].sha256).not.toBe(rows[1].sha256);expect(new Set(rows.map(row=>row.paths)).size).toBe(1);
 expect(JSON.stringify(gesture.source)).toBe(savedSource);expect(JSON.stringify(workspace)).toBe(savedWorkspace);
 if(process.env.SINGLE_CURVE_CORRECTNESS_OUTPUT)writeFileSync(process.env.SINGLE_CURVE_CORRECTNESS_OUTPUT,JSON.stringify({scope:'correctness-only canonical target and full PaintScene SSR output; no timing claim',curveId:gesture.curveId,sourceCurves:gesture.source.curves.length,rows},null,2)+'\n');
});
