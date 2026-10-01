import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyDrawing,parseDrawing,type DrawingDocument as Doc,type Cubic} from '../domain/drawing/model';
import {createCurve,addLayer,connect} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {localDisplayPath,displayPath,displayField} from '../domain/drawing/displayIntervals';
import {displayRouteInk,displayRouteInkSupport} from '../domain/drawing/displayRouteInk';
import {depthPaintBatches} from '../domain/drawing/depth';
import {fillGeometry} from '../domain/drawing/appearance';
import {createWarpGrid,moveWarpNode,deformDrawing} from '../domain/vectorWarp';
import PaintScene from '../ui/drawing/PaintScene';
function fixture():Doc{
 let d=emptyDrawing();
 for(const [prefix,side] of [['a',-1],['b',1]] as const){d=addLayer(d,prefix);const layer=d.layers[0].id,shapes:Cubic[]=[[[side,1],[side*.8,.5],[side*.4,.12],[0,0]],[[0,0],[-side*.15,.2],[-side*.25,.8],[-side*.2,1]],[[-side*.2,1],[0,1.2],[side*.5,1.2],[side,1]]];for(let i=0;i<3;i++)d=createCurve(d,layer,shapes[i],.008,`${prefix}${i}`,`${prefix}${i}`);for(let i=0;i<3;i++)d=connect(d,{curveId:`${prefix}${i}`,end:1},{curveId:`${prefix}${(i+1)%3}`,end:0},'POSITION');d=createFill(d,[`${prefix}0`,`${prefix}1`,`${prefix}2`],'white');}
 const seed=localDisplayPath(d,'a0'),route={seed,throughLinkIds:['chin']};
 return {...d,endpointLinks:[{id:'chin',a:{curveId:'a0',end:1},b:{curveId:'b0',end:1},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.05}}],displayIntervals:[{id:'route-track',anchor:{...seed.segments[0]},displayRoute:route,ranges:[{id:'all',start:0,end:1,mode:'SHOW'}]}]};
}
test('route field crosses layers while local paths, fill shapes and serialized source stay unchanged by rendering',()=>{
 const d=fixture(),before=JSON.stringify(d),route=d.displayIntervals![0].displayRoute!,fills=d.fills.map(f=>fillGeometry(d,f)),field=displayField(d,displayPath(d,'a0'));
 expect(localDisplayPath(d,'a0').closed).toBe(true);expect(displayPath(d,'a0').closed).toBe(false);expect(field.geometry.pieces.some(p=>p.joinId?.startsWith('display-join:'))).toBe(true);
 const plan=displayRouteInk(d,route,new Map());expect(plan.diagnostics).toEqual([]);expect(plan.runs.size).toBe(6);expect(plan.pieces.some(p=>p.joinId&&p.inkOwner==='a0')).toBe(true);expect(plan.pieces.some(p=>p.joinId&&p.inkOwner==='b0')).toBe(true);
 expect(d.fills.map(f=>fillGeometry(d,f))).toEqual(fills);expect(JSON.stringify(d)).toBe(before);expect(parseDrawing(JSON.parse(before))).toEqual(d);
});
test('route owners occupy original layer/depth slots, with white fills and offsets still rendered normally',()=>{
 const d=fixture();d.curves=d.curves.map(c=>c.id==='a0'?{...c,depthOffset:1,depthScope:'LAYER'}:c);const before=JSON.stringify(d),batches=depthPaintBatches(d),owners=batches.filter(b=>b.owner);
 expect(owners).toHaveLength(6);for(const b of owners)expect(d.layers.find(l=>l.id===b.layerId)!.items).toContain(b.owner);
 const noop=()=>{},svg=renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d,screen:p=>p,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));
 expect(svg.match(/data-testid="drawing-route-ink"/g)).toHaveLength(6);expect(svg.match(/data-testid="drawing-fill"/g)).toHaveLength(2);expect(svg).toContain('fill="white"');expect(JSON.stringify(d)).toBe(before);
});
test('unsupported local width/profile is diagnostic rather than silently copying the first style',()=>{
 const d=fixture(),route=d.displayIntervals![0].displayRoute!;d.curves=d.curves.map(c=>c.id==='b0'?{...c,width:.02}:c);expect(displayRouteInkSupport(d,route).some(x=>x.includes('线宽'))).toBe(true);expect(d.curves.find(c=>c.id==='b0')!.width).toBe(.02);
});
test('a hidden owner does not paint its half of the cross-layer ARC or move the structural route field',()=>{
 const d=fixture(),route=d.displayIntervals![0].displayRoute!,prior=displayField(d,displayPath(d,'a0')),hidden={...d,curves:d.curves.map(c=>c.id==='b0'?{...c,inkVisible:false}:c)},field=displayField(hidden,displayPath(hidden,'a0')),plan=displayRouteInk(hidden,route,new Map());
 expect(field.total).toBe(prior.total);expect(field.geometry).toEqual(prior.geometry);expect(plan.runs.has('b0')).toBe(false);
});
test('Warp transports route range coordinates once, retains route IDs and does not edit source/fills',()=>{
 const d=fixture(),track=d.displayIntervals![0],path=displayPath(d,'a0'),field=displayField(d,path);track.ranges=[{id:'middle',start:.2,end:.65,mode:'SHOW',inkEnds:[{taper:.03},{taper:.03}]}];const before=JSON.stringify(d);
 let grid=createWarpGrid({min:[-1.5,-.5],max:[1.5,1.5]},2,2);grid=moveWarpNode(grid,4,[.2,.65]);
 const result=deformDrawing(d,grid,{diagnostics:'preview'});expect(result.intervalTransportErrors).toEqual([]);expect(result.drawing.curves.map(c=>c.id)).toEqual(d.curves.map(c=>c.id));expect(result.drawing.displayIntervals![0].displayRoute).toEqual(track.displayRoute);expect(result.drawing.fills).toEqual(d.fills);expect(result.drawing.displayIntervals![0].ranges[0].id).toBe('middle');expect(displayField(result.drawing,displayPath(result.drawing,'a0')).total).not.toBe(field.total);expect(JSON.stringify(d)).toBe(before);
});
