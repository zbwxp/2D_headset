import {curveById,endKey,nodeAt,sameEnd,sub,length,type Cubic,type CurveUse,type DrawingDocument as Doc,type Endpoint,type InkEnds} from './model';
import {strokes,strokePaths,type StrokePath} from './strokes';
import {derivedUses,subcurve,type DerivedUses} from './roundedJoin';
import {arcField} from './sampling';
import type {InkSpan} from './displayIntervals';
import {compileDisplayRouteBrushes,type CompiledDisplayRouteBrushes,type DisplayLinkBrushOverrides} from './displayRouteBrush';
import {evaluatedAffine,evaluatedAffineSource,affineGeometry,affineMaterialField,affineShape} from './evaluatedAffine';

/** Display traversal only. The captured seed preserves the path selected before
 * linking. Geometry endpoints/links and interval positioning remain separate. */
export interface DisplayRoute {seed:StrokePath;throughLinkIds:string[]}
/** Copy/import uses its existing explicit ID map; missing dependencies are the
 * caller's validation error, never a reason to bind to nearby geometry. */
export function mapDisplayRouteReferences(route:DisplayRoute,curveId:(id:string)=>string,linkId:(id:string)=>string):DisplayRoute {
 return {...route,seed:{...route.seed,segments:route.seed.segments.map(u=>({...u,id:curveId(u.id)}))},throughLinkIds:route.throughLinkIds.map(linkId)};
}
/** An explicit split may replace both curve IDs. Legacy Drawing keeps id on
 * the left. Link ports are remapped by the command; this is traversal only. */
export function splitDisplayRoute(route:DisplayRoute,id:string,newId:string,leftId=id):DisplayRoute {
 return {seed:{closed:route.seed.closed,segments:route.seed.segments.flatMap(u=>u.id!==id?[{...u}]:u.reverse?[{id:newId,reverse:true},{id:leftId,reverse:true}]:[{id:leftId,reverse:false},{id:newId,reverse:false}])},throughLinkIds:[...route.throughLinkIds]};
}
export interface DisplayRouteDiagnostic {code:'INVALID_SEED'|'MISSING_LINK'|'DISABLED_LINK'|'PORT_CONFLICT'|'DISCONNECTED_LINK'|'SEPARATED_LINK'|'INVALID_TRAVERSAL'|'GEOMETRY';message:string;linkId?:string}
export interface ResolvedDisplayRoute {path:StrokePath;usedLinkIds:string[];displacedJoinIds:string[];diagnostics:DisplayRouteDiagnostic[]}
const opposite=(e:Endpoint):Endpoint=>({curveId:e.curveId,end:e.end===0?1:0});
const entrance=(u:CurveUse):Endpoint=>({curveId:u.id,end:u.reverse?1:0});
const exit=(u:CurveUse)=>opposite(entrance(u));
const clonePath=(p:StrokePath):StrokePath=>({segments:p.segments.map(u=>({...u})),closed:p.closed});

/** Invalid routes retain their captured traversal and report why they cannot be
 * adopted. Never choose a different branch from coordinates or tangent angles. */
export function resolveDisplayRoute(d:Doc,route:DisplayRoute,options:{deferEndpointPositions?:boolean}={}):ResolvedDisplayRoute {
 const diagnostics:DisplayRouteDiagnostic[]=[],usedLinkIds:string[]=[],displacedJoinIds:string[]=[];
 const result=(path:StrokePath=route.seed):ResolvedDisplayRoute=>({path:clonePath(path),usedLinkIds,displacedJoinIds,diagnostics});
 const seed=route.seed;
 if(!seed||!Array.isArray(seed.segments)||!seed.segments.length||typeof seed.closed!=='boolean'||seed.segments.some(u=>!u||typeof u.reverse!=='boolean'||!curveById(d,u.id))||new Set(seed.segments.map(u=>u.id)).size!==seed.segments.length){
  diagnostics.push({code:'INVALID_SEED',message:'显示路径的原始曲线引用无效。'});return {path:{segments:[],closed:false},usedLinkIds,displacedJoinIds,diagnostics};
 }
 if(!Array.isArray(route.throughLinkIds)||new Set(route.throughLinkIds).size!==route.throughLinkIds.length){diagnostics.push({code:'INVALID_SEED',message:'显示路径的联动引用重复或无效。'});return result();}
 // The seed itself is authoritative for its local continuation. Other paths are
 // discovered only by explicit selected links; layer/item order is not a route.
 const pairs=new Map<string,Endpoint>();
 const connect=(a:Endpoint,b:Endpoint)=>{pairs.set(endKey(a),b);pairs.set(endKey(b),a);};
 const disconnect=(e:Endpoint)=>{const partner=pairs.get(endKey(e));pairs.delete(endKey(e));if(partner&&sameEnd(pairs.get(endKey(partner))??{curveId:'',end:0},e))pairs.delete(endKey(partner));};
 for(const layer of d.layers)for(const stroke of strokes(d,layer.id))for(const path of strokePaths(stroke))for(let i=0;i<(path.closed?path.segments.length:path.segments.length-1);i++)connect(exit(path.segments[i]),entrance(path.segments[(i+1)%path.segments.length]));
 for(const u of seed.segments){disconnect(entrance(u));disconnect(exit(u));}
 for(let i=0;i<(seed.closed?seed.segments.length:seed.segments.length-1);i++){
  const a=exit(seed.segments[i]),b=entrance(seed.segments[(i+1)%seed.segments.length]);
  if(nodeAt(d,a).id!==nodeAt(d,b).id){diagnostics.push({code:'INVALID_SEED',message:'原显示路径的本地续接已改变；请明确更新路径引用。'});return result();}
  connect(a,b);
 }
 if(!route.throughLinkIds.length)return result();
 const selected=new Set<string>(),linkAt=new Map<string,string>();
 for(const id of route.throughLinkIds){
  const link=d.endpointLinks?.find(l=>l.id===id);
  if(!link){diagnostics.push({code:'MISSING_LINK',message:'显示路径引用的端点联动已删除。',linkId:id});continue;}
  if((link as typeof link & {throughDisplay?:boolean}).throughDisplay!==true){diagnostics.push({code:'DISABLED_LINK',message:'此端点联动尚未启用显示贯通。',linkId:id});continue;}
  if([link.a,link.b].some(e=>selected.has(endKey(e)))){diagnostics.push({code:'PORT_CONFLICT',message:'同一个几何端点指定了多个显示续接；请保留一个明确续接。',linkId:id});continue;}
  if(!curveById(d,link.a.curveId)||!curveById(d,link.b.curveId)||!options.deferEndpointPositions&&length(sub(nodeAt(d,link.a).position,nodeAt(d,link.b).position))>1e-7){diagnostics.push({code:'SEPARATED_LINK',message:'联动端点未重合，不能生成贯通显示路径。',linkId:id});continue;}
  for(const e of [link.a,link.b]){selected.add(endKey(e));linkAt.set(endKey(e),id);disconnect(e);}
  connect(link.a,link.b);
 }
 if(diagnostics.length)return result();
 // Walk backward from the seed's oriented entrance to find the genuine open
 // boundary, or retain that entrance as the origin of a closed traversal.
 const anchor=entrance(seed.segments[0]),backSeen=new Set<string>();let start=anchor;
 while(pairs.has(endKey(start))){
  const prior=opposite(pairs.get(endKey(start))!);
  if(sameEnd(prior,anchor)){start=anchor;break;}
  if(backSeen.has(endKey(prior))){diagnostics.push({code:'INVALID_TRAVERSAL',message:'显示续接未形成有效路径。'});return result();}
  backSeen.add(endKey(prior));start=prior;
 }
 const segments:CurveUse[]=[],seen=new Set<string>();let at:Endpoint|undefined=start,closed=false;
 while(at){
  if(seen.has(at.curveId)){closed=sameEnd(at,start);if(!closed)diagnostics.push({code:'INVALID_TRAVERSAL',message:'显示路径重复经过源曲线；请明确续接。'});break;}
  seen.add(at.curveId);segments.push({id:at.curveId,reverse:at.end===1});
  const end=opposite(at),linkId=linkAt.get(endKey(end));if(linkId&&!usedLinkIds.includes(linkId))usedLinkIds.push(linkId);
  at=pairs.get(endKey(end));
 }
 if(seed.segments.some(u=>!seen.has(u.id))){diagnostics.push({code:'INVALID_TRAVERSAL',message:'贯通操作会丢失原来选择的路径分支；请明确选择显示路径。'});return result();}
 for(const id of route.throughLinkIds)if(!usedLinkIds.includes(id))diagnostics.push({code:'DISCONNECTED_LINK',message:'所选联动不在此显示路径上。',linkId:id});
 if(diagnostics.length)return result();
 for(const join of d.joins)if(selected.has(endKey(join.a))||selected.has(endKey(join.b))){
  if(!sameEnd(pairs.get(endKey(join.a))??{curveId:'',end:0},join.b))displacedJoinIds.push(join.id);
 }
 return result({segments,closed});
}

/** Material identity, not a world-space nearest point. Join positions are local
 * arc fractions because an existing ARC is derived, not an original cubic. */
export type RouteMaterialPoint={kind:'curve';curveId:string;t:number}|{kind:'join';joinId:string;s:number};
export interface RouteMaterialSpan {from:RouteMaterialPoint;to:RouteMaterialPoint;ends:InkEnds;run:number;continuesBefore:boolean;continuesAfter:boolean}
export interface RouteCoverageIssue {span:number;reason:'MISSING_MATERIAL'|'TRIMMED_MATERIAL'|'DEGENERATE_MATERIAL';message:string}
export interface RouteCoverageResult {inkSpans:InkSpan[];unmapped:RouteCoverageIssue[]}

/** Explicit provenance for copy/import or an authored replacement of a local
 * ARC by an equivalent link ARC. The caller verifies geometric equivalence;
 * this function never invents the correspondence. Reversed a/b swaps arc s. */
export function mapRouteCoverageReferences(material:readonly RouteMaterialSpan[],curveId:(id:string)=>string,join:(id:string)=>{id:string;reverse?:boolean}):RouteMaterialSpan[]{
 const map=(point:RouteMaterialPoint):RouteMaterialPoint=>{
  if(point.kind==='curve')return {...point,curveId:curveId(point.curveId)};
  const target=join(point.joinId);return {kind:'join',joinId:target.id,s:target.reverse?1-point.s:point.s};
 };
 return material.map(span=>({...span,from:map(span.from),to:map(span.to),ends:cloneEnds(span.ends)}));
}

/** Exact source split transports coverage by the known parameter map. This is
 * an explicit editing operation, not automatic recovery from stale IDs. */
export function splitRouteCoverage(material:readonly RouteMaterialSpan[],id:string,newId:string,at:number,leftId=id):RouteMaterialSpan[]{
 if(!Number.isFinite(at)||at<=0||at>=1||!id||!newId||!leftId||leftId===newId||id===newId)throw new Error('显示路径分割映射无效。');
 return material.flatMap(span=>{
  if(span.from.kind!=='curve'||span.to.kind!=='curve'||span.from.curveId!==id||span.to.curveId!==id)return [{...span,from:{...span.from},to:{...span.to},ends:cloneEnds(span.ends)}];
  const a=span.from.t,b=span.to.t,cut=at>Math.min(a,b)&&at<Math.max(a,b),points=cut?[a,at,b]:[a,b];
  return points.slice(1).map((end,i)=>{
   const start=points[i],right=(start+end)/2>at,to=(t:number):RouteMaterialPoint=>({kind:'curve',curveId:right?newId:leftId,t:clamp(right?(t-at)/(1-at):t/at)}),ends=plainEnds();
   if(i===0)ends[0]={...span.ends[0]};if(i===points.length-2)ends[1]={...span.ends[1]};
   return {...span,from:to(start),to:to(end),ends,continuesBefore:span.continuesBefore||i>0,continuesAfter:span.continuesAfter||i<points.length-2};
  });
 });
}

type ArcField=ReturnType<typeof arcField>;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
function tAt(part:ArcField['parts'][number],distance:number):number {
 const local=Math.max(0,Math.min(part.length,distance));let lo=0,hi=part.dist.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
 return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);
}
function distanceAt(part:ArcField['parts'][number],t:number):number {
 let lo=0,hi=part.pts.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.pts[mid].t<=t)lo=mid;else hi=mid;}
 return part.start+part.dist[lo]+(part.dist[hi]-part.dist[lo])*clamp((t-part.pts[lo].t)/(part.pts[hi].t-part.pts[lo].t||1));
}
const plainEnds=():InkEnds=>[{taper:0,extension:0},{taper:0,extension:0}];
const cloneEnds=(ends:InkEnds):InkEnds=>[{...ends[0]},{...ends[1]}];

export interface DisplayRouteField extends ArcField {
 path:StrokePath;geometry:DerivedUses;diagnostics:DisplayRouteDiagnostic[];
 brushes:CompiledDisplayRouteBrushes;
 materialAt:(s:number)=>RouteMaterialPoint|undefined;
 positionOf:(point:RouteMaterialPoint)=>number|undefined;
 materialAtPiece:(piece:number,t:number)=>RouteMaterialPoint|undefined;
}
/** Measure route ink independently of local ownership/fills. Displaced local
 * ARC joins are omitted only in this transient ink geometry. */
export function createDisplayRouteField(d:Doc,route:DisplayRoute|ResolvedDisplayRoute,brushOverrides:DisplayLinkBrushOverrides={}):DisplayRouteField {
 const affine=evaluatedAffine(d,('seed' in route?route.seed:route.path).segments[0]?.id);if(affine){
  const source=createDisplayRouteField(evaluatedAffineSource(d)!,route,brushOverrides);
  return {...affineMaterialField(source,affine),geometry:affineGeometry(source.geometry,affine),brushes:{...source.brushes,links:source.brushes.links.map(link=>({...link,...(link.geometry?{geometry:{...link.geometry,shapes:link.geometry.shapes.map(shape=>affineShape(shape,affine))}}:{})}))}};
 }
 const resolved='seed' in route?resolveDisplayRoute(d,route):route;
 const brushes=compileDisplayRouteBrushes(d,resolved,brushOverrides),geometryDoc=brushes.inkDocument;
 const geometry=resolved.path.segments.length?derivedUses(geometryDoc,resolved.path.segments,resolved.path.closed):{shapes:[],pieces:[],error:'显示路径为空。'};
 const field=arcField(geometry.shapes),diagnostics=[...resolved.diagnostics];
 for(const issue of brushes.diagnostics)if(issue.severity==='error'&&issue.code!=='INVALID_ROUTE')diagnostics.push({code:'GEOMETRY',message:issue.message,linkId:issue.linkId});
 if(geometry.error)diagnostics.push({code:'GEOMETRY',message:geometry.error});
 const uses=new Map(resolved.path.segments.map(u=>[u.id,u])),joins=new Map<string,{start:number;length:number;reverse:boolean}>();
 geometry.pieces.forEach((p,i)=>{if(p.joinId){
  const old=joins.get(p.joinId),join=geometryDoc.joins.find(j=>j.id===p.joinId),before=geometry.pieces[(i-1+geometry.pieces.length)%geometry.pieces.length];
  const beforeUse=uses.get(before?.owners[0]);
  const reverse=old?.reverse??!!(join&&beforeUse&&sameEnd(exit(beforeUse),join.b));
  joins.set(p.joinId,{start:old?.start??field.parts[i].start,length:(old?.length??0)+field.parts[i].length,reverse});
 }});
 const materialAtPiece=(i:number,t:number):RouteMaterialPoint|undefined=>{
  const piece=geometry.pieces[i],part=field.parts[i];if(!piece||!part)return undefined;
  if(piece.joinId){const j=joins.get(piece.joinId)!,s=j.length?clamp((distanceAt(part,t)-j.start)/j.length):0;return {kind:'join',joinId:piece.joinId,s:j.reverse?1-s:s};}
  const id=piece.owners[0],range=piece.sourceRange??[0,1],u=range[0]+(range[1]-range[0])*t;
  return {kind:'curve',curveId:id,t:uses.get(id)?.reverse?1-u:u};
 };
 const materialAt=(s:number):RouteMaterialPoint|undefined=>{
  if(!Number.isFinite(s)||s<0||s>1||field.total<1e-12)return undefined;
  const distance=s*field.total,index=field.parts.findIndex(p=>distance<=p.start+p.length+1e-12),i=index<0?field.parts.length-1:index;
  return materialAtPiece(i,tAt(field.parts[i],distance-field.parts[i].start));
 };
 const positionOf=(point:RouteMaterialPoint):number|undefined=>{
  if(field.total<1e-12)return undefined;
  if(point.kind==='join'){const j=joins.get(point.joinId);return j&&Number.isFinite(point.s)&&point.s>=0&&point.s<=1?clamp((j.start+(j.reverse?1-point.s:point.s)*j.length)/field.total):undefined;}
  if(!Number.isFinite(point.t)||point.t<0||point.t>1)return undefined;
  const i=geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===point.curveId);if(i<0)return undefined;
  const range=geometry.pieces[i].sourceRange??[0,1],t=uses.get(point.curveId)?.reverse?1-point.t:point.t;
  if(t<range[0]-1e-10||t>range[1]+1e-10||range[1]-range[0]<1e-12)return undefined;
  // Valid source material lies inside this field. Summed piece distances can
  // exceed total by one ULP at its outer end; never serialize that as > 1.
  return clamp(distanceAt(field.parts[i],clamp((t-range[0])/(range[1]-range[0])))/field.total);
 };
 return {...field,path:clonePath(resolved.path),geometry,diagnostics,brushes,materialAt,positionOf,materialAtPiece};
}

/** Fractions here are native ROUTE arc length, not a track's anchor-relative
 * coordinate. The caller resolves SHOW/HIDE/wrap into disjoint InkSpans first. */
export function captureRouteCoverage(field:DisplayRouteField,spans:readonly InkSpan[]):RouteMaterialSpan[]{
 const out:RouteMaterialSpan[]=[];if(field.diagnostics.length)throw new Error(field.diagnostics[0].message);
 if(field.total<1e-12){if(spans.some(s=>s.end-s.start>1e-10))throw new Error('显示路径长度退化，无法保持区间。');return out;}
 const wrap=field.path.closed&&spans.some(s=>s.start<1e-10&&s.end>s.start)&&spans.some(s=>s.end>1-1e-10&&s.end>s.start);
 spans.forEach((span,run)=>{
  if(!Number.isFinite(span.start)||!Number.isFinite(span.end)||span.start<0||span.end>1||span.end<span.start)throw new Error('显示覆盖必须是有序的 0–1 弧长范围。');
  const start=span.start*field.total,end=span.end*field.total;
  field.parts.forEach((part,i)=>{
   const lo=Math.max(start,part.start),hi=Math.min(end,part.start+part.length);if(hi-lo<=1e-12)return;
   const a=field.materialAtPiece(i,tAt(part,lo-part.start)),b=field.materialAtPiece(i,tAt(part,hi-part.start));if(!a||!b)return;
   const continuesBefore=lo>start+1e-10||wrap&&lo<1e-10,continuesAfter=hi<end-1e-10||wrap&&hi>field.total-1e-10,ends=plainEnds();
   if(!continuesBefore)ends[0]={...span.ends[0]};if(!continuesAfter)ends[1]={...span.ends[1]};
   out.push({from:a,to:b,ends,run,continuesBefore,continuesAfter});
  });
 });return out;
}

/** Remap every material fragment, not merely the two outer cuts. Inserting a
 * loop between old cuts must never reveal that loop as an accidental side effect.
 * Missing/replaced ARC material is reported, never rebound by nearest geometry. */
export function remapRouteCoverage(material:readonly RouteMaterialSpan[],target:DisplayRouteField):RouteCoverageResult {
 if(target.diagnostics.length)throw new Error(target.diagnostics[0].message);
 const unmapped:RouteCoverageIssue[]=[],spans:InkSpan[]=[];
 material.forEach((span,index)=>{
  const a=target.positionOf(span.from),b=target.positionOf(span.to);
  if(a===undefined||b===undefined){
   const curve=span.from.kind==='curve'?span.from.curveId:undefined,exists=curve?target.path.segments.some(u=>u.id===curve):target.geometry.pieces.some(p=>p.joinId===(span.from.kind==='join'?span.from.joinId:''));
   unmapped.push({span:index,reason:target.total<1e-12?'DEGENERATE_MATERIAL':exists?'TRIMMED_MATERIAL':'MISSING_MATERIAL',message:exists?'原显示范围进入了新的裁切区域，无法保持同一材料位置。':'原显示范围的源曲线或圆弧已不在目标路径中。'});return;
  }
  if(Math.abs(b-a)<1e-12){unmapped.push({span:index,reason:'DEGENERATE_MATERIAL',message:'原显示范围在目标路径中退化。'});return;}
  const reverse=a>b;spans.push({start:Math.min(a,b),end:Math.max(a,b),ends:reverse?[{...span.ends[1]},{...span.ends[0]}]:cloneEnds(span.ends)});
 });
 // Only touching/overlapping material coverage is united. Gaps introduced by
 // routing remain gaps, including gaps where another closed loop was inserted.
 const inkSpans:InkSpan[]=[];
 for(const span of spans.sort((a,b)=>a.start-b.start||a.end-b.end)){
  const prior=inkSpans.at(-1);
  if(!prior||span.start>prior.end+1e-10){inkSpans.push(span);continue;}
  if(span.end>prior.end+1e-10){prior.end=span.end;prior.ends[1]={...span.ends[1]};}
 }
 return {inkSpans,unmapped};
}

export interface RouteInkPiece {shape:Cubic;pieceIndex:number;owners:string[];inkOwner?:string;joinId?:string;start:number;end:number;ends:InkEnds;run:number;continuesBefore:boolean;continuesAfter:boolean}
/** Pure rendering projection. Measure once globally, retain source ownership for
 * existing paint slots, and do not invent fresh 末端笔触 at member boundaries. */
export function projectRouteSpansToPieces(field:DisplayRouteField,spans:readonly InkSpan[]):RouteInkPiece[]{
 const out:RouteInkPiece[]=[];if(field.diagnostics.length)throw new Error(field.diagnostics[0].message);
 if(field.total<1e-12)return out;
 const wrap=field.path.closed&&spans.some(s=>s.start<1e-10&&s.end>s.start)&&spans.some(s=>s.end>1-1e-10&&s.end>s.start);
 const joins=new Map<string,{middle:number;before:string;after:string}>();
 for(let i=0;i<field.geometry.pieces.length;i++){
  const p=field.geometry.pieces[i];if(!p.joinId||joins.has(p.joinId))continue;
  let j=i+1;while(j<field.geometry.pieces.length&&field.geometry.pieces[j].joinId===p.joinId)j++;
  const start=field.parts[i].start,end=field.parts[j-1].start+field.parts[j-1].length;
  joins.set(p.joinId,{middle:(start+end)/2,before:field.geometry.pieces[(i-1+field.geometry.pieces.length)%field.geometry.pieces.length].owners[0],after:field.geometry.pieces[j%field.geometry.pieces.length].owners[0]});
 }
 spans.forEach((span,run)=>{
  if(!Number.isFinite(span.start)||!Number.isFinite(span.end)||span.start<0||span.end>1||span.end<span.start)throw new Error('显示覆盖必须是有序的 0–1 弧长范围。');
  const start=span.start*field.total,end=span.end*field.total;
  field.parts.forEach((part,pieceIndex)=>{
   const lo=Math.max(start,part.start),hi=Math.min(end,part.start+part.length);if(hi-lo<=1e-12)return;
   const piece=field.geometry.pieces[pieceIndex],join=piece.joinId?joins.get(piece.joinId):undefined;
   const cuts=join&&join.middle>lo+1e-10&&join.middle<hi-1e-10?[lo,join.middle,hi]:[lo,hi];
   for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1],b=cuts[i],continuesBefore=a>start+1e-10||wrap&&a<1e-10,continuesAfter=b<end-1e-10||wrap&&b>field.total-1e-10,ends=plainEnds();
    if(!continuesBefore)ends[0]={...span.ends[0]};if(!continuesAfter)ends[1]={...span.ends[1]};
    const inkOwner=join?((a+b)/2<join.middle?join.before:join.after):piece.inkOwner??piece.owners[0];
    out.push({shape:subcurve(part.shape,tAt(part,a-part.start),tAt(part,b-part.start)),pieceIndex,owners:[...piece.owners],inkOwner,joinId:piece.joinId,start:a/field.total,end:b/field.total,ends,run:wrap&&(span.start<1e-10||span.end>1-1e-10)?0:run,continuesBefore,continuesAfter});
   }
  });
 });return out;
}
