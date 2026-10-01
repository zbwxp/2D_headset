import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {addLayer,createCurve,duplicateCurves,duplicateLayer,ellipse,transform} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {createGroup} from '../domain/drawing/groups';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,shapeOf,curveById,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {fillGeometry,fillVisible,strokeInk} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';

function copiedIds(before:DrawingDocument,after:DrawingDocument,layerId:string){
 const source=before.layers.find(l=>l.id===layerId)!;
 return new Map(source.items.map((id,i)=>[id,after.layers[0].items[i]]));
}

test('whole-layer duplication preserves each member state and group membership without changing standalone-copy behavior',()=>{
 let d=addLayer(emptyDrawing(),'Mixed state');const layer=d.layers[0].id,e=ellipse(d,layer,[-.5,-.3],[.5,.3],.02);
 d=createFill(e.document,e.ids,'white');d=createOffset(d,e.ids[0]);d=addDisplayInterval(d,e.ids[0]);
 d=createCurve(d,layer,[[0,.6],[.1,.7],[.3,.7],[.4,.6]],.01,'Detail','detail');d=createGroup(d,[...e.ids,'detail'],'Group');
 d.curves=d.curves.map((c,i)=>({...c,visible:i!==0,locked:i===2,inkVisible:i!==1,depthOffset:i===3?1:undefined,depthScope:'LAYER'}));
 d.fills[0]={...d.fills[0],visible:true,locked:true};d.offsets[0]={...d.offsets[0],visible:false,locked:true};
 const before=structuredClone(d),copy=duplicateLayer(d,layer),map=copiedIds(d,copy,layer);
 expect(copy.layers[0]).toMatchObject({visible:true,locked:false});
 for(const c of d.curves){const n=curveById(copy,map.get(c.id)!);expect(n).toMatchObject({visible:c.visible,locked:c.locked,inkVisible:c.inkVisible,width:c.width,depthScope:c.depthScope});expect(n.depthOffset).toBe(c.depthOffset);expect(shapeOf(copy,n.id)).toEqual(shapeOf(d,c.id));expect(n.nodes.some(id=>c.nodes.includes(id))).toBe(false);}
 expect(copy.groups!.at(-1)).toMatchObject({visible:true,locked:false,curveIds:d.groups![0].curveIds.map(id=>map.get(id))});
 expect(copy.fills.at(-1)).toMatchObject({visible:true,locked:true,color:'white',boundary:d.fills[0].boundary.map(u=>({...u,id:map.get(u.id)}))});
 expect(copy.offsets.at(-1)).toMatchObject({visible:false,locked:true,source:d.offsets[0].source.map(u=>({...u,id:map.get(u.id)}))});
 expect(copy.displayIntervals!.at(-1)!.ranges[0]).toMatchObject({start:d.displayIntervals![0].ranges[0].start,end:d.displayIntervals![0].ranges[0].end});
 expect(fillGeometry(copy,copy.fills.at(-1)!).shapes).toEqual(fillGeometry(d,d.fills[0]).shapes);
 expect(()=>transform(copy,[...map.values()].filter(id=>!!curveById(copy,id)),p=>[-p[0],p[1]])).toThrow(/锁定/);
 expect(parseDrawing(copy)).toEqual(copy);expect(d).toEqual(before);
 const standalone=duplicateCurves(d,d.curves.map(c=>c.id));expect(standalone.ids.every(id=>curveById(standalone.document,id).visible&&!curveById(standalone.document,id).locked)).toBe(true);
});

test('the canonical inner-eye layer keeps all 12 hidden boundaries and six fills after duplication and reflection',()=>{
 const path=new URL('../assets/base-face.json',import.meta.url),raw=readFileSync(path,'utf8'),d=parseDrawing(JSON.parse(raw).drawingSnapshots.items.find((x:{name:string})=>x.name==='正面').drawing),before=JSON.stringify(d);
 const layer=d.layers.find(l=>l.name==='右眼内结构')!,copy=duplicateLayer(d,layer.id),map=copiedIds(d,copy,layer.id),ids=layer.items.filter(id=>!!curveById(d,id));
 expect(ids).toHaveLength(20);expect(ids.filter(id=>!curveById(d,id).visible)).toHaveLength(12);
 const axis=d.mirrorAxisX!,reflect=(p:Point2):Point2=>[2*axis-p[0],p[1]],mirrored=transform(copy,ids.map(id=>map.get(id)!),reflect);
 for(const id of ids){const c=curveById(d,id),cloned=curveById(mirrored,map.get(id)!);expect(shapeOf(mirrored,cloned.id)).toEqual(shapeOf(d,id).map(reflect));
  for(const key of ['visible','locked','inkVisible','depthOffset','depthScope','mist','inkEnds','width'] as const)expect(cloned[key]).toEqual(c[key]);
  if(!c.visible){expect(strokeInk(d,strokeFor(d,id),new Set(d.curves.filter(c=>c.visible).map(c=>c.id)))).toHaveLength(0);expect(strokeInk(mirrored,strokeFor(mirrored,cloned.id),new Set(mirrored.curves.filter(c=>c.visible).map(c=>c.id)))).toHaveLength(0);}
 }
 const fills=d.fills.filter(f=>layer.items.includes(f.id));expect(fills).toHaveLength(6);
 for(const f of fills){const clone=mirrored.fills.find(x=>x.id===map.get(f.id))!;expect(fillVisible(mirrored,clone)).toBe(fillVisible(d,f));expect(clone.color).toBe(f.color);expect(clone.mist).toEqual(f.mist);expect(fillGeometry(mirrored,clone).error).toBeUndefined();
  const expected=fillGeometry(d,f).shapes.map(s=>s.map(reflect)),actual=fillGeometry(mirrored,clone).shapes;
  expect(actual).toHaveLength(expected.length);for(let i=0;i<actual.length;i++)for(let j=0;j<4;j++)for(let k=0;k<2;k++)expect(actual[i][j][k]).toBeCloseTo(expected[i][j][k],12);
 }
 expect(parseDrawing(mirrored)).toEqual(mirrored);expect(JSON.stringify(d)).toBe(before);expect(readFileSync(path,'utf8')).toBe(raw);
});
