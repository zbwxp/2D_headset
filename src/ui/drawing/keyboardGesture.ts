import {add,type Point2} from '../../domain/drawing/model';
import {clearGestureTarget,previewGestureTarget,type GesturePreviewTarget} from './gestureTransaction';

/** A held-key gesture owns requested displacement, never the last projected
 * result. The caller adds its frozen document/adapter to this shared state. */
export interface KeyboardGesture<T> {
 readonly previewTarget:GesturePreviewTarget<T>;
 readonly keys:Set<string>;
 offset:Point2;
 ended:boolean;
}
export function beginKeyboardGesture<T>():KeyboardGesture<T> {
 return {previewTarget:{},keys:new Set(),offset:[0,0],ended:false};
}
export function previewKeyboardGesture<T>(gesture:KeyboardGesture<T>,key:string,delta:Point2,produce:(offset:Point2)=>T|undefined,publish:(target:T|null)=>boolean|void):boolean {
 if(gesture.ended)return false;
 gesture.keys.add(key);gesture.offset=add(gesture.offset,delta);
 return previewGestureTarget(gesture.previewTarget,()=>produce(gesture.offset),publish);
}
/** Only release of the last key owned by this gesture can finish it. The
 * caller then consumes its accepted target with takeGestureTarget. */
export function releaseKeyboardGesture<T>(gesture:KeyboardGesture<T>|null|undefined,key:string):boolean {
 if(!gesture||gesture.ended||!gesture.keys.delete(key)||gesture.keys.size)return false;
 gesture.ended=true;return true;
}
export function cancelKeyboardGesture<T>(gesture:KeyboardGesture<T>|null|undefined):void {
 if(!gesture)return;
 gesture.ended=true;gesture.keys.clear();clearGestureTarget(gesture.previewTarget);
}
