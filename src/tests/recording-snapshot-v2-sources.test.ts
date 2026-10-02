import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {strokes} from '../domain/drawing/strokes';
import {canonicalElementId,drawingIdentityIds,remapDrawingIdentities,upsertDrawingSource,remapWorkingSnapshotSource} from '../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';

test('legacy artwork IDs scope canonical identity even where raw curve IDs collide with different geometry',()=>{
 const project=JSON.parse(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'));
 const assets=project.drawingSnapshots.items as Array<{id:string;drawing:DrawingDocument}>;
 const canonical=assets.map(asset=>remapDrawingIdentities(asset.drawing,id=>canonicalElementId(asset.id,id)));
 for(const drawing of canonical)expect(()=>parseDrawing(drawing)).not.toThrow();
 const all=canonical.flatMap(drawingIdentityIds);expect(new Set(all).size).toBe(all.length);
 let collisions=0;
 for(let a=0;a<assets.length;a++)for(let b=a+1;b<assets.length;b++)for(const left of assets[a].drawing.curves){
  const right=assets[b].drawing.curves.find(c=>c.id===left.id);if(!right||JSON.stringify(left.handles)===JSON.stringify(right.handles))continue;
  collisions++;
  expect(canonical[a].curves.find(c=>c.id===canonicalElementId(assets[a].id,left.id))!.handles).toEqual(left.handles);
  expect(canonical[b].curves.find(c=>c.id===canonicalElementId(assets[b].id,right.id))!.handles).toEqual(right.handles);
 }
 expect(collisions).toBeGreaterThan(0);
});

test('every source reference round trips through scoped identities without changing geometry or metadata',()=>{
 const project=JSON.parse(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'));
 for(const asset of project.drawingSnapshots.items as Array<{id:string;drawing:DrawingDocument}>){
  const before=JSON.stringify(asset.drawing),map=new Map(drawingIdentityIds(asset.drawing).map(id=>[canonicalElementId(asset.id,id),id]));
  const mapped=remapDrawingIdentities(asset.drawing,id=>canonicalElementId(asset.id,id));
  expect(remapDrawingIdentities(mapped,id=>map.get(id)??id.slice(canonicalElementId(asset.id,'').length))).toEqual(asset.drawing);
  expect(JSON.stringify(asset.drawing)).toBe(before);
 }
});

test('canonical IDs retain source traversal direction for punctuation and non-ASCII node IDs',()=>{
 for(const ids of [['"a','/a'],['a:b','a/b'],['长节点','末端']]){
  const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:ids[0],position:[0,0]},{id:ids[1],position:[1,0]}],curves:[{id:'curve',name:'Directional taper',nodes:ids as [string,string],handles:[[.25,0],[.75,0]],visible:true,locked:false,width:.01,profile:'TAPER_END'}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
  const source='source:"/中文',mapped=remapDrawingIdentities(drawing,id=>canonicalElementId(source,id));
  expect(strokes(mapped,canonicalElementId(source,'layer'))[0].segments.map(s=>s.reverse)).toEqual(strokes(drawing,'layer')[0].segments.map(s=>s.reverse));
 }
});

test('saving the working source preserves its canonical namespace for existing and later members',()=>{
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'c',name:'Curve',nodes:['a','b'],handles:[[.25,0],[.75,0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]};
 const before=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'$working',drawing),saved=remapWorkingSnapshotSource(before,'named-artwork')!;
 const extended:DrawingDocument={...drawing,nodes:[...drawing.nodes,{id:'z',position:[2,0]}],curves:[...drawing.curves,{...drawing.curves[0],id:'next',nodes:['b','z'],handles:[[1.25,0],[1.75,0]]}],layers:[{...drawing.layers[0],items:['c','next']}]};
 const after=upsertDrawingSource(saved,'named-artwork',extended);
 expect(Object.keys(after.library.nodes).sort()).toEqual(['a','b','z'].map(id=>canonicalElementId('$working',id)).sort());expect(after.snapshots[0].id).toBe(before.snapshots[0].id);
});
