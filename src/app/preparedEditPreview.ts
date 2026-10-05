import type {LandmarkProject} from '../domain/landmarks/model';
import type {SnapshotEditPlan} from './snapshotEditTransaction';

/** UI request matching is not an edit authority. The retained plan still needs
 * the transaction's private receipt and revision fence before store commit. */
export interface PreparedEditPreviewRequest {
 readonly family:string;
 readonly identities?:readonly unknown[];
 /** Small serializable intent/command parameters, never an evaluated Drawing. */
 readonly value?:unknown;
}
const sameValue=(a:unknown,b:unknown):boolean=>{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x),other=Object.keys(y);
 return keys.length===other.length&&keys.every(key=>Object.hasOwn(y,key)&&sameValue(x[key],y[key]));
};
const sameRequest=(a:PreparedEditPreviewRequest,b:PreparedEditPreviewRequest)=>a.family===b.family&&(a.identities?.length??0)===(b.identities?.length??0)&&(a.identities??[]).every((value,index)=>Object.is(value,b.identities?.[index]))&&sameValue(a.value,b.value);
export interface AcceptedPreparedEdit<T=undefined> {readonly plan:SnapshotEditPlan;readonly result:T}
/** One accepted candidate for one editor. Clearing the visual preview before a
 * normal release is allowed; cancellation must retire the transaction revision.
 * A take consumes first, including stale/rejected commits, so a release cannot
 * reuse the same candidate twice. Other discrete requests prepare normally. */
export function createPreparedEditPreview<T=undefined>(){
 let accepted:{request:PreparedEditPreviewRequest;value:AcceptedPreparedEdit<T>}|undefined;
 return {
  accept(request:PreparedEditPreviewRequest,plan:SnapshotEditPlan,result:T){accepted={request:{family:request.family,identities:[...request.identities??[]],value:structuredClone(request.value)},value:{plan,result}};},
  clear(){accepted=undefined;},
  take(request:PreparedEditPreviewRequest,before:LandmarkProject):AcceptedPreparedEdit<T>|undefined {
   const ready=accepted;accepted=undefined;
   if(!ready||!sameRequest(ready.request,request))return undefined;
   if(ready.value.plan.before!==before)throw Error('The accepted preview belongs to a different project revision. Start the edit again.');
   return ready.value;
  },
 };
}
