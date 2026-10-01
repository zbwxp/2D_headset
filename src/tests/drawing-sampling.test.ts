import {test,expect} from 'vitest';
import {arcField,point,samples} from '../domain/drawing/sampling';
import {evaluate,split} from '../domain/geometry/bezier';
import type {Cubic} from '../domain/drawing/model';
import {frameNavigation} from '../ui/recording/frameNavigation';

test('specialized 2D subdivision preserves the previous tolerance, sample positions and curve evaluation',()=>{
 const curves:Cubic[]=[[[0,0],[.3,.8],[.7,-.4],[1,0]],[[0,0],[1,1],[-1,1],[0,0]],[[1,2],[1,2],[1,2],[1,2]],[[0,0],[3,0],[-2,0],[1,0]]];
 function previous(shape:Cubic){
  const out=[{p:shape[0],t:0}];
  function visit(s:Cubic,a:number,b:number,depth:number){
   const v=[s[3][0]-s[0][0],s[3][1]-s[0][1]],den=Math.hypot(...v);
   const error=Math.max(...s.slice(1,3).map(p=>{const q=den?Math.max(0,Math.min(1,((p[0]-s[0][0])*v[0]+(p[1]-s[0][1])*v[1])/(den*den))):0;return Math.hypot(p[0]-s[0][0]-v[0]*q,p[1]-s[0][1]-v[1]*q);}));
   if(!depth||error<=.00004&&b-a<=1/32){out.push({p:s[3],t:b});return;}
   const [l,r]=split(s.map(p=>[...p,0]),.5).map(c=>c.map(p=>p.slice(0,2)) as Cubic);const m=(a+b)/2;visit(l,a,m,depth-1);visit(r,m,b,depth-1);
  }visit(shape,0,1,14);return out;
 }
 for(const shape of curves){expect(samples(shape)).toEqual(previous(shape));for(let i=0;i<=100;i++)expect(point(shape,i/100)).toEqual(evaluate(shape.map(p=>[...p,0]),i/100).slice(0,2));}
});
test('arc tables share only unchanged values and detach from mutable control points',()=>{
 const shape:Cubic=[[0,0],[.3,.8],[.7,-.4],[1,0]],saved=structuredClone(shape),a=arcField([shape]),before=a.at(.4);
 expect(arcField([structuredClone(shape)]).parts[0].pts).toBe(a.parts[0].pts);
 shape[1][1]+=.3;const edited=arcField([shape]);expect(edited.parts[0].pts).not.toBe(a.parts[0].pts);expect(edited.at(.4)).not.toEqual(before);
 expect(a.at(.4)).toEqual(before);expect(arcField([saved]).parts[0].pts).toBe(a.parts[0].pts);
});
test('navigation coalesces device events and flushes the exact last angle on release',()=>{
 const callbacks=new Map<number,FrameRequestCallback>(),seen:unknown[]=[];let serial=0;
 const queue=frameNavigation(v=>seen.push(v),f=>{callbacks.set(++serial,f);return serial;},id=>{callbacks.delete(id);});
 for(let yaw=0;yaw<50;yaw++)queue.push({yaw,pitch:3});expect(callbacks.size).toBe(1);expect(seen).toEqual([]);
 [...callbacks.values()][0](0);expect(seen).toEqual([{yaw:49,pitch:3}]);expect(callbacks.size).toBe(0);
 queue.push({yaw:17.25,pitch:-4.5});queue.flush();expect(seen.at(-1)).toEqual({yaw:17.25,pitch:-4.5});expect(callbacks.size).toBe(0);
 queue.push({yaw:90,pitch:0});queue.cancel();expect(callbacks.size).toBe(0);expect(seen).toHaveLength(2);
});
