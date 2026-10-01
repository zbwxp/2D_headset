import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {planObjectDuplication,duplicateArtworkObjects,ObjectDuplicateError} from '../domain/drawing/duplicateArtworkObjects';
import {addLayer,createCurve,ellipse,linkEndpoints} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {createGroup} from '../domain/drawing/groups';
import {emptyDrawing,parseDrawing,shapeOf} from '../domain/drawing/model';
import {fillGeometry,offsetGeometry} from '../domain/drawing/appearance';

test('object duplication requires explicit dependency closure and keeps exact paint, topology and state',()=>{
 let d=addLayer(emptyDrawing(),'Eye');const layer=d.layers[0].id,e=ellipse(d,layer,[-1,-.5],[1,.5],.01);d=createFill(e.document,e.ids,'white');d=createOffset(d,e.ids[0]);d=createCurve(d,layer,[[0,1],[.2,1],[.4,1],[.6,1]],.01,'Detail','detail');d=createGroup(d,[...e.ids,'detail']);d.curves[0].visible=false;d.curves[1].locked=true;d.curves[2].inkVisible=false;d.fills[0].locked=true;const before=structuredClone(d);
 const plan=planObjectDuplication(d,[e.ids[0]]);expect(plan.objectIds).toHaveLength(7);expect(plan.additionalObjectIds).toHaveLength(6);expect(()=>duplicateArtworkObjects(d,[e.ids[0]])).toThrow(ObjectDuplicateError);
 const r=duplicateArtworkObjects(d,[e.ids[0]],{includeDependencies:true});expect(r.document.layers).toHaveLength(1);expect(r.document.layers[0].items.slice(0,7)).toEqual(plan.objectIds.map(id=>r.idMap[id]));
 for(const c of d.curves){const copy=r.document.curves.find(x=>x.id===r.idMap[c.id])!;expect(shapeOf(r.document,copy.id)).toEqual(shapeOf(d,c.id));expect(copy.visible).toBe(c.visible);expect(copy.locked).toBe(c.locked);expect(copy.inkVisible).toBe(c.inkVisible);}
 expect(fillGeometry(r.document,r.document.fills.at(-1)!).shapes).toEqual(fillGeometry(d,d.fills[0]).shapes);expect(offsetGeometry(r.document,r.document.offsets.at(-1)!).error).toBeUndefined();expect(r.document.groups).toHaveLength(2);expect(r.document.joins).toHaveLength(d.joins.length*2);expect(d).toEqual(before);
});

test('copies a complete hidden front eye element with fills without touching the canonical fixture',()=>{
 const url=new URL('../assets/base-face.json',import.meta.url),raw=readFileSync(url,'utf8'),d=parseDrawing(JSON.parse(raw).drawingSnapshots.items.find((s:{name:string})=>s.name==='正面').drawing),layer=d.layers.find(l=>l.name==='右眼内结构')!,r=duplicateArtworkObjects(d,layer.items);
 expect(r.curveIds).toHaveLength(20);expect(r.document.curves.filter(c=>r.curveIds.includes(c.id)&&!c.visible)).toHaveLength(12);expect(r.objectIds.filter(id=>r.document.fills.some(f=>f.id===id))).toHaveLength(6);expect(r.document.layers).toHaveLength(d.layers.length);expect(readFileSync(url,'utf8')).toBe(raw);
});

test('copy can target another layer but cannot silently flatten cross-layer relation dependencies',()=>{
 let d=addLayer(emptyDrawing(),'A');const a=d.layers[0].id;d=createCurve(d,a,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'A','a');d=addLayer(d,'B');const b=d.layers[0].id;const r=duplicateArtworkObjects(d,['a'],{targetLayerId:b});expect(r.document.layers[0].items).toEqual(r.objectIds);expect(r.document.layers[1].items).toEqual(['a']);
 d=createCurve(d,b,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.01,'B','b');d=linkEndpoints(d,{curveId:'a',end:0},{curveId:'b',end:0});expect(()=>duplicateArtworkObjects(d,['a'],{includeDependencies:true})).toThrow(/另一图层/);expect(()=>duplicateArtworkObjects(d,['a','b'],{includeDependencies:true})).toThrow(/同一图层/);
});
