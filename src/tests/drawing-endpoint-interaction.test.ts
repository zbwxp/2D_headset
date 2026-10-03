import {test,expect} from 'vitest';
import {createCurve,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,nodeAt,type Endpoint} from '../domain/drawing/model';
import {drawingEndpointCurveIds,pickDrawingEndpoint,drawingEndpointSelection,applyDrawingEndpointTool} from '../ui/drawing/endpointInteraction';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {setEndpointLinkBrush} from '../domain/drawing/endpointRelationAuthoring';
import {displayRouteInkSupport} from '../domain/drawing/displayRouteInk';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import EndpointRelationControls from '../ui/drawing/EndpointRelationControls';
const a:Endpoint={curveId:'a',end:1},b:Endpoint={curveId:'b',end:0};
function fixture(){let drawing=emptyDrawing();drawing.layers=[{id:'left',name:'Left',visible:true,locked:false,items:[]},{id:'right',name:'Right',visible:true,locked:false,items:[]}];drawing=createCurve(drawing,'left',[[-1,0],[-.7,0],[-.3,0],[0,0]],.01,'A','a');return createCurve(drawing,'right',[[.1,.1],[.4,.2],[.7,.1],[1,.1]],.02,'B','b');}
test('Drawing endpoint scope and eleven-pixel picking share visibility, lock and layer semantics',()=>{
 const drawing=fixture();expect(drawingEndpointCurveIds(drawing,'left')).toEqual(['a']);expect(drawingEndpointCurveIds(drawing,'right')).toEqual(['b']);expect(drawingEndpointCurveIds(drawing)).toEqual(['a','b']);
 expect(pickDrawingEndpoint(drawing,['a'],[.1,0],100)).toEqual(a);expect(pickDrawingEndpoint(drawing,['a'],[.12,0],100)).toBeNull();expect(pickDrawingEndpoint(drawing,['a'],[0,0],100,a)).toBeNull();
 drawing.curves[0].locked=true;expect(drawingEndpointCurveIds(drawing,'left')).toEqual([]);expect(pickDrawingEndpoint(drawing,['a'],[0,0],100)).toBeNull();drawing.curves[1].visible=false;expect(drawingEndpointCurveIds(drawing)).toEqual([]);
});
test('a link dispatch preserves Drawing’s two-click direction and separate identities across layers',()=>{
 const drawing=fixture(),next=applyDrawingEndpointTool(drawing,'link',a,b);expect(nodeAt(next,a).position).toEqual(nodeAt(drawing,a).position);expect(nodeAt(next,b).position).toEqual(nodeAt(drawing,a).position);expect(next.curves.map(curve=>curve.nodes)).toEqual(drawing.curves.map(curve=>curve.nodes));expect(next.curves.map(curve=>curve.width)).toEqual(drawing.curves.map(curve=>curve.width));expect(drawingEndpointSelection(next,b)).toEqual({ids:['b'],node:nodeAt(next,b).id});expect(applyDrawingEndpointTool(next,'link',b,a)).toBe(next);
});
test('bind retains the real Drawing merge semantics and never substitutes a cross-layer link',()=>{
 const drawing=fixture();expect(()=>applyDrawingEndpointTool(drawing,'bind',a,b)).toThrow(/同一图层/);const local={...drawing,layers:[{...drawing.layers[0],items:['a','b']}]},linked=linkEndpoints(local,a,b,true),bound=applyDrawingEndpointTool(linked,'bind',a,b);expect(nodeAt(bound,a).id).toBe(nodeAt(bound,b).id);expect(bound.endpointLinks).toEqual([]);expect(bound.curves[1].width).toBe(bound.curves[0].width);
});
test('the shared brush command authors real SMOOTH handles, ARC trim and POSITION without source-node merging',()=>{
 let drawing=fixture();drawing.curves[1].width=drawing.curves[0].width;drawing=linkEndpoints(drawing,a,b,true);drawing=addDisplayInterval(drawing,'a');drawing=adoptDisplayRoute(drawing,drawing.displayIntervals![0].id,drawing.endpointLinks![0].id).document;
 const before=structuredClone(drawing),link=drawing.endpointLinks![0],smooth=setEndpointLinkBrush(drawing,link.id,{kind:'SMOOTH'}),first=smooth.curves.find(curve=>curve.id==='a')!,second=smooth.curves.find(curve=>curve.id==='b')!;
 expect(first.handles[1]).toEqual(before.curves[0].handles[1]);expect(second.handles[0][1]).toBeCloseTo(nodeAt(smooth,b).position[1],10);expect(second.handles[0][0]).toBeGreaterThan(nodeAt(smooth,b).position[0]);expect(smooth.curves.map(curve=>curve.nodes)).toEqual(before.curves.map(curve=>curve.nodes));expect(smooth.layers).toEqual(before.layers);expect(drawing).toEqual(before);
 const arc=setEndpointLinkBrush(smooth,link.id,{kind:'ARC',trimDistance:.04});expect(arc.endpointLinks![0].joinBrush).toEqual({kind:'ARC',trimDistance:.04});expect(displayRouteInkSupport(arc,arc.displayIntervals![0].displayRoute!)).toEqual([]);const position=setEndpointLinkBrush(arc,link.id,undefined);expect(position.endpointLinks![0].joinBrush).toBeUndefined();expect(position.nodes).toEqual(arc.nodes);expect(position.curves).toEqual(arc.curves);
});
test('unsupported and locked brush edits fail without changing the document',()=>{
 const drawing=linkEndpoints(fixture(),a,b,true),saved=structuredClone(drawing),id=drawing.endpointLinks![0].id;expect(()=>setEndpointLinkBrush(drawing,id,{kind:'SMOOTH'})).toThrow(/显示贯通/);expect(()=>setEndpointLinkBrush(drawing,id,{kind:'ARC',trimDistance:.04})).toThrow(/显示贯通/);expect(drawing).toEqual(saved);drawing.curves[1].locked=true;expect(()=>setEndpointLinkBrush(drawing,id,{kind:'SHARP'})).toThrow(/锁定/);
});
test('the shared relation card exposes interval creation, Drawing route adoption, and active brush controls',()=>{
 let drawing=fixture();drawing.curves[1].width=drawing.curves[0].width;drawing=linkEndpoints(drawing,a,b,true);const markup=(document:typeof drawing)=>renderToStaticMarkup(createElement(EndpointRelationControls,{drawing:document,link:document.endpointLinks![0],editable:true,run:()=>{}}));
 expect(markup(drawing)).toContain('endpoint-create-display-interval');drawing=addDisplayInterval(drawing,'a');expect(markup(drawing)).toContain('adopt-display-route');drawing=adoptDisplayRoute(drawing,drawing.displayIntervals![0].id,drawing.endpointLinks![0].id).document;const active=markup(drawing);expect(active).toContain('detach-display-route');for(const mode of ['POSITION','SMOOTH','ARC'])expect(active).toContain(`value="${mode}"`);
});
