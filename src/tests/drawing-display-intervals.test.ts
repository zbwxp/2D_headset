import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type DrawingDocument as Doc} from '../domain/drawing/model';
import {strokeFor} from '../domain/drawing/strokes';
import {addDisplayInterval,changeDisplayInterval,removeDisplayInterval,displayField,displayPath,nearestDisplayPosition} from '../domain/drawing/displayIntervals';
import {strokeInk,fillGeometry,fillVisible,arcField,inkRuns,offsetGeometry} from '../domain/drawing/appearance';
const line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]];
function base(){const d=c.addLayer(emptyDrawing(),'Ink');return c.createCurve(d,d.layers[0].id,line,.1,'Line','a');}
function change(d:Doc,start:number,end:number,index=0){const t=d.displayIntervals![0];return changeDisplayInterval(d,t.id,t.ranges[index].id,{start,end});}
const ink=(d:Doc,id='a')=>strokeInk(d,strokeFor(d,id));
const length=(d:Doc,id='a')=>ink(d,id).reduce((n,r)=>n+arcField(r.shapes).total,0);
const extents=(d:Doc)=>{const xs=ink(d).flatMap(r=>r.shapes.flatMap(s=>[s[0][0],s[3][0]]));return [Math.min(...xs),Math.max(...xs)];};
test('single curve defaults to middle third; masks never modify raw geometry',()=>{
 const d=base(),n=addDisplayInterval(d,'a');expect(n.nodes).toBe(d.nodes);expect(n.curves).toBe(d.curves);expect(n.joins).toBe(d.joins);expect(length(n)).toBeCloseTo(1/3,8);expect(extents(n)[0]).toBeCloseTo(1/3);expect(extents(n)[1]).toBeCloseTo(2/3);expect(ink(n)[0].clipped).toBe(true);
 const t=n.displayIntervals![0];expect(removeDisplayInterval(n,t.id,t.ranges[0].id).displayIntervals).toEqual([]);expect(length(removeDisplayInterval(n,t.id,t.ranges[0].id))).toBeCloseTo(1);
});
test('multiple intervals form a union, with no duplicated ink and no phantom bridges',()=>{
 let d=change(addDisplayInterval(base(),'a'),.1,.3);d=change(addDisplayInterval(d,'a'),.6,.9,1);expect(ink(d)).toHaveLength(2);expect(length(d)).toBeCloseTo(.5);
 d=change(d,.2,.8,1);expect(ink(d)).toHaveLength(1);expect(length(d)).toBeCloseTo(.7);d=change(d,.5,.5);d=change(d,.5,.5,1);expect(ink(d)).toEqual([]);
});
test('arc positions cross curve joins and exact splitting preserves displayed region',()=>{
 let d=base();d=c.createCurve(d,d.layers[0].id,line.map(([x,y])=>[x+1,y]) as Cubic,.1,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');d=addDisplayInterval(d,'b');
 expect(length(d)).toBeCloseTo(2/3);expect(ink(d)[0].shapes).toHaveLength(2);const before=extents(d),split=c.splitCurve(d,'a',.4).document;expect(extents(split)).toEqual(expect.arrayContaining([expect.closeTo(before[0],7),expect.closeTo(before[1],7)]));expect(length(split)).toBeCloseTo(length(d),7);
 expect(parseDrawing(JSON.parse(JSON.stringify(split)))).toEqual(split);
});
test('closed intervals wrap across origin, merge into one run and leave fill complete',()=>{
 const d=c.addLayer(emptyDrawing(),'Circle'),e=c.ellipse(d,d.layers[0].id,[-1,-1],[1,1],.04);let n=p.createFill(e.document,e.ids,'white');const before=fillGeometry(n,n.fills[0]),total=arcField(before.shapes).total;n=change(addDisplayInterval(n,e.ids[0]),.85,.15);const id=e.ids[0];
 expect(ink(n,id)).toHaveLength(1);expect(ink(n,id)[0].closed).toBe(false);expect(length(n,id)/total).toBeCloseTo(.3,5);expect(fillGeometry(n,n.fills[0])).toEqual(before);expect(fillVisible(n,n.fills[0])).toBe(true);
 n=change(n,0,1);expect(ink(n,id)[0].closed).toBe(true);expect(length(n,id)).toBeCloseTo(total,5);
});
test('closed-loop origin stays stable when layer item order or traversal direction changes',()=>{
 const d=c.addLayer(emptyDrawing(),'Loop'),e=c.ellipse(d,d.layers[0].id,[-1,-.5],[1,.5],.02),n=change(addDisplayInterval(e.document,e.ids[0]),.12,.46),path=displayPath(n,e.ids[0]),field=displayField(n,path),t=n.displayIntervals![0];
 const a=field.at(field.native(t,.12)).p,b=field.at(field.native(t,.46)).p;
 const reordered={...n,layers:n.layers.map(l=>({...l,items:[...l.items.slice(2),...l.items.slice(0,2)]}))},f=displayField(reordered,displayPath(reordered,e.ids[0]));expect(f.at(f.native(t,.12)).p).toEqual(expect.arrayContaining(a.map(v=>expect.closeTo(v,7))));
 const reversed={...path,segments:[...path.segments].reverse().map(x=>({...x,reverse:!x.reverse}))},r=displayField(n,reversed);expect(r.at(r.native(t,.46)).p[0]).toBeCloseTo(b[0],7);expect(r.at(r.native(t,.46)).p[1]).toBeCloseTo(b[1],7);
});
test('profile and taper remain measured along original whole ink, not restarted at interval ends',()=>{
 const full=inkRuns([line],.1,'TAPER_END')[0],masked=inkRuns([line],.1,'TAPER_END',false,undefined,false,undefined,[],[[.65,.8]])[0];
 for(const q of masked.outline.filter(p=>p[1]>=0)){const match=full.outline.find(p=>Math.abs(p[0]-q[0])<1e-9&&p[1]>=0);if(match)expect(q[1]).toBeCloseTo(match[1],10);}
 expect(masked.outline[0][1]).toBeGreaterThan(.03);expect(masked.outline[Math.floor(masked.outline.length/2)-1][1]).toBeGreaterThan(0);expect(masked.uniform).toBe(false);
});
test('ink extensions only display with a covered original endpoint',()=>{
 let d=base();d=p.setInkEnd(p.setInkEnd(d,'a',0,{extension:.2}), 'a',1,{extension:.3});d=addDisplayInterval(d,'a');expect(extents(d)[0]).toBeCloseTo(1/3);expect(extents(d)[1]).toBeCloseTo(2/3);
 d=change(d,0,1);expect(extents(d)[0]).toBeCloseTo(-.2);expect(extents(d)[1]).toBeCloseTo(1.3);
});
test('round joins use their actual derived arc for marker positions and clipping',()=>{
 let d=base();d=c.createCurve(d,d.layers[0].id,[[1,0],[1,1/3],[1,2/3],[1,1]],.1,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);d=change(addDisplayInterval(d,'a'),.4,.6);const f=displayField(d,displayPath(d,'a')),t=d.displayIntervals![0];
 expect(f.geometry.pieces.some(p=>p.joinId)).toBe(true);expect(length(d)/f.total).toBeCloseTo(.2,5);const position=f.at(f.native(t,.5)).p;expect(Math.hypot(position[0]-1,position[1])).toBeGreaterThan(.03);
 const s=nearestDisplayPosition(f,t,position,.48);expect(s).toBeCloseTo(.5,3);
});
test('changing geometry moves markers with the stroke without editing stored fractions',()=>{
 const d=addDisplayInterval(base(),'a'),t=d.displayIntervals![0],n=c.moveHandle(d,{curveId:'a',end:0},[.3,.8]);expect(n.displayIntervals).toEqual(d.displayIntervals);
 const f=displayField(n,displayPath(n,'a')),p=f.at(f.native(t,t.ranges[0].start)).p;expect(p[1]).toBeGreaterThan(.1);const projected=nearestDisplayPosition(f,t,[p[0],p[1]+.01],1/3);expect(projected).toBeGreaterThan(.3);expect(projected).toBeLessThan(.37);
});
test('duplicate, delete anchor, move layer, save/load and validation keep appearance references valid',()=>{
 let d=addDisplayInterval(base(),'a');d=c.splitCurve(d,'a',.4).document;const ids=d.curves.map(c=>c.id),dupe=c.duplicateCurves(d,ids,undefined,[0,0]);expect(dupe.document.displayIntervals).toHaveLength(2);expect(length(dupe.document,dupe.ids[0])).toBeCloseTo(length(d),6);
 const removed=c.deleteCurves(d,[d.displayIntervals![0].anchor.id]);expect(removed.displayIntervals).toHaveLength(1);expect(()=>parseDrawing(removed)).not.toThrow();
 const layered=c.addLayer(d,'Other'),moved=c.moveToLayer(layered,ids,layered.layers[0].id);expect(moved.displayIntervals).toEqual(d.displayIntervals);expect(()=>parseDrawing(JSON.parse(JSON.stringify(dupe.document)))).not.toThrow();
 expect(c.deleteCurves(d,ids).displayIntervals).toEqual([]);expect(c.deleteLayer(d,d.layers[0].id).displayIntervals).toEqual([]);
 const track=d.displayIntervals![0];for(const value of [-.1,1.1,Infinity,NaN]){expect(()=>changeDisplayInterval(d,track.id,track.ranges[0].id,{start:value})).toThrow();expect(()=>parseDrawing({...d,displayIntervals:[{...track,ranges:[{...track.ranges[0],start:value}]}]})).toThrow();}
 expect(()=>parseDrawing({...d,displayIntervals:[{...track,anchor:{id:'missing',reverse:false}}]})).toThrow();
 expect(()=>addDisplayInterval(c.curveChange(d,'a',{locked:true}),'a')).toThrow(/锁定/);
});
test('stroke interval masks do not alter offset source geometry or raw endpoint relations',()=>{
 let d=p.createOffset(base(),'a');const source=offsetGeometry(d,d.offsets[0]),raw=shapeOf(d,'a');d=addDisplayInterval(d,'a');expect(offsetGeometry(d,d.offsets[0])).toEqual(source);expect(shapeOf(d,'a')).toEqual(raw);
});
