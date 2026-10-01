import {add,sub,mul,length,type Cubic,type End,type Point2,type ResolvedVisibleTerminus,type TerminusBrushStyle,type TerminusJoinBrush,type TangentJoin} from './model';
/** 末端笔触 is shared APPEARANCE. It does not locate/move a geometry endpoint or
 * a display interval. Suppression is effective-only; authored style is untouched. */
export function effectiveTerminusBrush(authored:TerminusBrushStyle,connected=false):TerminusBrushStyle{return connected?{taper:0,extension:0}:authored;}
/** Caller supplies the already chosen ink segment. This computes cap rendering
 * geometry only, never an editing reference or source topology relation. */
export function renderTerminusBrush(shape:Cubic,end:End,brush:TerminusBrushStyle={}):ResolvedVisibleTerminus{
 const support=shape[end?3:0],candidates=end?[sub(shape[3],shape[2]),sub(shape[3],shape[1]),sub(shape[3],shape[0])]:[sub(shape[0],shape[1]),sub(shape[0],shape[2]),sub(shape[0],shape[3])],v=candidates.find(v=>length(v)>1e-10)??[0,0] as Point2,direction=mul(v,1/(length(v)||1));
 return {kind:'VISIBLE_TERMINUS',support,direction,point:add(support,mul(direction,brush.extension??0)),brush};
}
/** Explicit compatibility adapter: old geometry joins keep their own positioning
 * and serialization; only their rendering style enters the shared brush system. */
export function geometryJoinBrush(join:Pick<TangentJoin,'mode'|'radius'>):TerminusJoinBrush{
 return join.mode==='CUSP'?{kind:'SHARP'}:join.mode==='SMOOTH'?{kind:'SMOOTH'}:{kind:'ARC',trimDistance:join.radius??0};
}
