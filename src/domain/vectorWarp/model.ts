import type {Point2} from '../drawing/model';

export interface WarpBounds {min:Point2;max:Point2}
/** A shared Hermite jet. Handles are absolute outgoing cubic Bezier handles.
 * The incoming handles are their reflection through position. twist is d²P/du dv,
 * with u/v measured in CELL units, not normalized across the whole grid. */
export interface WarpNode {position:Point2;handleU:Point2;handleV:Point2;twist:Point2}
/** rows/columns count cells. Nodes are row-major, (rows+1)*(columns+1).
 * bounds are the immutable source/rest rectangle; node positions are output space.
 * Shared positions, U/V derivatives and twist make neighboring patches C1.
 * This is our explicit representation, not an implementation of Cubism Core. */
export interface WarpGrid {rows:number;columns:number;bounds:WarpBounds;nodes:WarpNode[]}
export type WarpChain = readonly WarpGrid[];
export type WarpCurveResolver = (sourceCurveId:string)=>WarpChain;
export type WarpSource = WarpGrid | WarpChain | WarpCurveResolver;
export interface WeightedWarpGrid {grid:WarpGrid;weight:number}

const copy=(p:Point2):Point2=>[p[0],p[1]];
const finite=(p:unknown):p is Point2=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
export function validateWarpGrid(grid:WarpGrid):void {
 if(!grid||!Number.isInteger(grid.rows)||!Number.isInteger(grid.columns)||grid.rows<1||grid.columns<1||grid.rows>100||grid.columns>100||
 !grid.bounds||!finite(grid.bounds.min)||!finite(grid.bounds.max)||grid.bounds.max[0]<=grid.bounds.min[0]||grid.bounds.max[1]<=grid.bounds.min[1]||
 !Number.isFinite(grid.columns/(grid.bounds.max[0]-grid.bounds.min[0]))||!Number.isFinite(grid.rows/(grid.bounds.max[1]-grid.bounds.min[1]))||
 !Number.isFinite(grid.bounds.max[0]-grid.bounds.min[0])||!Number.isFinite(grid.bounds.max[1]-grid.bounds.min[1])||
 !Array.isArray(grid.nodes)||grid.nodes.length!==(grid.rows+1)*(grid.columns+1)||
 grid.nodes.some(n=>!n||![n.position,n.handleU,n.handleV,n.twist].every(finite)))throw new Error('Invalid vector warp grid');
}
export function createWarpGrid(bounds:WarpBounds,rows=2,columns=2):WarpGrid {
 if(!bounds||!finite(bounds.min)||!finite(bounds.max)||!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>100||columns>100||bounds.max[0]<=bounds.min[0]||bounds.max[1]<=bounds.min[1])throw new Error('Invalid vector warp grid dimensions');
 const dx=(bounds.max[0]-bounds.min[0])/columns,dy=(bounds.max[1]-bounds.min[1])/rows;
 const grid:WarpGrid={rows,columns,bounds:{min:copy(bounds.min),max:copy(bounds.max)},nodes:[]};
 for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
  const position:Point2=[bounds.min[0]+col*dx,bounds.min[1]+row*dy];
  grid.nodes.push({position,handleU:[position[0]+dx/3,position[1]],handleV:[position[0],position[1]+dy/3],twist:[0,0]});
 }
 validateWarpGrid(grid);return grid;
}
export const cloneWarpGrid=(grid:WarpGrid):WarpGrid=>structuredClone(grid);
/** Exact authoring-state identity test. No epsilon can hide a small intentional edit. */
export function isIdentityWarpGrid(grid:WarpGrid):boolean {
 const dx=(grid.bounds.max[0]-grid.bounds.min[0])/grid.columns,dy=(grid.bounds.max[1]-grid.bounds.min[1])/grid.rows;
 return grid.nodes.every((n,index)=>{
  const row=Math.floor(index/(grid.columns+1)),col=index%(grid.columns+1),x=grid.bounds.min[0]+col*dx,y=grid.bounds.min[1]+row*dy;
  return n.position[0]===x&&n.position[1]===y&&n.handleU[0]===x+dx/3&&n.handleU[1]===y&&n.handleV[0]===x&&n.handleV[1]===y+dy/3&&n.twist[0]===0&&n.twist[1]===0;
 });
}
/** Move a node without accidentally changing its tangent vectors. Pure/immutable. */
export function moveWarpNode(grid:WarpGrid,index:number,position:Point2,moveHandles=true):WarpGrid {
 if(!Number.isInteger(index)||!grid.nodes[index]||!finite(position))throw new Error('Invalid warp node edit');
 const result=cloneWarpGrid(grid),node=result.nodes[index],delta:Point2=[position[0]-node.position[0],position[1]-node.position[1]];
 node.position=copy(position);
 if(moveHandles){node.handleU=[node.handleU[0]+delta[0],node.handleU[1]+delta[1]];node.handleV=[node.handleV[0]+delta[0],node.handleV[1]+delta[1]];}
 return result;
}
/** Geometry interpolation, including signed combinations such as X+Y-neutral.
 * Weights are normalized by their sum. Rest bounds/topology must match exactly.
 * Blending does not reject a fold or a zero Jacobian. */
export function blendWarpGrids(entries:readonly WeightedWarpGrid[]):WarpGrid {
 if(!entries.length)throw new Error('Cannot blend an empty warp list');
 for(const {grid,weight} of entries){validateWarpGrid(grid);if(!Number.isFinite(weight))throw new Error('Invalid warp weight');}
 const base=entries[0].grid,total=entries.reduce((sum,e)=>sum+e.weight,0);
 if(!Number.isFinite(total)||Math.abs(total)<1e-12)throw new Error('Warp weights have zero total');
 if(entries.some(({grid:g})=>g.rows!==base.rows||g.columns!==base.columns||g.bounds.min.some((x,i)=>x!==base.bounds.min[i])||g.bounds.max.some((x,i)=>x!==base.bounds.max[i])))throw new Error('Warp grids have different rest domains or topology');
 // Preserve exact neutral state while blending identical keyforms; don't create
 // microscopic floating-point edits that defeat identity evaluation.
 if(entries.every(({grid})=>grid===base))return cloneWarpGrid(base);
 if(entries.every(({grid})=>isIdentityWarpGrid(grid)))return createWarpGrid(base.bounds,base.rows,base.columns);
 const result=cloneWarpGrid(base);
 for(let i=0;i<result.nodes.length;i++)for(const key of ['position','handleU','handleV','twist'] as const){
  const p:Point2=[0,0];for(const {grid,weight} of entries){p[0]+=grid.nodes[i][key][0]*weight/total;p[1]+=grid.nodes[i][key][1]*weight/total;}result.nodes[i][key]=p;
 }
 validateWarpGrid(result);return result;
}
