import {expect,test} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch,evaluateRecordingScene,type SceneCommand} from '../app/recordingSceneApi';
import {emptyDrawing} from '../domain/drawing/model';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {instanceObjectId} from '../domain/recordingScene/model';
import type {LandmarkProject} from '../domain/landmarks/model';

function source(){let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Contour','contour');return addDisplayInterval(d,'contour','SHOW');}
function project(){return {...createEmptyProject(),...saveDrawingSnapshot({drawing:source()},'Face artwork')};}
function harness(initial=project()){
 let p:LandmarkProject=initial,mode:'drawing'|'recording'='recording',past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project:p,past,future}),getMode:()=>mode,commitDrawing(d){past.push(p);p={...p,drawing:d};},commitRecordingScenes(recordingScenes){past.push(p);future=[];p={...p,recordingScenes};},undo(){const old=past.pop();if(old){future.push(p);p=old;}},redo(){const next=future.pop();if(next){past.push(p);p=next;}}});
 return {api,project:()=>p,past:()=>past,mode:(v:typeof mode)=>mode=v,replace:(v:LandmarkProject)=>p=v};
}
const val=<T,>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function setup(){const h=harness(),p=h.project(),asset=p.drawingSnapshots!.activeId!,layer=p.drawing!.layers[0].id;const result=val(h.api.scene({commands:[{op:'createScene',name:'Two parts',ref:'scene'},{op:'addInstance',artworkId:asset,name:'A',ref:'a'},{op:'addInstance',artworkId:asset,name:'B',ref:'b'},{op:'createWarp',name:'A Warp',layerRefs:[{instanceId:'$a',sourceLayerId:layer}],ref:'wa'},{op:'createWarp',name:'B Warp',layerRefs:[{instanceId:'$b',sourceLayerId:layer}],ref:'wb'}]}));const id=(ref:string)=>result.created.find(c=>c.ref===ref)!.id;return {...h,a:id('a'),b:id('b'),wa:id('wa'),wb:id('wb'),layer};}
const scene=(p:LandmarkProject)=>p.recordingScenes!.scenes.find(s=>s.id===p.recordingScenes!.activeSceneId)!;

test('one batch creates duplicate-source instances with independent namespaced geometry and one Undo',()=>{
 const h=harness(),before=h.project(),rev=h.api.inspect().revision,asset=before.drawingSnapshots!.activeId!,layer=before.drawing!.layers[0].id,commands:SceneCommand[]=[{op:'createScene',name:'Shared',ref:'s'},{op:'addInstance',artworkId:asset,name:'A',ref:'a'},{op:'addInstance',artworkId:asset,name:'B',ref:'b'},{op:'createWarp',layerRefs:[{instanceId:'$a',sourceLayerId:layer},{instanceId:'$b',sourceLayerId:layer}],ref:'w'}];
 val(h.api.scene({commands,dryRun:true,expectedRevision:rev}));expect(h.project()).toBe(before);expect(h.past()).toHaveLength(0);expect(h.api.inspect().revision).toBe(rev);
 const result=val(h.api.scene({commands,expectedRevision:rev})),p=h.project(),s=scene(p),out=evaluateRecordingScene(p);expect(s.instances).toHaveLength(2);expect(s.bindings).toHaveLength(2);expect(new Set(s.bindings.map(b=>b.warpId)).size).toBe(1);expect(out.drawing.curves).toHaveLength(2);expect(new Set(out.drawing.curves.map(c=>c.id)).size).toBe(2);expect(p.drawing).toBe(before.drawing);expect(p.drawingSnapshots).toBe(before.drawingSnapshots);expect(h.past()).toHaveLength(1);expect(result.applied).toBe(true);
 val(h.api.undo());expect(h.project()).toBe(before);val(h.api.redo());expect(h.project()).toBe(p);
});

test('each Warp saves only its own keys: two and ten coordinates stay independent',()=>{
 const h=setup(),commands:SceneCommand[]=[];for(const x of [0,90])commands.push({op:'setAngle',angle:{x,y:0}},{op:'saveSelected',warpIds:[h.wa]});for(let x=0;x<=90;x+=10)commands.push({op:'setAngle',angle:{x,y:0}},{op:'saveSelected',warpIds:[h.wb]});
 val(h.api.scene({commands}));const s=scene(h.project());expect(s.warps.find(w=>w.id===h.wa)!.keys).toHaveLength(2);expect(s.warps.find(w=>w.id===h.wb)!.keys).toHaveLength(10);expect(s.visibilityTracks).toHaveLength(0);expect(s.intervalTracks).toHaveLength(0);expect(s.warps.every(w=>!w.draft)).toBe(true);
 const round=parseLandmarks(JSON.stringify(h.project()));expect(round.recordingScenes).toEqual(h.project().recordingScenes);
});

test('object drafts survive cursor moves and another object edit, but cannot be overwritten at another angle',()=>{
 const h=setup();val(h.api.scene({commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'editWarpNodes',warpId:h.wa,edits:[{index:4,position:[.2,.1]}]},{op:'setAngle',angle:{x:60,y:0}},{op:'editWarpNodes',warpId:h.wb,edits:[{index:4,position:[.3,.1]}]}]}));
 const before=h.project(),a=scene(before).warps.find(w=>w.id===h.wa)!;expect(a.draft!.angle).toEqual({x:30,y:0});expect(scene(before).warps.find(w=>w.id===h.wb)!.draft!.angle.x).toBe(60);
 expect(h.api.scene({commands:[{op:'editWarpNodes',warpId:h.wa,edits:[{index:4,position:[9,9]}]}]})).toMatchObject({ok:false,error:{code:'OBJECT_DRAFT_AT_OTHER_ANGLE',commandIndex:0}});expect(h.project()).toBe(before);
 expect(h.api.scene({commands:[{op:'saveSelected',warpIds:[h.wa]}]})).toMatchObject({ok:false,error:{code:'OBJECT_DRAFT_AT_OTHER_ANGLE'}});
 val(h.api.scene({commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'saveSelected',warpIds:[h.wa]}]}));expect(scene(h.project()).warps.find(w=>w.id===h.wa)!.keys).toHaveLength(1);expect(scene(h.project()).warps.find(w=>w.id===h.wb)!.draft!.angle.x).toBe(60);
});

test('shared creation never steals a binding; explicit parent and child operations preserve old keys',()=>{
 const h=setup(),ref={instanceId:h.a,sourceLayerId:h.layer};val(h.api.scene({commands:[{op:'saveSelected',warpIds:[h.wa,h.wb]}]}));const before=h.project(),original=scene(before).warps.find(w=>w.id===h.wa)!;
 expect(h.api.scene({commands:[{op:'createWarp',layerRefs:[ref]}]})).toMatchObject({ok:false,error:{code:'ALREADY_BOUND'}});expect(h.project()).toBe(before);
 const parent=val(h.api.scene({commands:[{op:'wrapParent',warpIds:[h.wa,h.wb],name:'Common',ref:'parent'}]})).created.find(c=>c.ref==='parent')!.id,s=scene(h.project());expect(s.warps.find(w=>w.id===h.wa)!.keys).toEqual(original.keys);expect(s.bindings.find(b=>b.instanceId===h.a)!.warpId).toBe(h.wa);expect(s.warps.find(w=>w.id===h.wa)!.parentId).toBe(parent);
 expect(h.api.scene({commands:[{op:'createChild',parentWarpId:parent,layerRefs:[ref]}]})).toMatchObject({ok:false,error:{code:'NOT_DIRECT_PARENT'}});
 const child=val(h.api.scene({commands:[{op:'createChild',parentWarpId:h.wa,layerRefs:[ref],ref:'child'}]})).created.find(c=>c.ref==='child')!.id;expect(scene(h.project()).bindings.find(b=>b.instanceId===h.a)!.warpId).toBe(child);expect(scene(h.project()).warps.find(w=>w.id===child)!.parentId).toBe(h.wa);
});

test('wrapping parent includes saved and draft patch control hulls, not just source bounds',()=>{
 const h=setup();val(h.api.scene({commands:[{op:'editWarpNodes',warpId:h.wa,edits:[{index:4,position:[5,4],handleU:[8,4],handleV:[5,9],twist:[12,12]}]},{op:'saveSelected',warpIds:[h.wa]},{op:'setAngle',angle:{x:30,y:0}},{op:'editWarpNodes',warpId:h.wa,edits:[{index:4,position:[-4,-3]}]}]}));
 const result=val(h.api.scene({commands:[{op:'wrapParent',warpIds:[h.wa],ref:'parent'}]})),w=scene(h.project()).warps.find(w=>w.id===result.created[0].id)!;expect(w.restGrid.bounds.max[0]).toBeGreaterThanOrEqual(8);expect(w.restGrid.bounds.max[1]).toBeGreaterThanOrEqual(9);expect(w.restGrid.bounds.min[0]).toBeLessThanOrEqual(-4);
});

test('layer and interval keys are selected by their owning instance/layer and never change source',()=>{
 const h=setup(),source=h.project().drawing!,before=JSON.stringify(source),base=source.displayIntervals![0],r=base.ranges[0],target={instanceId:h.a,sourceLayerId:h.layer};
 val(h.api.scene({commands:[{op:'setVisibility',target,visible:false},{op:'changeInterval',instanceId:h.a,sourceTrackId:base.id,rangeId:r.id,start:.2,end:.8},{op:'saveSelected',layerRefs:[target]}]}));
 const s=scene(h.project());expect(s.visibilityTracks).toHaveLength(1);expect(s.intervalTracks).toHaveLength(1);expect(s.intervalTracks[0].keys).toHaveLength(1);expect(s.warps.every(w=>w.keys.length===0)).toBe(true);expect(JSON.stringify(h.project().drawing)).toBe(before);
 const out=evaluateRecordingScene(h.project());expect(out.drawing.curves.find(c=>c.id===instanceObjectId(h.a,'contour'))!.visible).toBe(false);expect(out.drawing.curves.find(c=>c.id===instanceObjectId(h.b,'contour'))!.visible).toBe(true);
});

test('all appearance channels of one layer share its draft angle guard',()=>{
 const h=setup(),target={instanceId:h.a,sourceLayerId:h.layer},base=h.project().drawing!.displayIntervals![0];
 val(h.api.scene({commands:[{op:'setVisibility',target,visible:false},{op:'setAngle',angle:{x:90,y:0}}]}));const before=h.project();
 for(const command of [{op:'setLayerOrder',target,value:1},{op:'changeInterval',instanceId:h.a,sourceTrackId:base.id,rangeId:base.ranges[0].id,start:.2}] as SceneCommand[])expect(h.api.scene({commands:[command]})).toMatchObject({ok:false,error:{code:'OBJECT_DRAFT_AT_OTHER_ANGLE'}});
 expect(h.project()).toBe(before);val(h.api.scene({commands:[{op:'discardSelected',layerRefs:[target]},{op:'changeInterval',instanceId:h.a,sourceTrackId:base.id,rangeId:base.ranges[0].id,start:.2},{op:'saveSelected',layerRefs:[target]}]}));expect(scene(h.project()).intervalTracks[0].keys[0].angle.x).toBe(90);
});

test('scene previews are pure, explicit angles use saved keys, and frame cameras stay fixed',()=>{
 const h=setup();val(h.api.scene({commands:[{op:'editWarpNodes',warpId:h.wa,edits:[{index:4,position:[.2,.4]}]}]}));const before=h.project(),rev=h.api.inspect().revision,options={width:300,height:300,showFills:false};h.mode('drawing');
 const draft=val(h.api.previewScene(options)),saved=val(h.api.previewScene({...options,angle:{x:0,y:0}}));expect(draft.usedDraft).toBe(true);expect(saved.usedDraft).toBe(false);expect(saved.hasUnappliedDraft).toBe(true);expect(draft.svg).not.toBe(saved.svg);const frames=val(h.api.previewSceneFrames({...options,angles:[{x:0,y:0},{x:90,y:0}]}));expect(frames.frames.every(f=>JSON.stringify(f.viewport)===JSON.stringify(frames.viewport))).toBe(true);expect(frames.frames.every(f=>!f.usedDraft)).toBe(true);expect(h.project()).toBe(before);expect(h.api.inspect().revision).toBe(rev);
});

test('failed commands, stale source revisions and mode guards cannot partially write scenes',()=>{
 const h=setup(),before=h.project(),revision=h.api.inspectScene().revision;
 expect(h.api.scene({commands:[{op:'setAngle',angle:{x:40,y:0}},{op:'editWarpNodes',warpId:h.wa,edits:[{index:0,position:[NaN,0]}]}]})).toMatchObject({ok:false,error:{commandIndex:1}});expect(h.project()).toBe(before);
 expect(h.api.scene({commands:[{op:'setAngle',angle:{x:40,y:0},drawing:{}}] as any})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(h.project()).toBe(before);
 h.replace({...before,drawing:{...before.drawing!,mirrorAxisX:.1}});expect(h.project().recordingScenes).toBe(before.recordingScenes);expect(h.api.scene({commands:[],expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
 h.mode('drawing');expect(h.api.scene({commands:[]})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(h.api.inspectScene().ok).toBe(true);
});

test('Recording-mode facade history cannot undo an inactive working-copy-only source change',()=>{
 const a=project(),asset=a.drawingSnapshots!.activeId!,before={...a,...saveDrawingSnapshot(a,'Other active artwork')},current={...before,drawingWorkingCopies:{[asset]:{...a.drawing!,mirrorAxisX:.3}}};let calls=0;
 const api=createVectorEditingApi({getState:()=>({project:current,past:[before],future:[]}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source write');},undo(){calls++;},redo(){calls++;}});
 expect(api.undo()).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(calls).toBe(0);
});

test('pure planner and JSON parser reject unknown payloads and retain orphan source references',()=>{
 const h=setup(),before=JSON.stringify(h.project()),data=structuredClone(h.project().recordingScenes!);data.scenes[0].instances[0].artworkId='gone';const parsed=parseRecordingScenes(data);expect(parsed.scenes[0].instances[0].artworkId).toBe('gone');
 expect(()=>parseRecordingScenes({...data,rawProject:{}})).toThrow(/unknown field/);expect(()=>prepareSceneBatch(h.project(),{commands:[{op:'removeInstance',instanceId:h.a},{op:'setWarp',warpId:h.wb,parentId:h.wb}]})).toThrow(/cycle/);expect(JSON.stringify(h.project())).toBe(before);
});

test('new scene projects reject legacy facade access instead of editing an invisible second rig',()=>{
 const h=setup(),before=h.project();for(const result of [h.api.inspectRecording(),h.api.recording({commands:[]}),h.api.previewRecording(),h.api.previewRecordingFrames()])expect(result).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED'}});expect(h.project()).toBe(before);expect(h.api.help().sceneSchema).toEqual({projectField:'recordingScenes',version:1});
});

test('layer opening preserves hidden source members; explicit object visibility can override and false gate wins',()=>{
 const h=setup(),p=h.project();h.replace({...p,drawing:{...p.drawing!,curves:p.drawing!.curves.map(c=>({...c,visible:false}))}});
 const target={instanceId:h.a,sourceLayerId:h.layer},visible=()=>evaluateRecordingScene(h.project()).drawing.curves.find(c=>c.id===instanceObjectId(h.a,'contour'))!.visible;
 val(h.api.scene({commands:[{op:'setVisibility',target,visible:true}]}));expect(visible()).toBe(false);
 val(h.api.scene({commands:[{op:'setVisibility',target:{...target,sourceObjectId:'contour'},visible:true}]}));expect(visible()).toBe(true);
 val(h.api.scene({commands:[{op:'setVisibility',target,visible:false}]}));expect(visible()).toBe(false);
 val(h.api.scene({commands:[{op:'setVisibility',target,visible:null}]}));expect(visible()).toBe(true);
});

const guide=readFileSync(new URL('../../docs/recording-scene-api.md',import.meta.url),'utf8'),examples=[...guide.matchAll(/<!-- scene-tested: ([a-z-]+) -->\s*```json\s*([\s\S]*?)```/g)].map(m=>({name:m[1],request:JSON.parse(m[2])}));
test('scene guide declares actual executable examples',()=>expect(examples.map(e=>e.name)).toEqual(['inspect','two-instances','selected-key','preview','frames']));
for(const example of examples)test(`scene guide example ${example.name} calls the actual facade without source or history writes`,()=>{
 const h=setup(),before=h.project(),revision=h.api.inspect().revision,replace=(v:unknown):unknown=>v==='SOURCE_ARTWORK_ID'?before.drawingSnapshots!.activeId:v==='SOURCE_LAYER_ID'?h.layer:v==='WARP_ID'?h.wa:Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v;
 const r=replace(example.request) as {method:string;request:any};const result=r.method==='scene'?h.api.scene(r.request):r.method==='inspectScene'?h.api.inspectScene(r.request):r.method==='previewSceneFrames'?h.api.previewSceneFrames(r.request):h.api.previewScene(r.request);expect(result.ok,JSON.stringify(result)).toBe(true);expect(h.project()).toBe(before);expect(h.api.inspect().revision).toBe(revision);
});

test('the frame extractor accepts the actual new scene response and rejects mixed scene identities',()=>{
 const h=setup(),result=h.api.previewSceneFrames({showFills:false,angles:[{x:0,y:0},{x:30,y:0}]}),value=val(result),directory=mkdtempSync(join(tmpdir(),'scene-frames-'));
 try{const input=join(directory,'response.json'),output=join(directory,'frames'),script=new URL('../../docs/tools/extract-recording-frames.mjs',import.meta.url).pathname;writeFileSync(input,JSON.stringify(result));expect(spawnSync(process.execPath,[script,input,output],{encoding:'utf8'}).status).toBe(0);expect(readdirSync(output)).toEqual(['frame-000.svg','frame-001.svg','manifest.json']);value.frames[1].sceneId='another-scene';writeFileSync(input,JSON.stringify({ok:true,value}));expect(spawnSync(process.execPath,[script,input,join(directory,'bad')],{encoding:'utf8'}).status).toBe(1);}finally{rmSync(directory,{recursive:true,force:true});}
});
