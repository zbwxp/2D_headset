import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../domain/recordingSnapshot/model';
import {evaluateEndpointResponse,validateEndpointResponse} from '../domain/recordingSnapshot/endpointPair';
import EndpointCorrectionEditor,{correctionResponseAt,insertCorrectionKnot,moveCorrectionKnot,selectedCorrectionControls} from '../ui/vectorRecording/EndpointCorrectionEditor';

test('inverse graph keeps progress ordered but supports negative, reversing and overshooting responses',()=>{
 const initial:Point2[]=[[.3,.8],[.6,.2]],added=insertCorrectionKnot(initial,[.45,1.2]);
 expect(added.points).toEqual([[.3,.8],[.45,1.2],[.6,.2]]);
 const moved=moveCorrectionKnot(added.points,1,[.9,-.4]);expect(moved[1][0]).toBeLessThan(.6);expect(moved[1][1]).toBe(-.4);expect(()=>validateEndpointResponse(moved)).not.toThrow();
 expect(initial).toEqual([[.3,.8],[.6,.2]]);for(const t of [0,.1,.3,.45,.55,.6,.8,1])expect(correctionResponseAt(moved,t)).toBe(evaluateEndpointResponse(moved,t));
});

test('control list uses shared node identity once and keeps separate relative handles',()=>{
 let d=addLayer(emptyDrawing(),'Jaw');d=createCurve(d,d.layers[0].id,[[0,0],[.2,.1],[.7,.3],[1,1]],.01,'one');d=createCurve(d,d.layers[0].id,[[1,1],[1.2,1.3],[1.7,1.6],[2,2]],.01,'two');
 const first=d.curves[0],second=d.curves[1];second.nodes[0]=first.nodes[1];const result=selectedCorrectionControls(d,[first.id,second.id]);
 expect(result.filter(v=>'nodeId' in v.control)).toHaveLength(3);expect(result.filter(v=>'curveId' in v.control)).toHaveLength(4);expect(result.some(v=>v.label.includes('H1'))).toBe(true);
});

test('correction panel shows independent axes and response contract without writing during render',()=>{
 let drawing=addLayer(emptyDrawing(),'Jaw');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.2,.1],[.7,.3],[1,1]],.01,'Jaw curve');
 const start=emptyRecordingSnapshot('front','Front','view',{x:0,y:0}),end=emptyRecordingSnapshot('side','Side','view',{x:-90,y:0});
 const recording={...emptySnapshotRecording('r'),mode:'endpoint-pair' as const,angle:{x:-60,y:0},endpointPair:{axis:'x' as const,startSnapshotId:start.id,endSnapshotId:end.id,responses:{nodes:{[drawing.curves[0].nodes[0]]:{x:[[2/3,1.2]] as Point2[]}},handles:{}}}};
 let writes=0;const before=JSON.stringify(recording),html=renderToStaticMarkup(createElement(EndpointCorrectionEditor,{recording,views:[start,end],drawing,curveIds:[drawing.curves[0].id],selected:null,zh:true,preview:()=>{writes++;},commit:()=>{writes++;}}));
 expect(html).toContain('control-response-graph');expect(html).toContain('X 响应');expect(html).toContain('Y 响应');expect(html).toContain('不建立中间形状键');expect(html).toContain('-60°');expect(html).toContain('没有位移');expect(writes).toBe(0);expect(JSON.stringify(recording)).toBe(before);
});
