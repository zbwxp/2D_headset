import {curveById,editable,type DrawingDocument,type TerminusJoinBrush} from './model';
import {displayRouteInkSupport} from './displayRouteInk';
import {transportDeformedIntervals} from './deform';
import {projectDrawingSmoothHandle} from './smoothHandleAuthoring';

/** EndpointLink ink belongs to an explicitly authored through-display route.
 * The same command serves Drawing and Snapshot editors; SMOOTH authors the
 * real tangent constraint, ARC keeps the existing along-curve trim semantics. */
export function setEndpointLinkBrush(drawing:DrawingDocument,linkId:string,brush:TerminusJoinBrush|undefined):DrawingDocument {
 const link=drawing.endpointLinks?.find(value=>value.id===linkId);if(!link)throw Error('端点联动已不存在。');
 if([link.a,link.b].some(endpoint=>!editable(drawing,endpoint.curveId)))throw Error('关联对象已隐藏或锁定，无法修改。');
 const routes=(drawing.displayIntervals??[]).filter(track=>link.throughDisplay&&track.displayRoute?.throughLinkIds.includes(linkId));
 if(brush&&brush.kind!=='SHARP'&&!routes.length)throw Error('请先为此端点联动建立显示贯通，再设置平滑或圆弧接笔。');
 if(JSON.stringify(link.joinBrush)===JSON.stringify(brush))return drawing;
 let next:DrawingDocument={...drawing,endpointLinks:drawing.endpointLinks!.map(value=>{if(value.id!==linkId)return value;const {joinBrush:_,...plain}=value;return brush?{...plain,joinBrush:{...brush}}:plain;})};
 if(brush?.kind==='SMOOTH'){
  next=projectDrawingSmoothHandle(next,link.a);
  for(const curve of next.curves)if(JSON.stringify(curve.handles)!==JSON.stringify(curveById(drawing,curve.id).handles)&&!editable(drawing,curve.id))throw Error('关联对象已隐藏或锁定，无法修改。');
 }
 for(const track of routes){const errors=displayRouteInkSupport(next,track.displayRoute!);if(errors.length)throw Error(errors[0]);}
 return transportDeformedIntervals(drawing,next);
}
