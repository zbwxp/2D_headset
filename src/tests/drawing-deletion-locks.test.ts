import {expect,test} from 'vitest';
import {addLayer,createCurve,linkEndpoints,deleteObjects,deleteLayer,deleteLayers} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {createVectorEditingApi,type VectorEditingHost} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';

test('deleting a linked member or its layer cannot bypass a locked partner in another layer',()=>{
 let d=addLayer(emptyDrawing(),'A');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[.2,0],[.4,0],[.6,0]],.01,'A','a');d=addLayer(d,'B');d=createCurve(d,d.layers[0].id,[[0,0],[-.2,0],[-.4,0],[-.6,0]],.01,'B','b');d=linkEndpoints(d,{curveId:'a',end:0},{curveId:'b',end:0});d.curves.find(c=>c.id==='b')!.locked=true;
 const before=structuredClone(d);expect(()=>deleteObjects(d,['a'])).toThrow(/锁定/);expect(()=>deleteLayer(d,layer)).toThrow(/锁定/);expect(()=>deleteLayers(d,[layer])).toThrow(/锁定/);expect(d).toEqual(before);
 const project={...createEmptyProject(),drawing:d};let commits=0;const host:VectorEditingHost={getState:()=>({project,past:[],future:[]}),getMode:()=> 'drawing',commitDrawing(){commits++;},undo(){},redo(){}};const api=createVectorEditingApi(host);
 for(const command of [{op:'deleteObjects' as const,objectIds:['a']},{op:'deleteLayers' as const,layerIds:[layer]}])expect(api.execute({commands:[command]}).ok).toBe(false);
 expect(commits).toBe(0);expect(project.drawing).toBe(d);expect(d).toEqual(before);
 const unlocked={...d,curves:d.curves.map(c=>({...c,locked:false}))};expect(deleteLayers(unlocked,[layer]).endpointLinks).toEqual([]);
});
