import {expect,expectTypeOf,test} from 'vitest';
import {type GeometryEndpoint,type GeometryEndpointLink,type Endpoint,type EndpointLink,type DisplayIntervalBoundary,type ResolvedVisibleTerminus,type TerminusBrushStyle,type InkEndStyle,type Cubic,emptyDrawing,nodeAt} from '../domain/drawing/model';
import {effectiveTerminusBrush,geometryJoinBrush,renderTerminusBrush} from '../domain/drawing/terminusBrush';
import {inkTips} from '../domain/drawing/appearance';
test('geometry endpoints, coverage bounds and resolved visible termini are separate contracts',()=>{
 expectTypeOf<Endpoint>().toEqualTypeOf<GeometryEndpoint>();expectTypeOf<EndpointLink>().toEqualTypeOf<GeometryEndpointLink>();expectTypeOf<InkEndStyle>().toEqualTypeOf<TerminusBrushStyle>();
 expectTypeOf<DisplayIntervalBoundary>().not.toMatchTypeOf<GeometryEndpoint>();expectTypeOf<ResolvedVisibleTerminus>().not.toMatchTypeOf<GeometryEndpoint>();expectTypeOf<ResolvedVisibleTerminus>().not.toMatchTypeOf<DisplayIntervalBoundary>();
 const assertDistinct=(coverage:DisplayIntervalBoundary,ink:ResolvedVisibleTerminus)=>{
  // @ts-expect-error A coverage boundary is not a movable Bézier endpoint.
  nodeAt(emptyDrawing(),coverage);
  // @ts-expect-error Resolved visible ink has no source-node editing semantics.
  nodeAt(emptyDrawing(),ink);
 };void assertDistinct;
 const old={id:'link',a:{curveId:'a',end:0},b:{curveId:'b',end:1}};expect(JSON.parse(JSON.stringify(old))).toEqual(old);
});
test('shared terminus rendering preserves authored brushes and legacy cap geometry',()=>{
 const authored=Object.freeze({taper:.04,taperWidthScale:20,extension:.1,interior:true}),suppressed=effectiveTerminusBrush(authored,true);expect(suppressed).toEqual({taper:0,extension:0});expect(effectiveTerminusBrush(authored,false)).toBe(authored);expect(authored).toEqual({taper:.04,taperWidthScale:20,extension:.1,interior:true});
 const line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]],tip=renderTerminusBrush(line,0,authored);expect(tip.kind).toBe('VISIBLE_TERMINUS');expect(tip.point).toEqual([-.1,0]);expect(inkTips([line],[authored,{}])[0].point).toEqual(tip.point);
 expect(geometryJoinBrush({mode:'CUSP'})).toEqual({kind:'SHARP'});expect(geometryJoinBrush({mode:'SMOOTH'})).toEqual({kind:'SMOOTH'});expect(geometryJoinBrush({mode:'ARC',radius:.05257222158088604})).toEqual({kind:'ARC',trimDistance:.05257222158088604});
});
