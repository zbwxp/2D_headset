import {describe,it,expect} from 'vitest';
import {defaultHairstyle,parseHairstyle} from '../domain/hairstyle/model';
import {independentHair,syncStrands,editHairDrawing,addStrand,rerollStrands} from '../domain/hairstyle/strands';
import {generateHair} from '../domain/hairstyle/geometry';
import {projectHairDrawing} from '../domain/hairstyle/drawing';
import {connect,unbind,deleteObjects,duplicateLayer} from '../domain/drawing/commands';
import {shapeOf,parseDrawing} from '../domain/drawing/model';
import {seededHairRandom} from '../domain/hairstyle/random';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {saveBackgroundState,applyBackgroundState,type RecordingReferenceImage} from '../domain/recording/reference';
import {createEmptyProject} from '../app/emptyProject';
import {hairEditorState} from '../ui/drawing/workspace';
import {useEditor} from '../app/store';

const setup=()=>independentHair(defaultHairstyle());
describe('independent procedural hair editor',()=>{
 it('migrates once, retaining ink, stable IDs, shared tips and saved snapshots',()=>{
  const old=defaultHairstyle(),saved=saveDrawingSnapshot({drawing:old.drawing},'old'),input={...old,drawingSnapshots:saved.drawingSnapshots},before=JSON.stringify(input),h=independentHair(input);
  expect(JSON.stringify(input)).toBe(before);expect(independentHair(h)).toBe(h);expect(h.generated).toBeUndefined();
  expect(h.drawing.curves.map(c=>c.id)).toEqual(old.drawing.curves.map(c=>c.id));expect(h.drawingSnapshots).toEqual(input.drawingSnapshots);
  for(const c of old.drawing.curves){const a=shapeOf(old.drawing,c.id),b=shapeOf(h.drawing,c.id);a.flat().forEach((v,i)=>expect(b.flat()[i]).toBeCloseTo(v,6));}
  expect(h.drawing.joins).toEqual(old.drawing.joins);expect(h.drawing.displayIntervals).toEqual(old.drawing.displayIntervals);
  expect(parseHairstyle(JSON.parse(JSON.stringify(h)))).toEqual(h);
 });
 it('independent base intervals and sampled endpoint offsets remain fixed across views and reload',()=>{
  let h=setup();const first=h.strandSet!.curves[0],node=h.strandSet!.endpoints.find(e=>e.id===first.nodes[1])!;
  h=syncStrands({...h,strandSet:{...h.strandSet!,curves:h.strandSet!.curves.map(c=>c.id===first.id?{...c,start:{value:.2,random:[-.1,.1]},end:{value:.8,random:[-.15,.15]}}:c),endpoints:h.strandSet!.endpoints.map(e=>e.id===node.id?{...e,x:{value:.1,random:[-.2,.2]}}:e)}});
  const rolled=rerollStrands(h,[first.id],seededHairRandom('hair')),before=JSON.stringify(rolled),g=generateHair(rolled),copy=JSON.parse(JSON.stringify(rolled));
  expect(rolled.strandSet!.curves[1]).toEqual(h.strandSet!.curves[1]);expect(rolled.strandSet!.curves[0].angle).toBe(first.angle);
  for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:30},{yaw:-80,pitch:-40}]){const d=projectHairDrawing(rolled,g,view);expect(parseDrawing(d)).toEqual(d);expect(d.curves).toHaveLength(4);}
  expect(JSON.stringify(rolled)).toBe(before);expect(parseHairstyle(copy)).toEqual(rolled);
  const ranges=rolled.drawing.displayIntervals!.find(t=>t.anchor.id===first.id)!.ranges[0];expect(ranges.start).toBeGreaterThanOrEqual(.1);expect(ranges.start).toBeLessThanOrEqual(.3);expect(ranges.end).toBeGreaterThanOrEqual(.65);expect(ranges.end).toBeLessThanOrEqual(.95);
 });
 it('binding / cusp / unbinding share sampled surface endpoints and remain correct in 3D',()=>{
  let h=setup();const [a,b]=h.strandSet!.curves;
  h=editHairDrawing(h,connect(h.drawing,{curveId:a.id,end:1},{curveId:b.id,end:1},'CUSP'));
  expect(h.strandSet!.curves[0].nodes[1]).toBe(h.strandSet!.curves[1].nodes[1]);
  const id=h.strandSet!.curves[0].nodes[1];h=syncStrands({...h,strandSet:{...h.strandSet!,endpoints:h.strandSet!.endpoints.map(e=>e.id===id?{...e,x:{value:.1,random:[-.1,.1]},y:{value:-.2,random:[-.1,.1]}}:e)}});
  h=rerollStrands(h,[a.id],seededHairRandom('bind'));const g=generateHair(h);expect(g.strands![0].cubic[3]).toEqual(g.strands![1].cubic[3]);
  expect(parseDrawing(h.drawing)).toEqual(h.drawing);
  const freed=editHairDrawing(h,unbind(h.drawing,{curveId:b.id,end:1}));expect(freed.strandSet!.curves[0].nodes[1]).not.toBe(freed.strandSet!.curves[1].nodes[1]);expect(shapeOf(freed.drawing,b.id)).toEqual(shapeOf(h.drawing,b.id));
 });
 it('deleting never resurrects roles, and duplicating a layer retains recipes and random ranges',()=>{
  let h=setup();const c=h.strandSet!.curves[0];h=syncStrands({...h,strandSet:{...h.strandSet!,curves:h.strandSet!.curves.map(x=>x===c?{...x,end:{value:.8,random:[-.2,.1]}}:x)}});
  const doubled=editHairDrawing(h,duplicateLayer(h.drawing,h.drawing.layers[0].id));expect(doubled.strandSet!.curves).toHaveLength(8);expect(parseHairstyle(JSON.parse(JSON.stringify(doubled)))).toEqual(doubled);
  const clone=doubled.strandSet!.curves.filter(x=>!h.strandSet!.curves.some(c=>c.id===x.id));expect(clone.some(x=>JSON.stringify(x.end)===JSON.stringify(h.strandSet!.curves[0].end))).toBe(true);
  const empty=editHairDrawing(doubled,deleteObjects(doubled.drawing,doubled.drawing.curves.map(c=>c.id)));expect(syncStrands(empty).drawing.curves).toHaveLength(0);expect(generateHair(empty).strands).toHaveLength(0);
  expect(addStrand(empty,empty.drawing.layers[0].id).drawing.curves).toHaveLength(1);
 });
 it('reroll protects locked strands and a shared locked endpoint',()=>{
  let h=setup();const [a,b]=h.strandSet!.curves;
  h=editHairDrawing(h,connect(h.drawing,{curveId:a.id,end:0},{curveId:b.id,end:0},'POSITION'));
  const node=h.strandSet!.curves[0].nodes[0];h=syncStrands({...h,strandSet:{...h.strandSet!,endpoints:h.strandSet!.endpoints.map(e=>e.id===node?{...e,x:{value:0,random:[-.2,.2]}}:e)},drawing:{...h.drawing,curves:h.drawing.curves.map(c=>c.id===b.id?{...c,locked:true}:c)}});
  const rolled=rerollStrands(h,undefined,seededHairRandom('locked'));
  expect(rolled.strandSet!.endpoints.find(e=>e.id===node)).toEqual(h.strandSet!.endpoints.find(e=>e.id===node));
  expect(shapeOf(rolled.drawing,b.id)).toEqual(shapeOf(h.drawing,b.id));
  expect(rolled.strandSet!.curves.find(c=>c.id===b.id)).toEqual(h.strandSet!.curves.find(c=>c.id===b.id));
 });
 it('private reference transforms and 9 named states persist without modifying the Drawing document',()=>{
  let ref:RecordingReferenceImage={name:'hair reference',dataUrl:'data:image/png;base64,AAAA',width:100,height:200,visible:true,locked:false,opacity:.5,offset:[0,0],scale:1,rotation:0};
  for(let i=1;i<=9;i++)ref=saveBackgroundState({...ref,offset:[i,-i],scale:i},String(i),'Slot '+i,i);
  ref=applyBackgroundState(ref,'2');expect(ref.offset).toEqual([2,-2]);
  const h=setup(),project=createEmptyProject(),source=structuredClone(h.drawing);project.drawing=source;project.hairstyle={...h,drawing:{...h.drawing,reference:ref}};
  const parsed=parseHairstyle(JSON.parse(JSON.stringify(project.hairstyle)));expect(parsed.drawing.reference).toEqual(ref);expect(project.drawing.reference).toBeUndefined();
  const state={...useEditor.getState(),project},adapter=hairEditorState(state);expect(adapter.project.drawing).toBe(project.hairstyle.drawing);expect(state.project.drawing).toBe(source);
 });
});
