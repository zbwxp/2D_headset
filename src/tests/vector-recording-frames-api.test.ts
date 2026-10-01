import {expect,test} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
const value=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function harness(){let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.01);let project:LandmarkProject={...createEmptyProject(),drawing:d};const past:LandmarkProject[]=[];const api=createVectorEditingApi({getState:()=>({project,past,future:[]}),getMode:()=> 'recording',commitDrawing(){throw Error('source write');},commitRecording(recording){past.push(project);project={...project,vectorRecording:recording};},undo(){},redo(){}});const setup=value(api.recording({commands:[{op:'ensureRig'},{op:'createDeformer',layerIds:[d.layers[0].id],rows:2,columns:2,ref:'head'}]})),id=setup.created.find(c=>c.ref==='head')!.id;value(api.recording({commands:[{op:'setAngle',angle:{x:90,y:0}},{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.6,.14]}]},{op:'saveKeyform'}]}));return {api,p:()=>project,past,id};}

test('seven saved-angle frames use the identical real preview renderer and one fixed source camera',()=>{
 const h=harness(),before=h.p(),revision=h.api.inspect().revision,history=h.past.length,result=value(h.api.previewRecordingFrames({width:640,height:480,showFills:true,expectedRevision:revision}));expect(result.frames.map(f=>f.angle.x)).toEqual([0,15,30,45,60,75,90]);expect(result.frames.map(f=>f.filename)).toEqual([0,1,2,3,4,5,6].map(i=>`frame-00${i}.svg`));expect(result.savedKeyformsOnly).toBe(true);expect(result.allFramesIdentical).toBe(false);
 for(const f of result.frames){expect(f.usedDraft).toBe(false);expect(f.viewport).toEqual(result.viewport);expect(f.svg).toBe(value(h.api.previewRecording({angle:f.angle,...result.viewport,showFills:true})).svg);expect(f.fitDiagnostics).toHaveLength(before.drawing!.curves.length);expect(f.diagnosticStage).toBe('full');}
 expect(result.frames[0].svg).not.toBe(result.frames.at(-1)!.svg);expect(h.p()).toBe(before);expect(h.past).toHaveLength(history);expect(h.api.inspect().revision).toBe(revision);
});

test('batch frames never silently reuse a current draft and reject draft/command options',()=>{
 const h=harness();value(h.api.recording({commands:[{op:'editGridNodes',deformerId:h.id,edits:[{index:4,position:[.8,.3]}]}]}));const before=h.p(),saved=value(h.api.previewRecordingFrames({angles:[{x:90,y:0}],center:[.5,.1] as Point2,pixelsPerUnit:250}));expect(saved.hasUnappliedDraft).toBe(true);expect(saved.frames[0].usedDraft).toBe(false);expect(saved.frames[0].svg).not.toBe(value(h.api.previewRecording({center:[.5,.1],pixelsPerUnit:250})).svg);expect(h.p()).toBe(before);
 for(const options of [{angles:[]},{angles:Array(32).fill({x:0,y:0})},{angles:[{x:91,y:0}]},{useDraft:true},{commands:[]},{angles:[{x:0,y:0,extra:true}]}])expect(h.api.previewRecordingFrames(options as never).ok).toBe(false);expect(h.p()).toBe(before);
});


test('the docs extractor writes actual saved-frame SVGs/manifest into a new directory and refuses overwrite/drafts',()=>{
 const h=harness(),result=h.api.previewRecordingFrames({angles:[{x:0,y:0},{x:90,y:0}],width:300,height:300}),dir=mkdtempSync(join(tmpdir(),'contour-frames-')),input=join(dir,'result.json'),output=join(dir,'frames'),script=fileURLToPath(new URL('../../docs/tools/extract-recording-frames.mjs',import.meta.url));
 try{writeFileSync(input,JSON.stringify(result));execFileSync(process.execPath,[script,input,output]);const manifest=JSON.parse(readFileSync(join(output,'manifest.json'),'utf8'));expect(manifest.frames.map((f:{angle:{x:number}})=>f.angle.x)).toEqual([0,90]);const v=value(result);expect(readFileSync(join(output,'frame-000.svg'),'utf8')).toBe(v.frames[0].svg);expect(readFileSync(join(output,'frame-001.svg'),'utf8')).toBe(v.frames[1].svg);expect(()=>execFileSync(process.execPath,[script,input,output],{stdio:'pipe'})).toThrow();expect(readFileSync(join(output,'frame-000.svg'),'utf8')).toBe(v.frames[0].svg);
  const bad={...v,frames:v.frames.map((f,i)=>i?f:{...f,usedDraft:true})};writeFileSync(input,JSON.stringify(bad));expect(()=>execFileSync(process.execPath,[script,input,join(dir,'invalid')],{stdio:'pipe'})).toThrow();expect(existsSync(join(dir,'invalid'))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
