import {emptyDrawing,uid,type DrawingDocument,type Cubic} from '../drawing/model';
/** Always writes to a supplied hair document; there is no global Drawing fallback.
 * Append preserves all prior edits. The initial document contains exactly two curves. */
export function addFrontBang(base:DrawingDocument|undefined,shapes:[Cubic,Cubic]):DrawingDocument {
 const d=base??emptyDrawing(),layerId=uid(),nodes:[string,string]=[uid(),uid()],ids=[uid(),uid()];
 return {...d,layers:[{id:layerId,name:'正刘海',visible:true,locked:false,items:ids},...d.layers],
  nodes:[...d.nodes,{id:nodes[0],position:shapes[0][0]},{id:nodes[1],position:shapes[0][3]}],
  curves:[...d.curves,...shapes.map((c,i)=>({id:ids[i],name:i?'右边界':'左边界',strokeName:'正刘海',nodes:[...nodes] as [string,string],handles:[c[1],c[2]] as [Cubic[0],Cubic[0]],width:.008,visible:true,locked:false,inkEnds:[{taper:0},{taper:0}] as [{taper:number},{taper:number}]}))]};
}
