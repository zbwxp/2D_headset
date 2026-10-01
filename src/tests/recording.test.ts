import {describe,test,expect} from 'vitest';
import {emptyRecording,parseRecording,displayShape,canonical,type Cubic,type RecordedCurve} from '../domain/recording/model';
import {coverage,evaluate} from '../domain/recording/evaluation';
import {createRecorded,defaultShape,duplicate,editShape,mergeEndpoint,mirrorEdit,writeKey} from '../domain/recording/commands';
import {defaultHeadFrame,rotateFrame} from '../domain/head/frame';
import {recordingBasis,projectReference} from '../domain/recording/projection';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
const shape=(x:number,y=0):Cubic=>[[x,y],[x+1,y+1],[x+2,y+1],[x+3,y]];
const curve=(views:number[][]):RecordedCurve=>({id:'a',name:'A',visible:true,locked:false,keys:views.map(([yaw,pitch])=>({yaw,pitch,shape:shape(yaw,pitch)}))});
describe('view-space interpolation',()=>{
 test('singleton is valid only at key; no extrapolation',()=>{const c=curve([[30,0]]);expect(evaluate(c,{yaw:30,pitch:0}).status).toBe('key');const e=evaluate(c,{yaw:0,pitch:0});expect(e.status).toBe('frozen');expect(e.shape).toEqual(c.keys[0].shape);});
 test('collinear uses piecewise interpolation and projects to nearest segment',()=>{const c=curve([[0,0],[30,0],[60,0]]);c.keys[1].shape=shape(100);expect(evaluate(c,{yaw:15,pitch:0}).shape[0][0]).toBe(50);expect(evaluate(c,{yaw:15,pitch:10}).shape[0][0]).toBe(50);expect(evaluate(c,{yaw:15,pitch:10}).status).toBe('frozen');expect(coverage(c).triangles).toHaveLength(0);});
 test('vertical and diagonal line coverage do not fill a plane',()=>{for(const c of [curve([[20,-20],[20,0],[20,20]]),curve([[0,0],[20,20],[40,40]])]){const a=c.keys[0],b=c.keys[1],v={yaw:(a.yaw+b.yaw)/2,pitch:(a.pitch+b.pitch)/2};expect(evaluate(c,v).status).toBe('interpolation');expect(evaluate(c,{...v,yaw:v.yaw+1}).status).toBe('frozen');}});
 test('Delaunay is deterministic for cocircular keys and exact for affine shape fields',()=>{const points=[[0,0],[30,0],[30,30],[0,30],[15,15]],c=curve(points),reversed=curve([...points].reverse());const g=coverage(c);expect(g.triangles).toHaveLength(4);
 for(let yaw=1;yaw<30;yaw+=3)for(let pitch=1;pitch<30;pitch+=3){const e=evaluate(c,{yaw,pitch});expect(e.status).not.toBe('frozen');expect(e.shape[0][0]).toBeCloseTo(yaw);expect(e.shape[0][1]).toBeCloseTo(pitch);expect(evaluate(reversed,{yaw,pitch}).shape).toEqual(e.shape);}
 const square=curve(points.slice(0,4));expect(coverage(square).triangles).toHaveLength(2);
 });
 test('outside hull freezes at nearest point, not nearest key or previous view',()=>{const c=curve([[0,0],[30,0],[0,30]]),e=evaluate(c,{yaw:20,pitch:20});expect(e.status).toBe('frozen');expect(e.at.yaw).toBeCloseTo(15);expect(e.at.pitch).toBeCloseTo(15);expect(e.shape[0][0]).toBeCloseTo(15);evaluate(c,{yaw:180,pitch:89});expect(evaluate(c,{yaw:20,pitch:20})).toEqual(e);});
 test('interior keys and skinny triangles retain affine reproduction',()=>{const c=curve([[0,0],[180,0],[0,.0001],[30,.00002]]);const e=evaluate(c,{yaw:20,pitch:.00001});expect(e.status).toBe('interpolation');expect(e.shape[0][0]).toBeCloseTo(20);});
});
describe('one-shot commands and auto-key seeds',()=>{
 test('edit inside coverage seeds complete interpolated cubic and does not mutate source',()=>{const c=curve([[0,0],[30,0]]),r={...emptyRecording(),curves:[c]},v={yaw:15,pitch:0};const result=editShape(r,'a',v,s=>{s[1][1]+=5;return s;});expect(result.curves[0].keys).toHaveLength(3);expect(evaluate(result.curves[0],v).shape).toEqual([[15,0],[16,6],[17,1],[18,0]]);expect(c.keys).toHaveLength(2);});
 test('selection/no-op edit never makes a Key',()=>{const r=createRecorded(emptyRecording(),{yaw:30,pitch:0},'a','A');expect(editShape(r,'a',{yaw:0,pitch:0},s=>s)).toBe(r);});
 test('duplicate is WYSIWYG for exact, interpolated and frozen shapes, one key only',()=>{const r={...emptyRecording(),curves:[curve([[0,0],[30,0]])]};for(const v of [{yaw:0,pitch:0},{yaw:15,pitch:0},{yaw:-60,pitch:0}]){const d=duplicate(r,'a',v,'b',[.1,-.1]).curves[1];expect(d.keys).toHaveLength(1);const expected=displayShape(evaluate(r.curves[0],v).shape,v).map(([x,y])=>[x+.1,y-.1]);expect(displayShape(d.keys[0].shape,v)).toEqual(expected);expect(evaluate(d,v).status).toBe('key');}});
 test('mirror reads interpolation without source Key, preserves parameter order, targets frozen shape',()=>{let r={...emptyRecording(),curves:[curve([[0,0],[30,0]])]};r=createRecorded(r,{yaw:30,pitch:0},'b','B');const v={yaw:-15,pitch:0},next=mirrorEdit(r,'a','b',v);expect(next.curves[0]).toBe(r.curves[0]);expect(next.curves[0].keys).toHaveLength(2);expect(evaluate(next.curves[1],v).shape).toEqual(shape(15).map(([x,y])=>[-x,y]));expect(next.curves[1].keys.at(-1)!.yaw).toBe(15);expect(mirrorEdit(r,'a','b',{yaw:50,pitch:0})).toBe(r);});
 test('merge interpolated/frozen targets preserves adjacent vector and opposite endpoint/handle',()=>{let r=createRecorded(emptyRecording(),{yaw:15,pitch:0},'a','A',shape(3));r={...r,curves:[...r.curves,{...curve([[0,0],[30,0]]),id:'b'}]};for(const v of [{yaw:15,pitch:0},{yaw:-15,pitch:0}])for(const end of [0,3] as const){const prior=displayShape(evaluate(r.curves[1],v).shape,v),next=mergeEndpoint(r,{id:'a',end:3},{id:'b',end},v),after=displayShape(evaluate(next.curves[1],v).shape,v),h=end===0?1:2;expect(after[end]).toEqual(displayShape(evaluate(r.curves[0],v).shape,v)[3]);expect(after[h].map((x,i)=>x-after[end][i])).toEqual(prior[h].map((x,i)=>x-prior[end][i]));expect(after[end===0?3:0]).toEqual(prior[end===0?3:0]);expect(after[end===0?2:1]).toEqual(prior[end===0?2:1]);expect(next.curves[1].keys).toHaveLength(3);expect(next.curves[0]).toBe(r.curves[0]);}
 const frozen={...r,curves:[r.curves[0],{...r.curves[1],keys:[r.curves[1].keys[0]]}]};expect(evaluate(mergeEndpoint(frozen,{id:'a',end:0},{id:'b',end:3},{yaw:15,pitch:0}).curves[1],{yaw:15,pitch:0}).status).toBe('key');});
 test('locked targets reject all geometry writes',()=>{const r={...emptyRecording(),curves:[curve([[0,0]]),{...curve([[0,0]]),id:'b',locked:true}]},v={yaw:0,pitch:0};expect(mirrorEdit(r,'a','b',v)).toBe(r);expect(mergeEndpoint(r,{id:'a',end:0},{id:'b',end:3},v)).toBe(r);expect(editShape(r,'b',v,()=>defaultShape)).toBe(r);});
 test('negative-yaw direct edit inverse-mirrors without reversing controls',()=>{const v={yaw:-30,pitch:12};let r=createRecorded(emptyRecording(),v,'a','A',shape(1));r=editShape(r,'a',v,()=>shape(2));expect(r.curves[0].keys[0]).toEqual({yaw:30,pitch:12,shape:shape(2).map(([x,y])=>[-x,y])});expect(canonical({yaw:-180,pitch:90})).toEqual({yaw:180,pitch:89});});
});
describe('projection and project persistence',()=>{
 test('projected ellipsoid support radii and HeadFrame-local direction',()=>{const f={...defaultHeadFrame(),radiusX:2,radiusY:3,radiusZ:4};expect(recordingBasis(f,{yaw:0,pitch:0}).halfWidth).toBe(2);expect(recordingBasis(f,{yaw:90,pitch:0}).halfWidth).toBe(4);expect(recordingBasis(f,{yaw:45,pitch:0}).halfWidth).toBeCloseTo(Math.sqrt(10));
 f.orientation=[0,Math.sin(.3),0,Math.cos(.3)];const q=rotateFrame([2,0,0],f).map((x,i)=>x+f.center[i]) as [number,number,number];const p=projectReference(q,f,{yaw:0,pitch:0});expect(p[0]).toBeCloseTo(1);expect(p[1]).toBeCloseTo(0);});
 test('retired recordings are discarded and old projects load empty',()=>{const p=createLandmarkProject();const r=writeKey(createRecorded(emptyRecording(),{yaw:0,pitch:0},'a','A'), 'a',{yaw:30,pitch:10},defaultShape);expect(parseLandmarks(JSON.stringify({...p,recording:r})).recording).toBeUndefined();expect((parseLandmarks(JSON.stringify(p)).recording??emptyRecording())).toEqual(emptyRecording());});
 test('malformed and duplicate canonical Keys are rejected',()=>{const r=createRecorded(emptyRecording(),{yaw:0,pitch:0},'a','A');expect(()=>parseRecording({...r,version:2})).toThrow();r.curves[0].keys.push(r.curves[0].keys[0]);expect(()=>parseRecording(r)).toThrow();});
});
test('Delaunay covers complete hull without overlaps and satisfies empty circumcircles',()=>{
 let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 const c=curve([[0,-89],[180,-89],[180,89],[0,89],...Array.from({length:36},()=>[random()*180,random()*178-89])]),g=coverage(c);
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 expect(g.triangles.reduce((sum,t)=>sum+cross(g.points[t[0]],g.points[t[1]],g.points[t[2]])/2,0)).toBeCloseTo(180*178,7);
 for(const t of g.triangles){const [a,b,d]=t.map(i=>g.points[i]);for(let i=0;i<g.points.length;i++){if(t.includes(i))continue;const p=g.points[i],[u,v,w]=[a,b,d].map(q=>[q[0]-p[0],q[1]-p[1]]);const det=(u[0]**2+u[1]**2)*(v[0]*w[1]-v[1]*w[0])-(v[0]**2+v[1]**2)*(u[0]*w[1]-u[1]*w[0])+(w[0]**2+w[1]**2)*(u[0]*v[1]-u[1]*v[0]);expect(det).toBeLessThan(1e-5);}}
 for(let i=0;i<100;i++){const v={yaw:random()*180,pitch:random()*178-89},e=evaluate(c,v);expect(e.status).not.toBe('frozen');expect(e.shape[0][0]).toBeCloseTo(v.yaw,8);expect(e.shape[0][1]).toBeCloseTo(v.pitch,8);}
});

test('frozen boundary includes intermediate collinear keys and agrees with boundary evaluation',()=>{
 const c=curve([[15,0],[15,15],[15,30],[45,0]]);c.keys[1].shape[0][0]=10;
 for(const pitch of [7,15,20]){
  const e=evaluate(c,{yaw:14,pitch});expect(e.status).toBe('frozen');
  e.shape.flat().forEach((x,i)=>expect(x).toBeCloseTo(evaluate(c,{yaw:15,pitch}).shape.flat()[i],12));
 }
});

test('retired Gridify metadata is dropped without changing saved keys',()=>{
 const c={...curve([[0,0],[30,0],[0,30]]),gridStepDegrees:5};
 const result=parseRecording({version:1,curves:[c]});
 expect(result.curves[0]).not.toHaveProperty('gridStepDegrees');
 expect(result.curves[0].keys).toEqual(c.keys);
 expect(c.gridStepDegrees).toBe(5);
});
