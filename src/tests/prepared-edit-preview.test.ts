import {describe,it,expect} from 'vitest';
import {createPreparedEditPreview} from '../app/preparedEditPreview';
import {createEmptyProject} from '../app/emptyProject';
import type {SnapshotEditPlan} from '../app/snapshotEditTransaction';
// This helper owns request matching only. Store receipt/validation tests use
// genuine transaction plans; the matching layer never authenticates these.
const plan=():SnapshotEditPlan=>{const before=createEmptyProject();return {before,project:{...before},changed:true};};
describe('accepted prepared preview request matching',()=>{
 it('consumes one accepted command candidate without preparing it again',()=>{const cache=createPreparedEditPreview<number>(),p=plan(),key={family:'commands',value:{commands:[{op:'setLayerPlacement',layerId:'a',value:{scale:0}}]}};cache.accept(key,p,7);expect(cache.take(structuredClone(key),p.before)).toEqual({plan:p,result:7});expect(cache.take(key,p.before)).toBeUndefined();});
 it('retains the original parameter values and distinguishes exact identities',()=>{const cache=createPreparedEditPreview(),p=plan(),a={},b={},key={family:'drawing',identities:[a,b],value:{axis:0}};cache.accept(key,p,undefined);expect(cache.take({...key,identities:[a,{}]},p.before)).toBeUndefined();cache.accept(key,p,undefined);key.value.axis=1;expect(cache.take(key,p.before)).toBeUndefined();});
 it('replaces and clears failed or canceled preview candidates',()=>{const cache=createPreparedEditPreview(),p=plan();cache.accept({family:'cage',value:1},p,undefined);cache.accept({family:'cage',value:2},p,undefined);expect(cache.take({family:'cage',value:1},p.before)).toBeUndefined();cache.accept({family:'cage',value:2},p,undefined);cache.clear();expect(cache.take({family:'cage',value:2},p.before)).toBeUndefined();});
 it('rejects stale project ownership and consumes even when rejection throws',()=>{const cache=createPreparedEditPreview(),p=plan(),key={family:'geometry'};cache.accept(key,p,undefined);expect(()=>cache.take(key,{...p.before})).toThrow(/different project/);expect(cache.take(key,p.before)).toBeUndefined();});
 it('keeps negative zero and missing keys distinct',()=>{const cache=createPreparedEditPreview(),p=plan();cache.accept({family:'value',value:{x:-0}},p,undefined);expect(cache.take({family:'value',value:{x:0}},p.before)).toBeUndefined();cache.accept({family:'value',value:{x:undefined}},p,undefined);expect(cache.take({family:'value',value:{}},p.before)).toBeUndefined();});
});
