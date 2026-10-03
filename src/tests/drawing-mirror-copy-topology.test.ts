import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import * as commands from '../domain/drawing/commands';
import {createGroup} from '../domain/drawing/groups';
import {applyMirrorEditing,validateMirrorEditing} from '../domain/drawing/mirrorEditing';
import {curveById,emptyDrawing,nodeAt,parseDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';

// An external regression drawing can exercise the same checks without copying
// private artwork into the repository or changing the supplied file.
const fixturePath=process.env.CONTOUR_MIRROR_REGRESSION_FIXTURE??new URL('../assets/hairless-symmetric-two-face.json',import.meta.url);
const fixtureBytes=readFileSync(fixturePath,'utf8'),fixture=JSON.parse(fixtureBytes),artwork=fixture.drawing??fixture;
const recipe=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-mirror-editing-setup.json',import.meta.url),'utf8'));
const source=(enabled=true)=>parseDrawing({...structuredClone(artwork),mirrorEditing:{...structuredClone(artwork.mirrorEditing??recipe.config),enabled}});
const valid=(d:DrawingDocument)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
const originalGeometryUnchanged=(before:DrawingDocument,after:DrawingDocument)=>{
 for(const c of before.curves)expect(curveById(after,c.id)).toEqual(c);
 for(const node of before.nodes)expect(after.nodes.find(n=>n.id===node.id)).toEqual(node);
 expect(after.mirrorEditing).toEqual(before.mirrorEditing);
};

test.each([false,true])('paired left eyebrow duplicates in place with independent controls, mirror enabled=%s',enabled=>{
 const d=source(enabled),before=structuredClone(d),layer=d.layers.find(l=>l.name==='左眉')!,id=layer.items.find(id=>curveById(d,id))!;
 const copied=commands.duplicateCurves(d,[id],layer.id,[0,0]),copyId=copied.ids[0],copy=curveById(copied.document,copyId);
 expect(copyId).not.toBe(id);expect(shapeOf(copied.document,copyId)).toEqual(shapeOf(d,id));
 expect(copy.nodes.some(id=>d.nodes.some(n=>n.id===id))).toBe(false);
 expect(copied.document.mirrorEditing).toBe(d.mirrorEditing);
 const position:Point2=[copy.handles[0][0]+.07,copy.handles[0][1]+.03];
 const moved=applyMirrorEditing(copied.document,commands.moveHandle(copied.document,{curveId:copyId,end:0},position),{handles:[{curveId:copyId,end:0,position}]});
 expect(curveById(moved,copyId).handles[0]).toEqual(position);originalGeometryUnchanged(d,moved);valid(moved);
 expect(d).toEqual(before);expect(readFileSync(fixturePath,'utf8')).toBe(fixtureBytes);
});

test('curve-copy callers retain their existing default offset',()=>{
 const d=source(),layer=d.layers.find(l=>l.name==='左眉')!,id=layer.items[0],copied=commands.duplicateCurves(d,[id]);
 expect(shapeOf(copied.document,copied.ids[0])).toEqual(shapeOf(d,id).map(([x,y])=>[x+.04,y-.04]));originalGeometryUnchanged(d,copied.document);
});

test('standalone paired ear-group copying remaps its fill, joins and intervals entirely inside the copy',()=>{
 const original=source(),layer=original.layers.find(l=>l.name==='左耳')!,d=createGroup(original,layer.items.filter(id=>curveById(original,id)),'Entire ear'),group=d.groups!.find(g=>g.name==='Entire ear')!;
 const copied=commands.duplicateCurves(d,group.curveIds,layer.id,[0,0]),map=new Map(group.curveIds.map((id,i)=>[id,copied.ids[i]]));
 const oldFills=d.fills.filter(f=>f.boundary.every(u=>map.has(u.id))&&layer.items.includes(f.id)),newFills=copied.document.fills.slice(d.fills.length);
 expect(oldFills.length).toBeGreaterThan(0);expect(newFills).toHaveLength(oldFills.length);
 for(const fill of oldFills)expect(newFills.some(f=>JSON.stringify(f.boundary)===JSON.stringify(fill.boundary.map(u=>({...u,id:map.get(u.id)}))))).toBe(true);
 expect(copied.document.joins.slice(d.joins.length).every(j=>copied.ids.includes(j.a.curveId)&&copied.ids.includes(j.b.curveId))).toBe(true);
 expect(copied.document.displayIntervals!.slice(d.displayIntervals!.length).every(t=>copied.ids.includes(t.anchor.id))).toBe(true);
 originalGeometryUnchanged(d,copied.document);valid(copied.document);
});

for(const enabled of [false,true])test.each(['左眼睑','左眼内结构','左耳'])('whole paired %s layer copies internal relations and paint with mirror enabled='+enabled,name=>{
 const d=source(enabled),before=structuredClone(d),layer=d.layers.find(l=>l.name===name)!,copied=commands.duplicateLayer(d,layer.id),created=copied.layers[0];
 const map=new Map(layer.items.map((id,i)=>[id,created.items[i]])),isCopied=(id:string)=>created.items.includes(id);
 originalGeometryUnchanged(d,copied);expect(d).toEqual(before);
 for(const id of layer.items){
  const curve=curveById(d,id);if(curve){const clone=curveById(copied,map.get(id)!);expect(shapeOf(copied,clone.id)).toEqual(shapeOf(d,id));expect(clone.nodes.some(id=>d.nodes.some(n=>n.id===id))).toBe(false);expect(clone.visible).toBe(curve.visible);expect(clone.locked).toBe(curve.locked);}
  const fill=d.fills.find(f=>f.id===id);if(fill)expect(copied.fills.find(f=>f.id===map.get(id))?.boundary).toEqual(fill.boundary.map(u=>({...u,id:map.get(u.id)})));
 }
 for(const [oldRelations,newRelations] of [[d.joins,copied.joins],[d.endpointLinks??[],copied.endpointLinks??[]]] as const){
  const internal=oldRelations.filter(r=>map.has(r.a.curveId)&&map.has(r.b.curveId)),clones=newRelations.filter(r=>isCopied(r.a.curveId)||isCopied(r.b.curveId));
  expect(clones).toHaveLength(internal.length);
  for(const relation of internal)expect(clones.some(r=>r.id!==relation.id&&r.a.curveId===map.get(relation.a.curveId)&&r.a.end===relation.a.end&&r.b.curveId===map.get(relation.b.curveId)&&r.b.end===relation.b.end)).toBe(true);
  expect(clones.every(r=>isCopied(r.a.curveId)&&isCopied(r.b.curveId))).toBe(true);
 }
 for(const group of d.groups??[])if(group.curveIds.every(id=>map.has(id))){const expected=group.curveIds.map(id=>map.get(id)!);expect(copied.groups?.some(g=>g.id!==group.id&&g.curveIds.length===expected.length&&expected.every(id=>g.curveIds.includes(id)))).toBe(true);}
 for(const track of d.displayIntervals??[])if(map.has(track.anchor.id)){
  const clone=copied.displayIntervals!.find(t=>t.anchor.id===map.get(track.anchor.id))!;expect(clone.id).not.toBe(track.id);expect(clone.ranges.map(({id:_,...r})=>r)).toEqual(track.ranges.map(({id:_,...r})=>r));
  expect(clone.ranges.every(r=>!track.ranges.some(old=>old.id===r.id))).toBe(true);
 }
 valid(copied);expect(readFileSync(fixturePath,'utf8')).toBe(fixtureBytes);
});

function topology(connected=true):DrawingDocument{
 let d=commands.addLayer(emptyDrawing(),'Pairs');const layer=d.layers[0].id,reflect=([x,y]:Point2):Point2=>[-x,y];
 const shapes:Cubic[]=[[[-2,0],[-1.75,.4],[-1.25,.4],[-1,0]],[[-1,0],[-.75,-.4],[-.25,-.4],[0,0]]];
 for(const [i,shape] of shapes.entries())for(const side of ['left','right'])d=commands.createCurve(d,layer,(side==='left'?shape:shape.map(reflect)) as Cubic,.01,side+i,side+i);
 if(connected)for(const side of ['left','right'])d=commands.connect(d,{curveId:side+'0',end:1},{curveId:side+'1',end:0},'SMOOTH');
 return {...d,mirrorEditing:{enabled:true,curvePairs:[0,1].map(i=>({id:'pair'+i,a:'left'+i,b:'right'+i,reverse:false})),axisNodeIds:['left1','right1'].map(curveId=>nodeAt(d,{curveId,end:1}).id)}};
}

test.each([false,true])('paired split, delete and unbind prune invalid references without changing the opposite side, enabled=%s',enabled=>{
 const d=topology(),before=structuredClone(d);d.mirrorEditing!.enabled=enabled;before.mirrorEditing!.enabled=enabled;
 const operations=[commands.splitCurve(d,'left0',.5).document,commands.deleteCurves(d,['left0']),commands.unbind(d,{curveId:'left0',end:1})];
 for(const next of operations){
  expect(next.mirrorEditing!.curvePairs).toEqual([d.mirrorEditing!.curvePairs[1]]);
  for(const id of ['right0','right1'])expect(shapeOf(next,id)).toEqual(shapeOf(d,id));
  expect(next.mirrorEditing!.axisNodeIds?.every(id=>next.nodes.some(n=>n.id===id))).toBe(true);validateMirrorEditing(next);valid(next);
 }
 expect(d).toEqual(before);
});

test('connecting paired curves retires only affected pair metadata and preserves valid unrelated pairs',()=>{
 const d=topology(false),before=structuredClone(d),next=commands.connect(d,{curveId:'left0',end:1},{curveId:'left1',end:0},'SMOOTH');
 expect(next.mirrorEditing!.curvePairs).toEqual([d.mirrorEditing!.curvePairs[0]]);
 expect(nodeAt(next,{curveId:'left0',end:1}).id).toBe(nodeAt(next,{curveId:'left1',end:0}).id);
 for(const id of ['right0','right1'])expect(shapeOf(next,id)).toEqual(shapeOf(d,id));valid(next);expect(d).toEqual(before);
});

test('deleting paired axial members removes missing axis references and leaves surviving geometry exact',()=>{
 const d=topology(),next=commands.deleteCurves(d,['left1']);
 expect(next.mirrorEditing!.curvePairs).toEqual([d.mirrorEditing!.curvePairs[0]]);
 expect(next.mirrorEditing!.axisNodeIds?.every(id=>next.nodes.some(n=>n.id===id))).toBe(true);
 expect(shapeOf(next,'right1')).toEqual(shapeOf(d,'right1'));valid(next);
});

test('moving the mirror axis updates the guide without changing any authored geometry',()=>{
 const d=topology(),next=commands.setMirrorAxis(d,.3);expect(next.mirrorAxisX).toBe(.3);originalGeometryUnchanged(d,next);valid(next);
});

test('actual locked join and linked-node dependencies remain protected independently of mirror pairs',()=>{
 const d=topology(),locked=commands.curveChange(d,'left1',{locked:true}),before=structuredClone(locked);
 expect(()=>commands.deleteCurves(locked,['left0'])).toThrow(/锁定/);
 expect(()=>commands.unbind(locked,{curveId:'left0',end:1})).toThrow(/锁定/);expect(locked).toEqual(before);
 const onlyMirrorLocked=commands.curveChange(d,'right0',{locked:true});expect(()=>commands.deleteCurves(onlyMirrorLocked,['left0'])).not.toThrow();
 expect(()=>commands.splitCurve(onlyMirrorLocked,'left0',.5)).not.toThrow();expect(()=>commands.unbind(onlyMirrorLocked,{curveId:'left0',end:1})).not.toThrow();
 const linked=commands.linkEndpoints(topology(false),{curveId:'left1',end:1},{curveId:'right1',end:1}),linkedLocked=commands.curveChange(linked,'right1',{locked:true});
 expect(()=>commands.deleteCurves(linkedLocked,['left1'])).toThrow(/锁定/);
});
