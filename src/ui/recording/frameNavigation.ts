import type {View} from '../../domain/recording/model';

/** Pointer devices may send many positions per display frame. Only the latest
 * matters, and pointer-up must flush it instead of dropping the final angle. */
export function frameNavigation(apply:(view:View)=>void,request:(f:FrameRequestCallback)=>number=requestAnimationFrame,cancel:(id:number)=>void=cancelAnimationFrame){
 let frame:number|undefined,pending:View|undefined;
 const flush=()=>{if(frame!==undefined)cancel(frame);frame=undefined;const value=pending;pending=undefined;if(value)apply(value);};
 return {
  push(view:View){pending=view;if(frame===undefined)frame=request(flush);},
  flush,
  cancel(){if(frame!==undefined)cancel(frame);frame=undefined;pending=undefined;},
 };
}
