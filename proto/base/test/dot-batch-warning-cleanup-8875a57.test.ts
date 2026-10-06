// dot's follow-up-edit cleanup check from the Mac review of 8875a57, copied from
// /Users/bowen/Documents/Codex/2026-10-06/task/review-8875a57/proto/base/test/dot-batch-warning-cleanup.test.ts
// ONE assertion changed (marked [CHANGED]), pending dot's agreement, plus a rollback-path variant that
// keeps dot's original expectation. Reason: since the notification is isolated, that batch no longer
// fails — it commits with warnings — so 'broken' is a real undo step before the follow-up edit.
import {it,expect} from 'vitest'
import {react} from '@tldraw/state'
import {Editor} from '../src/editor'
import {exampleRecords,ids} from '../src/fixture'
const cmd={type:'moveAnchors' as const,targets:[{curveId:ids.C1,anchorId:'a2'}],delta:{x:10,y:5}}
it('failed warning during batch rollback must not leave subsequent edits in an abandoned group',()=>{
 const e=new Editor(exampleRecords());e.onWarning=()=>{throw Error('sink failed')};let armed=false;
 const stop=react('curve-watcher',()=>{e.reader.get(ids.C1);if(armed)throw Error('observer failed')});armed=true;
 try{e.batch('broken',()=>e.apply(cmd))}catch{}finally{stop()}
 e.onWarning=()=>{};
 const result=e.apply(cmd);
 console.log('FOLLOWUP',JSON.stringify({result,history:e.history,revision:e.revision,point:(e.reader.get(ids.C1) as any).anchors.a2.p}));
 expect(result).toMatchObject({ok:true,written:true});
 // [CHANGED by Claude, see header] dot's original: toEqual(['moveAnchors']). Here the batch body does not fail,
 // so the batch commits (with warnings) and is one undo step; the follow-up edit is the next one.
 expect(e.history.undo).toEqual(['broken','moveAnchors']);expect(e.revision).toBeGreaterThan(0);
})
// Rollback-path variant (Claude): the body FAILS, the rollback flush hits the throwing subscriber, and the
// handler throws too. dot's original expectation applies unchanged: the group is cleaned up and the next
// edit is recorded.
it('failed batch body + failing rollback notification + failing handler: group cleaned up, next edit recorded',()=>{
 const e=new Editor(exampleRecords());const before=JSON.stringify(e.reader.serialize('document'));
 e.onWarning=()=>{throw Error('sink failed')};let armed=false;
 const stop=react('curve-watcher',()=>{e.reader.get(ids.C1);if(armed)throw Error('observer failed')});armed=true;
 let err:any;try{e.batch('broken',()=>{e.apply(cmd);throw Error('body failed')})}catch(x){err=String(x)}finally{stop()}
 expect(err).toBe('Error: body failed');
 expect(JSON.stringify(e.reader.serialize('document'))).toBe(before);expect(e.history).toEqual({undo:[],redo:[]});
 e.onWarning=()=>{};
 const result=e.apply(cmd);
 expect(result).toMatchObject({ok:true,written:true});expect(e.history.undo).toEqual(['moveAnchors']);expect(e.revision).toBeGreaterThan(0);
})
