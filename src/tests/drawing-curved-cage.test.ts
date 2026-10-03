import {createElement,isValidElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {neutralBend,bendEdges} from '../domain/deformation/coons';
import {quadProjection,type Quad,type DeformRect} from '../domain/drawing/deform';
import {point} from '../domain/drawing/sampling';
import type {Point2} from '../domain/drawing/model';
import DeformCageOverlay,{moveDeformBoundary} from '../ui/drawing/DeformCageOverlay';
const rect:DeformRect={min:[-1,-1],max:[1,1]},quad:Quad=[[-1,-1],[1,-.8],[.7,1],[-.9,.9]],source=([u,v]:Point2):Point2=>[-1+2*u,-1+2*v];
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
function elements(tree:unknown):ReactElement<any>[]{if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<{children?:unknown}>(tree))return [];return [tree,...elements(tree.props.children)];}

test('shared Drawing cage exposes four corners, eight boundary handles and four midpoint drags',()=>{
 const bend=neutralBend(),onCorner=vi.fn(),onBoundary=vi.fn(),props={rect,quad,bend,screen:(p:Point2)=>p,onCorner,onBoundary},html=renderToStaticMarkup(createElement(DeformCageOverlay,props));
 expect(html.match(/data-testid="drawing-deform-corner"/g)).toHaveLength(4);expect(html.match(/data-testid="drawing-deform-bend-handle"/g)).toHaveLength(8);expect(html.match(/data-testid="drawing-deform-bend-midpoint"/g)).toHaveLength(4);
 const all=elements(DeformCageOverlay(props)),event={button:0};all.find(e=>e.props['data-testid']==='drawing-deform-bend-handle'&&e.props['data-edge']===2&&e.props['data-handle']===1)!.props.onPointerDown(event);expect(onBoundary).toHaveBeenCalledWith(event,2,1);
 all.find(e=>e.props['data-testid']==='drawing-deform-corner'&&e.props['data-corner']===3)!.props.onPointerDown(event);expect(onCorner).toHaveBeenCalledWith(event,3);
});

test('boundary handle follows the pointer through true homography without touching other handles or baseline',()=>{
 const base=neutralBend(),before=JSON.stringify(base),h=quadProjection(rect,quad),from=h.map(source(base.handles[2][0])),to:Point2=[from[0]+.06,from[1]+.09],next=moveDeformBoundary(rect,quad,base,2,0,from,to);
 near(h.map(source(next.handles[2][0])),to);expect(next.handles[2][1]).toEqual(base.handles[2][1]);expect(next.handles.slice(0,2)).toEqual(base.handles.slice(0,2));expect(JSON.stringify(base)).toBe(before);
 expect(moveDeformBoundary(rect,quad,base,2,0,from,to)).toEqual(next);
});

test('edge midpoint moves both handles by the exact cubic midpoint factor',()=>{
 const base=neutralBend(),h=quadProjection(rect,quad),from=h.map(source(point(bendEdges(base)[1],.5))),to:Point2=[from[0]+.08,from[1]-.02],next=moveDeformBoundary(rect,quad,base,1,2,from,to);
 near(h.map(source(point(bendEdges(next)[1],.5))),to);expect(next.handles[0]).toEqual(base.handles[0]);expect(next.handles[2]).toEqual(base.handles[2]);
});
