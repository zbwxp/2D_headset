import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {cuspCorner} from '../domain/drawing/inkJoin';
import {emptyDrawing,shapeOf,type Cubic,type Point2} from '../domain/drawing/model';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk,fillVisible,fillGeometry,inkRuns} from '../domain/drawing/appearance';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+(b[0]-a[0])*2/3,a[1]+(b[1]-a[1])*2/3],b];
function corner(angle:number){const r=angle*Math.PI/180;return [line([-1,0],[0,0]),line([0,0],[-Math.cos(r),Math.sin(r)])] as [Cubic,Cubic];}
function joined(angle:number){let d=c.addLayer(emptyDrawing(),'Ink');corner(angle).forEach((s,i)=>{d=c.createCurve(d,d.layers[0].id,s,.1,undefined,String(i));});return c.connect(d,{curveId:'0',end:1},{curveId:'1',end:0},'CUSP');}
test('acute cusp tips stay pointed and never extend beyond five full widths',()=>{
 for(const degrees of [.001,1,5,10,15,45,90,150])for(const width of [.001,.01,.1,1]){const [a,b]=corner(degrees),g=cuspCorner(a,b,width/2);expect(g.pinch).toBe(false);expect(g.tip).toHaveLength(4);const tip=g.tip[2];expect(tip.every(Number.isFinite)).toBe(true);
  const natural=width/2/Math.sin(degrees*Math.PI/360);expect(Math.hypot(...tip)).toBeCloseTo(Math.min(natural,5*width),7);
  if(natural<=5*width)expect(Math.abs(tip[1])).toBeCloseTo(width/2,8);
 }
});
test('unequal adjacent widths use their average, independent of translation, mirror and traversal',()=>{
 for(const [w0,w1] of [[.02,.1],[.1,.02],[.001,.2]])for(const mirror of [1,-1]){
  const [a,b]=corner(1).map(s=>s.map(([x,y])=>[mirror*x+4,y-3]) as Cubic),g=cuspCorner(a,b,w0/2,w1/2),tip=g.tip[2];
  expect(Math.hypot(tip[0]-4,tip[1]+3)).toBeCloseTo(5*(w0+w1)/2,8);
  const reversed=cuspCorner([...b].reverse() as Cubic,[...a].reverse() as Cubic,w1/2,w0/2);
  expect(reversed.tip[2][0]).toBeCloseTo(tip[0],8);expect(reversed.tip[2][1]).toBeCloseTo(tip[1],8);
 }
});
test('rendered cusp limit uses local profile and interval taper width, leaving authoring data intact',()=>{
 const d=joined(1),before=JSON.stringify(d),s=strokeFor(d,'0');expect(Math.hypot(...strokeInk(d,s)[0].tips[0][2])).toBeCloseTo(.5,8);expect(JSON.stringify(d)).toBe(before);
 const shapes=corner(1),runs=inkRuns(shapes,.1,'UNIFORM',false,undefined,false,undefined,[0],[[0,.75]],[{start:0,end:.75,ends:[{},{taper:1}]}]);
 // The cut's end taper is halfway through at the cusp: local width is .1 * .5.
 expect(Math.hypot(...runs[0].tips[0][2])).toBeCloseTo(5*.1*.5,8);
});
test('only CUSP adds pointed ink; source geometry and independent handles stay unchanged',()=>{
 let d=joined(12);const before=d.curves.map(x=>shapeOf(d,x.id));expect(strokeInk(d,strokeFor(d,'0'))[0].tips).toHaveLength(1);d=c.removeJoin(d,d.joins[0].id);expect(strokeInk(d,strokeFor(d,'0'))[0].tips).toHaveLength(0);expect(d.curves.map(x=>shapeOf(d,x.id))).toEqual(before);
});
test('profile width, mirrored/reversed geometry and closed seam all retain the cusp tip',()=>{
 let d=paint.setInk(joined(20),['0'],{profile:'TAPER_BOTH'});const run=strokeInk(d,strokeFor(d,'0'))[0];expect(run.tips).toHaveLength(1);expect(Math.hypot(...run.tips[0][2])).toBeCloseTo(.05/Math.sin(Math.PI/18),7);
 const mirror=c.transform(d,['0','1'],([x,y])=>[-x,y]);expect(strokeInk(mirror,strokeFor(mirror,'0'))[0].tips[0][2][0]).toBeCloseTo(-run.tips[0][2][0],7);
 const shapes=[line([0,0],[1,0]),line([1,0],[.5,.1]),line([.5,.1],[0,0])];expect(inkRuns(shapes,.1,'UNIFORM',false,undefined,true,undefined,[0,1,2])[0].tips).toHaveLength(3);
 const hidden=inkRuns(shapes,.1,'UNIFORM',false,[true,false,true],true,undefined,[0,1,2]);expect(hidden.flatMap(r=>r.tips)).toHaveLength(1);
});
test('exact reversal uses a finite zero-width tip at the shared point and survives zero handles',()=>{
 const [a,b]=corner(0),run=inkRuns([a,b],.1,'UNIFORM',false,undefined,false,undefined,[0])[0];expect(run.uniform).toBe(false);expect(run.tips).toHaveLength(0);expect(run.outline.every(p=>p.every(Number.isFinite))).toBe(true);expect(run.outline.filter(p=>Math.abs(p[0])<1e-9).every(p=>p[1]===0)).toBe(true);
 a[2]=a[3];b[1]=b[0];expect(cuspCorner(a,b,.05).pinch).toBe(true);
});
test('fill visibility inherits boundary geometry while retaining its own visibility and hidden ink',()=>{
 const start=c.addLayer(emptyDrawing(),'Fill'),e=c.ellipse(start,start.layers[0].id,[-1,-1],[1,1],.01);let d=paint.createFill(e.document,e.ids,'white'),f=d.fills[0],g=fillGeometry(d,f);
 d=paint.setInk(d,e.ids,{inkVisible:false});expect(fillVisible(d,f)).toBe(true);const hidden=c.setStrokeState(d,e.ids[0],{visible:false});expect(fillVisible(hidden,hidden.fills[0])).toBe(false);expect(fillGeometry(hidden,f)).toEqual(g);const shown=c.setStrokeState(hidden,e.ids[0],{visible:true});expect(fillVisible(shown,shown.fills[0])).toBe(true);
 expect(fillVisible(paint.changePaint(shown,f.id,{visible:false}),f)).toBe(false);expect(fillVisible(c.layerChange(shown,shown.layers[0].id,{visible:false}),f)).toBe(false);
});
