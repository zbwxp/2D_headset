import {forEachPaintCase,styledPaintDrawing,domainPaintDrawing,publicPaintDrawing,withoutFillMist,type PaintOptions} from './paint-read-scope';
import {withIntervalPinch} from '../../domain/drawing/intervalPinch';
import {scaleEvaluatedDisplayRouteBrush} from '../../domain/drawing/displayRouteBrush';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';

export function forEachPaintProductCase(visit:(name:string,d:DrawingDocument,options?:PaintOptions)=>void){
 forEachPaintCase(visit);
 for(const scope of ['line','layer'] as const)for(const kind of ['affine','quad','coons'] as const)for(const scale of [125,500,750]){
  const d=domainPaintDrawing(kind,scope);visit(`camera-${scope}-${kind}-${scale}`,d,{showFills:true,unit:scale,pixelsPerUnit:scale*1.03,screen:p=>[83.27+p[0]*scale,251.63-p[1]*scale],selectedPaints:['fa','cut','offset'],opacity:new Map([['a0',.4],['fa',.6]])});
 }
 const d=styledPaintDrawing();
 const changes=[['original',()=>{}],['handle',()=>{d.curves[6].handles[0][0]+=.018;}],['width',()=>{d.curves[6].width=.022;}],['profile',()=>{d.curves[6].profile='TAPER_END';}],['taper',()=>{d.curves[6].inkEnds![1].taper=.11;}],['extension',()=>{d.curves[6].inkEnds![0].extension=.065;}],['mist',()=>{d.curves[6].mist!.density=.35;}],['depth',()=>{d.curves[6].depthScope='LAYER';d.curves[6].depthOffset=1;}],['join-radius',()=>{d.joins[0].radius=.14;}],['visibility',()=>{d.curves[0].visible=false;}],['ink-visibility',()=>{d.curves[2].inkVisible=false;}],['range',()=>{d.displayIntervals![0].ranges[0].end=.71;}],['pinch',()=>{withIntervalPinch(d.displayIntervals![0].ranges[0],.6);}]] as const;
 for(const [name,change] of changes){change();visit(`in-place-${name}`,d,{showFills:true,selectedPaints:['fa','offset']});}
 const brush=styledPaintDrawing();brush.endpointLinks![0].joinBrush=scaleEvaluatedDisplayRouteBrush({kind:'ARC',trimDistance:.04},60);visit('evaluated-large-brush',brush,{showFills:true});brush.endpointLinks![0].joinBrush={...brush.endpointLinks![0].joinBrush};visit('raw-large-brush-same-json',brush,{showFills:true});
 const route=styledPaintDrawing();route.curves[6].profile='UNIFORM';route.endpointLinks!.unshift({id:'earlier-link',a:{curveId:'c',end:1},b:{curveId:'a0',end:0},throughDisplay:true,joinBrush:{kind:'SHARP'}});route.displayIntervals!.unshift({id:'earlier-route',anchor:{id:'c',reverse:false},ranges:[{id:'earlier-range',start:0,end:1}],displayRoute:{seed:{segments:[{id:'c',reverse:false}],closed:false},throughLinkIds:['earlier-link','ab']}});visit('earlier-route-invalid',route);route.nodes.find(n=>n.id==='nc1')!.position=[0,0];visit('earlier-route-valid',route);
 for(const preview of [false,true])for(const tool of ['select','deform','split'] as const)visit(`ui-${preview}-${tool}`,styledPaintDrawing(),{showFills:true,preview,tool,selectedPaints:['fa','cut','offset'],fillVisibility:{a:!preview}});
 for(const scale of [125,500,750])visit(`public-camera-${scale}`,withoutFillMist(publicPaintDrawing()),{showFills:true,unit:scale,pixelsPerUnit:scale,screen:p=>[120+p[0]*scale,201-p[1]*scale] as Point2});
}
