import {test,expect} from 'vitest';
import {createAssembly,assemblyDrawing,assemblySnapshots,bindLayer,unbindLayer,parseAssembly,type AssemblyDocument} from '../../domain/assembly/model';
import {createPerspective,perspectiveMatrix,map3,inverse3,sourcePoint,normalizedPoint,toCSS,fromCSS,neutralQuad,assertPerspective} from '../../domain/assembly/perspective';
import {layerProjection} from '../../domain/assembly/projection';
import {quadProjection,rectQuad,type Quad} from '../../domain/drawing/deform';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {saveDrawingSnapshot,restoreDrawingSnapshot} from '../../domain/drawing/snapshots';
import {changeAssemblySnapshots} from '../../ui/assemblyDrawing/workspace';
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],7));
function fixture(){let d=addLayer(emptyDrawing(),'Left');d=createCurve(d,d.layers[0].id,[[-1,0],[-1,.6],[0,.8],[0,0]],.02);d=addLayer(d,'Right');d=createCurve(d,d.layers[0].id,[[1,-.2],[1,1],[3,1.4],[3,-.2]],.02);return createAssembly(d);}
const quad:Quad=[[.1,-.1],[.9,.05],[1.1,.9],[-.2,1.2]];
const view={width:850,height:700,unit:220,pan:[70,-30] as Point2};

test('exact homography maps corners and interior points, inverse survives non-origin coordinates',()=>{
 const rect={min:[-3,.7] as Point2,max:[1.5,2.9] as Point2},q=quad.map(p=>sourcePoint(rect,p)) as Quad,h=quadProjection(rect,q);
 for(const uv of [...neutralQuad(),[.3,.2],[.7,.8]] as Point2[]){const p=sourcePoint(rect,uv);near(map3(h.matrix,p),h.map(p));near(map3(inverse3(h.matrix),h.map(p)),p);}
 rectQuad(rect).forEach((p,i)=>near(map3(h.matrix,p),q[i]));near(fromCSS(toCSS(h.matrix)),h.matrix);
});
test('stored normalized deformation is reusable for another asset size; hidden outlines are included',()=>{
 const a=fixture(),d={...a.drawing,curves:a.drawing.curves.map(c=>({...c,visible:false,inkVisible:false}))};
 const p=createPerspective(d,d.layers[1].id,quad),q=createPerspective(d,d.layers[0].id,p.quad);
 expect(q.source).not.toEqual(p.source);expect(q.quad).toEqual(p.quad);
 for(const uv of [[.2,.3],[.7,.8]] as Point2[]){const x=map3(perspectiveMatrix(p),sourcePoint(p.source,uv)),y=map3(perspectiveMatrix(q),sourcePoint(q.source,uv));near(normalizedPoint(p.source,x),normalizedPoint(q.source,y));}
 expect(()=>createPerspective({...d,curves:d.curves.map(c=>({...c,locked:true}))},d.layers[0].id)).toThrow('锁定');
 expect(()=>assertPerspective({...p,quad:[[0,0],[1,1],[1,0],[0,1]]})).toThrow();
});
test('manual perspective composes with binding scale, pan, zoom and 3D card without changing source or paint order',()=>{
 const base=fixture(),id=base.drawing.layers[1].id;
 let a=bindLayer(base,id,'eye-l');a={...a,perspectives:[createPerspective(a.drawing,id,quad)],followAxisRotation:true,pose:{...a.pose,yaw:42,pitch:-16,roll:12}};
 const p=a.perspectives![0],before=JSON.stringify(a),projection=layerProjection(a,id,view),manual=perspectiveMatrix(p);
 const noManual=layerProjection({...a,perspectives:[]},id,view);
 for(const uv of [...neutralQuad(),[.2,.3],[.7,.8]] as Point2[]){
  const q=sourcePoint(p.source,uv),screen=map3(projection.sourceToScreen,q);
  near(map3(projection.matrix,screen),map3(noManual.placement,map3(manual,q)));
 }
 expect(assemblyDrawing(a)).toEqual(assemblyDrawing({...a,perspectives:[]}));expect(JSON.stringify(a)).toBe(before);
 expect(assemblyDrawing(a).layers).toBe(base.drawing.layers);
 const off={...a,followAxisRotation:false,perspectives:a.perspectives!.map(p=>({...p,enabled:false}))};
 expect(layerProjection(off,id,view).active).toBe(false);
 near(map3(layerProjection(off,id,view).matrix,[340,210]),[340,210]);
});
test('rebinding and detaching keep manual deformation registered to the unchanged billboard picture',()=>{
 const base=fixture(),id=base.drawing.layers[1].id;
 const a={...bindLayer(base,id,'eye-l'),perspectives:[createPerspective(base.drawing,id,quad)],pose:{...base.pose,yaw:47,pitch:12}};
 const original=layerProjection(a,id,view),p=a.perspectives[0];
 for(const next of [unbindLayer(a,id),bindLayer(a,id,'eye-r')]){
  const n=layerProjection(next,id,view),q=next.perspectives![0];
  for(const uv of [[0,0],[1,1],[.4,.7]] as Point2[])near(map3(original.placement,map3(perspectiveMatrix(p),sourcePoint(p.source,uv))),map3(n.placement,map3(perspectiveMatrix(q),sourcePoint(q.source,uv))));
 }
});
test('snapshot captures parameter-only changes; legacy snapshot restoration clears current deformer; compact reload validates it',()=>{
 const save=(a:AssemblyDocument,name:string)=>changeAssemblySnapshots(a,saveDrawingSnapshot({drawing:assemblyDrawing(a),drawingSnapshots:assemblySnapshots(a)},name));
 const restore=(a:AssemblyDocument,id:string)=>changeAssemblySnapshots(a,restoreDrawingSnapshot({drawing:assemblyDrawing(a),drawingSnapshots:assemblySnapshots(a)},id));
 let a=save(fixture(),'Original'),front=a.drawingSnapshots!.activeId!;
 a={...a,perspectives:[createPerspective(a.drawing,a.drawing.layers[1].id,quad)]};
 a=save(a,'Perspective');const turned=a.drawingSnapshots!.activeId!;
 const loaded=parseAssembly(JSON.parse(JSON.stringify(a)));expect(loaded.perspectives).toEqual(a.perspectives);expect(loaded.frames[turned].perspectives).toEqual(a.perspectives);
 const original=restore(loaded,front);expect(original.perspectives).toBeUndefined();
 const again=restore(original,turned);expect(again.perspectives).toEqual(a.perspectives);expect(again.drawing).toEqual(a.drawing);
 expect(()=>parseAssembly({...a,perspectives:[{...a.perspectives![0],layerId:'deleted'}]})).toThrow();
 expect(()=>parseAssembly({...a,perspectives:[a.perspectives![0],a.perspectives![0]]})).toThrow();
 expect(()=>parseAssembly({...a,perspectives:[{...a.perspectives![0],quad:[[0,0],[0,0],[0,0],[0,0]]}]})).toThrow();
});
