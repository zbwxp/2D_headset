import {test,expect} from 'vitest';
import {createRecorded,duplicate,editShape,editEndpoint,mergeEndpoint,mirrorEdit} from '../domain/recording/commands';
import {bindEndpoints,evaluateRecording,deleteRecordedCurve} from '../domain/recording/junctions';
import {emptyRecording,parseRecording,displayShape,type Cubic} from '../domain/recording/model';
const shape=(x:number):Cubic=>[[x,0],[x+1,1],[x+2,1],[x+3,0]];
const v={yaw:0,pitch:0};
function setup(){let r=emptyRecording();for(const [id,x] of [['a',0],['b',5],['c',10]] as const){r=createRecorded(r,v,id,id,shape(x));r=editShape(r,id,{yaw:30,pitch:0},s=>{s[1][1]+=1;return s;});}return r;}
test('immediate bind preserves raw keys, chains follow derived master, coverage stays unchanged',()=>{
 const raw=setup(),r=bindEndpoints(raw,{id:'a',end:3},{id:'b',end:0},v,'ab'),chain=bindEndpoints(r,{id:'b',end:0},{id:'c',end:3},v,'bc');
 expect(r.curves).toBe(raw.curves);
 for(const yaw of [0,15,30,-15]){const e=evaluateRecording(chain,{yaw,pitch:0});expect(e.get('b')!.shape[0]).toEqual(e.get('a')!.shape[3]);expect(e.get('c')!.shape[3]).toEqual(e.get('a')!.shape[3]);}
 const e=evaluateRecording(chain,{yaw:45,pitch:0});expect(e.get('b')!.shape).toEqual(e.get('b')!.rawShape);
 const short={...r,curves:r.curves.map(c=>c.id==='a'?{...c,keys:[c.keys[0]]}:c)};expect(evaluateRecording(short,{yaw:15,pitch:0}).get('b')!.shape).toEqual(evaluateRecording(short,{yaw:15,pitch:0}).get('b')!.rawShape);
 expect(parseRecording(JSON.parse(JSON.stringify(chain)))).toEqual(chain);
});
test('negative yaw inverse edit preserves bound endpoint and authors handle exactly once',()=>{
 const r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab'),view={yaw:-15,pitch:0},before=evaluateRecording(r,view).get('b')!;
 const next=editShape(r,'b',view,s=>{s[1][0]+=.4;s[1][1]+=.2;return s;}),after=evaluateRecording(next,view).get('b')!;
 const a=displayShape(after.shape,view),b=displayShape(before.shape,view);expect(a[1][0]-b[1][0]).toBeCloseTo(.4);expect(a[1][1]-b[1][1]).toBeCloseTo(.2);expect(after.rawShape[0]).toEqual(before.rawShape[0]);expect(after.shape[0]).toEqual(before.shape[0]);
 const moved=editShape(next,'a',view,s=>{s[3][1]+=2;return s;});expect(evaluateRecording(moved,view).get('b')!.shape[0][1]).toBe(2);
 expect(mergeEndpoint(r,{id:'c',end:3},{id:'b',end:0},view)).toBe(r);
});
test('mirror retains binding, duplicate is visible independent copy, deleting source cleans relations',()=>{
 const r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab');
 const mirrored=mirrorEdit(r,'c','b',v);expect(mirrored.junctions).toEqual(r.junctions);expect(evaluateRecording(mirrored,v).get('b')!.shape[0]).toEqual(evaluateRecording(r,v).get('a')!.shape[3]);
 const copy=duplicate(r,'b',v,'d',[0,0]);expect(copy.curves.at(-1)!.keys[0].shape).toEqual(evaluateRecording(r,v).get('b')!.shape);expect(copy.junctions).toEqual(r.junctions);
 expect(deleteRecordedCurve(r,'a').junctions).toEqual([]);
});
test('reject duplicate incoming, cycles, invalid load, lock and uncovered creation',()=>{
 const r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab');
 expect(bindEndpoints(r,{id:'c',end:0},{id:'b',end:0},v,'cb').junctions).toHaveLength(2);
 expect(bindEndpoints(r,{id:'b',end:3},{id:'a',end:0},v,'ba')).toBe(r);
 expect(bindEndpoints(r,{id:'a',end:0},{id:'c',end:0},{yaw:60,pitch:0},'ac')).toBe(r);
 const locked={...r,curves:r.curves.map(c=>({...c,locked:true}))};expect(bindEndpoints(locked,{id:'a',end:0},{id:'c',end:0},v,'ac')).toBe(locked);
 expect(()=>parseRecording({...r,junctions:[...r.junctions!,{...r.junctions![0],id:'bad',masterCurveId:'b',followerCurveId:'a'}]})).toThrow();
});

test('either side edits the same shared point, keys both curves, preserves handles and negative yaw',()=>{
 const r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab');
 for(const yaw of [15,-15]){
  const view={yaw,pitch:0},prior=evaluateRecording(r,view),target:[number,number]=[.2,.7];
  const a=editEndpoint(r,'a',3,view,target),b=editEndpoint(r,'b',0,view,target);
  expect(a).toEqual(b);expect(a.junctions).toBe(r.junctions);
  const after=evaluateRecording(a,view);
  for(const [id,end] of [['a',3],['b',0]] as const){
   expect(a.curves.find(c=>c.id===id)!.keys.some(k=>k.yaw===15)).toBe(true);
   expect(displayShape(after.get(id)!.shape,view)[end]).toEqual(target);
   const h=end===0?1:2;
   for(const d of [0,1])expect(after.get(id)!.shape[h][d]-after.get(id)!.shape[end][d]).toBeCloseTo(prior.get(id)!.shape[h][d]-prior.get(id)!.shape[end][d]);
  }
  expect(a.curves.find(c=>c.id==='c')).toBe(r.curves.find(c=>c.id==='c'));
 }
});
test('shared edit follows active chains and branches, keys inactive coverage and respects locks',()=>{
 let r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab');
 r=bindEndpoints(r,{id:'b',end:0},{id:'c',end:3},v,'bc');
 const view={yaw:15,pitch:0},next=editEndpoint(r,'c',3,view,[0,.3]);
 for(const c of next.curves)expect(c.keys.some(k=>k.yaw===15)).toBe(true);
 for(const [id,end] of [['a',3],['b',0],['c',3]] as const)expect(evaluateRecording(next,view).get(id)!.shape[end]).toEqual([0,.3]);
 const locked={...r,curves:r.curves.map(c=>c.id==='b'?{...c,locked:true}:c)};expect(editEndpoint(locked,'a',3,view,[0,1])).toBe(locked);
 const short={...r,curves:r.curves.map(c=>c.id==='a'?{...c,keys:[c.keys[0]]}:c)},edited=editEndpoint(short,'b',0,view,[.1,.2]);
 expect(edited.curves[0].keys.some(k=>k.yaw===15)).toBe(true);expect(evaluateRecording(edited,view).get('b')!.shape[0]).toEqual([.1,.2]);
 expect(editEndpoint(r,'b',0,v,evaluateRecording(r,v).get('b')!.shape[0])).toBe(r);
});

 test('frozen shared endpoint edits key the whole group and allow a third member in either click order',()=>{
  for(const reverse of [false,true]){
   let r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab');
   const existing={id:'b',end:0 as const},added={id:'c',end:3 as const};
   r=bindEndpoints(r,reverse?added:existing,reverse?existing:added,v,'third');
   expect(r.junctions).toHaveLength(2);
   const view={yaw:-60,pitch:10},next=editEndpoint(r,'b',0,view,[-.4,.8]);
   for(const [id,end] of [['a',3],['b',0],['c',3]] as const){
    expect(next.curves.find(c=>c.id===id)!.keys.some(k=>k.yaw===60&&k.pitch===10)).toBe(true);
    const e=evaluateRecording(next,view).get(id)!;expect(e.status).toBe('key');expect(displayShape(e.shape,view)[end]).toEqual([-.4,.8]);
   }
   expect(parseRecording(JSON.parse(JSON.stringify(next)))).toEqual(next);
  }
 });

test('per-view Unbind snapshots derived endpoint, allows independent editing and roundtrips state',async()=>{
 const {setBindingState}=await import('../domain/recording/commands');
 const {junctionEnabled}=await import('../domain/recording/bindingState');
 const r=bindEndpoints(setup(),{id:'a',end:3},{id:'b',end:0},v,'ab'),view={yaw:30,pitch:0};
 const before=evaluateRecording(r,view).get('b')!.shape;
 const unbound=setBindingState(r,'ab',view,false);
 expect(evaluateRecording(unbound,view).get('b')!.shape).toEqual(before);
 expect(junctionEnabled(unbound.junctions![0],v)).toBe(true);
 expect(junctionEnabled(unbound.junctions![0],{yaw:15,pitch:0})).toBe(false);
 expect(junctionEnabled(unbound.junctions![0],{yaw:-30,pitch:0})).toBe(false);
 const moved=editEndpoint(unbound,'b',0,view,[8,2]);
 expect(moved.curves[0]).toBe(unbound.curves[0]);expect(evaluateRecording(moved,view).get('b')!.shape[0]).toEqual([8,2]);
 const handle=editShape(moved,'b',view,s=>{s[1][1]+=1;return s;});expect(evaluateRecording(handle,view).get('b')!.shape[1][1]).toBeCloseTo(evaluateRecording(moved,view).get('b')!.shape[1][1]+1);
 const rebound=setBindingState(handle,'ab',view,true),e=evaluateRecording(rebound,view);expect(e.get('a')!.shape[3]).toEqual(e.get('b')!.shape[0]);
 expect(parseRecording(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
 expect(()=>parseRecording({...moved,junctions:[{...moved.junctions![0],bindingKeys:[{yaw:0,pitch:0,bound:1}]}]})).toThrow();
});
