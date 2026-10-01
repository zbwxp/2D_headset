import {expect,test} from 'vitest';
import * as c from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,sub,length,type Cubic,type DrawingDocument as Doc} from '../domain/drawing/model';
import {deformDrawing,mappedParameter,quadProjection,rectQuad,type Quad} from '../domain/drawing/deform';
import {addDisplayInterval,changeDisplayInterval,displayField,displayPath} from '../domain/drawing/displayIntervals';
import {point} from '../domain/drawing/sampling';
import {roundedJoins} from '../domain/drawing/roundedJoin';
const rect={min:[-1,-1] as [number,number],max:[1,1] as [number,number]},quad:Quad=[[-1,-1],[.85,-.8],[.5,1],[-.9,.8]];
function fixture(){let d=c.addLayer(emptyDrawing(),'Eye');const e=c.ellipse(d,d.layers[0].id,[-.8,-.6],[.8,.6],.01);d=createFill(e.document,e.ids,'white');return {d,ids:e.ids};}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
test('homography hits four corners exactly, is affine-exact, rejects crossing and horizon',()=>{
 const f=quadProjection(rect,quad);rectQuad(rect).forEach((p,i)=>expect(length(sub(f.map(p),quad[i]))).toBeLessThan(1e-12));
 for(const bad of [quad.map((p,i)=>i===2?quad[0]:p) as Quad,[quad[0],quad[2],quad[1],quad[3]] as Quad])expect(()=>quadProjection(rect,bad)).toThrow(/交叉/);
 const {d,ids}=fixture(),affine=rectQuad(rect).map(([x,y])=>[2*x+.3*y+.2,-.4*x+1.1*y]) as Quad,n=deformDrawing(d,ids,rect,affine);
 for(const id of ids)shapeOf(d,id).forEach(([x,y],i)=>expect(length(sub(shapeOf(n.document,id)[i],[2*x+.3*y+.2,-.4*x+1.1*y]))).toBeLessThan(1e-12));
 expect(n.maxError).toBeLessThan(1e-12);valid(n.document);
 expect(()=>quadProjection(rect,[[-1,-1],[1,-1],[.5,1],[-.5,1]]).map([0,-100])).toThrow();
});
test('perspective fit preserves IDs, closed fill, Smooth tangents, styles, ordering and source',()=>{
 const {d,ids}=fixture(),original=structuredClone(d),n=deformDrawing(d,ids,rect,quad),f=quadProjection(rect,quad);
 expect(n.document.layers).toEqual(d.layers);expect(n.document.fills).toEqual(d.fills);expect(n.document.joins).toEqual(d.joins);
 for(const id of ids){const a=shapeOf(d,id),b=shapeOf(n.document,id);expect(b[0]).toEqual(f.map(a[0]));expect(b[3]).toEqual(f.map(a[3]));expect(n.document.curves.find(c=>c.id===id)?.nodes).toEqual(d.curves.find(c=>c.id===id)?.nodes);}
 expect(n.maxError).toBeLessThan(.02);expect(n.maxError).toBeGreaterThan(0);valid(n.document);expect(d).toEqual(original);
});
test('whole-layer transform includes hidden standalone curves, keeping visibility and locks',()=>{
 let {d,ids}=fixture();d=c.createCurve(d,d.layers[0].id,[[-.5,.8],[-.2,.9],[.2,.9],[.5,.8]],.01,'Hidden','hidden');d=c.curveChange(d,'hidden',{visible:false});
 const all=[...ids,'hidden'],n=deformDrawing(d,all,rect,quad).document;
 expect(n.curves.find(c=>c.id==='hidden')?.visible).toBe(false);expect(shapeOf(n,'hidden')).not.toEqual(shapeOf(d,'hidden'));valid(n);
 const moved=c.transform(d,all,([x,y])=>[x+.2,y]);expect(shapeOf(moved,'hidden')[0][0]).toBeCloseTo(-.3);
 expect(()=>deformDrawing(d,['hidden'],rect,quad)).toThrow(/隐藏|锁定/);
 expect(()=>deformDrawing(c.curveChange(d,'hidden',{locked:true}),all,rect,quad)).toThrow(/锁定/);
 const hidden=c.layerChange(d,d.layers[0].id,{visible:false});expect(()=>deformDrawing(hidden,all,rect,quad)).not.toThrow();
});
test('display interval cuts retain material correspondence after nonuniform deformation',()=>{
 let {d,ids}=fixture();d=addDisplayInterval(d,ids[0]);const track=d.displayIntervals![0];d=changeDisplayInterval(d,track.id,track.ranges[0].id,{start:.85,end:.18});
 const old=displayField(d,displayPath(d,ids[0])),result=deformDrawing(d,ids,rect,quad),n=result.document,next=displayField(n,displayPath(n,ids[0])),nt=n.displayIntervals![0];
 for(const end of ['start','end'] as const){const s=old.native(d.displayIntervals![0],d.displayIntervals![0].ranges[0][end]),sample=old.at(s),index=old.parts.findIndex(p=>s*old.total<=p.start+p.length),target=next.geometry.pieces.findIndex(p=>p.owners[0]===old.geometry.pieces[index].owners[0]);expect(length(sub(next.at(next.native(nt,nt.ranges[0][end])).p,point(next.geometry.shapes[target],(displayPath(d,ids[0]).segments.find(u=>u.id===old.geometry.pieces[index].owners[0])!.reverse?1-mappedParameter(1-sample.t,result.parameters.get(old.geometry.pieces[index].owners[0])):mappedParameter(sample.t,result.parameters.get(old.geometry.pieces[index].owners[0]))))))).toBeLessThan(1e-5);}
 expect(nt.ranges[0].id).toBe(track.ranges[0].id);expect(nt.ranges[0].inkEnds).toEqual(track.ranges[0].inkEnds);valid(n);
 const full=changeDisplayInterval(d,track.id,track.ranges[0].id,{start:0,end:1});expect(deformDrawing(full,ids,rect,quad).document.displayIntervals![0].ranges[0]).toEqual(full.displayIntervals![0].ranges[0]);
});
test('arc joins and cuts survive deformation; linked nodes follow without layer ownership changes',()=>{
 let d=c.addLayer(emptyDrawing(),'Lines'),layer=d.layers[0].id;
 d=c.createCurve(d,layer,[[-.8,0],[-.5,0],[-.2,0],[0,0]],.01,'A','a');d=c.createCurve(d,layer,[[0,0],[0,.2],[0,.5],[0,.8]],.01,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.15);d=addDisplayInterval(d,'a');
 const t=d.displayIntervals![0];d=changeDisplayInterval(d,t.id,t.ranges[0].id,{start:.48,end:.52});
 const n=deformDrawing(d,['a','b'],rect,quad).document;expect([...roundedJoins(n).values()].every(g=>!g.error)).toBe(true);valid(n);
 d=c.addLayer(d,'Other');d=c.createCurve(d,d.layers[0].id,[[.2,.8],[.4,.8],[.6,.8],[.8,.8]] as Cubic,.01,'C','c');d=c.linkEndpoints(d,{curveId:'b',end:1},{curveId:'c',end:0});
 const linked=deformDrawing(d,['a','b'],rect,quad).document;expect(shapeOf(linked,'b')[3]).toEqual(shapeOf(linked,'c')[0]);expect(linked.layers).toEqual(d.layers);valid(linked);
});
test('long curved contour uses monotone fitting correspondence instead of distorting its silhouette',()=>{
 let d=c.addLayer(emptyDrawing(),'Collar');const s:Cubic=[[-1.1564,-.6919],[-1.2191,-.839],[.5323,-.8701],[.4925,-.6613]];
 d=c.createCurve(d,d.layers[0].id,s,.01,'Collar','a');
 const r={min:[-1.22,-.88] as [number,number],max:[.54,-.45] as [number,number]},q=rectQuad(r);q[2][0]-=.35;q[3][0]-=.14;q[2][1]+=.035;q[3][1]-=.02;
 const n=deformDrawing(d,['a'],r,q),p=n.parameters.get('a')!;
 expect(n.maxError*250).toBeLessThan(1);expect(p.values[0]).toBe(0);expect(p.values.at(-1)).toBe(1);expect(p.values.slice(1).every((v,i)=>v>p.values[i])).toBe(true);valid(n.document);
});
test('one selected side of Smooth retains its partner tangent and requires explicit relation scope',()=>{
 let d=c.addLayer(emptyDrawing(),'Stroke');d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.6,.2],[-.2,0],[0,0]],.01,'A','a');d=c.createCurve(d,d.layers[0].id,[[0,0],[.2,0],[.6,-.2],[.8,0]],.01,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');
 expect(()=>deformDrawing(d,['a'],rect,quad)).toThrow(c.RelatedSelection);
 const n=deformDrawing(d,['a'],rect,quad,true).document;valid(n);expect(shapeOf(n,'b')[3]).toEqual(shapeOf(d,'b')[3]);
});
