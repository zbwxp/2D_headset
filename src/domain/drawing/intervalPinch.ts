import type {DisplayInterval} from './model';

/** Transient recording preview only: pinch unbroken ink before opening a gap.
 * Kept out of authoring data, snapshots, JSON and Undo. */
const strengths=new WeakMap<DisplayInterval,number>();
export const intervalPinch=(range:DisplayInterval)=>strengths.get(range)??0;
export function withIntervalPinch(range:DisplayInterval,strength:number){
 if(strength>0)strengths.set(range,strength);
 return range;
}
export interface InkPinch {position:number;strength:number;tapers:[number,number]}
