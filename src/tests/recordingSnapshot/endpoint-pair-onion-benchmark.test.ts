import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {expect,test,vi} from 'vitest';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {resolveEndpointPairBasis} from '../../domain/recordingSnapshot/evaluation';
import {interpolateEndpointPairDrawing} from '../../domain/recordingSnapshot/endpointPair';
import {createEndpointPairOnionInkCache} from '../../ui/vectorRecording/endpointOnionInk';
import * as display from '../../domain/drawing/displayIntervals';

const fixture=process.env.ENDPOINT_PAIR_ONION_FIXTURE;
test.skipIf(!fixture)('reports basis, nine-ghost sampler and ink CPU for a constraint draft',()=>{
 const raw=readFileSync(fixture!,'utf8'),workspace=ensureRecordingSnapshots(parseLandmarks(raw),raw).recordingSnapshots,recording=workspace.recordings[0],views=workspace.snapshots.filter(view=>recording.snapshotIds.includes(view.id)),front=views.find(view=>view.angle.x===0&&view.angle.y===0)!,side=views.find(view=>Math.abs(view.angle.x)===90&&view.angle.y===0)!;
 expect(front).toBeDefined();expect(side).toBeDefined();recording.mode='endpoint-pair';recording.endpointPair={axis:'x',startSnapshotId:front.id,endSnapshotId:side.id};recording.angle={x:side.angle.x/3,y:0};
 const started=performance.now(),basis=resolveEndpointPairBasis(workspace,recording.id,{diagnostics:'preview',immutableInputs:true}),coldBasisMs=performance.now()-started,node=basis.start.drawing.nodes.find(node=>basis.end.drawing.nodes.find(value=>value.id===node.id)!.position.some((value,axis)=>Math.abs(value-node.position[axis])>1e-6))!;
 let fieldMs=0,fieldCalls=0;const inkCache=createEndpointPairOnionInkCache(),field=display.displayField,profile=process.env.ENDPOINT_PAIR_ONION_PROFILE?vi.spyOn(display,'displayField').mockImplementation((...args)=>{const before=performance.now();try{return field(...args);}finally{fieldMs+=performance.now()-before;fieldCalls++;}}):undefined;
 const run=(iteration:number)=>{
  const responses={nodes:{[node.id]:{x:[[1/3,.2+iteration*.01] as [number,number]]}},handles:{}},preview={...workspace,recordings:[{...recording,endpointPair:{...recording.endpointPair!,draft:{angle:recording.angle,responses}}}]},beforeBasis=performance.now(),currentBasis=resolveEndpointPairBasis(preview,recording.id,{diagnostics:'preview',immutableInputs:true}),basisMs=performance.now()-beforeBasis;
  expect(currentBasis.start.drawing).toBe(basis.start.drawing);expect(currentBasis.end.drawing).toBe(basis.end.drawing);
  let samplerMs=0,inkMs=0,inkFieldMs=0,inkFieldCalls=0;const samples=[];
  for(const progress of [0,1/9,2/9,4/9,5/9,6/9,7/9,8/9,1]){
   const beforeSample=performance.now(),sampled=interpolateEndpointPairDrawing(currentBasis.start.drawing,currentBasis.end.drawing,progress,responses,{startWins:progress<.5||progress===.5&&front.angle.x<side.angle.x}),sampleMs=performance.now()-beforeSample,beforeInkField=fieldMs,beforeInkFieldCalls=fieldCalls,beforeInk=performance.now(),ink=inkCache.resolve(sampled.drawing),sampleInkMs=performance.now()-beforeInk;inkFieldMs+=fieldMs-beforeInkField;inkFieldCalls+=fieldCalls-beforeInkFieldCalls;
   samplerMs+=sampleMs;inkMs+=sampleInkMs;samples.push({progress,samplerMs:sampleMs,inkMs:sampleInkMs,curves:Object.keys(ink.curves).length,diagnostics:sampled.diagnostics.length+ink.diagnostics.length});
  }
  return {basisMs,samplerMs,inkMs,...(profile?{inkFieldMs,inkFieldCalls}:{}),totalMs:basisMs+samplerMs+inkMs,samples};
 };
 const report={fixture,curves:basis.start.drawing.curves.length,layers:basis.start.drawing.layers.length,materialTracks:basis.start.drawing.displayIntervals?.length??0,coldBasisMs,firstDraft:run(0),warmDrafts:Array.from({length:5},(_,i)=>run(i+1))};
 profile?.mockRestore();
 if(process.env.ENDPOINT_PAIR_ONION_REPORT){mkdirSync(dirname(process.env.ENDPOINT_PAIR_ONION_REPORT),{recursive:true});writeFileSync(process.env.ENDPOINT_PAIR_ONION_REPORT,JSON.stringify(report,null,2));}console.info(JSON.stringify(report));
},120000);
