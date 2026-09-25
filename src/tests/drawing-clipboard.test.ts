import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {cutDrawing,pasteDrawingCut} from '../domain/drawing/clipboard';
import {createGroup} from '../domain/drawing/groups';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,shapeOf,layerFor,type Cubic} from '../domain/drawing/model';
import {fillGeometry,strokeInk,offsetGeometry} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
const line:Cubic=[[0,0],[.3,0],[.7,0],[1,0]];
function fixture(){
 let d=c.addLayer(emptyDrawing(),'Source');const source=d.layers[0].id,e=c.ellipse(d,source,[-.8,-.6],[.8,.6],.02);d=p.createFill(e.document,e.ids,'white');
 d=c.createPenCurve(d,source,line,.02,'line',7);d=addDisplayInterval(d,'line');d=p.setInkEnd(d,'line',1,{extension:.02,taper:.08});
 d={...d,curves:d.curves.map(x=>x.id==='line'?{...x,mist:{enabled:true,width:.04,density:2}}:x)};
 d=createGroup(d,[e.ids[0],'line'],'Eye');d=c.addLayer(d,'Target');const target=d.layers[0].id;d=c.createCurve(d,target,[[2,0],[2.3,0],[2.7,0],[3,0]],.01,'Other','other');
 return {d,source,target,ids:[...e.ids,'line']};
}
test('cut/paste preserves a group, closed fill, ink, geometry, intervals, member states and internal paint order',()=>{
 let {d,source,target,ids}=fixture();d=c.curveChange(d,ids[0],{visible:false});const before=structuredClone(d),order=d.layers.find(l=>l.id===source)!.items,fill=fillGeometry(d,d.fills[0]),ink=strokeInk(d,strokeFor(d,'line'));
 const result=cutDrawing(d,ids)!;expect(result.document.curves.map(x=>x.id)).toEqual(['other']);expect(result.document.groups).toEqual([]);expect(result.document.fills).toEqual([]);expect(result.document.displayIntervals).toEqual([]);parseDrawing(result.document);
 const pasted=pasteDrawingCut(result.document,result.clipboard,target);expect(pasted.layers.find(l=>l.id===target)!.items).toEqual([...order,'other']);expect(pasted.layers.find(l=>l.id===source)!.items).toEqual([]);
 for(const id of ids){expect(shapeOf(pasted,id)).toEqual(shapeOf(d,id));expect(pasted.curves.find(x=>x.id===id)).toEqual(d.curves.find(x=>x.id===id));}
 expect(pasted.groups).toEqual(d.groups);expect(pasted.joins).toEqual(d.joins);expect(pasted.fills).toEqual(d.fills);expect(pasted.displayIntervals).toEqual(d.displayIntervals);expect(fillGeometry(pasted,pasted.fills[0])).toEqual(fill);expect(strokeInk(pasted,strokeFor(pasted,'line'))).toEqual(ink);parseDrawing(pasted);expect(d).toEqual(before);
});
test('one constituent segment carries its connected stroke and fill, while unrelated group members remain',()=>{
 const {d,source,target,ids}=fixture(),result=cutDrawing(d,[ids[0]])!,pasted=pasteDrawingCut(result.document,result.clipboard,target);
 expect(result.clipboard.curves).toHaveLength(4);expect(result.clipboard.fills).toHaveLength(1);expect(result.clipboard.groups).toEqual([]);expect(layerFor(pasted,'line')!.id).toBe(source);expect(pasted.groups![0].curveIds).toEqual(['line']);expect(pasted.curves).toHaveLength(d.curves.length);parseDrawing(pasted);
});
test('hidden objects can be cut; locked members or fills reject atomically; missing target retains clipboard',()=>{
 const {d,source,ids}=fixture(),hidden=c.layerChange(d,source,{visible:false});expect(cutDrawing(hidden,ids)!.clipboard.curves.every(x=>!x.visible)).toBe(true);
 expect(()=>cutDrawing(c.curveChange(d,ids[2],{locked:true}),[ids[0]])).toThrow(/锁定/);expect(()=>cutDrawing(p.changePaint(d,d.fills[0].id,{locked:true}),[ids[0]])).toThrow(/锁定/);
 const cut=cutDrawing(d,ids)!;expect(()=>pasteDrawingCut(cut.document,cut.clipboard,'missing')).toThrow(/目标/);expect(cut.clipboard.curves).toHaveLength(5);
});
test('Undo-restored and already-pasted IDs move without duplication; partial stale clipboard is refused',()=>{
 const {d,target,source,ids}=fixture(),cut=cutDrawing(d,ids)!;
 const restored=pasteDrawingCut(d,cut.clipboard,target);expect(restored.curves).toHaveLength(d.curves.length);expect(layerFor(restored,'line')!.id).toBe(target);parseDrawing(restored);
 const back=pasteDrawingCut(restored,cut.clipboard,source);expect(back.curves).toHaveLength(d.curves.length);expect(back.groups).toEqual(d.groups);parseDrawing(back);
 expect(()=>pasteDrawingCut(c.deleteObjects(d,['line']),cut.clipboard,target)).toThrow(/改变/);
});
test('external endpoint links restore on paste; intervening movement is rejected without relocating artwork',()=>{
 let {d,target}=fixture();d=c.linkEndpoints(d,{curveId:'line',end:1},{curveId:'other',end:0});const cut=cutDrawing(d,['line'])!;expect(cut.document.endpointLinks).toEqual([]);
 const pasted=pasteDrawingCut(cut.document,cut.clipboard,target);expect(pasted.endpointLinks).toEqual(d.endpointLinks);expect(shapeOf(pasted,'line')).toEqual(shapeOf(d,'line'));parseDrawing(pasted);
 const node=cut.document.curves.find(c=>c.id==='other')!.nodes[0],moved=c.moveNode(cut.document,node,[1.1,0]);expect(()=>pasteDrawingCut(moved,cut.clipboard,target)).toThrow(/关联端点已移动/);
});
test('fill and offset rows can move independently, and new offsets use endpoint styles without a legacy profile',()=>{
 let {d,source,target}=fixture();d=p.createOffset(d,'line');const offset=d.offsets[0];expect(offset.profile).toBeUndefined();expect(offset.inkEnds!.every(e=>e.taperWidthScale===20)).toBe(true);
 for(const id of [d.fills[0].id,offset.id]){const cut=cutDrawing(d,[id])!,moved=pasteDrawingCut(cut.document,cut.clipboard,target);expect(cut.clipboard.curves).toEqual([]);expect(layerFor(moved,'line')!.id).toBe(source);expect(layerFor(moved,id)!.id).toBe(target);expect(offsetGeometry(moved,offset)).toEqual(offsetGeometry(d,offset));parseDrawing(moved);}
});
