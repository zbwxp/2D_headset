import {expect,test} from 'vitest';
import {applyElementCommand,ElementCommandError} from '../app/vectorElementCommands';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';

function fixture(){let d=addLayer(emptyDrawing(),'Elements');const layer=d.layers[0].id;d=createCurve(d,layer,[[0,0],[.2,.3],[.4,.3],[.6,0]],.02,'A','a');d=createCurve(d,layer,[[0,.5],[.2,.8],[.4,.8],[.6,.5]],.02,'B','b');return d;}
const apply=(d:DrawingDocument,c:unknown)=>{const result=applyElementCommand(d,c);expect(result).toBeDefined();expect(parseDrawing(result!.document)).toEqual(result!.document);return result!;};

test('organizational groups can be created, renamed, changed, promoted and removed without geometry edits',()=>{
 const d=fixture(),created=apply(d,{op:'createGroup',curveIds:['a','b'],name:'Features',ref:'features'}),id=created.created![0].id;
 const changed=apply(created.document,{op:'setGroup',groupId:id,name:'Details',visible:false});expect(changed.document.curves.every(c=>!c.visible)).toBe(true);expect(changed.document.groups![0].name).toBe('Details');expect(shapeOf(changed.document,'a')).toEqual(shapeOf(d,'a'));
 const promoted=apply(changed.document,{op:'groupToLayer',groupId:id,ref:'layer'});expect(promoted.document.layers).toHaveLength(2);expect(promoted.document.layers[0].name).toBe('Details');expect(promoted.document.groups).toEqual([]);expect(promoted.document.curves.every(c=>!c.visible)).toBe(true);
 expect(apply(created.document,{op:'ungroup',groupId:id}).document.groups).toEqual([]);
});

test('offset creation, editing, relocation and detachment retain source geometry and hidden appearance',()=>{
 const d=fixture(),r=apply(d,{op:'createOffset',curveId:'a',ref:'offset'}),id=r.created![0].id,edited=apply(r.document,{op:'setOffset',offsetId:id,distance:.025,start:.1,end:.9,taper:.1,width:.008,translation:[.1,-.1],visible:false});
 const layer=addLayer(edited.document,'Paint'),moved=apply(layer,{op:'movePaint',objectId:id,layerId:layer.layers[0].id});expect(moved.document.layers[0].items).toEqual([id]);
 const detached=apply(moved.document,{op:'detachOffset',offsetId:id,ref:'independent'});expect(detached.document.offsets).toEqual([]);expect(detached.created!.length).toBeGreaterThan(0);expect(detached.created!.every(x=>!detached.document.curves.find(c=>c.id===x.id)!.visible)).toBe(true);expect(shapeOf(detached.document,'a')).toEqual(shapeOf(d,'a'));
});

test('within-stroke ordering changes paint order only and rejects unrelated curves',()=>{
 let d=addLayer(emptyDrawing(),'Loop');const e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.01);d=createFill(e.document,e.ids,'white');const shape=e.ids.map(id=>shapeOf(d,id)),r=apply(d,{op:'reorderCurveMember',curveId:e.ids[0],targetCurveId:e.ids[2],after:true});expect(r.document.layers[0].items.indexOf(e.ids[0])).toBeGreaterThan(r.document.layers[0].items.indexOf(e.ids[2]));expect(e.ids.map(id=>shapeOf(r.document,id))).toEqual(shape);expect(r.document.fills).toEqual(d.fills);
 expect(()=>applyElementCommand(fixture(),{op:'reorderCurveMember',curveId:'a',targetCurveId:'b'})).toThrow(ElementCommandError);
});

test('object copy preserves exact member state and returns a complete canonical mapping',()=>{
 const d=fixture();d.curves[0].visible=false;const r=apply(d,{op:'duplicateObjects',objectIds:['a'],ref:'copy'}),map=r.created![0].idMap!,id=map.a;expect(r.document.curves.find(c=>c.id===id)!.visible).toBe(false);expect(shapeOf(r.document,id)).toEqual(shapeOf(d,'a'));expect(d.curves).toHaveLength(2);
});

test('explicit profile and mist commands use existing source appearance validation',()=>{
 const d=fixture(),ink=apply(d,{op:'setInkStyle',curveIds:['a'],profile:'TAPER_BOTH',profileReverse:true}),mist=apply(ink.document,{op:'setContourMist',objectIds:['a'],mist:{enabled:true,width:.003,density:.5}});
 expect(mist.document.curves.find(c=>c.id==='a')).toMatchObject({profile:'TAPER_BOTH',profileReverse:true,mist:{mode:'INK_EDGE',enabled:true,width:.003,density:.5}});expect(shapeOf(mist.document,'a')).toEqual(shapeOf(d,'a'));
});

test('malformed element requests and locked operations never mutate source',()=>{
 const d=fixture(),before=structuredClone(d);
 for(const c of [{op:'duplicateObjects',objectIds:['missing']},{op:'createOffset',curveId:'a',extra:true},{op:'setContourMist',objectIds:['a'],mist:{enabled:true,width:NaN,density:.4}},{op:'setInkStyle',curveIds:['a'],profile:'UNKNOWN'},{op:'createGroup',curveIds:['a','a']},{op:'movePaint',objectId:'a',layerId:d.layers[0].id}])expect(()=>applyElementCommand(d,c)).toThrow();
 expect(d).toEqual(before);d.curves[0].locked=true;expect(()=>applyElementCommand(d,{op:'setInkStyle',curveIds:['a'],profile:'TAPER_END'})).toThrow(/锁定/);
});
