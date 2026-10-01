import {curveById,nodeAt,sub,length,type DrawingDocument as Doc,type EndpointLink,type TangentJoin,type TerminusJoinBrush} from './model';
import {roundedJoins,type ArcJoinGeometry} from './roundedJoin';
import type {ResolvedDisplayRoute} from './displayRoutes';

export interface DisplayRouteBrushDiagnostic {
 severity:'info'|'warning'|'error';
 code:'INVALID_ROUTE'|'INVALID_BRUSH'|'MISSING_LINK'|'SEPARATED_ENDPOINTS'|'WIDTH_MISMATCH'|'PROFILE_VARIATION'|'DEGENERATE_TANGENT'|'SMOOTH_REQUIRES_TANGENT_MATCH'|'ARC_FAILED'|'ARC_CLAMPED'|'HIDDEN_OWNER';
 linkId?:string;message:string;
}
export interface ResolvedDisplayLinkBrush {
 linkId:string;brush:TerminusJoinBrush;joinId?:string;
 /** Geometry can remain resolved while its owners/coverage are hidden. */
 resolved:boolean;ownersVisible:boolean;widths:[number,number];
 /** Necessary, not sufficient: caller must also check that ink survives on BOTH
  * sides of the connection after interval coverage. */
 suppressionEligible:boolean;
 geometry?:ArcJoinGeometry;
}
export interface CompiledDisplayRouteBrushes {
 /** Transient ink input only. Never parse/save it or feed it to fillGeometry. */
 inkDocument:Doc;links:ResolvedDisplayLinkBrush[];diagnostics:DisplayRouteBrushDiagnostic[];
}
export type DisplayLinkBrushOverrides=Readonly<Record<string,TerminusJoinBrush>>;
type StyledLink=EndpointLink & {joinBrush?:TerminusJoinBrush};
const validBrush=(brush:TerminusJoinBrush)=>brush&&(['SHARP','SMOOTH'].includes(brush.kind)||brush.kind==='ARC'&&Number.isFinite(brush.trimDistance)&&brush.trimDistance>0&&brush.trimDistance<=2);

/** Existing geometric endpoint coupling supplies positions. This helper shares
 * ONLY 末端接笔 appearance: no endpoint abstraction, source handles, node merge,
 * ownership, width, interval location or fill boundary is edited.
 *
 * Like the existing ARC, trimDistance is requested per-side influence, not a
 * fixed circle radius. biarc's cubic circle approximation and G1 semantics are
 * retained. Constant-width MVP requires matching base widths; varying profiles
 * are explicitly reported and must retain each owner's style in the renderer. */
export function compileDisplayRouteBrushes(d:Doc,route:ResolvedDisplayRoute,overrides:DisplayLinkBrushOverrides={}):CompiledDisplayRouteBrushes {
 const diagnostics:DisplayRouteBrushDiagnostic[]=[],links:ResolvedDisplayLinkBrush[]=[];
 if(route.diagnostics.length)return {inkDocument:d,links,diagnostics:[{severity:'error',code:'INVALID_ROUTE',message:route.diagnostics[0].message}]};
 const displaced=new Set(route.displacedJoinIds),joins=d.joins.filter(j=>!displaced.has(j.id));
 const occupied=new Set([...d.layers,...d.nodes,...d.curves,...d.fills,...d.offsets,...d.joins,...(d.endpointLinks??[])].map(x=>x.id));
 const syntheticId=(linkId:string)=>{let id=`display-join:${linkId}`;while(occupied.has(id))id=`display:${id}`;occupied.add(id);return id;};
 for(const linkId of route.usedLinkIds){
  const link=d.endpointLinks?.find(l=>l.id===linkId) as StyledLink|undefined;
  if(!link){diagnostics.push({severity:'error',code:'MISSING_LINK',linkId,message:'贯通路径的几何端点联动已不存在。'});continue;}
  const brush=overrides[linkId]??link.joinBrush??{kind:'SHARP'},a=curveById(d,link.a.curveId),b=curveById(d,link.b.curveId);
  if(!a||!b){diagnostics.push({severity:'error',code:'MISSING_LINK',linkId,message:'联动所引用的源曲线已不存在。'});continue;}
  const ownersVisible=a.visible&&b.visible&&a.inkVisible!==false&&b.inkVisible!==false;
  const item:ResolvedDisplayLinkBrush={linkId,brush:{...brush},resolved:false,ownersVisible,widths:[a.width,b.width],suppressionEligible:false};links.push(item);
  const error=(code:DisplayRouteBrushDiagnostic['code'],message:string)=>diagnostics.push({severity:'error',code,linkId,message});
  if(!validBrush(brush)){error('INVALID_BRUSH','末端接笔影响距离须大于 0 且不超过 2 个绘制单位。');continue;}
  const pa=nodeAt(d,link.a).position,pb=nodeAt(d,link.b).position;
  if(length(sub(pa,pb))>1e-7){error('SEPARATED_ENDPOINTS','几何端点未重合，不能生成贯通接笔。');continue;}
  if(Math.abs(a.width-b.width)>1e-10){error('WIDTH_MISMATCH','两侧线宽不同；当前等宽接笔不会修改任何源笔画线宽。');continue;}
  if((a.profile??'UNIFORM')!=='UNIFORM'||(b.profile??'UNIFORM')!=='UNIFORM')diagnostics.push({severity:'warning',code:'PROFILE_VARIATION',linkId,message:'两侧存在变化线宽轮廓；渲染须保留各自样式，不能假定接合处有效线宽相同。'});
  if(!ownersVisible)diagnostics.push({severity:'info',code:'HIDDEN_OWNER',linkId,message:'一侧墨线隐藏；保留结构弧长，不抑制外露的末端笔触。'});
  const va=sub(a.handles[link.a.end],pa),vb=sub(b.handles[link.b.end],pb),la=length(va),lb=length(vb);
  if(brush.kind!=='SHARP'&&(la<1e-7||lb<1e-7)){error('DEGENERATE_TANGENT','接笔处的源控制柄退化，无法确定平滑方向。');continue;}
  if(brush.kind==='SMOOTH'){
   const cosine=(va[0]*vb[0]+va[1]*vb[1])/(la*lb);
   if(cosine>-1+1e-6){error('SMOOTH_REQUIRES_TANGENT_MATCH','平滑笔触要求当前两侧切线已连续；不会旋转源控制柄。可选择带影响距离的圆弧笔触。');continue;}
  }
  const joinId=syntheticId(linkId),join:TangentJoin={id:joinId,a:{...link.a},b:{...link.b},mode:brush.kind==='SHARP'?'CUSP':brush.kind,...(brush.kind==='ARC'?{radius:brush.trimDistance}:{})};
  joins.push(join);item.joinId=joinId;item.resolved=true;item.suppressionEligible=ownersVisible;
 }
 const sameJoins=joins.length===d.joins.length&&joins.every((j,i)=>j===d.joins[i]),inkDocument=sameJoins?d:{...d,joins};
 // Evaluate all new ARC requests together so two transitions sharing a source
 // curve receive the same length-budget/clamping policy as local ARC joins.
 const arcs=links.some(l=>l.brush.kind==='ARC'&&l.joinId)?roundedJoins(inkDocument):undefined;
 for(const item of links){
  if(item.brush.kind!=='ARC'||!item.joinId)continue;
  const geometry=arcs!.get(item.joinId)!;item.geometry=geometry;
  if(geometry.error){item.resolved=false;item.suppressionEligible=false;diagnostics.push({severity:'error',code:'ARC_FAILED',linkId:item.linkId,message:geometry.error});}
  else if(geometry.clamped)diagnostics.push({severity:'warning',code:'ARC_CLAMPED',linkId:item.linkId,message:`圆弧可用长度不足，实际两侧影响距离为 ${geometry.distance}；保存的请求值未改变。`});
 }
 return {inkDocument,links,diagnostics};
}
