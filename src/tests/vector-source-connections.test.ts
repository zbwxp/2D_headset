import {expect,test} from 'vitest';
import {createVectorEditingApi,type VectorCommand,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,nodeAt,parseDrawing,shapeOf,type DrawingDocument,type Cubic} from '../domain/drawing/model';
import {strokes} from '../domain/drawing/strokes';
import {fillGeometry} from '../domain/drawing/appearance';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import type {LandmarkProject} from '../domain/landmarks/model';

function harness(d=emptyDrawing()){
 let project:LandmarkProject={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[],mode:'drawing'|'recording'='drawing',commits=0;
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(drawing){past.push(project);future=[];project={...project,drawing};commits++;},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}});
 return {api,state:()=>({project,past,commits}),mode:(value:typeof mode)=>{mode=value;}};
}
const value=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const fail=(r:VectorResult<unknown>,code:string)=>expect(r).toMatchObject({ok:false,error:{code}});

/** Testable recipe: two real three-node closed pieces, before coverage/route authoring. */
export function closedFaceRecipe():VectorCommand[]{
 const cap:Cubic=[[0,1],[-.6,1],[-.8,.6],[-.7,0]],jaw:Cubic=[[-.7,0],[-.7,-.3],[-.3,-.8],[0,-.9]],closure:Cubic=[[0,-.9],[.2,-.5],[.2,.6],[0,1]];
 return ['right','left'].flatMap((side,index):VectorCommand[]=>[
  {op:'createLayer',name:side,ref:side},
  ...[cap,jaw,closure].map((shape,i)=>({op:'createCurve' as const,layerId:`$${side}`,shape:shape.map(([x,y])=>[index?-x:x,y]) as Cubic,width:.008,name:`${side} ${['cap','jaw','closure'][i]}`,ref:`${side}${i}`})),
  {op:'connectGeometry',a:{curveId:`$${side}0`,end:1},b:{curveId:`$${side}1`,end:0}},
  {op:'connectGeometry',a:{curveId:`$${side}1`,end:1},b:{curveId:`$${side}2`,end:0}},
  {op:'connectGeometry',a:{curveId:`$${side}2`,end:1},b:{curveId:`$${side}0`,end:0}},
  {op:'createFill',curveIds:[`$${side}0`,`$${side}1`,`$${side}2`],color:'white',ref:`${side}Fill`},
 ]);
}

test('one JSON batch constructs two truly closed three-curve white-filled pieces with independent layer nodes',()=>{
 const h=harness(),before=h.state().project,commands=closedFaceRecipe(),revision=h.api.inspect().revision;
 const dry=value(h.api.execute({commands,dryRun:true,expectedRevision:revision}));expect(dry.applied).toBe(false);expect(h.state().project).toBe(before);
 const r=value(h.api.execute({commands,expectedRevision:revision})),d=h.state().project.drawing!;expect(d.layers).toHaveLength(2);expect(d.curves).toHaveLength(6);expect(d.nodes).toHaveLength(6);expect(d.fills).toHaveLength(2);expect(d.joins).toEqual([]);expect(d.endpointLinks??[]).toEqual([]);
 for(const l of d.layers){expect(strokes(d,l.id)).toHaveLength(1);expect(strokes(d,l.id)[0].closed).toBe(true);expect(fillGeometry(d,d.fills.find(f=>l.items.includes(f.id))!).error).toBeUndefined();}
 const ids=Object.fromEntries(r.created.filter(c=>c.ref).map(c=>[c.ref!,c.id]));
 for(let i=0;i<3;i++)expect(shapeOf(d,ids[`left${i}`])).toEqual(shapeOf(d,ids[`right${i}`]).map(([x,y])=>[-x,y]));
 expect(nodeAt(d,{curveId:ids.right1,end:1}).id).not.toBe(nodeAt(d,{curveId:ids.left1,end:1}).id);expect(parseDrawing(d)).toEqual(d);expect(h.state().commits).toBe(1);
 value(h.api.undo());expect(h.state().project).toBe(before);value(h.api.redo());expect(h.state().project.drawing).toBe(d);
});

test('geometry merges and position link/unlink preserve authored brushes and normal node/layer ownership',()=>{
 let d=addLayer(emptyDrawing(),'A');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'A','a');d=createCurve(d,layer,[[.6,0],[.8,.1],[1,.1],[1.2,0]],.01,'B','b');d=addLayer(d,'B');d=createCurve(d,d.layers[0].id,[[1.5,0],[1.7,0],[1.9,0],[2.1,0]],.01,'C','c');d.curves.forEach(c=>{c.inkEnds=[{taper:.12,extension:.01},{taperWidthScale:7,extension:.03}];});const brushes=d.curves.map(c=>c.inkEnds),h=harness(d);
 value(h.api.execute({commands:[{op:'connectGeometry',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}]}));let current=h.state().project.drawing!;expect(nodeAt(current,{curveId:'a',end:1}).id).toBe(nodeAt(current,{curveId:'b',end:0}).id);expect(current.curves.map(c=>c.inkEnds)).toEqual(brushes);
 const count=current.nodes.length,link=value(h.api.execute({commands:[{op:'linkEndpoints',a:{curveId:'b',end:1},b:{curveId:'c',end:0},ref:'link'}]})),id=link.created[0].id;current=h.state().project.drawing!;expect(current.nodes).toHaveLength(count);expect(nodeAt(current,{curveId:'b',end:1}).id).not.toBe(nodeAt(current,{curveId:'c',end:0}).id);expect(nodeAt(current,{curveId:'b',end:1}).position).toEqual(nodeAt(current,{curveId:'c',end:0}).position);expect(current.curves.map(c=>c.inkEnds)).toEqual(brushes);const nodes=structuredClone(current.nodes),layers=structuredClone(current.layers);
 value(h.api.execute({commands:[{op:'unlinkEndpoints',linkId:id}]}));current=h.state().project.drawing!;expect(current.curves.map(c=>c.inkEnds)).toEqual(brushes);expect(current.nodes).toEqual(nodes);expect(current.layers).toEqual(layers);
 const legacy=linkEndpoints(d,{curveId:'a',end:1},{curveId:'c',end:0});expect(legacy.curves.find(c=>c.id==='a')!.inkEnds![1]).toEqual({taper:0,extension:0});
});

test('connection guards reject implicit style changes, cross-layer merges, locked dependencies and stale writes atomically',()=>{
 let d=addLayer(emptyDrawing(),'A');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'A','a');d=createCurve(d,layer,[[.6,0],[.8,0],[1,0],[1.2,0]],.02,'B','b');d=addLayer(d,'B');d=createCurve(d,d.layers[0].id,[[2,0],[2.2,0],[2.4,0],[2.6,0]],.01,'C','c');d.curves.find(c=>c.id==='c')!.locked=true;const h=harness(d),before=h.state().project,revision=h.api.inspect().revision;
 fail(h.api.execute({commands:[{op:'createLayer',name:'Temporary'},{op:'connectGeometry',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}]}),'STYLE_CONFLICT');expect(h.state().project).toBe(before);
 fail(h.api.execute({commands:[{op:'connectGeometry',a:{curveId:'a',end:1},b:{curveId:'c',end:0}}]}),'INVALID_REQUEST');fail(h.api.execute({commands:[{op:'linkEndpoints',a:{curveId:'a',end:1},b:{curveId:'c',end:0}}]}),'CONSTRAINT_VIOLATION');expect(h.state().commits).toBe(0);
 h.mode('recording');fail(h.api.execute({commands:[{op:'linkEndpoints',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}]}),'MODE_RESTRICTED');h.mode('drawing');value(h.api.execute({commands:[{op:'renameCurve',curveId:'a',name:'Changed'}]}));fail(h.api.execute({commands:[{op:'connectGeometry',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}],expectedRevision:revision}),'STALE_REVISION');
});

test('zero-displacement shared-node merge cannot clean position links to a locked third-party curve',()=>{
 let d=addLayer(emptyDrawing(),'Local');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'A','a');d=createCurve(d,layer,[[0,0],[0,.2],[0,.4],[0,.6]],.01,'B','b');d=addLayer(d,'Other');d=createCurve(d,d.layers[0].id,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.01,'F','f');
 d=linkEndpoints(d,{curveId:'a',end:0},{curveId:'f',end:0},true);d=linkEndpoints(d,{curveId:'b',end:0},{curveId:'f',end:0},true);d.curves.find(c=>c.id==='f')!.locked=true;
 const before=structuredClone(d),h=harness(d);fail(h.api.execute({commands:[{op:'connectGeometry',a:{curveId:'a',end:0},b:{curveId:'b',end:0}}]}),'CONSTRAINT_VIOLATION');expect(h.state().commits).toBe(0);expect(h.state().project.drawing).toEqual(before);expect(d.endpointLinks).toHaveLength(2);
});

test('a geometry merge refuses to reinterpret existing whole-stroke interval material coordinates',()=>{
 let d=addLayer(emptyDrawing(),'Lines');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[1/3,0],[2/3,0],[1,0]],.01,'A','a');d=createCurve(d,layer,[[1,0],[4/3,0],[5/3,0],[2,0]],.01,'B','b');d=addDisplayInterval(d,'a','HIDE');d.displayIntervals![0].ranges[0]={...d.displayIntervals![0].ranges[0],start:.2,end:.4};const before=structuredClone(d),h=harness(d);
 fail(h.api.execute({commands:[{op:'connectGeometry',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}]}),'INTERVAL_TOPOLOGY_CONFLICT');expect(h.state().commits).toBe(0);expect(h.state().project.drawing).toEqual(before);
});
