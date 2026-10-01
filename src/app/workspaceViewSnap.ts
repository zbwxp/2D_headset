import {curveById,visible,type DrawingDocument as Doc,type Point2,type Cubic} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {subcurve} from '../domain/drawing/roundedJoin';
import {snapViewGuides} from '../domain/drawing/viewGuides';
import type {DrawingSnapshots} from '../domain/drawing/snapshots';
import type {WorkspaceView} from './workspaceView';
interface Fragment {curve:Cubic;curveIds:string[];joinId?:string;sourceRange?:[number,number]}
const cache=new WeakMap<Doc,Fragment[]>();
/** Actual SHOW/HIDE centerline pieces, including derived ARC. Fill occlusion,
 * taper silhouette and extensions are not extra snapping geometry. */
export function visibleSnapFragments(d:Doc):Fragment[]{
 const cached=cache.get(d);if(cached)return cached;const visited=new Set<string>(),out:Fragment[]=[];
 for(const curve of d.curves){if(visited.has(curve.id))continue;const path=displayPath(d,curve.id);path.segments.forEach(u=>visited.add(u.id));const field=displayField(d,path);if(field.geometry.error||field.total<=1e-12)continue;
  const ranges=field.mask??[[0,1]];
  field.parts.forEach((part,i)=>{const piece=field.geometry.pieces[i];if(!piece.owners.every(id=>visible(d,id)&&curveById(d,id).inkVisible!==false))return;
   const at=(distance:number)=>{const local=Math.max(0,Math.min(part.length,distance-part.start));let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}const fraction=(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*fraction;};
   for(const [start,end] of ranges){const lo=Math.max(start*field.total,part.start),hi=Math.min(end*field.total,part.start+part.length);if(hi-lo<=1e-12)continue;const a=at(lo),b=at(hi),r=piece.sourceRange??[0,1],reverse=path.segments.find(u=>u.id===piece.owners[0])?.reverse,map=(t:number)=>{const v=r[0]+(r[1]-r[0])*t;return reverse?1-v:v;};out.push({curve:subcurve(part.shape,a,b),curveIds:[...piece.owners],...(piece.joinId?{joinId:piece.joinId}:{sourceRange:[map(a),map(b)] as [number,number]})});}
  });
 }
 cache.set(d,out);return out;
}
/** Shared read-only snap query for human gestures and AI point preparation. */
export function snapWorkspacePoint(source:Doc,library:DrawingSnapshots|undefined,view:WorkspaceView,point:Point2,unitsPerPixel:number,thresholdPx=8,excludeCurveIds:readonly string[]=[]){
 if(!view.guidesVisible||!view.snappingEnabled||!view.guides.length)return null;
 const excluded=new Set(excludeCurveIds),candidates:Array<Fragment&{source:'artwork'|'reference'}>=visibleSnapFragments(source).filter(c=>!c.curveIds.some(id=>excluded.has(id))).map(c=>({...c,source:'artwork'}));
 const ref=view.reference,saved=ref?.visible&&ref.snap?library?.items.find(a=>a.id===ref.artworkId)?.drawing:undefined;
 if(saved&&ref)for(const c of visibleSnapFragments(saved))candidates.push({...c,curve:c.curve.map(([x,y])=>[x*ref.scale+ref.offset[0],y*ref.scale+ref.offset[1]]) as Cubic,source:'reference'});
 const hit=snapViewGuides(point,view.guides,candidates.map(c=>c.curve),unitsPerPixel,thresholdPx);if(!hit)return null;
 const target=hit.curveIndex===undefined?undefined:candidates[hit.curveIndex];return {...hit,...(target?{target:{source:target.source,curveId:target.curveIds[0],curveIds:target.curveIds,...(target.joinId?{joinId:target.joinId}:{sourceT:target.sourceRange![0]+(target.sourceRange![1]-target.sourceRange![0])*(hit.t??0)})}}:{})};
}
