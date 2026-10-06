// dot's notification contract matrix from the Mac review of 8875a57, copied from
// /Users/bowen/Documents/Codex/2026-10-06/task/review-8875a57/proto/base/test/dot-warning-contract.test.ts
// ONE assertion changed (marked [CHANGED]), pending dot's agreement: when onWarning throws, apply's
// result lists WARNING_HANDLER_FAILED after OBSERVER_FAILED instead of dropping it silently. The
// commit outcome (ok, written, document, history, revision, handler called once) is asserted as dot wrote it.
import {it,expect} from 'vitest'
import {react,transaction} from '@tldraw/state'
import {Editor} from '../src/editor'
import {createApi} from '../src/api'
import {exampleRecords,ids} from '../src/fixture'
const cmd={type:'moveAnchors' as const,targets:[{curveId:ids.C1,anchorId:'a2'}],delta:{x:10,y:5}}
const doc=(e:Editor)=>e.reader.serialize('document')
const snapshot=(e:Editor)=>({doc:doc(e),hist:e.history,revision:e.revision,dirty:e.isDirty})
for(const operation of ['apply','undo','redo','batch-curve','batch-history','apiBatch-history'] as const){
 for(const throws of [false,true]){
  it(`${operation}: warning callback ${throws?'throws':'returns'} preserves committed-result contract`,()=>{
   const e=new Editor(exampleRecords());const fresh=snapshot(e);let edited:any;
   if(operation==='undo'||operation==='redo'){e.apply(cmd);edited=snapshot(e);if(operation==='redo')e.undo()}
   let armed=false;let warnings=0;
   e.onWarning=()=>{warnings++;if(throws)throw Error('warning sink failed')}
   const stop=react('dot-'+operation,()=>{if(operation.endsWith('history'))e.history;else e.reader.get(ids.C1);if(armed)throw Error('observer failed')});armed=true;
   let result:any;let thrown:any;
   try{
    if(operation==='apply')result=e.apply(cmd);
    else if(operation==='undo')result=e.undo();
    else if(operation==='redo')result=e.redo();
    else if(operation==='apiBatch-history')result=createApi(e).applyBatch('group',[cmd]);
    else result=e.batch('group',()=>e.apply(cmd));
   }catch(error){thrown=String(error)}finally{stop()}
   const after=snapshot(e);
   console.log('WARNING_CASE',JSON.stringify({operation,throws,result,thrown,warnings,point:(e.reader.get(ids.C1) as any).anchors.a2.p,history:e.history,revision:e.revision}));
   expect(thrown,'notification failure must not escape as command failure').toBeUndefined();
   expect(warnings).toBe(1);
   if(operation==='undo'){expect(result).toBe(true);expect(after.doc).toEqual(fresh.doc);expect(after.hist).toEqual({undo:[],redo:['moveAnchors']});expect(after.revision).toBe(0)}
   else if(operation==='redo'){expect(result).toBe(true);expect(after).toEqual(edited)}
   else{
    const resultItem=Array.isArray(result)?result[0]:result;expect(resultItem).toMatchObject({ok:true,written:true});
    expect((e.reader.get(ids.C1) as any).anchors.a2.p).toEqual({x:20,y:65});
    expect(e.history).toEqual({undo:[operation==='apply'?'moveAnchors':'group'],redo:[]});expect(e.revision).toBe(1);
    // [CHANGED by Claude, see header] dot's original: toEqual([OBSERVER_FAILED]) in both callback modes
    if(operation==='apply')expect(result.warnings).toEqual(throws?[{code:'OBSERVER_FAILED',message:'observer failed'},{code:'WARNING_HANDLER_FAILED',message:'warning sink failed'}]:[{code:'OBSERVER_FAILED',message:'observer failed'}]);
   }
  })
 }
}
it('outer abort restores document/history/saved revision and never reuses revision',()=>{
 const e=new Editor(exampleRecords());const before=snapshot(e);let issued=0;
 try{transaction(()=>{e.apply(cmd);issued=e.revision;e.save();throw Error('abort')})}catch{}
 expect(snapshot(e)).toEqual(before);expect(e.savedRevision).toBe(0);const r=e.apply(cmd);expect(r.ok).toBe(true);expect(e.revision).toBeGreaterThan(issued)
})
it('batch callback rejection plus observer failure keeps original document/history',()=>{
 const e=new Editor(exampleRecords());const before=snapshot(e);e.onWarning=()=>{};let armed=false;
 const stop=react('rollback-watch',()=>{e.reader.get(ids.C1);if(armed)throw Error('observer failed')});armed=true;
 let err:any;try{e.batch('group',()=>{e.apply(cmd);throw Error('body failed')})}catch(x){err=String(x)}finally{stop()}
 expect(err).toBe('Error: body failed');expect(snapshot(e)).toEqual(before)
})
