import {add,sub,mul,length,nodeAt,curveById,type DrawingDocument,type Endpoint} from './model';
import {deriveSmoothComponents,smoothEndpointKey as endpointKey} from '../endpointRelations/smoothComponent';

type SmoothComponent={ends:Map<string,{endpoint:Endpoint;sign:number}>;driver:Endpoint;conflict:boolean};
/** A stable authority and alternating directions retain G1 between angle keys.
 * The graph includes Drawing joins and cross-layer SMOOTH display links. */
export function drawingSmoothComponents(d:DrawingDocument):SmoothComponent[]{
 const relations=[...d.joins.filter(j=>j.mode==='SMOOTH'),...(d.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='SMOOTH')];
 return deriveSmoothComponents(relations).map(component=>({ends:new Map(component.members.map(member=>[endpointKey(member.endpoint),member])),driver:component.members[0].endpoint,conflict:component.conflict}));
}
/** Drawing policy: preserve each length and the existing scalar-first arithmetic.
 * Sparse pose evaluation uses the stable driver and ignores authored locks;
 * authoring supplies its grabbed endpoint and rejects changed locked controls.
 * Validate the complete component before changing any of its handles. */
export function projectDrawingSmoothComponent(d:DrawingDocument,component:SmoothComponent,driver=component.driver,authoring=false):void {
 if(component.conflict)throw Error('SMOOTH links request conflicting handle directions.');
 const vector=sub(curveById(d,driver.curveId).handles[driver.end],nodeAt(d,driver).position),size=length(vector),driverSign=component.ends.get(endpointKey(driver))!.sign;
 if(size<1e-7)throw Error('A SMOOTH handle cannot collapse to zero.');
 for(const {endpoint,sign} of component.ends.values()){
  const curve=curveById(d,endpoint.curveId),node=nodeAt(d,endpoint).position,old=curve.handles[endpoint.end],extent=length(sub(old,node));
  if(extent<1e-7)throw Error('A SMOOTH handle cannot collapse to zero.');
  const position=add(node,mul(vector,extent/size*sign/driverSign));
  if(authoring&&curve.locked&&length(sub(old,position))>1e-12)throw Error('关联对象已锁定，无法修改。');
 }
 for(const {endpoint,sign} of component.ends.values()){const curve=curveById(d,endpoint.curveId),node=nodeAt(d,endpoint).position,extent=length(sub(curve.handles[endpoint.end],node));curve.handles[endpoint.end]=add(node,mul(vector,extent/size*sign/driverSign));}
}
/** Native layer editing uses the same explicit, cross-layer SMOOTH graph as
 * legacy scene editing. The grabbed endpoint is the authoring direction driver. */
export function projectDrawingSmoothHandle(drawing:DrawingDocument,endpoint:Endpoint):DrawingDocument {
 const component=drawingSmoothComponents(drawing).find(c=>c.ends.has(endpointKey(endpoint)));if(!component)return drawing;
 const result=structuredClone(drawing);projectDrawingSmoothComponent(result,component,endpoint,true);return result;
}
