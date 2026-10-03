/** The existing material arc table's exact piecewise-linear inverse. Shared by
 * topology transfer and Recorder material partition sampling. */
interface MaterialTable {pts:readonly {t:number}[];dist:readonly number[];length:number}
interface MaterialField {sourcePieceParameter?:(piece:number,t:number)=>number;fittedPieceParameter?:(piece:number,t:number)=>number;parts:readonly MaterialTable[];geometry:{pieces:readonly {joinId?:string;owners:readonly string[];sourceRange?:readonly [number,number]}[]}}
export function materialTableParameterAt(part:MaterialTable,fraction:number):number {
 if(fraction<=0)return 0;if(fraction>=1)return 1;
 const distance=Math.max(0,Math.min(1,fraction))*part.length;let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=distance)lo=mid;else hi=mid;}
 return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(distance-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);
}
export function materialTableFractionAt(part:MaterialTable,parameter:number):number {
 if(parameter<=0)return 0;if(parameter>=1)return 1;
 const t=Math.max(0,Math.min(1,parameter));let lo=0,hi=part.pts.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.pts[mid].t<=t)lo=mid;else hi=mid;}
 return (part.dist[lo]+(part.dist[hi]-part.dist[lo])*Math.max(0,Math.min(1,(t-part.pts[lo].t)/(part.pts[hi].t-part.pts[lo].t||1))))/(part.length||1);
}
export function curveMaterialParameterMap(field:MaterialField,path:{segments:readonly {id:string;reverse:boolean}[]},curveId:string):{parameterAt:(value:number)=>number;valueAt:(parameter:number)=>number} {
 const index=field.geometry.pieces.findIndex(piece=>!piece.joinId&&piece.owners[0]===curveId),part=field.parts[index],piece=field.geometry.pieces[index],use=path.segments.find(use=>use.id===curveId);
 if(!part||!piece||!use||!(part.length>0))throw Error(`Material curve ${curveId} is absent or degenerate.`);
 const range=piece.sourceRange??[0,1];
 return {parameterAt:value=>{const fraction=use.reverse?1-value:value,native=materialTableParameterAt(part,fraction),t=range[0]+(range[1]-range[0])*(field.sourcePieceParameter?.(index,native)??native);return use.reverse?1-t:t;},valueAt:parameter=>{const native=use.reverse?1-parameter:parameter,local=(native-range[0])/(range[1]-range[0]||1),fraction=materialTableFractionAt(part,field.fittedPieceParameter?.(index,local)??local);return use.reverse?1-fraction:fraction;}};
}
