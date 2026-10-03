import {shapeOf,type DrawingDocument as Doc} from './model';
import {displayField,displayPath} from './displayIntervals';
import {mappedParameter,type CurveParameterMap} from '../deformation/cubicDeformation';

const clamp=(x:number)=>Math.max(0,Math.min(1,x));

type Field=ReturnType<typeof displayField>;
export function deformMaterialDistanceAt(part:Field['parts'][number],t:number){
 const i=Math.max(1,part.pts.findIndex(p=>p.t>=t)),lo=part.pts[i-1].t,hi=part.pts[i].t;
 return part.start+part.dist[i-1]+(part.dist[i]-part.dist[i-1])*clamp((t-lo)/(hi-lo||1));
}
/** Invert only this selected piece's arc table. A second whole-field lookup can
 * choose the adjacent piece at a floating-point seam and pair its t with the
 * previous source ID, moving a cut by an entire cubic. */
function parameterAt(part:Field['parts'][number],distance:number){
 const local=Math.max(0,Math.min(part.length,distance-part.start));let lo=0,hi=part.dist.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
 return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);
}
/** Transport material positions, rather than retaining arc percentages after nonuniform deformation.
 * This is Drawing's existing authoring transport: rebuilt ARC spans retain their
 * aggregate material fraction. A retained nonlinear domain must instead fit the
 * original derived ARC pieces and carry each piece's parameter correspondence. */
export function transportDeformedIntervals(before:Doc,after:Doc,parameters=new Map<string,CurveParameterMap>()):Doc{
 if(!before.displayIntervals?.length)return after;
 const fields=new Map<string,[Field,Field]>();
 return {...after,displayIntervals:before.displayIntervals.map(track=>{
  const path=displayPath(before,track.anchor.id),key=path.segments.map(s=>s.id).join('|');
  const ids=new Set(path.segments.map(s=>s.id)),joins=(d:Doc)=>d.joins.filter(j=>ids.has(j.a.curveId)||ids.has(j.b.curveId));
  if(path.segments.every(s=>JSON.stringify(shapeOf(before,s.id))===JSON.stringify(shapeOf(after,s.id)))&&JSON.stringify(joins(before))===JSON.stringify(joins(after))&&JSON.stringify(before.endpointLinks)===JSON.stringify(after.endpointLinks))return track;
  let pair=fields.get(key);if(!pair){pair=[displayField(before,path),displayField(after,displayPath(after,track.anchor.id))];fields.set(key,pair);}
  const [old,next]=pair;if(old.total<1e-10||next.total<1e-10)throw Error('显示区间所在曲线退化，无法变形。');
  const move=(s:number)=>{
   const absolute=old.native(track,s)*old.total,index=Math.max(0,old.parts.findIndex(p=>absolute<=p.start+p.length+1e-12)),part=old.parts[index],piece=old.geometry.pieces[index];
   let dest:number;
   if(piece.joinId){
    const indices=old.geometry.pieces.flatMap((p,i)=>p.joinId===piece.joinId?[i]:[]),targets=next.geometry.pieces.flatMap((p,i)=>p.joinId===piece.joinId?[i]:[]);
    if(!targets.length)throw Error('圆弧过渡退化，无法保持显示区间。');
    const start=old.parts[indices[0]].start,total=indices.reduce((n,i)=>n+old.parts[i].length,0),endTotal=targets.reduce((n,i)=>n+next.parts[i].length,0);
    dest=next.parts[targets[0]].start+clamp((absolute-start)/(total||1))*endTotal;
   }else{
    const range=piece.sourceRange??[0,1],sourceT=range[0]+(range[1]-range[0])*parameterAt(part,absolute);
    const reversed=path.segments.find(u=>u.id===piece.owners[0])!.reverse,parameterMap=parameters.get(piece.owners[0]),native=reversed?1-mappedParameter(1-sourceT,parameterMap):mappedParameter(sourceT,parameterMap);
    const j=next.geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===piece.owners[0]),r=next.geometry.pieces[j].sourceRange??[0,1];
    dest=deformMaterialDistanceAt(next.parts[j],clamp((native-r[0])/(r[1]-r[0]||1)));
   }
   return next.relative(track,dest/next.total);
  };
  return {...track,ranges:track.ranges.map(r=>r.fullLoop?{...r,start:move(r.start),end:move(r.start)}:path.closed&&Math.abs(r.end-r.start)>1-1e-10?r:{...r,start:move(r.start),end:move(r.end)})};
 })};
}
