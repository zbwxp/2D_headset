import {describe,it,expect} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {interpolateSnapshotSimplexGeometry} from '../../domain/recordingSnapshot/simplexGeometry';

function basis(id:string,origin:Point2,options:{extra?:boolean;hidden?:boolean;link?:boolean}={}):{snapshotId:string;drawing:DrawingDocument}{
 const d=emptyDrawing();d.nodes=[{id:'a',position:origin},{id:'b',position:[origin[0]+1,origin[1]]}];
 d.curves=[{id:'c',name:'Curve',nodes:['a','b'],handles:[[origin[0]+.25,origin[1]+.1],[origin[0]+.75,origin[1]-.1]],visible:!options.hidden,locked:false,width:.01}];
 if(options.extra){d.nodes.push({id:'x',position:[3,3]},{id:'y',position:[4,3]});d.curves.push({id:'only',name:'Only here',nodes:['x','y'],handles:[[3.3,3],[3.7,3]],visible:true,locked:false,width:.01});}
 if(options.link){d.nodes.push({id:'linked',position:[...origin]});d.curves.push({id:'second',name:'Linked curve',nodes:['linked','b'],handles:[[origin[0]+.2,origin[1]+.2],[origin[0]+.8,origin[1]+.2]],visible:true,locked:false,width:.01});d.endpointLinks=[{id:'link',a:{curveId:'c',end:0},b:{curveId:'second',end:0}}];}
 d.layers=[{id:'layer',name:'Layer',visible:true,locked:false,items:d.curves.map(c=>c.id)}];return {snapshotId:id,drawing:d};
}
describe('active snapshot simplex geometry',()=>{
 it('keeps exact vertex objects and hides one-vertex membership only in interpolation',()=>{
  const a=basis('a',[0,0],{extra:true}),b=basis('b',[2,0]),c=basis('c',[0,2]);
  expect(interpolateSnapshotSimplexGeometry([a],[1]).drawing).toBe(a.drawing);
  const result=interpolateSnapshotSimplexGeometry([a,b,c],[.2,.3,.5]);
  expect(result.drawing.curves.map(c=>c.id)).toEqual(['c']);expect(result.drawing.nodes[0].position).toEqual([.6,1]);
  expect(result.drawing.curves[0].handles[0][0]).toBeCloseTo(.85,14);expect(result.drawing.curves[0].handles[0][1]).toBeCloseTo(1.1,14);
 });
 it('uses geometry support independently of hidden flags and signed response weights',()=>{
  const a=basis('a',[0,0],{hidden:true,extra:true}),b=basis('b',[2,0]),c=basis('c',[0,2]);
  const result=interpolateSnapshotSimplexGeometry([a,b,c],[.6,.2,.2],target=>target.kind==='node'?[-1,1,1]:[.6,.2,.2]);
  expect(result.drawing.curves.map(c=>c.id)).toEqual(['c']);expect(result.drawing.curves[0].visible).toBe(false);
  expect(result.drawing.nodes[0].position).toEqual([2,2]);
 });
 it('keeps one linked-node authority and carries relative handles once',()=>{
  const bases=[basis('a',[0,0],{link:true}),basis('b',[2,0],{link:true}),basis('c',[0,2],{link:true})];
  const calls:string[]=[];const result=interpolateSnapshotSimplexGeometry(bases,[.2,.3,.5],(target,_axis,_positions,w)=>{if(target.kind==='node')calls.push(target.nodeId);return w;});
  expect(result.nodeAuthorities.get('linked')).toBe('a');
  expect(result.drawing.nodes.find(n=>n.id==='linked')!.position).toEqual(result.drawing.nodes.find(n=>n.id==='a')!.position);
  expect(calls.filter(id=>id==='a')).toHaveLength(2);expect(calls).not.toContain('linked');
  expect(result.drawing.curves[0].handles[0][0]-result.drawing.nodes[0].position[0]).toBeCloseTo(.25,14);
 });
 it('does not impose a one-sided relation on another snapshot',()=>{
  const a=basis('a',[0,0],{link:true}),b=basis('b',[2,0],{link:true});b.drawing.endpointLinks=[];b.drawing.nodes.find(n=>n.id==='linked')!.position=[3,0];
  const result=interpolateSnapshotSimplexGeometry([a,b],[.5,.5]);
  expect(result.drawing.endpointLinks).toEqual([]);expect(result.drawing.nodes.find(n=>n.id==='a')!.position).toEqual([1,0]);
  expect(result.drawing.nodes.find(n=>n.id==='linked')!.position).toEqual([1.5,0]);expect(result.diagnostics.join(' ')).toContain('link');
 });
 it('does not snap an inconsistent inherited link immediately off a real vertex',()=>{
  const a=basis('a',[0,0],{link:true}),b=basis('b',[2,0],{link:true});a.drawing.nodes.find(n=>n.id==='linked')!.position=[.5,0];
  const result=interpolateSnapshotSimplexGeometry([a,b],[1-1e-9,1e-9]);
  expect(result.drawing.endpointLinks).toEqual([]);expect(result.drawing.nodes.find(n=>n.id==='linked')!.position[0]).toBeCloseTo(.5,8);expect(result.diagnostics.join(' ')).toContain('not silently snapped');
 });
 it('rejects zero support inputs and incompatible scalar output without source mutation',()=>{
  const a=basis('a',[0,0]),b=basis('b',[2,0]),before=JSON.stringify([a,b]);
  expect(()=>interpolateSnapshotSimplexGeometry([a,b],[1,0])).toThrow('positive');
  expect(()=>interpolateSnapshotSimplexGeometry([a,b],[.5,.5],()=>[1,1])).toThrow('sum-one');
  expect(JSON.stringify([a,b])).toBe(before);
 });
});
