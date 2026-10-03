import type {DrawingDocument,Point2} from '../drawing/model';
import type {SceneProgressMapper} from '../recordingScene/tracks';
import type {Angle,RecordingSnapshot,SnapshotInterpolationWeight,SnapshotRecording} from './model';

const clamp=(t:number)=>Math.max(0,Math.min(1,Number.isFinite(t)?t:0));
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
/** Validation never sorts or clamps authoring data: malformed imported curves
 * must fail atomically rather than acquire a different response silently. */
export function validateSnapshotInterpolationWeight(weight:SnapshotInterpolationWeight):void {
 if(!weight||!validId(weight.id)||!weight.target||!validId(weight.target.layerId)||weight.target.curveId!==undefined&&!validId(weight.target.curveId)||!validId(weight.startSnapshotId)||!validId(weight.endSnapshotId)||weight.startSnapshotId===weight.endSnapshotId)throw Error('Invalid interpolation weight target or endpoint pair.');
 const points=weight.points;
 if(!Array.isArray(points)||points.length<2||points.length>32||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw Error('Interpolation weight needs 2 to 32 finite normalized control points.');
 if(points[0][0]!==0||points[0][1]!==0||points.at(-1)![0]!==1||points.at(-1)![1]!==1)throw Error('Interpolation weight endpoints must remain [0,0] and [1,1].');
 if(points.some((point,index)=>index>0&&(point[0]<=points[index-1][0]||point[1]<points[index-1][1])))throw Error('Interpolation weight control points must increase in X and never decrease in Y.');
}

/** PCHIP interpolates y at the supplied x, not a Bézier parameter. Harmonic
 * tangents and one-sided endpoint limiting preserve monotonicity without
 * overshoot, including flat spans and very close control-point abscissae. */
export function evaluateSnapshotWeightCurve(points:readonly Point2[]|undefined,progress:number):number {
 const t=clamp(progress);if(t===0||t===1||!points||points.length<3)return t;
 const widths=points.slice(1).map((p,i)=>p[0]-points[i][0]),slopes=widths.map((h,i)=>(points[i+1][1]-points[i][1])/h);
 const endpoint=(h0:number,h1:number,d0:number,d1:number)=>{const value=((2*h0+h1)*d0-h0*d1)/(h0+h1);return value*d0<=0?0:d0*d1<0&&Math.abs(value)>Math.abs(3*d0)?3*d0:value;};
 const tangent=(i:number)=>{
  if(i===0)return endpoint(widths[0],widths[1],slopes[0],slopes[1]);
  if(i===points.length-1){const j=widths.length-1;return endpoint(widths[j],widths[j-1],slopes[j],slopes[j-1]);}
  const left=slopes[i-1],right=slopes[i];if(left<=0||right<=0)return 0;
  const a=2*widths[i]+widths[i-1],b=widths[i]+2*widths[i-1];return (a+b)/(a/left+b/right);
 };
 let i=0;while(i<points.length-2&&t>points[i+1][0])i++;
 const h=widths[i],u=(t-points[i][0])/h,u2=u*u,u3=u2*u;
 return Math.max(points[i][1],Math.min(points[i+1][1],(2*u3-3*u2+1)*points[i][1]+(u3-2*u2+u)*h*tangent(i)+(-2*u3+3*u2)*points[i+1][1]+(u3-u2)*h*tangent(i+1)));
}

export function resolveSnapshotInterpolationWeight(recording:SnapshotRecording|undefined,startSnapshotId:string,endSnapshotId:string,layerId:string,curveId?:string):{asset?:SnapshotInterpolationWeight;reversed:boolean} {
 const candidates=(recording?.interpolationWeights??[]).filter(asset=>asset.target.layerId===layerId&&(asset.startSnapshotId===startSnapshotId&&asset.endSnapshotId===endSnapshotId||asset.startSnapshotId===endSnapshotId&&asset.endSnapshotId===startSnapshotId));
 const asset=(curveId?candidates.find(asset=>asset.target.curveId===curveId):undefined)??candidates.find(asset=>asset.target.curveId===undefined);
 return {asset,reversed:!!asset&&asset.startSnapshotId===endSnapshotId};
}
export function snapshotInterpolationWeight(recording:SnapshotRecording|undefined,startSnapshotId:string,endSnapshotId:string,layerId:string,t:number,curveId?:string):number {
 const {asset,reversed}=resolveSnapshotInterpolationWeight(recording,startSnapshotId,endSnapshotId,layerId,curveId);
 return reversed?1-evaluateSnapshotWeightCurve(asset?.points,1-clamp(t)):evaluateSnapshotWeightCurve(asset?.points,t);
}

export interface SnapshotWeightNodeOwner {layerId:string;curveId?:string}
/** Every shared node and explicit endpoint-link component has one layer
 * authority (the lexically first layer ID). Only a truly exclusive, unlinked
 * node inherits a curve override. Reordering curves cannot change ownership. */
export function snapshotWeightNodeOwners(drawing:DrawingDocument):Map<string,SnapshotWeightNodeOwner> {
 const curveLayers=new Map(drawing.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const))),curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),incident=new Map<string,Set<string>>(),parents=new Map<string,string>(),linked=new Set<string>();
 for(const curve of drawing.curves)for(const id of curve.nodes){parents.set(id,id);const entries=incident.get(id)??new Set();entries.add(curve.id);incident.set(id,entries);}
 const root=(id:string):string=>{const parent=parents.get(id);if(parent===undefined||parent===id)return id;const value=root(parent);parents.set(id,value);return value;};
 for(const link of drawing.endpointLinks??[]){const a=curves.get(link.a.curveId)?.nodes[link.a.end],b=curves.get(link.b.curveId)?.nodes[link.b.end];if(!a||!b)continue;linked.add(a);linked.add(b);const ar=root(a),br=root(b);if(ar!==br)parents.set(ar<br?br:ar,ar<br?ar:br);}
 const components=new Map<string,string[]>();for(const id of incident.keys()){const key=root(id),ids=components.get(key)??[];ids.push(id);components.set(key,ids);}
 const result=new Map<string,SnapshotWeightNodeOwner>();for(const ids of components.values()){
  const members=[...new Set(ids.flatMap(id=>[...incident.get(id)??[]]))],layers=members.map(id=>curveLayers.get(id)).filter((id):id is string=>!!id).sort();if(!layers.length)continue;
  const owner={layerId:layers[0],...(ids.length===1&&!linked.has(ids[0])&&members.length===1?{curveId:members[0]}:{})};for(const id of ids)result.set(id,owner);
 }return result;
}

/** Placement remains a layer domain. Layers touching a shared/linked node
 * therefore use one response authority for that domain, not independently
 * retimed affines that could tear an otherwise coherent endpoint connection. */
export function snapshotWeightLayerOwners(drawing:DrawingDocument):Map<string,string> {
 const nodeOwners=snapshotWeightNodeOwners(drawing),curveLayers=new Map(drawing.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const))),parents=new Map(drawing.layers.map(layer=>[layer.id,layer.id]));
 const root=(id:string):string=>{const parent=parents.get(id);if(parent===undefined||parent===id)return id;const value=root(parent);parents.set(id,value);return value;};
 for(const curve of drawing.curves){const layer=curveLayers.get(curve.id);if(!layer)continue;for(const id of curve.nodes){const owner=nodeOwners.get(id);if(!owner)continue;const a=root(layer),b=root(owner.layerId);if(a!==b)parents.set(a<b?b:a,a<b?a:b);}}
 return new Map(drawing.layers.map(layer=>[layer.id,root(layer.id)]));
}

/** Runtime only changes existing axis-aligned brackets contained in a saved
 * view pair. Each bracket renormalizes the same response, preserving every
 * authored intermediate key. Overlapping pairs choose the narrowest span,
 * then stable asset ID; a flat response span falls back to local linear. */
export function snapshotTrackProgressMapper(recording:SnapshotRecording,snapshots:readonly RecordingSnapshot[],layerId:string,curveId?:string):SceneProgressMapper|undefined {
 const assets=recording.interpolationWeights;if(!assets?.length)return undefined;
 const views=new Map(snapshots.map(view=>[view.id,view])),pairs=new Map<string,SnapshotInterpolationWeight>();
 for(const asset of assets){if(asset.target.layerId!==layerId||asset.target.curveId!==undefined&&asset.target.curveId!==curveId)continue;const key=JSON.stringify([asset.startSnapshotId,asset.endSnapshotId].sort()),known=pairs.get(key);if(!known||asset.target.curveId===curveId&&curveId!==undefined)pairs.set(key,asset);}
 if(!pairs.size)return undefined;
 const contains=(p:number)=>p>=-1e-8&&p<=1+1e-8;
 return (start:Angle,end:Angle,t:number)=>{
  if(t===0||t===1)return t;
  const candidates=[...pairs.values()].flatMap(asset=>{
   const a=views.get(asset.startSnapshotId)?.angle,b=views.get(asset.endSnapshotId)?.angle;if(!a||!b)return [];
   const dx=b.x-a.x,dy=b.y-a.y,axis=dx!==0&&dy===0?'x':dy!==0&&dx===0?'y':undefined;if(!axis)return [];
   const cross=axis==='x'?'y':'x';if(Math.abs(start[cross]-a[cross])>1e-8||Math.abs(end[cross]-a[cross])>1e-8)return [];
   const span=b[axis]-a[axis],lo=(start[axis]-a[axis])/span,hi=(end[axis]-a[axis])/span;if(!contains(lo)||!contains(hi))return [];
   return [{asset,lo,hi,span:Math.abs(span)}];
  }).sort((a,b)=>a.span-b.span||a.asset.id.localeCompare(b.asset.id));
  const found=candidates[0];if(!found)return t;
  const a=evaluateSnapshotWeightCurve(found.asset.points,found.lo),b=evaluateSnapshotWeightCurve(found.asset.points,found.hi),value=evaluateSnapshotWeightCurve(found.asset.points,found.lo+(found.hi-found.lo)*t);
  return Math.abs(b-a)<1e-12?t:clamp((value-a)/(b-a));
 };
}
