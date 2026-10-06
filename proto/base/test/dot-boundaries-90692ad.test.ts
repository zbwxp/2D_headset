import {it,expect} from 'vitest'
import {react,transaction} from '@tldraw/state'
import {Editor} from '../src/editor'
import {exampleRecords,ids} from '../src/fixture'
import {Container} from '../src/schema'
const cmd:any={type:'moveAnchors',targets:[{curveId:ids.C1,anchorId:'a2'}],delta:{x:10,y:5}}
const doc=(e:Editor)=>JSON.stringify(e.reader.serialize('document'))
it('probe throwing reactive observer consistency',()=>{
 const e=new Editor(exampleRecords());const before=doc(e);let shouldThrow=false;
 const stop=react('dot-throw',()=>{e.reader.get(ids.C1);if(shouldThrow)throw Error('dot observer throw')});shouldThrow=true;let result:any;try{result=e.apply(cmd)}catch(err){result={thrown:String(err)}}finally{stop()}
 console.log('OBSERVER',JSON.stringify({result,changed:doc(e)!==before,history:e.history,revision:e.revision}));
 expect(result.ok===false && doc(e)!==before && e.history.undo.length===0).toBe(false)
})
it('probe outer state transaction rollback consistency',()=>{
 const e=new Editor(exampleRecords());const before=doc(e);try{transaction(()=>{e.apply(cmd);throw Error('outer abort')})}catch{}
 console.log('OUTER',JSON.stringify({docRestored:doc(e)===before,history:e.history,revision:e.revision}));expect(e.history.undo).toEqual([])
})
it('probe ancestor locked child visible flag',()=>{
 const child=Container.create({id:Container.createId('child'),parentId:ids.L2,name:'child',index:'a1'});const e=new Editor([...exampleRecords(),child]);const before=doc(e);const result=e.apply({type:'setContainerFlags',containerId:child.id,visible:false});console.log('ANCESTOR',JSON.stringify({result,changed:doc(e)!==before,history:e.history}));expect(result.ok).toBe(false);expect(doc(e)).toBe(before)
})
it('raw numeric oracle rejects invalid inputs without writes',()=>{const e=new Editor(exampleRecords());for(const n of [NaN,Infinity,-Infinity]){const before=doc(e);const r=e.apply({...cmd,delta:{x:n,y:0}});expect(r.ok).toBe(false);expect(doc(e)).toBe(before);expect(e.history.undo).toEqual([])}})
