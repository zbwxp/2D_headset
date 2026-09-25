import {add,sub,mul,length,type Point2,type Cubic} from './model';
const unit=(v:Point2)=>mul(v,1/(length(v)||1));
/** Direction of travel at a cubic endpoint, including collapsed endpoint handles. */
export function cubicEndTangent(s:Cubic,end:0|1):Point2{
 const vs=end?[sub(s[3],s[2]),sub(s[3],s[1]),sub(s[3],s[0])]:[sub(s[1],s[0]),sub(s[2],s[0]),sub(s[3],s[0])];
 return unit(vs.find(v=>length(v)>1e-10)??[0,0]);
}
/** Add a pointed outer wedge, capped at five times the adjacent average full
 * ink width, measured from the shared point. An exact reversal has no finite miter;
 * callers taper locally to the shared point instead of emitting infinity. */
export function cuspCorner(incoming:Cubic,outgoing:Cubic,halfWidth:number,outgoingHalfWidth=halfWidth):{tip:Point2[];pinch:boolean}{
 const a=cubicEndTangent(incoming,1),b=cubicEndTangent(outgoing,0),dot=Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1])),turn=a[0]*b[1]-a[1]*b[0];
 if(length(a)<.5||length(b)<.5)return {tip:[],pinch:true};
 if(1+dot<1e-10)return {tip:[],pinch:true};
 if(Math.abs(turn)<1e-10||halfWidth+outgoingHalfWidth<=0)return {tip:[],pinch:false};
 const p=incoming[3],side=turn>0?-1:1,n0:Point2=[-a[1],a[0]],n1:Point2=[-b[1],b[0]],offset0=mul(n0,side*halfWidth),offset1=mul(n1,side*outgoingHalfWidth);
 const miter=halfWidth===outgoingHalfWidth?mul(add(n0,n1),side*halfWidth/(1+dot)):
  add(offset0,mul(a,side*(halfWidth*dot-outgoingHalfWidth)/turn));
 // The sum of half widths is the average of full widths. Shorten the spike,
 // retaining a pointed apex rather than replacing it with a bevel.
 const limit=5*(halfWidth+outgoingHalfWidth),tip=mul(miter,Math.min(1,limit/(length(miter)||1)));
 return {tip:[p,add(p,offset0),add(p,tip),add(p,offset1)],pinch:false};
}
