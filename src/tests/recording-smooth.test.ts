import {test,expect} from 'vitest';
import {createRecorded,editShape} from '../domain/recording/commands';
import {bindEndpoints,evaluateRecording} from '../domain/recording/junctions';
import {editSmoothStyle,setSmoothMode,smoothGeometry,smoothStyle,smoothCoverage,handleTension,type SmoothJunction} from '../domain/recording/smooth';
import {emptyRecording,parseRecording,type Cubic,type Recording} from '../domain/recording/model';
const v={yaw:0,pitch:0};
function setup(){let r=emptyRecording();for(const [id,shape] of [['a',[[-1,1],[-.8,.5],[-.3,0],[0,0]]],['b',[[0,0],[.3,0],[.8,.5],[1,1]]]] as [string,Cubic][]){r=createRecorded(r,v,id,id,shape);for(const view of [{yaw:60,pitch:0},{yaw:0,pitch:60}])r=editShape(r,id,view,s=>{s[1][1]+=.2;return s;});}r=bindEndpoints(r,{id:'a',end:3},{id:'b',end:0},v,'j');return setSmoothMode(r,'j',v,true);}
const j=(r:Recording)=>r.junctions![0] as SmoothJunction;
const diff=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]);
function parallel(a:number[],b:number[]){expect(Math.abs(a[0]*b[1]-a[1]*b[0])).toBeLessThan(1e-10);expect(a[0]*b[0]+a[1]*b[1]).toBeGreaterThan(0);}
test('first key propagates everywhere; style hull freezes style only, raw remains immutable',()=>{
 const r=setup(),n=editSmoothStyle(r,'j',v,{tensionA:2,radiusScale:1.3});expect(n.curves).toBe(r.curves);
 for(const view of [v,{yaw:20,pitch:20},{yaw:50,pitch:0}]){expect(smoothStyle(j(n),view)).toEqual({radiusScale:1.3,tensionA:2,tensionB:1});expect(smoothGeometry(n,view).transitions).toHaveLength(1);}
 expect(smoothGeometry(n,{yaw:70,pitch:0}).transitions).toHaveLength(0);
 expect(smoothGeometry(n,v).transitions[0].shape).not.toEqual(smoothGeometry(n,{yaw:30,pitch:10}).transitions[0].shape);
 expect(smoothStyle({...j(r),smoothKeys:[]},v)).toEqual({radiusScale:1,tensionA:1,tensionB:1});
});
test('two keys, triangle and closest boundary style; source keys never determine style topology',()=>{
 let r=setup();r=editSmoothStyle(r,'j',{yaw:30,pitch:0},{tensionA:3});
 expect(smoothStyle(j(r),{yaw:15,pitch:20}).tensionA).toBeCloseTo(2);
 expect(smoothStyle(j(r),{yaw:50,pitch:0}).tensionA).toBeCloseTo(3);
 r=editSmoothStyle(r,'j',{yaw:0,pitch:30},{tensionA:2});
 expect(smoothStyle(j(r),{yaw:10,pitch:10}).tensionA).toBeCloseTo(2);
 const before=smoothCoverage(j(r));const added=editShape(r,'a',{yaw:12,pitch:12},s=>{s[1][0]+=.1;return s;});expect(smoothCoverage(j(added))).toBe(before);
 expect(smoothStyle(j(r),{yaw:-15,pitch:0})).toEqual(smoothStyle(j(r),{yaw:15,pitch:0}));
 expect(parseRecording(JSON.parse(JSON.stringify(r)))).toEqual(r);
});
test('all endpoint orientations and style settings preserve exact trim positions and positive G1',()=>{
 for(const ae of [0,3] as const)for(const be of [0,3] as const){let r=setup();r={...r,junctions:[],curves:r.curves.map(c=>({...c,keys:c.keys.map(k=>({...k,shape:((c.id==='a'?ae===0:be===3)?[...k.shape].reverse():k.shape) as Cubic}))}))};r=bindEndpoints(r,{id:'a',end:ae},{id:'b',end:be},v,'j');r=setSmoothMode(r,'j',v,true);
 for(const tension of [.05,1,4]){const n=editSmoothStyle(r,'j',v,{tensionA:tension,tensionB:4.05-tension,radiusScale:2});const g=smoothGeometry(n,v),tr=g.transitions[0];expect(tr).toBeDefined();parallel(diff(tr.shape[1],tr.shape[0]),tr.ta);parallel(diff(tr.shape[3],tr.shape[2]),tr.tb);expect(g.sources.get('a')![ae]).toEqual(tr.shape[0]);expect(g.sources.get('b')![be]).toEqual(tr.shape[3]);}}
});
test('degenerate geometry and overlap fall back to position without partial trimming',()=>{
 const r=setup(),zero={...r,curves:r.curves.map(c=>({...c,keys:c.keys.map(k=>({...k,shape:[[0,0],[0,0],[0,0],[0,0]] as Cubic}))}))};expect(smoothGeometry(zero,v).warnings.size).toBe(1);expect(smoothGeometry(zero,v).transitions).toHaveLength(0);
 let three=createRecorded(r,v,'c','C',[[1,1],[1.3,1],[1.8,2],[2,2]]);three=bindEndpoints(three,{id:'b',end:3},{id:'c',end:0},v,'k');three=setSmoothMode(three,'k',v,true);
 three=editSmoothStyle(three,'j',v,{radiusScale:8});three=editSmoothStyle(three,'k',v,{radiusScale:8});
 const g=smoothGeometry(three,v);expect(g.warnings.size).toBe(2);expect(g.transitions).toHaveLength(0);expect(g.sources.get('b')).toEqual(evaluateRecording(three,v).get('b')!.shape);
});
test('one smooth per endpoint, malformed keys rejected and handle projection remains positive',()=>{
 let r=createRecorded(setup(),v,'c','C',[[0,0],[1,0],[1,1],[2,1]]);r=bindEndpoints(r,{id:'a',end:3},{id:'c',end:0},v,'other');expect(setSmoothMode(r,'other',v,true)).toBe(r);
 expect(()=>parseRecording({...r,junctions:[{...j(r),smoothKeys:[{yaw:0,pitch:0,radiusScale:1,tensionA:0,tensionB:1}]}]})).toThrow();
 expect(handleTension([0,30],[1,0],.1,1,[100,200])).toBe(1);expect(handleTension([-1000,0],[1,0],.1,1,[100,200])).toBe(.05);
});
test('normalized style follows source scaling and source key deletion leaves style field unchanged',()=>{
 const r=editSmoothStyle(setup(),'j',v,{radiusScale:1.4,tensionA:1.8,tensionB:.6}),field=smoothCoverage(j(r)),base=smoothGeometry(r,v).transitions[0];
 const scaled={...r,curves:r.curves.map(c=>({...c,keys:c.keys.map(k=>({...k,shape:k.shape.map(([x,y])=>[x*2,y*2]) as Cubic}))}))};
 const after=smoothGeometry(scaled,v).transitions[0];after.shape.flat().forEach((x,i)=>expect(x).toBeCloseTo(base.shape.flat()[i]*2,10));
 const removed={...r,curves:r.curves.map(c=>({...c,keys:[c.keys[0]]}))};expect(smoothCoverage(j(removed))).toBe(field);expect(smoothStyle(j(removed),{yaw:40,pitch:10})).toEqual(smoothStyle(j(r),{yaw:40,pitch:10}));
});

test('unbound state removes transition, preserves Smooth style, and returns on bound views',async()=>{
 const {setBindingState}=await import('../domain/recording/commands');
 let r=emptyRecording();
 r=createRecorded(r,{yaw:0,pitch:0},'a','A',[[-1,0],[-.7,0],[-.3,0],[0,0]]);
 r=createRecorded(r,{yaw:0,pitch:0},'b','B',[[0,0],[0,.3],[0,.7],[0,1]]);
 r=bindEndpoints(r,{id:'a',end:3},{id:'b',end:0},{yaw:0,pitch:0},'j');
 r=setSmoothMode(r,'j',{yaw:0,pitch:0},true);
 const before=r.junctions![0];r=setBindingState(r,'j',{yaw:30,pitch:0},false);
 expect(smoothGeometry(r,{yaw:0,pitch:0}).transitions).toHaveLength(1);
 expect(smoothGeometry(r,{yaw:30,pitch:0}).transitions).toHaveLength(0);
 expect(r.junctions![0].mode).toBe('SMOOTH');
 if(before.mode==='SMOOTH'&&r.junctions![0].mode==='SMOOTH')expect(r.junctions![0].smoothKeys).toEqual(before.smoothKeys);
 const position=setSmoothMode(r,'j',{yaw:0,pitch:0},false);expect(position.junctions![0].bindingKeys).toEqual(r.junctions![0].bindingKeys);
});
