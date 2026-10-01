import {createElement,useMemo} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useEditor} from '../../app/store';
import {useWorkspaceView} from '../../app/workspaceView';
import {shapeOf,type DrawingDocument as Doc,type Point2,type Cubic} from '../../domain/drawing/model';
import type {DrawingSnapshots} from '../../domain/drawing/snapshots';
import type {ArtworkReferenceView} from '../../app/workspaceView';
import PaintScene from '../drawing/PaintScene';
const noop=()=>{},cache=new WeakMap<object,{url:string;min:Point2;max:Point2}>();
export function cachedArtworkReference(d:Doc){
 const existing=cache.get(d);if(existing)return existing;
 const points=d.curves.flatMap(c=>shapeOf(d,c.id)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),pad=.08,min:Point2=[xs.length?Math.min(...xs)-pad:-1,ys.length?Math.min(...ys)-pad:-1],max:Point2=[xs.length?Math.max(...xs)+pad:1,ys.length?Math.max(...ys)+pad:1],unit=250,width=(max[0]-min[0])*unit,height=(max[1]-min[1])*unit;
 const screen=(p:Point2):Point2=>[(p[0]-min[0])*unit,(max[1]-p[1])*unit];
 const svg=renderToStaticMarkup(createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width,height,viewBox:`0 0 ${width} ${height}`},createElement(PaintScene,{d,screen,unit,pixelsPerUnit:unit,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));
 const value={url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),min,max};cache.set(d,value);return value;
}
export function referenceSnapCurves(library:DrawingSnapshots|undefined,ref:ArtworkReferenceView|undefined):Cubic[]{
 if(!ref?.visible||!ref.snap)return [];const d=library?.items.find(a=>a.id===ref.artworkId)?.drawing;if(!d)return [];
 return d.curves.filter(c=>c.visible&&c.inkVisible!==false).map(c=>shapeOf(d,c.id).map(([x,y])=>[x*ref.scale+ref.offset[0],y*ref.scale+ref.offset[1]]) as Cubic);
}
/** An isolated SVG image, never source objects or an interactive drawing. */
export default function ArtworkReference({screen,unit}:{screen:(p:Point2)=>Point2;unit:number}){
 const ref=useWorkspaceView(s=>s.reference),library=useEditor(s=>s.project.drawingSnapshots),drawing=library?.items.find(a=>a.id===ref?.artworkId)?.drawing;
 const result=useMemo(()=>{try{return drawing?{image:cachedArtworkReference(drawing)}:{};}catch(e){return {error:(e as Error).message};}},[drawing]);
 if(!ref?.visible||!result.image)return result.error?<g pointerEvents="none"><text x={28} y={48} fill="#c75a44">参考画稿渲染失败：{result.error}</text></g>:null;
 const {image}=result,p=screen([image.min[0]*ref.scale+ref.offset[0],image.max[1]*ref.scale+ref.offset[1]]);
 return <image data-testid="artwork-view-reference" href={image.url} x={p[0]} y={p[1]} width={(image.max[0]-image.min[0])*ref.scale*unit} height={(image.max[1]-image.min[1])*ref.scale*unit} opacity={ref.opacity} pointerEvents="none" preserveAspectRatio="none"/>;
}
