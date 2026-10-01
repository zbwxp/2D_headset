import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {restoreSnapshotLayer as restore} from '../domain/drawing/snapshotLayers';
import {saveDrawingSnapshot as save} from '../domain/drawing/snapshots';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument as Doc} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {createGroup} from '../domain/drawing/groups';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {serializeProject} from '../app/autosave';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {emptyPoseRecording,recordSnapshot} from '../domain/recording/poses';

function fixture(){
 let d=c.addLayer(emptyDrawing(),'Hair');const layer=d.layers[0].id,e=c.ellipse(d,layer,[-.5,-.4],[.5,.4],.02);
 d=p.createFill(e.document,e.ids,'black');d=p.createOffset(d,e.ids[0]);d=addDisplayInterval(d,e.ids[0]);d=c.createCurve(d,layer,[[0,.6],[.2,.7],[.4,.7],[.6,.6]],.02,'Detail','detail');d=createGroup(d,[...e.ids,'detail'],'Hair group');
 d.curves[0]={...d.curves[0],visible:false,inkEnds:[{taper:.12,extension:.04},{}],depthOffset:-1,depthScope:'LAYER',mist:{mode:'INK_EDGE',enabled:true,width:.005,density:.5}};
 d.displayIntervals![0].ranges[0].inkEnds=[{taper:.02},{taperWidthScale:4}];
 d=c.addLayer(d,'Face');const face=d.layers[0].id;d=c.createCurve(d,face,[[0,0],[.3,0],[.6,0],[1,0]],.02,'Face','face');
 d.reference={name:'Reference',dataUrl:'data:image/png;base64,AAAA',width:100,height:100,offset:[1,2],scale:2,rotation:0,opacity:.4,visible:true,locked:true};
 return {d,layer,face,ids:e.ids};
}
function content(d:Doc,id:string){const l=d.layers.find(l=>l.id===id)!,items=new Set(l.items),nodes=new Set(d.curves.filter(c=>items.has(c.id)).flatMap(c=>c.nodes));return {layer:l,curves:d.curves.filter(c=>items.has(c.id)),nodes:d.nodes.filter(n=>nodes.has(n.id)),fills:d.fills.filter(f=>items.has(f.id)),offsets:d.offsets.filter(o=>items.has(o.id)),joins:d.joins.filter(j=>items.has(j.a.curveId)),groups:d.groups?.filter(g=>g.curveIds.some(id=>items.has(id))),intervals:d.displayIntervals?.filter(t=>items.has(t.anchor.id))};}

test('restores a whole layer including hidden geometry, relations, styles and removed objects; preserves other layers and reference',()=>{
 const {d:source,layer,face,ids}=fixture(),sourceCopy=structuredClone(source);
 let working=c.deleteCurves(source,[ids[0]]);working=c.createCurve(working,layer,[[0,0],[.2,.1],[.4,.1],[.6,0]],.03,'New hair','new');
 working=c.moveNode(working,working.curves.find(c=>c.id==='face')!.nodes[0],[.2,.3]);
 working={...working,mirrorAxisX:.4,reference:{...working.reference!,offset:[8,9]},layers:[...working.layers].reverse().map(l=>l.id===layer?{...l,name:'Side hair'}:l)};
 const before=structuredClone(working),result=restore(working,source,layer),n=result.document;
 expect(content(n,layer)).toEqual(content(source,layer));expect(content(n,face)).toEqual(content(working,face));
 expect(n.layers.map(l=>l.id)).toEqual(working.layers.map(l=>l.id));expect(n.reference).toBe(working.reference);expect(n.mirrorAxisX).toBe(.4);
 expect(n.curves.some(c=>c.id==='new')).toBe(false);expect(parseDrawing(n)).toEqual(n);expect(result.detachedLinks).toBe(0);
 expect(working).toEqual(before);expect(source).toEqual(sourceCopy);n.nodes.find(n=>n.id===source.curves[0].nodes[0])!.position[0]=88;expect(source).toEqual(sourceCopy);
});

test('cross-layer links retain compatible positions and detach incompatible ones without moving outside geometry',()=>{
 let d=c.addLayer(emptyDrawing(),'A');const a=d.layers[0].id;d=c.createCurve(d,a,[[0,0],[.2,0],[.4,0],[.6,0]],.02,'A','a');
 d=c.addLayer(d,'B');const b=d.layers[0].id;d=c.createCurve(d,b,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.02,'B','b');
 d.endpointLinks=[{id:'link',a:{curveId:'a',end:0},b:{curveId:'b',end:0}}];
 expect(restore(d,d,a).document.endpointLinks).toEqual(d.endpointLinks);
 const shifted={...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0],n.position[1]+1] as [number,number]}))};
 const result=restore(shifted,d,a);expect(result.detachedLinks).toBe(1);expect(result.document.endpointLinks).toEqual([]);
 expect(shapeOf(result.document,'b')).toEqual(shapeOf(shifted,'b'));expect(shapeOf(result.document,'a')).toEqual(shapeOf(d,'a'));expect(parseDrawing(result.document)).toEqual(result.document);
 const missing={...d,endpointLinks:[]};expect(restore(d,missing,a).document.endpointLinks).toEqual(d.endpointLinks);
});

test('layer identity survives renaming; absent layer and moved ownership reject without stealing objects',()=>{
 const {d,layer,face,ids}=fixture();expect(restore({...d,layers:d.layers.map(l=>({...l,name:'Renamed'}))},d,layer).document.layers.find(l=>l.id===layer)!.name).toBe('Hair');
 expect(()=>restore(d,emptyDrawing(),layer)).toThrow(/没有该图层/);expect(()=>restore(d,d,'missing')).toThrow(/不存在/);
 const moved=p.dropPaint(d,d.groups![0].id,face),before=structuredClone(moved);expect(()=>restore(moved,d,layer)).toThrow(/其他图层/);expect(moved).toEqual(before);
 const empty={...emptyDrawing(),layers:[{...d.layers.find(l=>l.id===layer)!,items:[]}]};const clear=restore(d,empty,layer).document;
 expect(clear.layers.find(l=>l.id===layer)!.items).toEqual([]);expect(clear.curves.map(c=>c.id)).toEqual(['face']);expect(parseDrawing(clear)).toEqual(clear);
});

test('external paint referencing removed additions is preserved with an explicit diagnostic count',()=>{
 const {d,layer,face}=fixture();const working=c.createCurve(d,layer,[[0,0],[.2,0],[.4,0],[.6,0]],.02,'Extra','extra');
 working.fills.push({id:'external-fill',name:'External',visible:true,locked:false,color:'white',boundary:[{id:'extra',reverse:false}]});working.layers.find(l=>l.id===face)!.items.push('external-fill');
 const result=restore(working,d,layer);expect(result.affectedPaint).toBe(1);expect(result.document.fills.find(f=>f.id==='external-fill')).toEqual(working.fills.at(-1));expect(parseDrawing(result.document)).toEqual(result.document);
});

test('real accepted face restores each layer independently and remains loadable',()=>{
 const source=JSON.parse(readFileSync('docs/assets/front-face-v1/基础脸模·正面·v1.json','utf8')).drawing as Doc;
 const changed={...source,nodes:source.nodes.map(n=>({...n,position:[n.position[0]+.02,n.position[1]-.01] as [number,number]})),curves:source.curves.map(c=>({...c,handles:c.handles.map(p=>[p[0]+.02,p[1]-.01]) as [[number,number],[number,number]]}))};
 for(const layer of source.layers){const n=restore(changed,source,layer.id).document;expect(content(n,layer.id)).toEqual(content(source,layer.id));for(const other of changed.layers)if(other.id!==layer.id)expect(content(n,other.id)).toEqual(content(changed,other.id));expect(parseDrawing(n)).toEqual(n);}
});

test('layer restoration is one undoable draft edit; snapshot/recording change only on explicit snapshot update; round trip',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../app/store'),{commitDrawing,commitDrawingSnapshot}=await import('../ui/drawing/edit');const editor=()=>useEditor.getState();
  const {d,layer}=fixture();let state=save({drawing:d},'Front');const front=state.drawingSnapshots!.activeId!;
  state=save({...state,drawing:{...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0]+.1,n.position[1]]})),curves:d.curves.map(c=>({...c,handles:c.handles.map(p=>[p[0]+.1,p[1]]) as [[number,number],[number,number]]}))}},'Side');const side=state.drawingSnapshots!.activeId!;
  const recording=recordSnapshot(emptyPoseRecording(),state.drawingSnapshots!.items[1],{yaw:15,pitch:0});
  editor().load({...createLandmarkProject(),...state,poseRecording:recording});const before=editor().project,n=editor().past.length;
  commitDrawing(restore(before.drawing!,before.drawingSnapshots!.items[0].drawing,layer).document);const after=editor().project;
  expect(editor().past).toHaveLength(n+1);expect(after.drawingSnapshots).toBe(before.drawingSnapshots);expect(after.drawingSnapshots!.activeId).toBe(side);expect(after.poseRecording).toBe(before.poseRecording);
  editor().undo();expect(editor().project).toBe(before);editor().redo();expect(editor().project).toBe(after);
  commitDrawingSnapshot(s=>save(s,'Side',side));expect(editor().project.poseRecording!.poses[0].drawing).toEqual(editor().project.drawingSnapshots!.items[1].drawing);
  expect(editor().project.drawingSnapshots!.items.find(s=>s.id===front)).toEqual(before.drawingSnapshots!.items[0]);
  const loaded=parseLandmarks(serializeProject(editor().project));expect(loaded.drawing).toEqual(after.drawing);expect(loaded.drawingSnapshots!.activeId).toBe(side);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
