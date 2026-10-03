import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {emptyDrawing,shapeOf,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {addLayer,createCurve,duplicateCurves,transform,moveNode} from '../domain/drawing/commands';
import {addMirrorCurvePair,setMirrorEditingEnabled} from '../domain/drawing/mirrorCommands';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {pairSelectedMirrorCurves} from '../ui/drawing/mirrorSelection';
import MirrorEditingControls from '../ui/drawing/MirrorEditingControls';
function fixture(){let d=addLayer(emptyDrawing(),'Brows');d={...d,mirrorAxisX:.25};d=createCurve(d,d.layers[0].id,[[-1,0],[-.8,.2],[-.4,.2],[-.2,0]],.01,'Left','left');d=createCurve(d,d.layers[0].id,[[1.5,0],[1.3,.2],[.9,.2],[.7,0]],.01,'Right','right');return setMirrorEditingEnabled(addMirrorCurvePair(d,'left','right'),true);}
const reflect=(d:DrawingDocument,p:Point2):Point2=>[2*(d.mirrorAxisX??0)-p[0],p[1]];
test('in-place copy, explicit axis placement and explicit reassignment preserve original geometry and activate only the chosen follower',()=>{
 const d=fixture(),originalPairs=structuredClone(d.mirrorEditing),copied=duplicateCurves(d,['left'],undefined,[0,0]);expect(copied.document.mirrorEditing).toEqual(originalPairs);expect(shapeOf(copied.document,copied.ids[0])).toEqual(shapeOf(d,'left'));
 const placed=finalizeGeometryEdit(copied.document,transform(copied.document,copied.ids,p=>reflect(d,p)));expect(shapeOf(placed,copied.ids[0])).toEqual(shapeOf(d,'left').map(p=>reflect(d,p)));expect(shapeOf(placed,'left')).toEqual(shapeOf(d,'left'));expect(shapeOf(placed,'right')).toEqual(shapeOf(d,'right'));
 const paired=pairSelectedMirrorCurves(placed,['left',copied.ids[0]]);expect(paired.mirrorEditing?.curvePairs).toHaveLength(1);expect(paired.mirrorEditing?.curvePairs[0]).toMatchObject({a:'left',b:copied.ids[0]});expect(paired.nodes).toEqual(placed.nodes);expect(paired.curves).toEqual(placed.curves);
 const nodeId=paired.curves.find(c=>c.id==='left')!.nodes[0],position:Point2=[-1.1,.1],moved=finalizeGeometryEdit(paired,moveNode(paired,nodeId,position),{nodes:[{nodeId,position}]});expect(shapeOf(moved,copied.ids[0])[0]).toEqual(reflect(d,position));expect(shapeOf(moved,'right')).toEqual(shapeOf(d,'right'));
});
test('re-enabling preserves authored asymmetry; controls describe edit behavior and explicit replacement',()=>{
 const d=fixture(),off=setMirrorEditingEnabled(d,false),nodeId=d.curves[0].nodes[0],asymmetric=moveNode(off,nodeId,[-1.1,.3]),enabled=setMirrorEditingEnabled(asymmetric,true);expect(enabled.nodes).toEqual(asymmetric.nodes);expect(enabled.curves).toEqual(asymmetric.curves);
 const copy=duplicateCurves(enabled,['left'],undefined,[0,0]),html=renderToStaticMarkup(createElement(MirrorEditingControls,{d:copy.document,ids:['left',copy.ids[0]],run(){}}));expect(html).toContain('替换所选镜像对应');expect(html).toContain('不会改变曲线位置');expect(html).not.toContain('几何约束');expect(html).not.toContain('中心约束固定');
});
