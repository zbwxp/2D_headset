import {test,expect,vi} from 'vitest';
import {emptyDrawing,parseDrawing,type DrawingDocument as Doc,type DisplayIntervalMode} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {addDisplayInterval,changeDisplayInterval,setDisplayIntervalEnd,displayPath,displayField,intervalMode,removeDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokeInk,fillGeometry,fillVisible,arcField} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
import {blendPoseIntervals} from '../domain/recording/poseIntervals';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {serializeProject} from '../app/autosave';
function base(){const d=c.addLayer(emptyDrawing(),'Mouth');const n=c.createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'Mouth','mouth');n.nodes.forEach((p,i)=>p.id=String(i));n.curves[0].nodes=['0','1'];return n;}
function range(d:Doc,mode:DisplayIntervalMode,start:number,end:number,id='mouth'){
 let n=addDisplayInterval(d,id,mode);const t=n.displayIntervals!.at(-1)!,r=t.ranges.at(-1)!;
 n=changeDisplayInterval(n,t.id,r.id,{start,end});n=setDisplayIntervalEnd(n,t.id,r.id,0,{taper:0});return setDisplayIntervalEnd(n,t.id,r.id,1,{taper:0});
}
const field=(d:Doc,id='mouth')=>displayField(d,displayPath(d,id));
const ink=(d:Doc,id='mouth')=>strokeInk(d,strokeFor(d,id));
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
const blend=(a:Doc,b:Doc,t:number)=>({...a,displayIntervals:blendPoseIntervals(a,[{drawing:a,weight:1-t},{drawing:b,weight:t}])});

test('gap-only cuts the middle of a curve, empty gap is neutral and full gap hides all ink',()=>{
 const b=base(),d=range(b,'HIDE',.3,.7);expect(field(d).mask).toEqual([[0,.3],[.7,1]]);expect(ink(d)).toHaveLength(2);expect(d.curves).toBe(b.curves);expect(d.nodes).toBe(b.nodes);
 const t=d.displayIntervals![0],r=t.ranges[0];expect(field(changeDisplayInterval(d,t.id,r.id,{end:.3})).mask).toEqual([[0,1]]);
 expect(ink(changeDisplayInterval(d,t.id,r.id,{start:0,end:1}))).toEqual([]);expect(field(removeDisplayInterval(d,t.id,r.id)).mask).toBeUndefined();valid(d);
});
test('positive ranges union first, gaps win regardless of insertion order and overlapped gap markers do not create extra tips',()=>{
 let d=range(base(),'SHOW',.1,.9);d=range(d,'HIDE',.3,.5);d=range(d,'HIDE',.4,.7);expect(field(d).mask).toEqual([[.1,.3],[.7,.9]]);expect(ink(d)).toHaveLength(2);
 const reversed={...d,displayIntervals:d.displayIntervals!.map(t=>({...t,ranges:[...t.ranges].reverse()}))};expect(field(reversed).inkSpans).toEqual(field(d).inkSpans);
 const separate=range(range(base(),'HIDE',.15,.25),'HIDE',.65,.75);expect(field(separate).mask).toEqual([[0,.15],[.25,.65],[.75,1]]);valid(d);
});
test('gap marker styles apply on the surviving sides, preserve outer pen tips and extend into the gap',()=>{
 let d=range(base(),'HIDE',.3,.7),t=d.displayIntervals![0],r=t.ranges[0];
 d=setDisplayIntervalEnd(d,t.id,r.id,0,{taper:.1,extension:.02});d=setDisplayIntervalEnd(d,t.id,r.id,1,{taper:.15,extension:.03});
 d=p.setInkEnd(d,'mouth',0,{taper:.04});d=p.setInkEnd(d,'mouth',1,{taper:.05});
 const f=field(d);expect(f.inkSpans![0].ends[1]).toEqual({taper:.1,extension:.02});expect(f.inkSpans![1].ends[0]).toEqual({taper:.15,extension:.03});
 const runs=ink(d);expect(runs[0].shapes.at(-1)![3][0]).toBeCloseTo(.32);expect(runs[1].shapes[0][0][0]).toBeCloseTo(.67);
 for(const run of runs){expect(run.uniform).toBe(false);expect(run.outline[0][1]).toBeCloseTo(0);expect(run.outline[run.outline.length/2-1][1]).toBeCloseTo(0);}
 const path=displayPath(d,'mouth'),back=displayField(d,{...path,segments:[{id:'mouth',reverse:true}]});expect(back.inkSpans![0].ends[1]).toEqual(f.inkSpans![1].ends[0]);valid(d);
});
test('closed wrapping gaps complement the cyclic domain with no seam tip; fill stays whole',()=>{
 let d=c.addLayer(emptyDrawing(),'Loop');const e=c.ellipse(d,d.layers[0].id,[-1,-1],[1,1],.02),id=e.ids[0];d=p.createFill(e.document,e.ids,'black');const fill=fillGeometry(d,d.fills[0]);
 d=range(d,'HIDE',.85,.15,id);expect(ink(d,id)).toHaveLength(1);expect(ink(d,id)[0].closed).toBe(false);expect(ink(d,id).reduce((n,r)=>n+arcField(r.shapes).total,0)/field(d,id).total).toBeCloseTo(.7,5);
 expect(fillGeometry(d,d.fills[0])).toEqual(fill);expect(fillVisible(d,d.fills[0])).toBe(true);
 const t=d.displayIntervals![0],r=t.ranges[0];d=changeDisplayInterval(d,t.id,r.id,{start:.3,end:.6});d=setDisplayIntervalEnd(d,t.id,r.id,0,{taper:.1});d=setDisplayIntervalEnd(d,t.id,r.id,1,{taper:.1});
 const run=ink(d,id)[0];expect(ink(d,id)).toHaveLength(1);const seam=field(d,id).at(0).p,near=run.outline.filter(p=>Math.hypot(p[0]-seam[0],p[1]-seam[1])<.02);expect(near.length).toBeGreaterThan(0);near.forEach(p=>expect(Math.hypot(p[0]-seam[0],p[1]-seam[1])).toBeGreaterThan(.008));valid(d);
});
test('new/deleted gap first pinches, then opens from its midpoint with the full authored tip distance',()=>{
 const a=base();let b=range(a,'HIDE',.3,.7);const track=b.displayIntervals![0],r=track.ranges[0];b=setDisplayIntervalEnd(b,track.id,r.id,0,{taper:.1,extension:.02});
 expect(field(blend(a,b,0)).mask).toEqual([[0,1]]);
 const mid=blend(a,b,.5);expect(field(mid).mask![0][1]).toBeCloseTo(.425);expect(field(mid).mask![1][0]).toBeCloseTo(.575);expect(field(mid).inkSpans![0].ends[1].taper).toBeCloseTo(.1);expect(field(mid).inkSpans![0].ends[1].extension).toBeCloseTo(.0075);
 expect(field(blend(b,a,.5)).inkSpans).toEqual(field(mid).inkSpans);expect(field(blend(a,b,.001)).mask).toEqual([[0,1]]);expect(field(blend(a,b,.001)).pinches[0].tapers).toEqual([.1,0]);expect(field(blend(a,b,1)).mask).toEqual(field(b).mask);valid(mid);
});
test('switching one authored range from visible to gap blends both roles without a halfway pop or duplicate IDs',()=>{
 const a=range(base(),'SHOW',.2,.8),t=a.displayIntervals![0],r=t.ranges[0],b=changeDisplayInterval(a,t.id,r.id,{mode:'HIDE'});
 for(const x of [0,.01,.49,.5,.51,.99,1]){const mid=blend(a,b,x),spans=field(mid).inkSpans!;expect(spans.reduce((n,s)=>n+s.end-s.start,0)).toBeCloseTo(.6-.2*x);valid(mid);}
 expect(field(blend(a,b,0)).mask).toEqual(field(a).mask);expect(field(blend(a,b,1)).mask).toEqual(field(b).mask);
 expect(a.displayIntervals![0].ranges[0].mode).toBe('SHOW');expect(b.displayIntervals![0].ranges[0].mode).toBe('HIDE');
});
test('gaps carry through snapshot interpolation across the closed seam and survive exact splitting, cloning and mode validation',()=>{
 const a=range(base(),'HIDE',.3,.7),split=c.splitCurve(a,'mouth',.5).document;expect(field(split).mask).toEqual(field(a).mask);expect(ink(split)).toHaveLength(2);valid(split);
 const cloned=c.duplicateCurves(split,split.curves.map(c=>c.id)).document;expect(cloned.displayIntervals!.map(t=>intervalMode(t.ranges[0]))).toEqual(['HIDE','HIDE']);valid(cloned);
 const t=a.displayIntervals![0],r=t.ranges[0];expect(()=>changeDisplayInterval(a,t.id,r.id,{mode:'INVALID' as DisplayIntervalMode})).toThrow();expect(()=>parseDrawing({...a,displayIntervals:[{...t,ranges:[{...r,mode:'INVALID'}]}]})).toThrow();
 const old=structuredClone(a);delete old.displayIntervals![0].ranges[0].mode;expect(field(old).mask).toEqual([[.3,.7]]);valid(old);
 let loop=c.addLayer(emptyDrawing(),'Loop');const e=c.ellipse(loop,loop.layers[0].id,[-1,-1],[1,1],.02),id=e.ids[0];loop=range(e.document,'HIDE',.85,.05,id);const tr=loop.displayIntervals![0],last=changeDisplayInterval(loop,tr.id,tr.ranges[0].id,{start:.95,end:.15});
 const mid=blend(loop,last,.5),mask=field(mid,id).mask!;expect(mask).toHaveLength(1);expect(mask[0][0]).toBeCloseTo(.1);expect(mask[0][1]).toBeCloseTo(.9);valid(mid);
});
test('type edits and gap creation are undoable and retain modes/styles through snapshots and project save/load',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../app/store'),{commitDrawing}=await import('../ui/drawing/edit'),editor=()=>useEditor.getState();editor().load({...createLandmarkProject(),drawing:base()});const before=editor().project;
  commitDrawing(range(before.drawing!,'HIDE',.3,.7));const gap=editor().project;editor().undo();expect(editor().project).toBe(before);editor().redo();expect(editor().project).toBe(gap);
  const t=gap.drawing!.displayIntervals![0];commitDrawing(changeDisplayInterval(gap.drawing!,t.id,t.ranges[0].id,{mode:'SHOW'}));editor().undo();expect(editor().project).toBe(gap);
  const state=saveDrawingSnapshot({drawing:gap.drawing!},'Mouth gap'),loaded=parseLandmarks(serializeProject({...gap,...state}));expect(loaded.drawing).toEqual(gap.drawing);expect(loaded.drawingSnapshots!.items[0].drawing.displayIntervals).toEqual(gap.drawing!.displayIntervals);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
