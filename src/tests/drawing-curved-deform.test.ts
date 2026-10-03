import {expect,test} from 'vitest';
import * as c from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,sub,length,type Cubic,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {deformDrawing,drawingDeformProjection,mappedParameter,quadProjection,rectQuad,type Quad} from '../domain/drawing/deform';
import {assertBend,bendPoint,bendVector,neutralBend} from '../domain/deformation/coons';
import {addDisplayInterval,changeDisplayInterval,displayField,displayPath} from '../domain/drawing/displayIntervals';
import {point} from '../domain/drawing/sampling';
import {validateMirrorEditing} from '../domain/drawing/mirrorEditing';
const rect={min:[-1,-1] as Point2,max:[1,1] as Point2},quad:Quad=[[-1,-1],[.85,-.8],[.5,1],[-.9,.8]];
const near=(a:Point2,b:Point2,tolerance=1e-9)=>expect(length(sub(a,b))).toBeLessThan(tolerance);
function bowed(){const bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.2;bend.handles[0][1][1]=-.1;return bend;}
function fixture(){let d=c.addLayer(emptyDrawing(),'Eye');const e=c.ellipse(d,d.layers[0].id,[-.8,-.6],[.8,.6],.01);d=createFill(e.document,e.ids,'white');d=addDisplayInterval(d,e.ids[0]);const track=d.displayIntervals![0];d=changeDisplayInterval(d,track.id,track.ranges[0].id,{start:.83,end:.19});return {d,ids:e.ids};}

test('neutral and disabled boundaries preserve the exact old homography, fit and interval transport',()=>{
 const {d,ids}=fixture(),off={...bowed(),enabled:false};
 for(const q of [quad,rectQuad(rect)]){
  const old=deformDrawing(d,ids,rect,q),f=quadProjection(rect,q);
  for(const bend of [neutralBend(),off]){
   expect(deformDrawing(d,ids,rect,q,false,bend)).toEqual(old);
   const curved=drawingDeformProjection(rect,q,bend);
   for(const p of [[-.8,.4],[0,0],[.3,-.7]] as Point2[]){expect(curved.map(p)).toEqual(f.map(p));expect(curved.vector(p,[.3,.4])).toEqual(f.vector(p,[.3,.4]));expect(curved.denominator(p)).toBe(f.denominator(p));}
  }
 }
});

test('curved field is the existing Coons patch followed by the true homography, with analytic derivatives',()=>{
 const bend=bowed(),f=drawingDeformProjection(rect,quad,bend),h=quadProjection(rect,quad),source=([u,v]:Point2):Point2=>[2*u-1,2*v-1];
 for(let j=0;j<=6;j++)for(let i=0;i<=6;i++){
  const uv:Point2=[i/6,j/6],p=source(uv),direction:Point2=[.23,-.37],eps=1e-6;
  near(f.map(p),h.map(source(bendPoint(bend,uv))),1e-12);
  const a=f.map([p[0]+eps*direction[0],p[1]+eps*direction[1]]),b=f.map([p[0]-eps*direction[0],p[1]-eps*direction[1]]);
  near(f.vector(p,direction),[(a[0]-b[0])/(2*eps),(a[1]-b[1])/(2*eps)],1e-8);
  const ba=bendPoint(bend,[uv[0]+eps*direction[0],uv[1]+eps*direction[1]]),bb=bendPoint(bend,[uv[0]-eps*direction[0],uv[1]-eps*direction[1]]);
  near(bendVector(bend,uv,direction),[(ba[0]-bb[0])/(2*eps),(ba[1]-bb[1])/(2*eps)],1e-8);
 }
 expect(f.affine).toBe(false);
});

test('curved fit keeps one cubic per source ID, topology, appearance, tangent rays and material cuts',()=>{
 const {d,ids}=fixture(),before=structuredClone(d),bend=bowed(),f=drawingDeformProjection(rect,quad,bend),result=deformDrawing(d,ids,rect,quad,false,bend),n=result.document;
 expect(n.curves.map(v=>v.id)).toEqual(d.curves.map(v=>v.id));expect(n.nodes.map(v=>v.id)).toEqual(d.nodes.map(v=>v.id));
 for(const key of ['layers','fills','joins','endpointLinks','offsets'] as const)expect(n[key]).toEqual(d[key]);
 for(const id of ids){const a=shapeOf(d,id),b=shapeOf(n,id),parameters=result.parameters.get(id)!;expect(b).toHaveLength(4);expect(b[0]).toEqual(f.map(a[0]));expect(b[3]).toEqual(f.map(a[3]));
  for(const end of [0,1]){const pos=end?3:0,handle=end?2:1,tangent=f.vector(a[pos],sub(a[handle],a[pos])),fitted=sub(b[handle],b[pos]);expect(Math.abs(tangent[0]*fitted[1]-tangent[1]*fitted[0])).toBeLessThan(1e-12);}
  expect(parameters.values[0]).toBe(0);expect(parameters.values.at(-1)).toBe(1);expect(parameters.values.slice(1).every((v,i)=>v>parameters.values[i])).toBe(true);
 }
 const old=displayField(d,displayPath(d,ids[0])),next=displayField(n,displayPath(n,ids[0])),track=d.displayIntervals![0],nt=n.displayIntervals![0];
 for(const end of ['start','end'] as const){const s=old.native(track,track.ranges[0][end]),sample=old.at(s),index=old.parts.findIndex(p=>s*old.total<=p.start+p.length),id=old.geometry.pieces[index].owners[0],target=next.geometry.pieces.findIndex(p=>p.owners[0]===id),reverse=displayPath(d,ids[0]).segments.find(u=>u.id===id)!.reverse,t=reverse?1-mappedParameter(1-sample.t,result.parameters.get(id)):mappedParameter(sample.t,result.parameters.get(id));near(next.at(next.native(nt,nt.ranges[0][end])).p,point(next.geometry.shapes[target],t),1e-5);}
 expect(result.maxError).toBeGreaterThan(0);expect(result.maxError).toBeLessThan(.02);expect(parseDrawing(n)).toEqual(n);expect(d).toEqual(before);
 // Each cage gesture is evaluated against the fixed source. A later edit and
 // reverting its handles therefore cannot accumulate the previous fit error.
 const later=bowed();later.handles[2][0][1]+=.08;deformDrawing(d,ids,rect,quad,false,later);expect(deformDrawing(d,ids,rect,quad,false,bend)).toEqual(result);
});

test('a field fixing all four controls still evaluates the changed interior',()=>{
 const bounds={min:[0,0] as Point2,max:[1,1] as Point2};let d=c.addLayer(emptyDrawing(),'Corners');d=c.createCurve(d,d.layers[0].id,[[0,0],[1,0],[0,1],[1,1]],.01,'S','s');
 const result=deformDrawing(d,['s'],bounds,rectQuad(bounds),false,bowed());
 expect(result.parameters.has('s')).toBe(true);expect(shapeOf(result.document,'s')).not.toEqual(shapeOf(d,'s'));expect(result.maxError).toBeGreaterThan(0);
});

test('partial Smooth and cross-layer endpoint links survive a curved field',()=>{
 let d=c.addLayer(emptyDrawing(),'Stroke');d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.6,.2],[-.2,0],[0,0]],.01,'A','a');d=c.createCurve(d,d.layers[0].id,[[0,0],[.2,0],[.6,-.2],[.8,0]],.01,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');
 d=c.addLayer(d,'Follower');d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.7,.3],[-.6,.4],[-.5,.5]],.01,'Follower','f');d=c.linkEndpoints(d,{curveId:'a',end:0},{curveId:'f',end:0});
 expect(()=>deformDrawing(d,['a'],rect,quad,false,bowed())).toThrow(c.RelatedSelection);
 const n=deformDrawing(d,['a'],rect,quad,true,bowed()).document,a=shapeOf(n,'a'),b=shapeOf(n,'b'),ta=sub(a[2],a[3]),tb=sub(b[1],b[0]);
 expect(Math.abs(ta[0]*tb[1]-ta[1]*tb[0])).toBeLessThan(1e-12);expect(ta[0]*tb[0]+ta[1]*tb[1]).toBeLessThan(0);expect(b[3]).toEqual(shapeOf(d,'b')[3]);
 expect(a[0]).toEqual(shapeOf(n,'f')[0]);expect(n.layers).toEqual(d.layers);expect(n.endpointLinks).toEqual(d.endpointLinks);expect(parseDrawing(n)).toEqual(n);
});

test('mirror editing reflects the fitted cubic and reversed material correspondence',()=>{
 let d=c.addLayer(emptyDrawing(),'Pair');const shape:Cubic=[[-.9,-.5],[-.8,.2],[-.3,.5],[-.1,.6]],reflect=([x,y]:Point2):Point2=>[-x,y];
 d=c.createCurve(d,d.layers[0].id,shape,.01,'Left','left');d=c.createCurve(d,d.layers[0].id,[...shape].reverse().map(reflect) as Cubic,.01,'Right','right');
 d={...d,mirrorAxisX:0,mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'left',b:'right',reverse:true}]}} as DrawingDocument;
 d=addDisplayInterval(d,'right');const result=deformDrawing(d,['left'],rect,quad,false,bowed());
 shapeOf(result.document,'left').forEach((p,i)=>near(reflect(p),shapeOf(result.document,'right')[3-i]));
 expect(result.parameters.get('right')!.values).toEqual([...result.parameters.get('left')!.values].reverse().map(t=>1-t));expect(validateMirrorEditing(result.document).enabled).toBe(true);expect(parseDrawing(result.document)).toEqual(result.document);
});

test('invalid, folded and horizon-crossing cages reject without changing the source',()=>{
 const {d,ids}=fixture(),before=structuredClone(d),bad=neutralBend();bad.handles[1][0][0]=bad.handles[1][1][0]=-2;
 expect(()=>deformDrawing(d,ids,rect,quad,false,bad)).toThrow(/折叠/);
 bad.handles[1][0][0]=NaN;expect(()=>deformDrawing(d,ids,rect,quad,false,bad)).toThrow(/参数/);
 const horizon=neutralBend();horizon.handles[0][0][1]=horizon.handles[0][1][1]=-.5;assertBend(horizon);
 expect(()=>drawingDeformProjection({min:[0,0],max:[1,1]},[[0,0],[1,0],[.6,1],[.4,1]],horizon)).toThrow();expect(d).toEqual(before);
});
