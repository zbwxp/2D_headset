import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {importArtworkLayers,planArtworkLayerImport,ArtworkLayerDependencyError,ArtworkLayerImportError} from '../domain/drawing/importArtworkLayers';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import * as commands from '../domain/drawing/commands';
import {createFill,createOffset,setInk} from '../domain/drawing/paintCommands';
import {createGroup} from '../domain/drawing/groups';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokes,strokePaths,strokeFor} from '../domain/drawing/strokes';
import {strokeInk,fillGeometry,offsetGeometry} from '../domain/drawing/appearance';
import {createEmptyProject} from '../app/emptyProject';
import {useWorkspaceMode} from '../app/workspaceMode';

function fixture(){
 let d=commands.addLayer(emptyDrawing(),'Hair');const layer=d.layers[0].id,e=commands.ellipse(d,layer,[-.5,-.4],[.5,.4],.02);
 d=createFill(e.document,e.ids,'black');d=createOffset(d,e.ids[0]);d=addDisplayInterval(d,e.ids[0]);
 d=commands.createCurve(d,layer,[[0,.6],[.2,.7],[.4,.7],[.6,.6]],.02,'Detail','detail');d=createGroup(d,[...e.ids,'detail'],'Hair group');
 d.curves[0]={...d.curves[0],visible:false,inkEnds:[{taper:.12,extension:.04},{}],depthOffset:-1,depthScope:'LAYER',mist:{mode:'INK_EDGE',enabled:true,width:.005,density:.5}};
 d.displayIntervals![0].ranges[0]={...d.displayIntervals![0].ranges[0],start:.8,end:.2,inkEnds:[{taper:.02},{taperWidthScale:4}],mode:'SHOW'};
 d=commands.addLayer(d,'Face');const face=d.layers[0].id;d=commands.createCurve(d,face,[[0,0],[.3,0],[.6,0],[1,0]],.02,'Face','face');
 d.reference={name:'Source ref',dataUrl:'data:image/png;base64,AAAA',width:100,height:100,offset:[1,2],scale:2,rotation:0,opacity:.4,visible:true,locked:true};
 d.mirrorAxisX=.7;
 return {d:parseDrawing(d),layer,face,ids:e.ids};
}
const allIds=(d:DrawingDocument)=>[...d.layers,...d.curves,...d.nodes,...d.fills,...d.offsets,...d.joins,...(d.groups??[]),...(d.endpointLinks??[]),...(d.displayIntervals??[]),...(d.displayIntervals??[]).flatMap(t=>t.ranges)].map(x=>x.id);
const generator=()=>{let i=0;return ()=>`import-${String(++i).padStart(5,'0')}`;};

test('copies whole layers with fresh IDs and exact geometry, styles, topology, paint order and interval anchors',()=>{
 const {d:source,layer}=fixture(),target=structuredClone(source);target.reference!.name='Current reference';target.mirrorAxisX=-.2;
 const sourceBefore=structuredClone(source),targetBefore=structuredClone(target),r=importArtworkLayers(target,source,[layer],{idFactory:generator()}),d=r.document,m=r.idMap;
 expect(r.importedLayerIds).toEqual([m[layer]]);expect(d.layers[0].name).toBe('Hair');expect(d.layers[0].items).toEqual(source.layers.find(l=>l.id===layer)!.items.map(id=>m[id]));
 expect(d.layers.slice(1)).toEqual(target.layers);expect(d.reference).toEqual(target.reference);expect(d.mirrorAxisX).toBe(-.2);
 for(const c of source.curves.filter(c=>r.importedCurveIds.includes(m[c.id]))){
  const clone=d.curves.find(x=>x.id===m[c.id])!;expect(shapeOf(d,clone.id)).toEqual(shapeOf(source,c.id));
  expect(clone).toEqual({...c,id:m[c.id],nodes:c.nodes.map(id=>m[id])});
 }
 for(const j of source.joins)expect(d.joins.find(x=>x.id===m[j.id])).toEqual({...j,id:m[j.id],a:{...j.a,curveId:m[j.a.curveId]},b:{...j.b,curveId:m[j.b.curveId]}});
 expect(d.groups!.at(-1)!.curveIds).toEqual(source.groups![0].curveIds.map(id=>m[id]));
 expect(d.fills.at(-1)!.boundary).toEqual(source.fills[0].boundary.map(u=>({...u,id:m[u.id]})));
 expect(d.offsets.at(-1)!.source).toEqual(source.offsets[0].source.map(u=>({...u,id:m[u.id]})));
 const t=source.displayIntervals![0];expect(d.displayIntervals!.at(-1)).toEqual({...t,id:m[t.id],anchor:{...t.anchor,id:m[t.anchor.id]},ranges:t.ranges.map(x=>({...x,id:m[x.id]}))});
 const oldIds=new Set([...allIds(source),...allIds(target)]);expect(Object.values(m).every(id=>!oldIds.has(id))).toBe(true);expect(new Set(allIds(d)).size).toBe(allIds(d).length);
 expect(parseDrawing(d)).toEqual(d);expect(source).toEqual(sourceBefore);expect(target).toEqual(targetBefore);
 d.nodes.at(-1)!.position[0]=99;expect(source).toEqual(sourceBefore);expect(target).toEqual(targetBefore);
});

test('selection order never changes source layer order; insertion and repeated names are explicit',()=>{
 const {d,layer,face}=fixture(),r=importArtworkLayers(d,d,[layer,face],{insertAt:1});
 expect(r.sourceLayerIds).toEqual(d.layers.map(l=>l.id));expect(r.document.layers.map(l=>l.name)).toEqual(['Face','Face','Hair','Hair']);
 expect(r.document.layers[0]).toEqual(d.layers[0]);expect(r.document.layers[3]).toEqual(d.layers[1]);
 const again=importArtworkLayers(r.document,d,[face]);expect(new Set(allIds(again.document)).size).toBe(allIds(again.document).length);
});

test('cross-layer position links require explicit dependency closure and never silently detach or bind to existing IDs',()=>{
 let d=commands.addLayer(emptyDrawing(),'A');const a=d.layers[0].id;d=commands.createCurve(d,a,[[0,0],[.2,0],[.4,0],[.6,0]],.02,'A','a');
 d=commands.addLayer(d,'B');const b=d.layers[0].id;d=commands.createCurve(d,b,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.02,'B','b');
 d.endpointLinks=[{id:'link',a:{curveId:'a',end:0},b:{curveId:'b',end:0}}];
 const plan=planArtworkLayerImport(d,[a]);expect(plan.additionalLayerIds).toEqual([b]);expect(plan.dependencies.some(x=>x.kind==='endpointLink'&&x.requiredLayerId===b)).toBe(true);
 expect(()=>importArtworkLayers(d,d,[a])).toThrow(ArtworkLayerDependencyError);
 const r=importArtworkLayers(d,d,[a],{includeDependencies:true}),link=r.document.endpointLinks!.at(-1)!;
 expect(link).toEqual({id:r.idMap.link,a:{curveId:r.idMap.a,end:0},b:{curveId:r.idMap.b,end:0}});
 expect(r.document.endpointLinks![0]).toEqual(d.endpointLinks[0]);expect(parseDrawing(r.document)).toEqual(r.document);
});

test('fill and offset references recursively include their source layers; unrelated consumers do not hitchhike',()=>{
 const {d,layer,face,ids}=fixture();
 // Move the fill to Face. Importing Face now needs Hair; importing Hair does not need its consumer.
 const f=d.fills[0];d.layers.find(l=>l.id===layer)!.items=d.layers.find(l=>l.id===layer)!.items.filter(id=>id!==f.id);d.layers.find(l=>l.id===face)!.items.push(f.id);
 const plan=planArtworkLayerImport(d,[face]);expect(plan.additionalLayerIds).toEqual([layer]);expect(plan.dependencies.some(x=>x.kind==='fill')).toBe(true);
 expect(planArtworkLayerImport(d,[layer]).additionalLayerIds).toEqual([]);
 const r=importArtworkLayers(emptyDrawing(),d,[face],{includeDependencies:true});expect(r.document.fills[0].boundary.map(u=>u.id)).toEqual(f.boundary.map(u=>r.idMap[u.id]));
 expect(fillGeometry(r.document,r.document.fills[0]).error).toBeUndefined();expect(offsetGeometry(r.document,r.document.offsets[0]).error).toBeUndefined();
 const malformed=structuredClone(d);malformed.offsets[0].source=[{id:'absent',reverse:false}];
 expect(()=>planArtworkLayerImport(malformed,[layer])).toThrow(/不存在的曲线/);
 expect(ids.every(id=>r.idMap[id])).toBe(true);
});

test('hidden and locked source artwork can be copied without changing the original flags or source',()=>{
 const {d,layer}=fixture();for(const c of d.curves)c.locked=true;
 const r=importArtworkLayers(emptyDrawing(),d,[layer]);expect(r.document.curves.every(c=>c.locked)).toBe(true);expect(r.document.curves[0].visible).toBe(false);expect(parseDrawing(r.document)).toEqual(r.document);
});

test('fresh ID allocation preserves directional open-stroke traversal and asymmetric profile rendering',()=>{
 let d=commands.addLayer(emptyDrawing(),'Lid');const layer=d.layers[0].id;
 d=commands.createCurve(d,layer,[[-1,0],[-.8,.4],[-.2,.4],[0,0]],.02,'A','a');d=commands.createCurve(d,layer,[[0,0],[.2,-.3],[.8,-.3],[1,0]],.02,'B','b');d=commands.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');d=setInk(d,['a','b'],{profile:'TAPER_END'});
 const r=importArtworkLayers(emptyDrawing(),d,[layer],{idFactory:generator()}),original=strokePaths(strokeFor(d,'a'))[0],copy=strokePaths(strokeFor(r.document,r.idMap.a))[0];
 expect(copy.segments).toEqual(original.segments.map(s=>({...s,id:r.idMap[s.id]})));
 const originalInk=strokeInk(d,{...original,id:'a'}),copyInk=strokeInk(r.document,{...copy,id:r.idMap.a});expect(copyInk).toEqual(originalInk);
});

test('invalid selection/options/dependencies and exhausted ID generators leave both documents untouched',()=>{
 const {d,layer}=fixture(),before=JSON.stringify(d);
 expect(()=>importArtworkLayers(d,d,['missing'])).toThrow(ArtworkLayerImportError);
 expect(()=>importArtworkLayers(d,d,[layer],{insertAt:-1})).toThrow(/插入位置/);
 expect(()=>importArtworkLayers(d,d,[layer],{idFactory:()=>layer})).toThrow(/不冲突/);
 expect(()=>importArtworkLayers(d,d,[layer],{idFactory:()=>''})).toThrow(/有效的新对象/);
 expect(JSON.stringify(d)).toBe(before);
 const noOp=importArtworkLayers(d,d,[]);expect(noOp.document).toBe(d);expect(noOp.idMap).toEqual({});
});

test('default face full artwork and each dependency-closed layer import preserve renderable references and fixture bytes',()=>{
 const path=new URL('../assets/base-face.json',import.meta.url),raw=readFileSync(path,'utf8'),source=parseDrawing(JSON.parse(raw).drawing);
 const full=importArtworkLayers(source,source,source.layers.map(l=>l.id));expect(full.document.curves).toHaveLength(source.curves.length*2);expect(parseDrawing(full.document)).toEqual(full.document);
 for(const layer of source.layers){const r=importArtworkLayers(emptyDrawing(),source,[layer.id],{includeDependencies:true});
  expect(r.document.curves.map(c=>c.id)).toEqual(r.importedCurveIds);expect(parseDrawing(r.document)).toEqual(r.document);
  for(const f of r.document.fills)expect(fillGeometry(r.document,f).error).toEqual(fillGeometry(source,source.fills.find(x=>r.idMap[x.id]===f.id)!).error);
  for(const c of r.document.curves){const id=source.curves.find(x=>r.idMap[x.id]===c.id)!.id;expect(shapeOf(r.document,c.id)).toEqual(shapeOf(source,id));}
 }
 expect(readFileSync(path,'utf8')).toBe(raw);
});

test('one layer import uses one root undo transaction and saved artwork remains unchanged',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 const {useEditor}=await import('../app/store'),old=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 try{
  useWorkspaceMode.getState().setMode('drawing');const {d,layer}=fixture(),project={...createEmptyProject(),drawing:emptyDrawing(),drawingSnapshots:{version:1 as const,items:[{id:'front',name:'Front',drawing:d}],images:[]}};
  useEditor.setState({project,past:[],future:[]});const r=importArtworkLayers(project.drawing,d,[layer]),e=useEditor.getState();e.beginEdit();try{e.setDrawing(r.document);}finally{e.endEdit();}
  const after=useEditor.getState().project;expect(useEditor.getState().past).toHaveLength(1);expect(after.drawingSnapshots).toBe(project.drawingSnapshots);
  useEditor.getState().undo();expect(useEditor.getState().project.drawing).toEqual(project.drawing);useEditor.getState().redo();expect(useEditor.getState().project.drawing).toEqual(r.document);
  useWorkspaceMode.getState().setMode('recording');expect(()=>useEditor.getState().setDrawing(r.document)).toThrow();
 }finally{vi.runAllTimers();useEditor.setState(old,true);useWorkspaceMode.getState().setMode(mode);vi.unstubAllGlobals();vi.useRealTimers();}
});
