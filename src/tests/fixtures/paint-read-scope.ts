import {createElement,type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PaintScene from '../../ui/drawing/PaintScene';
import {parseDrawing,type DrawingDocument,type Point2,type InkEnds} from '../../domain/drawing/model';
import fullFace from '../../assets/hairless-symmetric-two-face-mirror.json';
import {makeFixture,RECORDING_ID,screen,shiftedBasis} from '../../../tests/fixtures/recording-renderer-benchmark-fixture';
import {prepareRecordingContext} from '../../domain/recordingSnapshot/evaluation';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../../domain/drawing/affineDrawing';
import {applyLayerCageDomain} from '../../domain/recordingSnapshot/layerCageEvaluation';
import type {SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';
import {neutralBend} from '../../domain/deformation/coons';
import type {Affine2D} from '../../domain/geometry/affine2d';

const noop=()=>{};
export type PaintOptions=Partial<Omit<ComponentProps<typeof PaintScene>,'d'>>;
export function paintMarkup(d:DrawingDocument,options:PaintOptions={}){
 return renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d,screen,unit:250,pixelsPerUnit:250,preview:false,showFills:false,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop,...options})));
}
export function publicPaintDrawing(){return parseDrawing(fullFace);}
/** Node SSR has no Canvas/Path2D. Fills-on parity covers solid geometry only. */
export function withoutFillMist(d:DrawingDocument):DrawingDocument {return {...d,fills:d.fills.map(f=>f.mist?.enabled?{...f,mist:{...f.mist,enabled:false}}:f)};}
export function addNuisanceCurves(d:DrawingDocument,count=80){
 const layer={id:'nuisance-layer',name:'Nuisance',visible:true,locked:false,items:[] as string[]};
 for(let i=0;i<count;i++){
  const id=`nuisance:${i}`,x=2+i*.015;
  d.nodes.push({id:`${id}:0`,position:[x,0]},{id:`${id}:1`,position:[x,.1]});
  d.curves.push({id,name:id,nodes:[`${id}:0`,`${id}:1`],handles:[[x,.03],[x,.07]],visible:true,locked:false,width:.004});layer.items.push(id);
 }
 d.layers.push(layer);return d;
}
/** Deterministic two local loops, cross-layer ARC route, local ARC, cutout,
 * offset, mist ink, taper/extensions, depth and one explicitly hidden member. */
export function styledPaintDrawing():DrawingDocument {
 const nodes:[string,Point2][]=[['a0',[0,0]],['a1',[-1,0]],['a2',[-1,1]],['b0',[0,0]],['b1',[1,0]],['b2',[1,1]],['c0',[1.3,-.5]],['c1',[1.8,.3]],['h0',[2,0]],['h1',[2,1]]];
 const curve=(id:string,a:string,b:string)=>{
  const p=nodes.find(n=>n[0]===a)![1],q=nodes.find(n=>n[0]===b)![1];
  return {id,name:id,nodes:[`n${a}`,`n${b}`] as [string,string],handles:[[p[0]+(q[0]-p[0])/3,p[1]+(q[1]-p[1])/3],[p[0]+2*(q[0]-p[0])/3,p[1]+2*(q[1]-p[1])/3]] as [Point2,Point2],visible:true,locked:false,width:.012};
 };
 const seed={segments:['a0','a1','a2'].map(id=>({id,reverse:false})),closed:true};
 const opaque={domain:{kind:'future-domain',controls:['a0','na0'],payload:{knots:[.13,.83]}},author:'metadata'};
 return Object.assign({version:3 as const,nodes:nodes.map(([id,position])=>({id:`n${id}`,position,metadata:opaque})),
  curves:[curve('a0','a0','a1'),curve('a1','a1','a2'),curve('a2','a2','a0'),curve('b0','b0','b1'),curve('b1','b1','b2'),curve('b2','b2','b0'),{...curve('c','c0','c1'),profile:'TAPER_BOTH' as const,inkEnds:[{extension:.03},{taper:.05}] as InkEnds,mist:{enabled:true,width:.04,density:.8}},{...curve('hidden','h0','h1'),visible:false}].map(c=>({...c,metadata:opaque})),
  layers:[{id:'a',name:'A',visible:true,locked:false,items:['a0','fa','cut','a1','a2']},{id:'b',name:'B',visible:true,locked:false,items:['b0','b1','b2']},{id:'c',name:'C',visible:true,locked:false,items:['c','offset','hidden']}],
  joins:[{id:'arc',a:{curveId:'a1',end:1 as const},b:{curveId:'a2',end:0 as const},mode:'ARC' as const,radius:.05}],
  endpointLinks:[{id:'ab',a:{curveId:'a2',end:1 as const},b:{curveId:'b0',end:0 as const},throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.04}}],
  fills:[{id:'fa',name:'Fill',visible:true,locked:false,color:'white' as const,boundary:seed.segments},{id:'cut',name:'Cutout',visible:true,locked:false,color:'transparent' as const,boundary:seed.segments}],
  offsets:[{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'c',reverse:false}],distance:.035,start:.1,end:.9,taper:.1,width:.01}],
  displayIntervals:[{id:'track',anchor:{id:'a0',reverse:false},ranges:[{id:'range',start:.13,end:.86,mode:'SHOW' as const,inkEnds:[{taper:.02},{extension:.015}] as InkEnds}],displayRoute:{seed,throughLinkIds:['ab']}}],
 },{metadata:opaque}) as DrawingDocument;
}
export function domainPaintDrawing(kind:'affine'|'quad'|'coons',scope:'line'|'layer'){
 const d=styledPaintDrawing();
 if(kind==='affine'){
  const owners=drawingLayerObjectOwners(d),matrix:Affine2D=[1.1,.12,.2,.85,.04,-.02];
  return scope==='layer'?placeDrawingAffines(d,{a:matrix,b:matrix},id=>owners.get(id)):placeDrawingAffines(d,{line:matrix},id=>['c','nc0','nc1','offset'].includes(id)?'line':undefined);
 }
 const bend=neutralBend();bend.handles[1][0][0]=1.15;bend.handles[1][1][0]=1.08;
 const domain:SnapshotLayerCageDomain={kind:'h-coons',id:`${scope}:${kind}`,layerIds:scope==='line'?['c']:['a','b'],...(scope==='line'?{strokeScope:{kind:'continuous-strokes',curveIds:['c']}}:{}),restRect:{min:[-2,-1],max:[2,2]},quad:[[-2,-1],[2,-.85],[1.8,2],[-1.8,1.9]],...(kind==='coons'?{bend}:{})};
 return applyLayerCageDomain(d,domain);
}
export function forEachPaintCase(visit:(name:string,d:DrawingDocument,options:PaintOptions)=>void){
 const source=publicPaintDrawing();visit('drawing-fills-off',source,{});visit('drawing-solid-fills',withoutFillMist(source),{showFills:true});
 const {workspace}=makeFixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,useDraft:true,diagnostics:'preview'});
 for(const index of [1,7,19]){
  const angle={x:11.137+(index*17.713)%63,y:14.713+(index*.317)%9};
  for(const basis of [false,true]){
   const frame=(basis?context.fork(shiftedBasis(workspace,index)):context).sample(RECORDING_ID,{angle});
   for(const showFills of [false,true])visit(`recording-${basis?'basis':'angle'}-${index}-${showFills?'solid-fills':'ink'}`,showFills?withoutFillMist(frame.drawing):frame.drawing,{paintBatches:frame.paintBatches,showFills});
  }
 }
 visit('public-plus-80-visible-curves',addNuisanceCurves(publicPaintDrawing()),{});
 for(const scope of ['line','layer'] as const)for(const kind of ['affine','quad','coons'] as const)visit(`${scope}-${kind}`,domainPaintDrawing(kind,scope),{showFills:true,selectedPaints:['fa','cut','offset'],opacity:new Map([['a0',.5],['fa',.7]])});
 const mutable=styledPaintDrawing();visit('mutable-initial',mutable,{showFills:true});
 mutable.nodes[1].position[0]-=.12;visit('mutable-coordinate',mutable,{showFills:true});
 mutable.curves[0].visible=false;visit('mutable-visibility',mutable,{showFills:true});
 mutable.curves[1].nodes[0]='nb1';visit('mutable-topology',mutable,{showFills:true});
 mutable.curves[1].nodes[0]='na1';mutable.layers.reverse();mutable.layers[2].items.reverse();visit('mutable-order',mutable,{showFills:true});
 mutable.endpointLinks![0].throughDisplay=false;visit('mutable-link',mutable,{showFills:true});
 mutable.endpointLinks![0].throughDisplay=true;mutable.curves[0].visible=true;mutable.displayIntervals![0].ranges[0].end=.58;visit('mutable-range',mutable,{showFills:true});
 visit('styled-preview',styledPaintDrawing(),{preview:true,showFills:true});visit('styled-moving',styledPaintDrawing(),{referenceMoving:true,showFills:true});
}
