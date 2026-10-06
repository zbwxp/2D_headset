// dot's independent yaw checks from the review of 2a48719, copied from
// /Users/bowen/Documents/Codex/2026-10-06/task/review-2a48719/proto/base/test/dot-yaw.test.ts
// Unchanged except: the connected-endpoint probe became KF-2 (now fixed: test/pose-connections.test.ts),
// and two [CHANGED] spots for the shared yaw budget (options renamed; the aggregate-retention test now
// asserts the bound instead of documenting its absence).
import {it,expect} from 'vitest'
import {Editor} from '../src/editor'
import {evaluate} from '../src/evaluate'
import {evaluateAtYaw} from '../src/pose'
import {exampleRecords,ids} from '../src/fixture'
import {Container,Reference,poseIdOf} from '../src/schema'
import {resetCounters,counters} from '../src/counters'
const state=(e:Editor)=>({doc:e.reader.serialize('document'),history:e.history,revision:e.revision,saved:e.savedRevision,dirty:e.isDirty})
const key=(e:Editor,curveId:any,yaw:number,offsets:any)=>e.apply({type:'setPoseKey',curveId,yaw,offsets})
it('source-local pose offsets transform through mirrored/scaled references rather than being added in screen axes',()=>{
 const scaled=Reference.create({id:Reference.createId('scale'),name:'scale',parentId:ids.L1,sourceId:ids.L3,transform:{a:2,b:0,c:0,d:3,e:10,f:-4}});const e=new Editor([...exampleRecords(),scaled]);expect(key(e,ids.E1,0,{}).ok).toBe(true);expect(key(e,ids.E1,90,{e2:{x:5,y:2}}).ok).toBe(true);
 const cached=e.derived.atYaw(90);const full=evaluateAtYaw(e.reader,90);const p=(addr:string)=>cached.curves.find(c=>c.address===addr)!.anchors.e2.p;
 console.log('REFERENCE_FRAME',JSON.stringify({source:p(ids.E1),mirror:p(`${ids.R1}/${ids.E1}`),scale:p(`${scaled.id}/${ids.E1}`),expectedMirror:{x:85,y:52},expectedScale:{x:-40,y:152},cachedEqualsFull:JSON.stringify(cached)===JSON.stringify(full)}));
 expect(p(ids.E1)).toEqual({x:-25,y:52});expect.soft(p(`${ids.R1}/${ids.E1}`)).toEqual({x:85,y:52});expect.soft(p(`${scaled.id}/${ids.E1}`)).toEqual({x:-40,y:152});
})
it('pose create/update observes ancestor locks and rejects unknown anchor/nonfinite input atomically',()=>{
 const parent=Container.create({id:Container.createId('locked'),name:'locked',index:'z',locked:true});const e=new Editor([...exampleRecords().map(r=>r.id===ids.L1?{...r,parentId:parent.id}:r),parent]);const before=state(e);expect(key(e,ids.C1,90,{a2:{x:3,y:0}})).toMatchObject({ok:false,written:false,error:{code:'LOCKED'}});expect(state(e)).toEqual(before);expect(e.reader.get(poseIdOf(ids.C1))).toBeUndefined();
 const free=new Editor(exampleRecords());for(const cmd of [{yaw:90,offsets:{missing:{x:1,y:0}}},{yaw:NaN,offsets:{}},{yaw:90,offsets:{a2:{x:Infinity,y:0}}}]){const s=state(free);expect(key(free,ids.C1,cmd.yaw,cmd.offsets).ok).toBe(false);expect(state(free)).toEqual(s)}
})
it('default base, explicit zero form, read-only angles, same-ID pose recreation, undo and open',()=>{
 const e=new Editor(exampleRecords(),{yawBudget:6}) /* [CHANGED] options renamed: one shared budget */;const base=e.derived.evaluated();expect(e.derived.atYaw(0)).toEqual(base);key(e,ids.C1,0,{a2:{x:2,y:1}});key(e,ids.C1,90,{a2:{x:20,y:10}});expect(e.derived.curveAt(ids.C1,0).anchors.a2.p).toEqual({x:12,y:61});expect(e.derived.curveAt(ids.C1,45).anchors.a2.p).toEqual({x:21,y:65.5});expect(e.derived.evaluated()).toEqual(base);e.save();const before=state(e);for(let y=-100;y<=100;y++)e.derived.atYaw(y);expect(state(e)).toEqual(before);expect(counters.yawEvictions).toBeGreaterThan(0);
 const opened=Editor.open(JSON.parse(JSON.stringify(e.save())));expect(opened.derived.atYaw(45)).toEqual(e.derived.atYaw(45));e.undo();e.undo();expect(e.reader.get(poseIdOf(ids.C1))).toBeUndefined();key(e,ids.C1,0,{a2:{x:-8,y:4}});expect(e.derived.curveAt(ids.C1,0).anchors.a2.p).toEqual({x:2,y:64});
 const single=new Editor(exampleRecords());key(single,ids.C1,90,{a2:{x:9,y:0}});expect(single.derived.curveAt(ids.C1,0).anchors.a2.p).toEqual({x:19,y:60});console.log('NO_IMPLICIT_ZERO','single key at 90 clamps at yaw 0; explicit zero key is needed')
})
it('19-yaw shared preview changes equals accepted free-anchor commit and never writes while previewing',()=>{
 const e=new Editor(exampleRecords());key(e,ids.C1,0,{});key(e,ids.C1,90,{a2:{x:9,y:0}});const cmd={type:'moveAnchors' as const,targets:[{curveId:ids.C1,anchorId:'a2'}],delta:{x:3,y:2}};const before=state(e);const plan=e.preview(cmd);if(!plan.ok)throw Error('preview');resetCounters();const ch=e.derived.previewChanges(plan.puts);const yaws=Array.from({length:19},(_,i)=>-90+i*10);const shown=yaws.map(y=>e.derived.previewAtYaw(plan.puts,y,ch));expect(counters.previews).toBe(1);expect(state(e)).toEqual(before);e.apply(cmd);yaws.forEach((y,i)=>expect(shown[i]).toEqual(evaluateAtYaw(e.reader,y)));expect(shown[18].curves.find(c=>c.address===ids.C1)!.anchors.a2.p).toEqual({x:22,y:62})
})
// [CHANGED by Claude] dot's original asserted the problem itself (lists kept 16 curve results with
// item capacity 2). With one shared budget the same scenario must keep the retained results within it.
it('cache eviction is correct and ONE shared budget bounds aggregate retained geometry (lists included)',()=>{
 const e=new Editor(exampleRecords().map(r=>r.id===ids.L2?{...r,locked:false}:r),{yawBudget:8});for(const [cid,aid]of [[ids.C1,'a2'],[ids.C2,'b2'],[ids.E1,'e2']]){key(e,cid,0,{});key(e,cid,90,{[aid]:{x:9,y:3}})}
 for(const y of [0,10,20,30]){e.derived.atYaw(y);expect(e.derived.yawBudget.retainedObjects().size).toBeLessThanOrEqual(8)}
 console.log('AGGREGATE_RETENTION',JSON.stringify({...e.derived.yawCacheSize,distinctRetained:e.derived.yawBudget.retainedObjects().size}));
 for(const y of [40,50,60,70,80])e.derived.atYaw(y);resetCounters();expect(e.derived.atYaw(0)).toEqual(evaluateAtYaw(e.reader,0));expect(counters.yawCurveEvals).toBeGreaterThan(0);expect(e.derived.yawBudget.retainedObjects().size).toBeLessThanOrEqual(8)
})

