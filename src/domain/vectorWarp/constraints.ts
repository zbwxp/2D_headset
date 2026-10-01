import type {Point2} from '../drawing/model';
import {createWarpMapper} from './evaluation';
import {cloneWarpGrid,validateWarpGrid,type WarpBounds,type WarpGrid} from './model';

export interface WarpPointPin {
 /** Fixed source/rest point, not an already deformed screen point. */
 sourcePoint:Point2;
 /** Explicit desired output in this grid's immediate parent's input space. */
 targetPoint:Point2;
 /** null denotes the root drawing space. The caller supplies real hierarchy IDs. */
 gridParentId:string|null;
 targetParentId:string|null;
 /** When a parent grid exists, supplying its bounds rejects extrapolated targets. */
 parentBounds?:WarpBounds;
 /** Residual reporting tolerance in logical Drawing units; default 1e-12. */
 tolerance?:number;
}
export interface WarpPinNodeChange {
 nodeIndex:number;row:number;column:number;
 /** Hermite position basis weight at the fixed source point. */
 weight:number;
 /** Actual node-position change; its U/V handles receive the same translation. */
 delta:Point2;
}
export interface WarpPointPinResult {
 grid:WarpGrid;
 beforePoint:Point2;afterPoint:Point2;
 /** afterPoint - targetPoint, measured through the production forward mapper. */
 residual:Point2;residualNorm:number;tolerance:number;withinTolerance:boolean;
 changes:WarpPinNodeChange[];
 /** Largest actual displacement of any position/U/V handle, in Drawing units. */
 maxControlDelta:number;
 /** Sum of squared actual position/U/V-handle displacements, in Drawing units². */
 squaredControlDelta:number;
 iterations:number;
}
export class WarpPinError extends Error {
 constructor(readonly code:'INVALID_PIN'|'PARENT_SPACE_MISMATCH'|'SOURCE_OUTSIDE_GRID'|'TARGET_OUTSIDE_PARENT'|'NON_FINITE_RESULT',message:string){super(message);this.name='WarpPinError';}
}
const finite=(p:unknown):p is Point2=>Array.isArray(p)&&p.length===2&&[p[0],p[1]].every(x=>typeof x==='number'&&Number.isFinite(x));
const validSpace=(id:unknown)=>id===null||typeof id==='string'&&id.length>0;
const validBounds=(b:WarpBounds)=>b&&finite(b.min)&&finite(b.max)&&[0,1].every(i=>b.max[i]>b.min[i]&&Number.isFinite(b.max[i]-b.min[i]));
const inside=(p:Point2,b:WarpBounds)=>[0,1].every(i=>p[i]>=b.min[i]&&p[i]<=b.max[i]);
const delta=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];

/**
 * A single forward pin, not an inverse-map or multi-constraint solver.
 *
 * Translate at most four active-cell corner nodes, including their two absolute
 * handles. Local derivative vectors and twist stay unchanged. The shared-node
 * Hermite representation therefore remains C1, including adjacent cells.
 * If w_i are the position basis weights and e is the target error, the correction
 * delta_i = w_i e / sum(w_i²) minimizes the sum of squared node translations.
 * It also minimizes total position/handle movement within this restricted family.
 * Other control values, topology, and immutable rest bounds are preserved.
 *
 * This can reshape neighboring cells and does not protect previous independent
 * pins, injectivity, or arbitrary source tangents. Folds are accepted. Source and
 * target frame IDs must match; this pure grid helper cannot verify a rig hierarchy.
 * No source or parent-domain extrapolation is allowed by the supplied bounds.
 * Use the same rest point and same target at corresponding authored keys to keep
 * a common pin under normalized linear grid blending. Varying targets interpolate
 * linearly too; any common parent is then applied after the pinned child output.
 */
export function pinWarpPoint(grid:WarpGrid,pin:WarpPointPin):WarpPointPinResult {
 validateWarpGrid(grid);
 const tolerance=pin?.tolerance??1e-12;
 if(!pin||!finite(pin.sourcePoint)||!finite(pin.targetPoint)||!validSpace(pin.gridParentId)||!validSpace(pin.targetParentId)||!Number.isFinite(tolerance)||tolerance<0||pin.parentBounds!==undefined&&!validBounds(pin.parentBounds))throw new WarpPinError('INVALID_PIN','Invalid finite warp pin or coordinate-space declaration');
 if(pin.gridParentId!==pin.targetParentId)throw new WarpPinError('PARENT_SPACE_MISMATCH','Warp pin target must be in the grid’s immediate parent coordinate space');
 if(!inside(pin.sourcePoint,grid.bounds))throw new WarpPinError('SOURCE_OUTSIDE_GRID','Warp pin source lies outside the grid rest bounds');
 if(pin.parentBounds&&!inside(pin.targetPoint,pin.parentBounds))throw new WarpPinError('TARGET_OUTSIDE_PARENT','Warp pin target would require parent-domain extrapolation');
 const gu=(pin.sourcePoint[0]-grid.bounds.min[0])*(grid.columns/(grid.bounds.max[0]-grid.bounds.min[0])),gv=(pin.sourcePoint[1]-grid.bounds.min[1])*(grid.rows/(grid.bounds.max[1]-grid.bounds.min[1]));
 const column=Math.min(grid.columns-1,Math.max(0,Math.floor(gu))),row=Math.min(grid.rows-1,Math.max(0,Math.floor(gv))),u=gu-column,v=gv-row;
 const positionBasis=(t:number)=>[(1-t)*(1-t)*(1+2*t),t*t*(3-2*t)];
 const hu=positionBasis(u),hv=positionBasis(v),support:Array<{nodeIndex:number;row:number;column:number;weight:number}>=[];
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){const weight=hu[i]*hv[j];if(weight!==0)support.push({nodeIndex:(row+j)*(grid.columns+1)+column+i,row:row+j,column:column+i,weight});}
 const denominator=support.reduce((sum,s)=>sum+s.weight*s.weight,0),result=cloneWarpGrid(grid),beforePoint=createWarpMapper([grid]).mapPoint(pin.sourcePoint);
 if(!finite(beforePoint)||!Number.isFinite(denominator)||denominator<=0)throw new WarpPinError('NON_FINITE_RESULT','Warp pin field cannot be evaluated finitely');
 let afterPoint:Point2=[...beforePoint],iterations=0;
 // Three bounded residual corrections remove production power-basis rounding.
 // Never skip an intentional small edit merely because it is below tolerance.
 for(let i=0;i<3;i++){
  const error=delta(pin.targetPoint,afterPoint);if(error[0]===0&&error[1]===0)break;
  if(!finite(error))throw new WarpPinError('NON_FINITE_RESULT','Warp pin correction overflowed');
  for(const s of support){const n=result.nodes[s.nodeIndex],dx=error[0]*s.weight/denominator,dy=error[1]*s.weight/denominator;
   for(const key of ['position','handleU','handleV'] as const){n[key]=[n[key][0]+dx,n[key][1]+dy];if(!finite(n[key]))throw new WarpPinError('NON_FINITE_RESULT','Warp pin controls overflowed');}
  }
  iterations++;afterPoint=createWarpMapper([result]).mapPoint(pin.sourcePoint);
  if(!finite(afterPoint))throw new WarpPinError('NON_FINITE_RESULT','Pinned warp field cannot be evaluated finitely');
 }
 const changes:WarpPinNodeChange[]=[];let maxControlDelta=0,squaredControlDelta=0;
 for(const s of support){let changed=false;
  for(const key of ['position','handleU','handleV'] as const){const d=delta(result.nodes[s.nodeIndex][key],grid.nodes[s.nodeIndex][key]),n=Math.hypot(...d);changed ||= d[0]!==0||d[1]!==0;maxControlDelta=Math.max(maxControlDelta,n);squaredControlDelta+=n*n;}
  if(changed)changes.push({...s,delta:delta(result.nodes[s.nodeIndex].position,grid.nodes[s.nodeIndex].position)});
 }
 const residual=delta(afterPoint,pin.targetPoint),residualNorm=Math.hypot(...residual);
 if(![residualNorm,maxControlDelta,squaredControlDelta].every(Number.isFinite))throw new WarpPinError('NON_FINITE_RESULT','Warp pin diagnostic magnitude overflowed');
 return {grid:result,beforePoint,afterPoint,residual,residualNorm,tolerance,withinTolerance:residualNorm<=tolerance,changes,maxControlDelta,squaredControlDelta,iterations};
}
