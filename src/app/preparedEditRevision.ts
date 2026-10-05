/** Session-only cancellation fence. It is neither project data nor an
 * evaluation-cache revision: Undo may restore reusable immutable geometry while
 * still invalidating a plan prepared before cancellation/history navigation. */
let revision=0;
export const currentPreparedEditRevision=()=>revision;
export function invalidatePreparedEdits():void {revision++;}
export function assertPreparedEditCurrent(plan:{readonly preparedRevision?:number}):void {
 if(plan.preparedRevision!==revision)throw Error('This prepared edit is stale, canceled or superseded. Start the gesture again.');
}
