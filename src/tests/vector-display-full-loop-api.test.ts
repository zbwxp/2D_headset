import {expect,test} from 'vitest';
import {createVectorEditingApi,type VectorCommand,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import type {LandmarkProject} from '../domain/landmarks/model';
const value=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function fixture(closed=true){let d=addLayer(emptyDrawing(),'Loop');if(closed)d=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.01).document;else d=createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.6,0],[1,0]],.01);return d;}
function harness(d:DrawingDocument){let project:LandmarkProject={...createEmptyProject(),drawing:d};const past:LandmarkProject[]=[];const api=createVectorEditingApi({getState:()=>({project,past,future:[]}),getMode:()=> 'drawing',commitDrawing(drawing){past.push(project);project={...project,drawing};},undo(){const p=past.pop();if(p)project=p;},redo(){}});return {api,d:()=>project.drawing!,state:()=>project,past};}
const mask=(d:DrawingDocument)=>displayField(d,displayPath(d,d.curves[0].id)).mask;

test('equal closed bounds are empty unless fullLoop is explicit; full SHOW and full HIDE remain distinct',()=>{
 const h=harness(fixture()),curveId=h.d().curves[0].id,result=value(h.api.execute({commands:[{op:'addDisplayInterval',curveId,mode:'SHOW',start:.3,end:.3,ref:'range'}]})),rangeId=result.created.find(c=>c.ref==='range')!.id;
 expect(mask(h.d())).toEqual([]);value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId,fullLoop:true}]}));expect(mask(h.d())).toEqual([[0,1]]);expect(h.d().displayIntervals![0].ranges[0]).toMatchObject({start:.3,end:.3,fullLoop:true});
 value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId,mode:'HIDE'}]}));expect(mask(h.d())).toEqual([]);expect(h.d().displayIntervals![0].ranges[0].fullLoop).toBe(true);
 value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId,fullLoop:false}]}));expect(mask(h.d())).toEqual([[0,1]]);
});

test('new full loop normalizes equal bounds; boundary writes clear it unless explicitly reaffirmed',()=>{
 const h=harness(fixture()),curveId=h.d().curves[0].id,commands:VectorCommand[]=[{op:'addDisplayInterval',curveId,mode:'SHOW',start:.2,end:.9,fullLoop:true,ref:'range'}],before=h.state();
 value(h.api.execute({commands,dryRun:true}));expect(h.state()).toBe(before);const rangeId=value(h.api.execute({commands})).created[0].id;expect(h.d().displayIntervals![0].ranges[0]).toMatchObject({start:.2,end:.2,fullLoop:true});
 value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId,end:.4}]}));expect(h.d().displayIntervals![0].ranges[0].fullLoop).toBeUndefined();expect(mask(h.d())).not.toEqual([[0,1]]);
 value(h.api.execute({commands:[{op:'changeDisplayInterval',rangeId,start:.6,fullLoop:true}]}));expect(h.d().displayIntervals![0].ranges[0]).toMatchObject({start:.6,end:.6,fullLoop:true});expect(mask(h.d())).toEqual([[0,1]]);
});

test('open or curve-scoped full loops reject atomically and malformed booleans are not coerced',()=>{
 const h=harness(fixture(false)),before=h.state();expect(h.api.execute({commands:[{op:'renameCurve',curveId:h.d().curves[0].id,name:'Discard me'},{op:'addDisplayInterval',curveId:h.d().curves[0].id,fullLoop:true}]}).ok).toBe(false);expect(h.state()).toBe(before);expect(h.past).toHaveLength(0);
 const q=harness(fixture()),curveId=q.d().curves[0].id;expect(q.api.execute({commands:[{op:'addDisplayInterval',curveId,fullLoop:'true'} as unknown as VectorCommand]})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
 const d=fixture();d.displayIntervals=[{id:'track',anchor:{id:d.curves[0].id,reverse:false},scope:'CURVE',ranges:[{id:'range',mode:'SHOW',start:.2,end:.2}]}];const scoped=harness(d);expect(scoped.api.execute({commands:[{op:'changeDisplayInterval',rangeId:'range',fullLoop:true}]}).ok).toBe(false);expect(scoped.state().drawing).toBe(d);
});
