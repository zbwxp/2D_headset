import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {snapWorkspacePoint} from '../app/workspaceViewSnap';
import {createEmptyProject} from '../app/emptyProject';
import {emptyWorkspaceView,getWorkspaceView,replaceWorkspaceView,type WorkspaceView} from '../app/workspaceView';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
function harness(){let drawing=addLayer(emptyDrawing(),'Source');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,0],[.6,0],[1,0]],.01);const project={...createEmptyProject(),...saveDrawingSnapshot({drawing},'Reference')},source=JSON.stringify(project);let view:WorkspaceView=emptyWorkspaceView(),replacements=0,mode:'drawing'|'recording'='drawing';const api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=>mode,commitDrawing(){throw Error('must not write source');},undo(){throw Error('no history');},redo(){},getView:()=>view,replaceView(next){view=next;replacements++;}});return {api,project,source,view:()=>view,replacements:()=>replacements,mode:(m:typeof mode)=>{mode=m;}};}

test('transient reference/guide commands work in either mode without changing source, history or revision',()=>{
 const h=harness(),revision=h.api.inspect().revision,id=h.project.drawingSnapshots!.activeId!;h.mode('recording');const result=h.api.view({commands:[{op:'setReference',artworkId:id,placement:'left',opacity:.4},{op:'addGuide',id:'axis',axis:'x',value:.2},{op:'setGuideOptions',rulers:true,snapping:false}]});expect(result.ok).toBe(true);expect(result).not.toHaveProperty('revision');expect(h.view().reference).toMatchObject({artworkId:id,offset:[-1.2,0],opacity:.4});expect(h.view().guides).toEqual([{id:'axis',axis:'x',value:.2}]);expect(h.view().rulersVisible).toBe(true);expect(h.replacements()).toBe(1);expect(h.api.inspect().revision).toBe(revision);expect(JSON.stringify(h.project)).toBe(h.source);
 const inspected=h.api.inspectView();if(!inspected.ok)throw Error(inspected.error.message);inspected.value.view.guides.length=0;expect(h.view().guides).toHaveLength(1);h.mode('drawing');expect(h.api.view({commands:[{op:'changeGuide',id:'axis',value:.3}]}).ok).toBe(true);
});

test('view dry-run and a late invalid command cause no partial application',()=>{
 const h=harness(),before=h.view(),revision=h.api.inspect().revision;const dry=h.api.view({commands:[{op:'addGuide',id:'draft',axis:'y',value:1}],dryRun:true});expect(dry.ok).toBe(true);expect(h.view()).toBe(before);expect(h.replacements()).toBe(0);
 expect(h.api.view({commands:[{op:'addGuide',id:'draft',axis:'y',value:1},{op:'setReference',artworkId:'missing'}]})).toMatchObject({ok:false,error:{code:'VIEW_INVALID',commandIndex:1}});expect(h.view()).toBe(before);expect(h.api.inspect().revision).toBe(revision);
 expect(h.api.view({commands:[],expectedRevision:revision} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(h.api.view({commands:[],dryRun:'true'} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(h.api.inspectView({anything:true} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
});

test('reference clear, explicit guide IDs and reset affect transient state only',()=>{
 const h=harness(),id=h.project.drawingSnapshots!.activeId!;expect(h.api.view({commands:[{op:'setReference',artworkId:id},{op:'addGuide',id:'__proto__',axis:'x',value:0}]}).ok).toBe(true);expect(h.api.view({commands:[{op:'setReference',artworkId:null},{op:'deleteGuides',ids:['__proto__']}]}).ok).toBe(true);expect(h.view().reference).toBeUndefined();expect(h.view().guides).toEqual([]);expect(h.api.view({commands:[{op:'resetView'}]}).ok).toBe(true);expect(h.view()).toEqual(emptyWorkspaceView());expect(JSON.stringify(h.project)).toBe(h.source);
});

test('default adapter writes the transient Zustand store and never adds project revision/history',()=>{
 const previous=getWorkspaceView();try{replaceWorkspaceView(emptyWorkspaceView());const api=createVectorEditingApi(),revision=api.inspect().revision;expect(api.view({commands:[{op:'addGuide',id:'api-test',axis:'y',value:.25}]}).ok).toBe(true);expect(getWorkspaceView().guides[0]).toEqual({id:'api-test',axis:'y',value:.25});expect(api.inspect().revision).toBe(revision);}finally{replaceWorkspaceView(previous);}
});

const guide=readFileSync(new URL('../../docs/vector-workspace-view-api.md',import.meta.url),'utf8'),examples=[...guide.matchAll(/<!-- view-tested: ([a-z-]+) -->\s*```json\s*([\s\S]*?)```/g)].map(m=>({name:m[1],request:JSON.parse(m[2])}));
test('view guide declares three executable examples',()=>expect(examples.map(e=>e.name)).toEqual(['inspect','guides','reference']));
for(const e of examples)test(`view guide ${e.name} runs through the actual view facade`,()=>{const h=harness(),before=h.view(),replace=(v:unknown):unknown=>v==='REFERENCE_ARTWORK_ID'?h.project.drawingSnapshots!.activeId:Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v,r=replace(e.request) as {method:string;request:any};const result=r.method==='view'?h.api.view(r.request):h.api.inspectView(r.request);expect(result.ok,JSON.stringify(result)).toBe(true);expect(h.view()).toBe(before);expect(JSON.stringify(h.project)).toBe(h.source);});


test('snapView uses the shared pointer helper and returns a detached read-only candidate',()=>{
 const h=harness(),id=h.project.drawingSnapshots!.activeId!;h.api.view({commands:[{op:'addGuide',id:'x',axis:'x',value:.4},{op:'setReference',artworkId:id,offset:[0,.5],scale:2,snap:true}]});const before=h.view(),revision=h.api.inspect().revision,request={point:[.402,.501] as [number,number],unitsPerPixel:.005,thresholdPx:8};
 const expected=snapWorkspacePoint(h.project.drawing!,h.project.drawingSnapshots,before,request.point,request.unitsPerPixel,request.thresholdPx),result=h.api.snapView(request);expect(result.ok).toBe(true);if(!result.ok)throw Error(result.error.message);expect(result.value.candidate).toEqual(expected);expect(result).not.toHaveProperty('revision');if(result.value.candidate)result.value.candidate.point[0]=999;expect(h.view()).toBe(before);expect(h.api.inspect().revision).toBe(revision);expect(JSON.stringify(h.project)).toBe(h.source);
});

test('snapView honors disabled view state and strictly validates query inputs without applying geometry',()=>{
 const h=harness();h.api.view({commands:[{op:'addGuide',id:'x',axis:'x',value:0},{op:'setGuideOptions',snapping:false}]});expect(h.api.snapView({point:[0,0],unitsPerPixel:.01})).toMatchObject({ok:true,value:{candidate:null}});
 for(const request of [{point:[0,0],unitsPerPixel:0},{point:[NaN,0],unitsPerPixel:.01},{point:[0,0],unitsPerPixel:.01,excludeCurveIds:['missing']},{point:[0,0],unitsPerPixel:.01,expectedRevision:'not-applicable'},{point:[0,0],unitsPerPixel:.01,targetSpace:'pose'}])expect(h.api.snapView(request as never).ok).toBe(false);expect(JSON.stringify(h.project)).toBe(h.source);
});
