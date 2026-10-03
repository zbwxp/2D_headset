import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {emptyRecordingSnapshot,emptySnapshotRecording,type SnapshotInterpolationWeight} from '../domain/recordingSnapshot/model';
import {validateSnapshotInterpolationWeight} from '../domain/recordingSnapshot/weights';
import InterpolationWeightEditor,{insertWeightEditorPoint,moveWeightEditorPoint,weightEditorAsset} from '../ui/vectorRecording/InterpolationWeightEditor';

const response:Point2[]=[[0,0],[.5,.2],[1,1]];
const asset=(points:Point2[],curveId?:string):SnapshotInterpolationWeight=>({id:curveId??'layer-weight',target:{layerId:'layer',...(curveId?{curveId}:{})},startSnapshotId:'zero',endSnapshotId:'profile',points});

test('PS-style graph point drags preserve ordered monotone endpoints including tightly spaced imported points',()=>{
 const inserted=insertWeightEditorPoint([[0,0],[1,1]],[.67,.4]);expect(inserted.index).toBe(1);expect(inserted.points).toEqual([[0,0],[.67,.4],[1,1]]);
 const original:Point2[]=[[0,0],[.4,.1],[.4001,.4],[.4002,.8],[1,1]],before=JSON.stringify(original);
 const dragged=moveWeightEditorPoint(original,2,[.9,-1]);expect(dragged[2][0]).toBeGreaterThan(.4);expect(dragged[2][0]).toBeLessThan(.4002);expect(dragged[2][1]).toBe(.1);expect(()=>validateSnapshotInterpolationWeight(asset(dragged))).not.toThrow();expect(JSON.stringify(original)).toBe(before);expect(moveWeightEditorPoint(original,0,[.2,.7])).toEqual(original);
});

test('UI distinguishes explicit linear curve override, inherited layer response and reversed endpoint orientation',()=>{
 const recording={...emptySnapshotRecording('r'),interpolationWeights:[asset(response)]};
 expect(weightEditorAsset(recording,'zero','profile',{layerId:'layer',curveId:'curve'})).toMatchObject({inherited:true,points:response});
 recording.interpolationWeights.push(asset([[0,0],[1,1]],'curve'));expect(weightEditorAsset(recording,'zero','profile',{layerId:'layer',curveId:'curve'})).toMatchObject({inherited:false,points:[[0,0],[1,1]]});
 expect(weightEditorAsset(recording,'profile','zero',{layerId:'layer'}).points).toEqual([[0,0],[.5,.8],[1,1]]);
});

test('weight panel keeps 30/60 onion guides and labels middle-key runtime behavior without authoring during render',()=>{
 const zero=emptyRecordingSnapshot('zero','Front','view',{x:0,y:0}),profile=emptyRecordingSnapshot('profile','Side','view',{x:-90,y:0});
 const recording=emptySnapshotRecording('r');recording.angle={x:-90,y:0};recording.snapshotIds=[zero.id,profile.id];recording.interpolationWeights=[asset(response)];recording.tracks=[{id:'shape',targetId:'layer',channel:'shape',keys:[{id:'middle',angle:{x:-60,y:0},value:{nodes:{},handles:{}}}]}];
 const drawing={...emptyDrawing(),layers:[{id:'layer',name:'Jaw',items:['curve'],visible:true,locked:false}]};let writes=0;const before=JSON.stringify(recording);
 const html=renderToStaticMarkup(createElement(InterpolationWeightEditor,{recording,views:[zero,profile],drawing,startSnapshotId:'zero',endSnapshotId:'profile',layerIds:['layer'],curveIds:['curve'],zh:true,preview:()=>{writes++;},commit:()=>{writes++;}}));
 expect(html).toContain('weight-curve-graph');expect(html).toContain('weight-angle-guide--30');expect(html).toContain('weight-angle-guide--60');expect(html).toContain('weight-runtime-segments');expect(html).toContain('共用端点');expect(writes).toBe(0);expect(JSON.stringify(recording)).toBe(before);
});

test('diagonal pairs show an actionable limitation rather than an editor whose curve runtime ignores',()=>{
 const zero=emptyRecordingSnapshot('zero','Front'),diagonal=emptyRecordingSnapshot('diagonal','Diagonal','view',{x:60,y:30});
 const html=renderToStaticMarkup(createElement(InterpolationWeightEditor,{recording:emptySnapshotRecording('r'),views:[zero,diagonal],drawing:emptyDrawing(),startSnapshotId:'zero',endSnapshotId:'diagonal',layerIds:['layer'],curveIds:[],zh:true,preview:()=>{},commit:()=>{}}));
 expect(html).not.toContain('data-testid="weight-curve-graph"');expect(html).toContain('同一俯仰');
});
