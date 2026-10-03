import {expect,test} from 'vitest';
import {drawingDeformProjection,quadProjection,rectQuad,type DeformRect,type Quad} from '../domain/deformation/cageField';
import {fitDeformedCubic,mappedParameter} from '../domain/deformation/cubicDeformation';
import {neutralBend} from '../domain/deformation/coons';
import {addLayer,createCurve,connect,ellipse} from '../domain/drawing/commands';
import {deformDrawing} from '../domain/drawing/deform';
import {transportDeformedIntervals} from '../domain/drawing/deformMaterial';
import {displayField,displayPath,addDisplayInterval,changeDisplayInterval} from '../domain/drawing/displayIntervals';
import {biarc} from '../domain/drawing/roundedJoin';
import {point} from '../domain/drawing/sampling';
import {emptyDrawing,shapeOf,length,sub,type Cubic,type Point2,type DrawingDocument} from '../domain/drawing/model';

const rect:DeformRect={min:[-1,-1],max:[1,1]},quad:Quad=[[-1,-1],[.85,-.8],[.5,1],[-.9,.8]];
const shape:Cubic=[[-.8,-.5],[-.6,.4],[.3,-.2],[.7,.6]];
const bowed=()=>{const value=neutralBend();value.handles[1][0][0]=value.handles[1][1][0]=1.2;value.handles[0][1][1]=-.1;return value;};
const near=(a:Point2,b:Point2,tolerance=1e-10)=>expect(length(sub(a,b))).toBeLessThan(tolerance);
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function stroke(){
 let d=addLayer(emptyDrawing(),'Material');const layer=d.layers[0].id;
 d=createCurve(d,layer,[[-.8,-.5],[-.7,-.4],[-.5,-.2],[-.2,0]],.013,'A','a');
 // The second source curve runs against the display traversal.
 d=createCurve(d,layer,[[.7,.6],[.5,.2],[.1,-.2],[-.2,0]],.013,'B','b');
 d=connect(d,{curveId:'a',end:1},{curveId:'b',end:1},'POSITION');
 return addDisplayInterval(d,'a');
}
function applyFit(d:DrawingDocument,field:ReturnType<typeof drawingDeformProjection>){
 const fits=new Map(d.curves.map(c=>[c.id,fitDeformedCubic(shapeOf(d,c.id),field)])),nodes=new Map<string,Point2>();
 for(const c of d.curves){const fitted=fits.get(c.id)!.shape;nodes.set(c.nodes[0],fitted[0]);nodes.set(c.nodes[1],fitted[3]);}
 const after:DrawingDocument={...d,nodes:d.nodes.map(n=>({...n,position:nodes.get(n.id)!})),curves:d.curves.map(c=>({...c,handles:[fits.get(c.id)!.shape[1],fits.get(c.id)!.shape[2]]}))};
 return {after,parameters:new Map([...fits].map(([id,result])=>[id,result.parameters]))};
}

test('pure cubic fit preserves the exact affine fast path and source parameter table',()=>{
 const matrix=([x,y]:Point2):Point2=>[2*x+.3*y+.2,-.4*x+1.1*y];
 const field=drawingDeformProjection(rect,rectQuad(rect).map(matrix) as Quad),source=freeze(structuredClone(shape)),result=fitDeformedCubic(source,field);
 expect(result.shape).toEqual(source.map(field.map));
 source.forEach((p,i)=>near(result.shape[i],matrix(p)));
 expect(result.parameters.values).toEqual(Array.from({length:129},(_,i)=>i/128));
 expect(result.maxError).toBeLessThan(1e-12);expect(source).toEqual(shape);
});

test('kernel recomputes from fixed input without accumulated fit error or a frozen member list',()=>{
 const cage=freeze({rect:structuredClone(rect),quad:structuredClone(quad),bend:bowed()}),source=freeze(structuredClone(shape));
 const field=drawingDeformProjection(cage.rect,cage.quad,cage.bend),first=fitDeformedCubic(source,field);
 const changed=bowed();changed.handles[2][0][1]+=.08;fitDeformedCubic(source,drawingDeformProjection(rect,quad,changed));
 const later:Cubic=[[.4,-.7],[.5,-.6],[.7,.3],[.8,.5]],added=fitDeformedCubic(later,field);
 expect(fitDeformedCubic(source,field)).toEqual(first);expect(cage).toEqual({rect,quad,bend:bowed()});
 expect(added.shape[0]).toEqual(field.map(later[0]));expect(added.shape[3]).toEqual(field.map(later[3]));
 // This exercises newly supplied geometry against one fixed field, not Snapshot persistence.
 expect(added.parameters.values[0]).toBe(0);expect(added.parameters.values.at(-1)).toBe(1);
});

test('nonlinear fit keeps exact endpoints and tangent rays but does not point-map handles',()=>{
 const field=drawingDeformProjection(rect,quad,bowed()),result=fitDeformedCubic(shape,field);
 for(const [endpoint,handle] of [[0,1],[3,2]]){
  expect(result.shape[endpoint]).toEqual(field.map(shape[endpoint]));
  const tangent=field.vector(shape[endpoint],sub(shape[handle],shape[endpoint])),actual=sub(result.shape[handle],result.shape[endpoint]);
  expect(Math.abs(tangent[0]*actual[1]-tangent[1]*actual[0])).toBeLessThan(1e-12);
  expect(tangent[0]*actual[0]+tangent[1]*actual[1]).toBeGreaterThan(0);
  expect(length(sub(result.shape[handle],field.map(shape[handle])))).toBeGreaterThan(1e-3);
 }
 expect(result.parameters.values.slice(1).every((v,i)=>v>result.parameters.values[i])).toBe(true);
 let sampled=0;for(let i=0;i<=256;i++)sampled=Math.max(sampled,length(sub(point(result.shape,mappedParameter(i/256,result.parameters)),field.map(point(shape,i/256)))));
 expect(result.maxError).toBeCloseTo(sampled,12);
});

test('derived ARC cubics use the same nonlinear fit with source parameter correspondence',()=>{
 const arcs=biarc([-.6,-.2],[1,0],[.4,.6],[0,1]),field=drawingDeformProjection(rect,quad,bowed());
 const fitted=arcs.map(s=>fitDeformedCubic(s,field));expect(fitted.length).toBeGreaterThan(0);
 arcs.forEach((source,i)=>{
  const result=fitted[i];expect(result.shape[0]).toEqual(field.map(source[0]));expect(result.shape[3]).toEqual(field.map(source[3]));
  expect(result.parameters.values.slice(1).every((v,j)=>v>result.parameters.values[j])).toBe(true);
  expect(result.maxError).toBeLessThan(.02);
  if(i)near(fitted[i-1].shape[3],result.shape[0]);
 });
 // This validates reusable math on an ARC piece. It does not register a nonlinear affine adapter.
});

test('pure interval transport matches Drawing authoring across reversed pieces and an exact seam',()=>{
 let source=stroke();const path=displayPath(source,'a'),old=displayField(source,path),track=source.displayIntervals![0];
 expect(path.segments.some(s=>s.reverse)).toBe(true);
 const seam=old.parts[0].length/old.total;
 source=changeDisplayInterval(source,track.id,track.ranges[0].id,{start:old.relative(track,seam),end:old.relative(track,.9)});
 freeze(source);const {after,parameters}=applyFit(source,drawingDeformProjection(rect,quad,bowed())),beforeAfter=structuredClone(after);
 const moved=transportDeformedIntervals(source,after,parameters),command=deformDrawing(source,['a','b'],rect,quad,false,bowed());
 expect(moved).toEqual(command.document);expect(after).toEqual(beforeAfter);expect(command.parameters).toEqual(parameters);
 const next=displayField(moved,displayPath(moved,'a')),range=moved.displayIntervals![0].ranges[0];
 near(next.at(next.native(moved.displayIntervals![0],range.start)).p,shapeOf(moved,'a')[3],1e-8);
 expect(range.id).toBe(track.ranges[0].id);expect(moved.curves.map(c=>c.width)).toEqual(source.curves.map(c=>c.width));
});

test('pure material transport preserves empty ranges and uses no document authoring on no-op input',()=>{
 const empty=emptyDrawing();expect(transportDeformedIntervals(empty,empty)).toBe(empty);
 let source=stroke();const t=source.displayIntervals![0];source=changeDisplayInterval(source,t.id,t.ranges[0].id,{start:.47,end:.47,mode:'HIDE'});
 const {after,parameters}=applyFit(source,drawingDeformProjection(rect,quad,bowed())),moved=transportDeformedIntervals(source,after,parameters),range=moved.displayIntervals![0].ranges[0];
 expect(range.start).toBe(range.end);expect(range.mode).toBe('HIDE');expect(range.id).toBe(t.ranges[0].id);
});

test('the fixed cage checks a newly evaluated cubic against the projective horizon',()=>{
 const field=quadProjection(rect,[[-1,-1],[1,-1],[.5,1],[-.5,1]]),bad:Cubic=[[0,-100],[.2,-100],[.2,-99],[0,-99]],before=structuredClone(bad);
 expect(()=>fitDeformedCubic(bad,field)).toThrow();expect(bad).toEqual(before);
 expect(fitDeformedCubic(shape,field).shape.flat().every(Number.isFinite)).toBe(true);
});


test('stationary endpoint handles and reversed cubics retain a finite ordered correspondence',()=>{
 const field=drawingDeformProjection(rect,quad,bowed()),stationary:Cubic=[[-.5,-.4],[-.5,-.4],[.2,.3],[.5,.5]];
 for(const source of [stationary,[...stationary].reverse() as Cubic]){
  const result=fitDeformedCubic(source,field);expect(result.shape.flat().every(Number.isFinite)).toBe(true);
  expect(result.parameters.values).toHaveLength(129);expect(result.parameters.values.slice(1).every((v,i)=>v>result.parameters.values[i])).toBe(true);
  expect(mappedParameter(-.2,result.parameters)).toBe(0);expect(mappedParameter(1.2,result.parameters)).toBe(1);
  const endpoint=source===stationary?0:3,handle=source===stationary?1:2;expect(result.shape[endpoint]).toEqual(result.shape[handle]);
 }
});

test('transport preserves full-loop identity, reversed anchor and disabled material metadata',()=>{
 const base=addLayer(emptyDrawing(),'Closed'),created=ellipse(base,base.layers[0].id,[-.8,-.6],[.8,.6],.013);let d=addDisplayInterval(created.document,created.ids[0]);
 const track=d.displayIntervals![0],range={...track.ranges[0],start:.37,end:.37,fullLoop:true,mode:'HIDE' as const,enabled:false,inkEnds:[{taper:.1},{extension:.02}] as const};
 d={...d,displayIntervals:[{...track,anchor:{...track.anchor,reverse:true},ranges:[{...range,inkEnds:[{...range.inkEnds[0]},{...range.inkEnds[1]}]}]}]};
 const {after,parameters}=applyFit(d,drawingDeformProjection(rect,quad,bowed())),moved=transportDeformedIntervals(d,after,parameters),next=moved.displayIntervals![0];
 expect(next.anchor).toEqual(d.displayIntervals![0].anchor);expect(next.ranges[0].start).toBe(next.ranges[0].end);
 const {start:oldStart,end:oldEnd,...oldMetadata}=range,{start,end,...metadata}=next.ranges[0];
 expect(metadata).toEqual(oldMetadata);expect(Number.isFinite(start)&&Number.isFinite(end)).toBe(true);expect(oldStart).toBe(oldEnd);
});
