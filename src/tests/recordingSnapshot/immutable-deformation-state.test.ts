import {describe,expect,it,vi} from 'vitest';
import {emptyDrawing} from '../../domain/drawing/model';
import {emptyRecordingSnapshot,emptySnapshotDeformationState,emptySnapshotRecording,type SnapshotDeformationState} from '../../domain/recordingSnapshot/model';
import {mergeSnapshotDeformation,evaluateSnapshotState} from '../../domain/recordingSnapshot/tracks';
import {mergeLayerDomains} from '../../domain/recordingSnapshot/layerDomains';

const freeze=<T,>(v:T):T=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}return v;};
function states(count=3){
 const before=emptySnapshotDeformationState(),draft=emptySnapshotDeformationState();
 for(let i=0;i<count;i++){
  before.layers[`layer${i}`]={shape:{nodes:{[`node${i}`]:[.1,.2]},handles:{[`curve${i}`]:[[.3,.4],[.5,.6]]}},visibility:{[`curve${i}`]:true},curveAppearance:{[`curve${i}`]:{width:.03,inkEnds:{start:{taper:.04},end:{extension:.1}}}}};
  draft.layers[`layer${i}`]={shape:{nodes:{[`node${i}`]:[.7,.8]},handles:{[`curve${i}`]:[[.9,1],[1.1,1.2]]}}};
 }
 before.layerDomains=[{id:'field',layerIds:['layer0'],matrix:[1,0,.2,1,.3,.4],postShape:{nodes:{node0:[.01,.02]},handles:{}}}];
 draft.layerDomains=[{id:'field',layerIds:['layer0'],matrix:[0,0,0,1,.3,.4],enabled:false},{id:'next',layerIds:['layer1'],matrix:[1,0,0,1,.2,.1]}];
 return {before,draft};
}

describe('immutable deformation assembly retains the existing merge law',()=>{
 it.each([1,100,1000])('retains unchanged layer values across targets (%i layers)',count=>{
  const {before,draft}=states(count);freeze(before);freeze(draft);
  const a=mergeSnapshotDeformation(before,draft,{immutableInputs:true});expect(a).toEqual(mergeSnapshotDeformation(before,draft));
  expect(mergeSnapshotDeformation(before,draft,{immutableInputs:true})).toBe(a);
  const next={...draft,layers:{...draft.layers,layer0:{...draft.layers.layer0,shape:{nodes:{node0:[2,3] as [number,number]},handles:{}}}}};freeze(next);
  const b=mergeSnapshotDeformation(before,next,{immutableInputs:true});expect(b).toEqual(mergeSnapshotDeformation(before,next));
  expect(b.layers.layer0).not.toBe(a.layers.layer0);expect(b.layers.layer0.shape).toBe(next.layers.layer0.shape);
  for(let i=1;i<count;i++)expect(b.layers[`layer${i}`]).toBe(a.layers[`layer${i}`]);
  expect(b.layerDomains?.[0]).toBe(draft.layerDomains![0]);expect(before.layerDomains![0].enabled).toBeUndefined();
 });
 it('default mutable merges and Save results stay detached',()=>{
  const {before,draft}=states(),a=mergeSnapshotDeformation(before,draft),b=mergeSnapshotDeformation(undefined,before);
  a.layers.layer0.shape!.handles.curve0[0][0]=88;a.layerDomains![0].enabled=true;b.layers.layer0.visibility!.curve0=false;
  expect(draft.layers.layer0.shape!.handles.curve0[0][0]).toBe(.9);expect(draft.layerDomains![0].enabled).toBe(false);expect(before.layers.layer0.visibility!.curve0).toBe(true);
 });
 it('retains exact patch field precedence, clearing values, relation positions and domain order',()=>{
  const {before,draft}=states();draft.layers.layer0={...draft.layers.layer0,curveAppearance:{curve0:{inkEnds:{start:{taper:null}},profile:null}},paintAppearance:{fill:{kind:'fill',color:'black'}},visibility:{curve0:null}};
  before.relationPositions.link={sourceLinkIds:['L'],offset:[.1,.2]};draft.relationPositions.link={sourceLinkIds:['L'],offset:[.3,.4]};freeze(before);freeze(draft);
  const actual=mergeSnapshotDeformation(before,draft,{immutableInputs:true});expect(actual).toEqual(mergeSnapshotDeformation(before,draft));
  expect(actual.layers.layer0.curveAppearance!.curve0.inkEnds).toEqual({start:{taper:null},end:{extension:.1}});expect(actual.layers.layer0.visibility!.curve0).toBeNull();expect(actual.relationPositions.link).toBe(draft.relationPositions.link);expect(actual.layerDomains!.map(d=>d.id)).toEqual(['field','next']);
 });
 it('suppresses only suspended material in a private output, including repeated reads',()=>{
  const snapshot=emptyRecordingSnapshot('snapshot'),recording=emptySnapshotRecording('recording');recording.mode='triangulated';
  snapshot.deformation.layers.layer={intervals:{bad:{appearance:null,enabled:{gap:false}},good:{appearance:null,enabled:{gap:true}}}};
  snapshot.deformation.intervalMaterialIssues={bad:{sourceSnapshotId:'source',sourceSignature:'old',message:'Source interval changed.'}};freeze(snapshot);freeze(recording);
  const before=JSON.stringify(snapshot),material={immutableInputs:true,signature:()=> 'new',diagnostics:[]};
  for(let i=0;i<2;i++){const actual=evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),material);expect(actual.layers.layer.intervals).toEqual({good:{appearance:null,enabled:{gap:true}}});expect(actual).toEqual(evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),{signature:()=> 'new',diagnostics:[]}));}
  const restored=evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),{...material,signature:()=> 'old'});expect(restored.layers.layer.intervals).toEqual(snapshot.deformation.layers.layer.intervals);
  const suspendedAgain=evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),material);expect(suspendedAgain.layers.layer.intervals).toEqual({good:{appearance:null,enabled:{gap:true}}});expect(JSON.stringify(snapshot)).toBe(before);expect(material.diagnostics).toHaveLength(3);
 });
 it('performs no deep clones for repeated trusted native state assembly',()=>{
  const {before,draft}=states(100),snapshot=emptyRecordingSnapshot('snapshot'),recording=emptySnapshotRecording('recording');recording.mode='triangulated';snapshot.deformation=before;snapshot.draft={angle:snapshot.angle,deformation:draft,channels:[]};freeze(snapshot);freeze(recording);
  const material={immutableInputs:true,signature:()=>undefined,diagnostics:[]},first=evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),material),spy=vi.spyOn(globalThis,'structuredClone');
  try{expect(evaluateSnapshotState(snapshot,recording,emptyDrawing(),snapshot.angle,true,new Set(),material)).toBe(first);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
 it('validates new immutable domain arrays and keeps mutable validation live',()=>{
  const {before,draft}=states();freeze(before);freeze(draft);expect(mergeLayerDomains(before.layerDomains,draft.layerDomains,{immutableInputs:true})).toEqual(mergeLayerDomains(before.layerDomains,draft.layerDomains));
  const invalid=structuredClone(draft.layerDomains!);invalid[0].layerIds=[];expect(()=>mergeLayerDomains(before.layerDomains,invalid,{immutableInputs:true})).toThrow();
  const mutable=structuredClone(draft.layerDomains!);mergeLayerDomains([],mutable);mutable[0].layerIds=[];expect(()=>mergeLayerDomains([],mutable)).toThrow();
 });
});
