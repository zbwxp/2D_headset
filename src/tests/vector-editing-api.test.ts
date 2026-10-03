import {describe,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {readFileSync} from 'node:fs';
import {createVectorEditingApi,cubicBounds,registerVectorEditingApi,type VectorEditingHost,type VectorResult,type VectorCommand} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {createCurve,addLayer,connect,linkEndpoints,moveHandle,transform} from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,type DrawingDocument,type Cubic} from '../domain/drawing/model';
import {deformDrawing,transportDeformedIntervals,type Quad} from '../domain/drawing/deform';
import {neutralBend} from '../domain/deformation/coons';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {WorkspaceMode} from '../app/workspaceMode';

const aShape:Cubic=[[-1,0],[-.7,.3],[-.3,.3],[0,0]];
const bShape:Cubic=[[0,0],[.3,-.3],[.7,-.3],[1,0]];
function fixture(){
 let d=addLayer(emptyDrawing(),'Eye');const layer=d.layers[0].id;
 d=createCurve(d,layer,aShape,.01,'Upper lid','upper');
 d=createCurve(d,layer,bShape,.01,'Lower lid','lower');
 d=connect(d,{curveId:'upper',end:1},{curveId:'lower',end:0},'SMOOTH');
 d=addLayer(d,'Hair');d=createCurve(d,d.layers[0].id,[[0,1],[.2,.8],[.2,.2],[0,0]],.01,'Fringe','fringe');
 return linkEndpoints(d,{curveId:'upper',end:1},{curveId:'fringe',end:1});
}
function harness(d=fixture()){
 let project={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[],mode:WorkspaceMode='drawing',commits=0,selection:string[]=[];
 const host:VectorEditingHost={
  getState:()=>({project,past,future}),getMode:()=>mode,
  commitDrawing(drawing){expect(mode).toBe('drawing');commits++;past=[...past,project];future=[];project={...project,drawing};},
  undo(){const prior=past.at(-1);if(prior){future=[project,...future];past=past.slice(0,-1);project=prior as typeof project;}},
  redo(){const next=future[0];if(next){past=[...past,project];future=future.slice(1);project=next as typeof project;}},
  selectCurveIds(ids){selection=ids;},getSelection:()=>({ids:selection}),
  getViewport:()=>({width:800,height:600,center:[.2,-.4],pixelsPerUnit:250,origin:[100,50]}),
 };
 const api=createVectorEditingApi(host);
 return {api,host,state:()=>({project,past,future,commits,selection}),setMode:(m:WorkspaceMode)=>mode=m,replaceProject:(p:LandmarkProject)=>project=p as typeof project};
}
function value<T>(r:VectorResult<T>):T{expect(r.ok,r.ok?'':JSON.stringify(r.error)).toBe(true);if(!r.ok)throw Error(r.error.message);return r.value;}
function error(r:VectorResult<unknown>,code:string){expect(r.ok).toBe(false);if(r.ok)throw Error('Expected API failure');expect(r.error.code).toBe(code);return r.error;}
const geometry=(d:DrawingDocument)=>({nodes:d.nodes,curves:d.curves.map(c=>({id:c.id,nodes:c.nodes,handles:c.handles}))});

describe('structured vector authoring API',()=>{
 test('named queries expose canonical geometry, graph relationships and detached stable IDs',()=>{
  const h=harness(),first=h.api.inspect({layerNames:['Eye']}),v=value(first);
  expect(v.curves.map(c=>c.id)).toEqual(['upper','lower']);expect(v.strokes).toHaveLength(1);
  expect(v.curves[0].shape).toEqual(aShape);expect(v.curves[0].bounds.max[1]).toBeCloseTo(.225,12);
  expect(v.nodes.find(n=>n.id===nodeAt(h.state().project.drawing,{curveId:'upper',end:1}).id)?.linkedNodeIds).toHaveLength(2);
  expect(v.endpointLinks).toHaveLength(1);expect(v.joins).toHaveLength(1);
  v.curves[0].handles[0][0]=900;v.layers[0].items.length=0;
  expect(h.state().project.drawing.curves[0].handles[0][0]).toBe(-.7);
  value(h.api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'Top eyelid'}],expectedRevision:first.revision}));
  expect(value(h.api.inspect({curveNames:['Top eyelid']})).curves.map(c=>c.id)).toEqual(['upper']);
  expect(value(h.api.inspect({nameIncludes:'frINge'})).curves.map(c=>c.id)).toEqual(['fringe']);
  expect(value(h.api.inspect({layerNames:['missing']})).curves).toEqual([]);
  error(h.api.inspect({curveIds:['missing']}),'NOT_FOUND');
 });

 test('batch is one transaction and one undo, with redo and stale revision protection',()=>{
  const h=harness(),original=structuredClone(h.state().project.drawing),revision=h.api.inspect().revision;
  const result=h.api.execute({expectedRevision:revision,commands:[{op:'renameCurve',curveId:'upper',name:'Upper edited'},{op:'setCurveWidth',curveIds:['upper'],width:.015}]});
  expect(value(result).applied).toBe(true);expect(h.state().commits).toBe(1);expect(h.state().past).toHaveLength(1);
  expect(h.state().project.drawing.curves.filter(c=>c.id!=='fringe').every(c=>c.width===.015)).toBe(true);
  error(h.api.execute({expectedRevision:revision,commands:[{op:'renameCurve',curveId:'upper',name:'Stale'}]}),'STALE_REVISION');
  value(h.api.undo({expectedRevision:result.revision}));expect(h.state().project.drawing).toEqual(original);
  value(h.api.redo());expect(h.state().project.drawing.curves[0].name).toBe('Upper edited');
 });

 test('shared endpoints, linked nodes and smooth tangents use the existing commands',()=>{
  const h=harness(),d=h.state().project.drawing,n=nodeAt(d,{curveId:'upper',end:1});
  const result=value(h.api.execute({commands:[{op:'moveNode',nodeId:n.id,position:[.1,.15]},{op:'moveHandle',curveId:'upper',end:1,position:[-.2,.45]}]}));
  const next=h.state().project.drawing;
  expect(result.curveIds.sort()).toEqual(['fringe','lower','upper']);
  expect(nodeAt(next,{curveId:'fringe',end:1}).position).toEqual([.1,.15]);
  expect(next.nodes.map(n=>n.id)).toEqual(d.nodes.map(n=>n.id));expect(next.curves.map(c=>c.nodes)).toEqual(d.curves.map(c=>c.nodes));
  expect(next.joins).toEqual(d.joins);expect(next.endpointLinks).toEqual(d.endpointLinks);
  expect(()=>parseDrawing(next)).not.toThrow();
 });

 test('failed later commands never commit partial geometry, selection or undo history',()=>{
  const h=harness(),before=JSON.stringify(h.state()),rev=h.api.inspect().revision;
  const result=h.api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'Must not remain'},{op:'moveHandle',curveId:'missing',end:0,position:[0,0]}]});
  expect(error(result,'NOT_FOUND').commandIndex).toBe(1);expect(JSON.stringify(h.state())).toBe(before);expect(result.revision).toBe(rev);
  error(h.api.execute({commands:[{op:'runCode',code:'globalThis.x=1'}] as unknown as VectorCommand[]}),'UNKNOWN_COMMAND');
  expect(JSON.stringify(h.state())).toBe(before);
 });

 test('invalid inputs, singular transforms and coordinate overflow are rejected before writing',()=>{
  const h=harness(),id=h.state().project.drawing.nodes[0].id;
  for(const bad of [NaN,Infinity,-Infinity,10001])error(h.api.execute({commands:[{op:'moveNode',nodeId:id,position:[bad,0]}]}),'INVALID_REQUEST');
  error(h.api.execute({commands:[{op:'transformCurves',curveIds:['upper','lower'],matrix:[0,0,0,1,0,0]}]}),'INVALID_REQUEST');
  error(h.api.execute({commands:[{op:'setCurveWidth',curveIds:['upper'],width:0}]}),'INVALID_REQUEST');
  error(h.api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'x',hidden:true}] as unknown as VectorCommand[]}),'INVALID_REQUEST');
  error(h.api.execute({commands:[],dryRun:'yes'} as any),'INVALID_REQUEST');
  expect(h.state().commits).toBe(0);expect(h.state().past).toHaveLength(0);
 });

 test('dry-run and speculative preview are detached and produce no history',()=>{
  const h=harness(),before=JSON.stringify(h.state()),revision=h.api.inspect().revision;
  const commands:VectorCommand[]=[{op:'transformCurves',curveIds:['upper','lower'],matrix:[1,0,0,1,.1,0]}];
  const result=value(h.api.execute({commands,dryRun:true,expectedRevision:revision}));
  expect(result).toMatchObject({applied:false,changed:true,dryRun:true});expect(result.curveIds).toContain('fringe');
  const preview=value(h.api.preview({commands,width:512,height:512}));expect(preview.svg).toContain('<svg');expect(preview.svg).not.toContain('drawing-hit');
  expect(JSON.stringify(h.state())).toBe(before);expect(h.api.inspect().revision).toBe(revision);
 });

 test('Recording rejects all source writes, including dry-runs and source-changing history; reads remain available',()=>{
  const h=harness();value(h.api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'Edit'}]}));h.setMode('recording');
  const before=JSON.stringify(h.state()),command:VectorCommand={op:'renameCurve',curveId:'upper',name:'Forbidden'};
  error(h.api.execute({commands:[command]}),'MODE_RESTRICTED');error(h.api.execute({commands:[command],dryRun:true}),'MODE_RESTRICTED');
  error(h.api.preview({commands:[command]}),'MODE_RESTRICTED');error(h.api.undo(),'MODE_RESTRICTED');
  expect(value(h.api.inspect()).sourceEditable).toBe(false);expect(value(h.api.preview({showFills:false})).svg).toContain('<svg');
  expect(JSON.stringify(h.state())).toBe(before);
  h.setMode('drawing');value(h.api.undo());h.setMode('recording');error(h.api.redo(),'MODE_RESTRICTED');
 });

 test('locks and partial-related selection failures identify impacted curves without changing the graph',()=>{
  const d=fixture();d.curves.find(c=>c.id==='lower')!.locked=true;const h=harness(d),original=structuredClone(d);
  error(h.api.execute({commands:[{op:'moveHandle',curveId:'upper',end:1,position:[-.2,.6]}]}),'CONSTRAINT_VIOLATION');
  expect(h.state().project.drawing).toEqual(original);
  const free=harness(),r=free.api.execute({commands:[{op:'transformCurves',curveIds:['upper'],matrix:[1,0,0,1,.1,.1]}]});
  expect(error(r,'CONSTRAINT_VIOLATION').relatedCurveIds).toEqual(['upper','lower']);
  value(free.api.execute({commands:[{op:'transformCurves',curveIds:['upper'],matrix:[1,0,0,1,.1,.1],allowRelated:true}]}));
  expect(()=>parseDrawing(free.state().project.drawing)).not.toThrow();
 });

 test('selection feedback validates all IDs first and only changes local selection',()=>{
  const h=harness(),revision=h.api.inspect().revision;
  value(h.api.select({curveIds:['upper','lower']}));expect(h.state().selection).toEqual(['upper','lower']);
  error(h.api.select({curveIds:['upper','missing']}),'NOT_FOUND');expect(h.state().selection).toEqual(['upper','lower']);
  expect(h.state().past).toHaveLength(0);expect(h.api.inspect().revision).toBe(revision);
 });

 test('geometry transforms transport display cuts independently and preserve IDs, topology, styles and recording',()=>{
  const d=fixture();d.displayIntervals=[{id:'track',anchor:{id:'upper',reverse:false},ranges:[{id:'range',start:.2,end:.65,mode:'SHOW'}]}];
  const h=harness(d),matrix:[number,number,number,number,number,number]=[1.3,0,0,.7,0,0];
  const manual=transportDeformedIntervals(d,transform(d,['upper','lower'],p=>[p[0]*1.3,p[1]*.7]));
  value(h.api.execute({commands:[{op:'transformCurves',curveIds:['upper','lower'],matrix}]}));
  expect(h.state().project.drawing.displayIntervals).toEqual(manual.displayIntervals);
  expect(h.state().project.drawing.layers).toEqual(d.layers);expect(h.state().project.drawing.joins).toEqual(d.joins);
  expect(h.state().project.drawing.displayIntervals![0].ranges[0].id).toBe('range');
 });

 test('quad fitting exposes its sampled error and keeps canonical curve IDs',()=>{
  let d=addLayer(emptyDrawing(),'Lid');d=createCurve(d,d.layers[0].id,aShape,.01,'Upper','upper');const h=harness(d);
  const r=value(h.api.execute({commands:[{op:'deformCurves',curveIds:['upper'],bounds:{min:[-1,-.1],max:[0,.4]},quad:[[-1,-.1],[.05,-.1],[.12,.4],[-.9,.4]]}]}));
  expect(r.approximations).toHaveLength(1);expect(r.approximations[0].sampledMaxError).toBeGreaterThanOrEqual(0);
  expect(h.state().project.drawing.curves.map(c=>c.id)).toEqual(['upper']);expect(()=>parseDrawing(h.state().project.drawing)).not.toThrow();
 });

 test('curved quad commands share Drawing evaluation, expose fit error and validate atomically',()=>{
  let d=addLayer(emptyDrawing(),'Lid');d=createCurve(d,d.layers[0].id,aShape,.01,'Upper','upper');const h=harness(d),bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.2;
  const bounds={min:[-1,-.1] as [number,number],max:[0,.4] as [number,number]},quad:Quad=[[-1,-.1],[.05,-.1],[.12,.4],[-.9,.4]],command:VectorCommand={op:'deformCurves',curveIds:['upper'],bounds,quad,bend};
  const expected=deformDrawing(d,['upper'],bounds,quad,false,bend),r=value(h.api.execute({commands:[command]}));
  expect(h.state().project.drawing).toEqual(expected.document);expect(r.approximations[0].sampledMaxError).toBe(expected.maxError);expect(h.state().commits).toBe(1);
  const saved=structuredClone(h.state()),invalid=neutralBend();invalid.handles[0][0][0]=9;
  error(h.api.execute({commands:[{...command,bend:invalid}]}),'INVALID_REQUEST');expect(h.state()).toEqual(saved);
  const folded=neutralBend();folded.handles[1][0][0]=folded.handles[1][1][0]=-2;
  error(h.api.execute({commands:[{...command,bend:folded}]}),'CONSTRAINT_VIOLATION');expect(h.state()).toEqual(saved);
 });

 test('centerline bounds evaluate cubic extrema rather than the control hull',()=>{
  expect(cubicBounds([[0,0],[0,1],[1,1],[1,0]])).toEqual({min:[0,0],max:[1,.75],center:[.5,.375]});
 });

 test('source export is deterministic and read-only; serialized source validates',()=>{
  const h=harness(),r=value(h.api.exportSource()),again=value(h.api.exportSource());expect(r.json).toBe(again.json);
  expect(parseDrawing(JSON.parse(r.json))).toEqual(h.state().project.drawing);r.document.nodes[0].position=[999,999];
  expect(h.state().project.drawing.nodes[0].position).toEqual([-1,0]);expect(h.state().commits).toBe(0);
 });

 test('SVG previews preserve the existing paint pipeline and are deterministic',()=>{
  const h=harness(),a=value(h.api.preview({width:300,height:200})),b=value(h.api.preview({width:300,height:200}));
  expect(a.svg).toBe(b.svg);expect(a.viewport).toEqual(b.viewport);expect(a.svg).toContain('drawing-paint-layer');expect(a.svg).toContain('drawing-ink');
  expect(a.svg).not.toContain('drawing-reference');expect(a.svg).not.toContain('drawing-selected');expect(h.state().commits).toBe(0);
 });

 test('reference image and canvas/client coordinates round-trip with clockwise screen rotation',()=>{
  const d=fixture();d.reference={name:'Reference',dataUrl:'data:image/png;base64,AAAA',width:1000,height:500,opacity:.5,visible:true,locked:true,offset:[.2,-.4],scale:2,rotation:90};
  const h=harness(d),meta=value(h.api.inspect()).reference!;expect(meta).not.toHaveProperty('dataUrl');expect(meta.pixelsIncluded).toBe(false);
  const ref=value(h.api.convertPoint({point:[600,250],from:'reference',to:'source'})).point;
  expect(ref[0]).toBeCloseTo(.2);expect(ref[1]).toBeCloseTo(-.92);
  const back=value(h.api.convertPoint({point:ref,from:'source',to:'reference'})).point;expect(back[0]).toBeCloseTo(600);expect(back[1]).toBeCloseTo(250);
  const client=value(h.api.convertPoint({point:ref,from:'source',to:'client'})).point;
  const back2=value(h.api.convertPoint({point:client,from:'client',to:'source'})).point;expect(back2[0]).toBeCloseTo(ref[0]);expect(back2[1]).toBeCloseTo(ref[1]);
  expect(value(h.api.exportSource()).document.reference).toBeUndefined();expect(value(h.api.exportSource({includeReference:true})).document.reference).toEqual(d.reference);
 });

 test('revision observes writes from outside this API',()=>{
  const h=harness(),rev=h.api.inspect().revision;h.replaceProject({...h.state().project,meta:{...h.state().project.meta,name:'External edit'}});
  error(h.api.execute({expectedRevision:rev,commands:[]}),'STALE_REVISION');
 });

 test('registration is explicit, reversible, and never replaces a newer registration on cleanup',()=>{
  const target:{contourAI?:ReturnType<typeof createVectorEditingApi>}={},h=harness();const cleanup=registerVectorEditingApi(target,h.api);
  expect(target.contourAI).toBe(h.api);target.contourAI=harness().api;cleanup();expect(target.contourAI).toBeDefined();
  const clear=registerVectorEditingApi({},h.api);expect(()=>clear()).not.toThrow();
 });

 test('default face can be queried, modified, previewed and undone without changing the canonical fixture',()=>{
  const url=new URL('../assets/base-face.json',import.meta.url),raw=readFileSync(url,'utf8'),p=JSON.parse(raw) as LandmarkProject;
  const h=harness(parseDrawing(p.drawing)),all=value(h.api.inspect()),nose=value(h.api.inspect({layerNames:['鼻部']}));
  expect(all.curves).toHaveLength(210);expect(nose.curves.length).toBeGreaterThan(0);
  const curveIds=nose.curves.map(c=>c.id),commands:VectorCommand[]=[{op:'transformCurves',curveIds,matrix:[1,0,0,1,.01,0]}],before=geometry(h.state().project.drawing);
  const dry=value(h.api.execute({commands,dryRun:true}));expect(dry.applied).toBe(false);expect(h.state().commits).toBe(0);
  expect(value(h.api.preview({commands,width:400,height:400,showFills:false})).svg).toContain('drawing-ink');
  value(h.api.execute({commands}));expect(h.state().project.drawing.curves.map(c=>c.id)).toEqual(all.curves.map(c=>c.id));
  expect(()=>parseDrawing(JSON.parse(value(h.api.exportSource()).json))).not.toThrow();
  value(h.api.undo());expect(geometry(h.state().project.drawing)).toEqual(before);expect(readFileSync(url,'utf8')).toBe(raw);
 });
});


test('default adapter commits through root store as one undo and respects root Recording capability',()=>{
 const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  useWorkspaceMode.getState().setMode('drawing');const drawing=fixture();
  useEditor.setState({project:{...createEmptyProject(),drawing},past:[],future:[]});
  const api=createVectorEditingApi(),r=api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'Root edit'},{op:'setCurveWidth',curveIds:['upper'],width:.02}]});
  value(r);expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.drawing!.curves[0].name).toBe('Root edit');
  useWorkspaceMode.getState().setMode('recording');const before=useEditor.getState().project;
  error(api.execute({commands:[{op:'renameCurve',curveId:'upper',name:'Forbidden'}]}),'MODE_RESTRICTED');
  expect(()=>useEditor.getState().setDrawing(drawing)).toThrow();expect(useEditor.getState().project).toBe(before);expect(useEditor.getState().past).toHaveLength(1);
  error(api.undo(),'MODE_RESTRICTED');expect(useEditor.getState().project).toBe(before);
  useWorkspaceMode.getState().setMode('drawing');value(api.undo());expect(useEditor.getState().project.drawing).toEqual(drawing);
  value(api.redo());expect(useEditor.getState().project.drawing!.curves[0].name).toBe('Root edit');
 }finally{
  vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.unstubAllGlobals();vi.useRealTimers();
 }
});

test('mist-fill previews report the browser requirement rather than silently substituting an image',()=>{
 const p=JSON.parse(readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8')) as LandmarkProject,h=harness(parseDrawing(p.drawing));
 const before=JSON.stringify(h.state());error(h.api.preview({showFills:true}),'BROWSER_REQUIRED');expect(JSON.stringify(h.state())).toBe(before);
});

test('inspection names control roles and edit results expose before/after without relying on ambiguous UI labels',()=>{
 const h=harness(),inspection=value(h.api.inspect({curveIds:['upper']})),c=inspection.curves[0];
 expect(c.controls.map(c=>[c.targetKind,c.role])).toEqual([['node','P0'],['handle','H0'],['handle','H1'],['node','P1']]);
 expect(c.controls[0]).toMatchObject({nodeId:c.nodes[0],curveId:'upper'});expect(c.controls[1]).toMatchObject({end:0,curveId:'upper'});
 expect(inspection.displayIntervalCoordinates.unit).toContain('not Bezier t');
 const r=value(h.api.execute({commands:[{op:'moveHandle',curveId:'upper',end:0,position:[-.6,.45]}]})),delta=r.beforeAfter.find(x=>x.curveId==='upper')!;
 expect(delta.before.shape).toEqual(aShape);expect(delta.after.shape[1]).toEqual([-.6,.45]);expect(delta.layerId).toBe(c.layerId);
 delta.after.shape[1][0]=123;expect(h.state().project.drawing.curves[0].handles[0][0]).toBe(-.6);
});

test('AI annotations are explicit, selection-scoped, transient and excluded from normal previews and source export',()=>{
 const h=harness(),before=JSON.stringify(h.state()),clean=value(h.api.preview()),guide=value(h.api.preview({annotations:{curveIds:['upper'],grid:true,labels:true,handles:true}}));
 expect(clean.annotated).toBe(false);expect(clean.svg).not.toContain('ai-guide-overlay');
 expect(guide.annotated).toBe(true);expect(guide.svg).toContain('ai-guide-overlay');expect(guide.svg).toContain('ai-coordinate-grid');
 expect(guide.svg).toContain('data-ai-control="P0"');expect(guide.svg).toContain('data-ai-control="H0"');expect(guide.svg).toContain('data-ai-control="H1"');expect(guide.svg).toContain('data-ai-control="P1"');
 expect(guide.svg).toContain('data-ai-curve-id="upper"');expect(guide.svg).not.toContain('data-ai-curve-id="lower"');
 expect(value(h.api.preview({annotations:{curveIds:['upper'],grid:true,labels:true,handles:true}})).svg).toBe(guide.svg);
 expect(value(h.api.preview()).svg).toBe(clean.svg);expect(value(h.api.exportSource()).json).not.toContain('annotations');
 expect(JSON.stringify(h.state())).toBe(before);
 error(h.api.preview({annotations:{curveIds:['missing']}}),'NOT_FOUND');
 const large=Array.from({length:33},(_,i)=>`id${i}`);error(h.api.preview({annotations:{curveIds:large}}),'INVALID_REQUEST');
});

test('interval inspection resolves material cut locations to explicit source pieces rather than treating percentages as cubic t',()=>{
 const d=fixture();d.displayIntervals=[{id:'track',anchor:{id:'upper',reverse:true},ranges:[{id:'range',start:.2,end:.7,mode:'SHOW'}]}];
 const inspected=value(harness(d).api.inspect({curveIds:['upper']})),locations=inspected.displayIntervalLocations[0];
 expect(locations.trackId).toBe('track');expect(locations.approximation).toContain('arc-length');
 for(const end of locations.ranges[0].ends){expect(end.source.kind).toBe('curve');if(end.source.kind==='curve'){expect(['upper','lower']).toContain(end.source.curveId);expect(end.source.t).toBeGreaterThanOrEqual(0);expect(end.source.t).toBeLessThanOrEqual(1);}expect(end.position.every(Number.isFinite)).toBe(true);}
});
