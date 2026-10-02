import {expect,test} from 'vitest';
import {addLayer,createCurve,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Cubic} from '../domain/drawing/model';
import {createWarpGrid,type WarpGrid} from '../domain/vectorWarp/model';
import {mapPoint} from '../domain/vectorWarp/evaluation';
import {emptyRecordingScene,instanceObjectId,layerTrackIds,intervalTrackLayer,type RecordingScene,type SceneWarp,type SceneKey} from '../domain/recordingScene/model';
import {evaluateScene,sceneWarpChain} from '../domain/recordingScene/evaluation';
import {evaluateWarpTrack,evaluateVisibilityTrack} from '../domain/recordingScene/tracks';

const shape:Cubic=[[0,0],[.2,.1],[.8,.1],[1,0]];
function fixture(){let d=addLayer(emptyDrawing(),'First');const a=d.layers[0].id;d=createCurve(d,a,shape,.01,'Line','a:/%');d=addLayer(d,'Second');const b=d.layers[0].id;d=createCurve(d,b,shape,.01,'Line B','b:/%');return {d,a,b};}
const rest=()=>createWarpGrid({min:[-1,-1],max:[2,2]},2,2);
const affine=(g:WarpGrid,sx=1,sy=1,x=0,y=0):WarpGrid=>({...g,nodes:g.nodes.map(n=>({position:[n.position[0]*sx+x,n.position[1]*sy+y],handleU:[n.handleU[0]*sx+x,n.handleU[1]*sy+y],handleV:[n.handleV[0]*sx+x,n.handleV[1]*sy+y],twist:[n.twist[0]*sx,n.twist[1]*sy]}))});
const key=<T>(id:string,x:number,value:T,y=0):SceneKey<T>=>({id,angle:{x,y},value});
const warp=(id:string,keys:SceneKey<WarpGrid>[]=[],parentId?:string):SceneWarp=>({id,name:id,restGrid:rest(),keys,...(parentId?{parentId}:{})});
const sceneFor=(d:DrawingDocument):RecordingScene=>({...emptyRecordingScene('scene'),instances:[{id:'one',artworkId:'art',name:'One'}],bindings:[],warps:[],visibilityTracks:[],intervalTracks:[]});

test('a two-key Warp is independent of another object’s ten-key angle coordinates',()=>{
 const {d,a,b}=fixture(),g=rest(),A=warp('A',[key('a0',0,g),key('a90',90,affine(g,1,1,.9))]),B=warp('B',Array.from({length:10},(_,i)=>key('b'+i,i*10,affine(g,1,1,Math.sin(i))))),scene={...sceneFor(d),warps:[A,B],bindings:[{instanceId:'one',sourceLayerId:a,warpId:'A'},{instanceId:'one',sourceLayerId:b,warpId:'B'}]},snapshot=JSON.stringify([scene,d]);
 const only={...scene,warps:[A],bindings:scene.bindings.slice(0,1)};
 for(const x of [1,15,29.5,45,71.3,89]){const full=evaluateScene(scene,()=>d,{angle:{x,y:0},diagnostics:'preview'}),isolated=evaluateScene(only,()=>d,{angle:{x,y:0},diagnostics:'preview'}),id=instanceObjectId('one','a:/%');expect(shapeOf(full.drawing,id)).toEqual(shapeOf(isolated.drawing,id));expect(shapeOf(full.drawing,id)[0][0]).toBeCloseTo(x/100,12);}
 expect(JSON.stringify([scene,d])).toBe(snapshot);
});

test('one shared leaf serves cross-layer and cross-instance objects and composes its parent once',()=>{
 let {d,a,b}=fixture();d=linkEndpoints(d,{curveId:'a:/%',end:0},{curveId:'b:/%',end:0});const g=rest(),parent=warp('parent',[key('p',0,affine(g,2,2))]),child=warp('child',[key('c',0,affine(g,1,1,.2,.1))],'parent');
 const scene={...sceneFor(d),instances:[{id:'one',artworkId:'art',name:'One'},{id:'two:/%',artworkId:'art',name:'Two'}],warps:[parent,child],bindings:['one','two:/%'].flatMap(instanceId=>[a,b].map(sourceLayerId=>({instanceId,sourceLayerId,warpId:'child'})))};
 const result=evaluateScene(scene,()=>d,{diagnostics:'preview'});expect(result.conflictingNodeIds).toEqual([]);expect(result.drawing.curves).toHaveLength(4);
 for(const instanceId of ['one','two:/%'])for(const id of ['a:/%','b:/%'])expect(shapeOf(result.drawing,instanceObjectId(instanceId,id))[0]).toEqual(expect.arrayContaining([expect.closeTo(.4,12),expect.closeTo(.2,12)]));
 expect(new Set(result.drawing.nodes.map(n=>n.id)).size).toBe(d.nodes.length*2);expect(sceneWarpChain(scene,{instanceId:'one',sourceLayerId:a})).toEqual(['child','parent']);
 const local=evaluateScene(scene,()=>d,{stopAtWarpId:'child',diagnostics:'preview'});expect(shapeOf(local.drawing,instanceObjectId('one','a:/%'))[0][0]).toBeCloseTo(.2,12);
});

test('new sparse two-dimensional tracks use their own neutral and explicit corrections',()=>{
 const g=rest(),w=warp('xy',[key('x',90,affine(g,1,1,.9)),key('y',0,affine(g,1,1,0,.6),90)]);
 expect(mapPoint(evaluateWarpTrack(w,{x:45,y:45}),[0,0])).toEqual([expect.closeTo(.45,12),expect.closeTo(.3,12)]);
 w.keys.push(key('correct',45,affine(g,1,1,.8,.2),45));expect(mapPoint(evaluateWarpTrack(w,{x:45,y:45}),[0,0])).toEqual([expect.closeTo(.8,12),expect.closeTo(.2,12)]);
 expect(mapPoint(evaluateWarpTrack(w,{x:-90,y:0}),[0,0])).toEqual([0,0]);
});

test('drafts affect only their object and angle; angle sampling does not author any key',()=>{
 const g=rest(),w={...warp('w',[key('0',0,g),key('90',90,affine(g,1,1,.9))]),draft:{angle:{x:30,y:0},value:affine(g,1,1,.8)}},before=JSON.stringify(w);
 expect(mapPoint(evaluateWarpTrack(w,{x:30,y:0}),[0,0])[0]).toBeCloseTo(.8);expect(mapPoint(evaluateWarpTrack(w,{x:30,y:0},false),[0,0])[0]).toBeCloseTo(.3);expect(mapPoint(evaluateWarpTrack(w,{x:15,y:0}),[0,0])[0]).toBeCloseTo(.15);expect(JSON.stringify(w)).toBe(before);
 const visibility={id:'visible',target:{instanceId:'one',sourceLayerId:'layer'},keys:[key('0',0,true),key('90',90,null)]};expect(evaluateVisibilityTrack(visibility,{x:90,y:0})).toBeNull();
});

test('all instances resolve latest source; opening a layer preserves hidden source members',()=>{
 const f=fixture();let d=f.d;d={...d,curves:d.curves.map(c=>c.id==='b:/%'?{...c,visible:false,inkVisible:false}:c)};
 const scene={...sceneFor(d),instances:[{id:'one',artworkId:'art',name:'One'},{id:'two',artworkId:'art',name:'Two'}],visibilityTracks:[{id:'show',target:{instanceId:'one',sourceLayerId:f.b},keys:[key('v',0,true)]}]};
 const old=evaluateScene(scene,()=>d,{diagnostics:'preview'});expect(old.drawing.curves.find(c=>c.id===instanceObjectId('one','b:/%'))).toMatchObject({visible:false,inkVisible:false});
 d={...d,curves:d.curves.map(c=>c.id==='a:/%'?{...c,handles:[[.4,.7],[.8,.1]]}:c)};const before=JSON.stringify([d,scene]),latest=evaluateScene(scene,()=>d,{diagnostics:'preview'});
 for(const id of ['one','two'])expect(shapeOf(latest.drawing,instanceObjectId(id,'a:/%'))).toEqual(shapeOf(d,'a:/%'));
 expect(JSON.stringify([d,scene])).toBe(before);expect(latest.drawing.curves[0]).not.toBe(d.curves[0]);
});

test('layer inheritance, container gates and explicit member overrides have distinct priorities',()=>{
 const {d,b}=fixture(),source={...d,curves:d.curves.map(c=>c.id==='b:/%'?{...c,visible:false}:c)};
 const visible=(layer:boolean|null,member?:boolean)=>{const scene={...sceneFor(source),visibilityTracks:[{id:'layer',target:{instanceId:'one',sourceLayerId:b},keys:[key('k',0,layer)]},...(member===undefined?[]:[{id:'member',target:{instanceId:'one',sourceLayerId:b,sourceObjectId:'b:/%'},keys:[key('k',0,member)]}])]};return evaluateScene(scene,()=>source,{diagnostics:'preview'}).drawing.curves.find(c=>c.id===instanceObjectId('one','b:/%'))!.visible;};
 expect(visible(null)).toBe(false);expect(visible(true)).toBe(false);expect(visible(true,false)).toBe(false);expect(visible(false,true)).toBe(false);expect(visible(null,true)).toBe(true);expect(visible(true,true)).toBe(true);
});

test('missing sources and channels remain local diagnostics without deleting static instances',()=>{
 const {d}=fixture(),scene={...sceneFor(d),instances:[...sceneFor(d).instances,{id:'lost',artworkId:'missing',name:'Lost'}],intervalTracks:[{id:'interval',instanceId:'one',sourceTrackId:'missing-track',keys:[]}]},before=JSON.stringify(scene);
 const result=evaluateScene(scene,id=>id==='art'?d:undefined,{diagnostics:'preview'});expect(result.drawing.curves).toHaveLength(2);expect(result.diagnostics.map(d=>d.code)).toEqual(expect.arrayContaining(['MISSING_SOURCE','MISSING_INTERVAL']));expect(JSON.stringify(scene)).toBe(before);
});

test('interval channel ownership follows the real layer→group→stroke→curve UI hierarchy once',()=>{
 const {d,a}=fixture(),source={...d,groups:[{id:'group',name:'Group',visible:true,locked:false,curveIds:['a:/%']}],curves:d.curves.map(c=>c.id==='a:/%'?{...c,strokeName:'Stroke in group'}:c),displayIntervals:[{id:'sourceTrack',anchor:{id:'a:/%',reverse:false},ranges:[{id:'range',start:0,end:1}]}]},track={id:'interval',instanceId:'one',sourceTrackId:'sourceTrack',keys:[]},scene={...sceneFor(source),intervalTracks:[track]};
 expect(intervalTrackLayer(track,()=>source,scene)).toEqual({instanceId:'one',sourceLayerId:a});expect(layerTrackIds(scene,{instanceId:'one',sourceLayerId:a},()=>source)).toEqual(['interval']);
});
