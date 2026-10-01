import {useId,type ReactNode} from 'react';
import {objectById,visible,curveById,type DrawingDocument as Doc,type Point2,type InkEnds} from '../../domain/drawing/model';
import {strokeWidth,strokePaths} from '../../domain/drawing/strokes';
import {strokeInk,fillGeometry,fillVisible,offsetGeometry,inkRuns,pathOf,strokeEnds,extendedInk,displayInkSampling} from '../../domain/drawing/appearance';
import {derivedUses,partitionedUses} from '../../domain/drawing/roundedJoin';
import {curvePath} from './geometry';
import {strokeInkPasses} from '../../domain/drawing/mist';
import MistInk from './MistInk';
import MistFill from './MistFill';
import {depthPaintBatches,memberInk} from '../../domain/drawing/depth';
import type {DrawingTool} from './session';
interface Props {pixelsPerUnit?:number;interactiveEffects?:boolean;opacity?:ReadonlyMap<string,number>;d:Doc;screen:(p:Point2)=>Point2;unit:number;preview:boolean;showFills:boolean;fillVisibility?:Readonly<Record<string,boolean>>;referenceMoving:boolean;tool:DrawingTool;selectedPaint?:string;selectedPaints?:string[];curveDown:(e:React.PointerEvent,id:string)=>void;paintDown:(e:React.PointerEvent,id:string)=>void;arcDown:(e:React.PointerEvent,id:string)=>void}
export default function PaintScene({pixelsPerUnit,interactiveEffects=false,opacity,d,screen:project,unit,preview,showFills,fillVisibility,referenceMoving,tool,selectedPaint,selectedPaints,curveDown,paintDown,arcDown}:Props){
 const clipPrefix=useId(),sampling=displayInkSampling(pixelsPerUnit??unit);
 // Only SVG display coordinates are rounded; authoring/interpolation remains exact.
 const screen=(p:Point2):Point2=>{const q=project(p);return [Math.round(q[0]*1000)/1000,Math.round(q[1]*1000)/1000];};
 const pick=!preview&&!referenceMoving,select=pick&&['select','direct'].includes(tool);
 const inkDocument=d.curves.some(c=>!visible(d,c.id))?{...d,curves:d.curves.map(c=>visible(d,c.id)?c:{...c,inkVisible:false})}:d;
 const batches=depthPaintBatches(d),positions=new Map(batches.filter(b=>b.owner).map(b=>[b.owner!,b.position]));
 const partitionCache=new Map<string,ReturnType<typeof memberInk>>();
 const groups:{layerId:string;batches:typeof batches}[]=[];
 for(const b of batches.slice().reverse()){if(groups.at(-1)?.layerId===b.layerId)groups.at(-1)!.batches.push(b);else groups.push({layerId:b.layerId,batches:[b]});}
 return <>{groups.map((batchGroup,layerIndex)=>{const l=d.layers.find(l=>l.id===batchGroup.layerId)!;
  const fills=d.fills.filter(f=>l.items.includes(f.id)&&fillVisible(d,f)&&(fillVisibility?.[l.id]??showFills)),geometry=new Map(fills.map(f=>[f.id,fillGeometry(d,f)]));
  const cutouts=fills.filter(f=>f.color==='transparent'&&!geometry.get(f.id)!.error);
  // Intersect inverse clips, so overlapping cutouts remove their union instead
  // of filling each other's holes. Native SVG clipping also excludes fill hits
  // inside a hole; an alpha mask alone would leave invisible picking targets.
  const clips=cutouts.map((f,i)=>({id:`${clipPrefix}-cut-${layerIndex}-${i}`,path:pathOf(geometry.get(f.id)!.shapes,screen,true)}));
  const bounds=clips.length?[...geometry.values()].flatMap(g=>g.shapes.flatMap(s=>s.map(screen))).reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]):[];
  // Cubic control hulls bound all fills, including translated/offscreen artwork.
  const padding=4+Math.max(0,...fills.map(f=>f.mist?.enabled&&f.mist.side!=='INSIDE'?f.mist.width*unit:0));
  const outer=clips.length?`M ${bounds[0]-padding} ${bounds[1]-padding} H ${bounds[2]+padding} V ${bounds[3]+padding} H ${bounds[0]-padding} Z`:'';
  return <g key={`${l.id}:${layerIndex}`} data-testid="drawing-paint-layer" data-id={l.id}>
  {clips.length>0&&<defs>{clips.map(c=><clipPath key={c.id} id={c.id} clipPathUnits="userSpaceOnUse"><path d={`${outer} ${c.path}`} clipRule="evenodd"/></clipPath>)}</defs>}
  {batchGroup.batches.map(({item,owner})=>{
  if(item.stroke)return strokePaths(item.stroke).map((path,pathIndex)=>{const s={...path,id:item.id},enabled=s.segments.map(x=>visible(d,x.id));if(!enabled.some(Boolean)||owner&&!s.segments.some(x=>x.id===owner))return null;
   if(owner){
    const key=`${item.id}:${pathIndex}`;let divided=partitionCache.get(key);if(!divided){divided=memberInk(inkDocument,s,positions,sampling);partitionCache.set(key,divided);}
    const runs=divided.get(owner)??[],pieces=partitionedUses(d,s.segments,s.closed).pieces.filter(p=>p.inkOwner===owner&&p.owners.every(id=>visible(d,id))),c=curveById(d,owner);
    return <g key={`${key}:${owner}`} data-testid="drawing-depth-ink" data-id={owner} data-depth={c.depthOffset??0} opacity={opacity?.get(owner)}>
     <MistInk runs={runs} mist={c.mist} screen={screen} unit={unit} width={strokeWidth(d,s)} strokeId={s.id} owner={owner}/>
     {pick&&runs.flatMap(r=>r.extensions??[]).map((ext,i)=><path key={'ext'+i} data-testid="drawing-ink-extension-hit" data-id={owner} d={curvePath(ext.shape,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={['select','direct','deform','mirror'].includes(tool)?'stroke':'none'} onPointerDown={e=>curveDown(e,owner)}/>)}
     {pick&&pieces.map((p,i)=><path key={i} data-testid={p.joinId?'drawing-arc-hit':'drawing-hit'} data-id={p.joinId??owner} d={curvePath(p.shape,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={['select','direct','deform','split','mirror'].includes(tool)?'stroke':'none'} onPointerDown={e=>p.joinId?arcDown(e,p.joinId):curveDown(e,owner)}/>)}
    </g>;
   }
   const runs=strokeInk(inkDocument,s,undefined,false,sampling),pieces=derivedUses(d,s.segments,s.closed).pieces,ends=strokeEnds(d,s),extensions=s.closed?[]:extendedInk(pieces.map(p=>p.shape),ends.map(e=>e.style) as InkEnds).extensions;
   return <g key={`${item.id}:${pathIndex}`} opacity={opacity?.get(s.segments[0].id)}>{strokeInkPasses(inkDocument,s,runs,sampling).map((g,i)=><MistInk key={i} runs={g.runs} mist={g.mist} screen={screen} unit={unit} width={strokeWidth(d,s)} strokeId={s.id} owner={g.owner}/>)}
    {pick&&extensions.map((ext,i)=>{const id=ends[ext.end].endpoint.curveId;return visible(d,id)&&curveById(d,id).inkVisible!==false?<path key={'ext'+i} data-testid="drawing-ink-extension-hit" data-id={id} d={curvePath(ext.shape,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={['select','direct','deform','mirror'].includes(tool)?'stroke':'none'} onPointerDown={e=>curveDown(e,id)}/>:null;})}
    {pick&&runs.flatMap(run=>run.extensions??[]).map((ext,i)=>{const id=pieces[ext.pieceIndex].owners[0];return <path key={'local-ext'+i} data-testid="drawing-ink-extension-hit" data-id={id} d={curvePath(ext.shape,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={['select','direct','deform','mirror'].includes(tool)?'stroke':'none'} onPointerDown={e=>curveDown(e,id)}/>;})}
    {pick&&pieces.filter(p=>p.owners.every(id=>visible(d,id))).map((p,i)=><path key={i} data-testid={p.joinId?'drawing-arc-hit':'drawing-hit'} data-id={p.joinId??p.owners[0]} d={curvePath(p.shape,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={['select','direct','deform','split','mirror'].includes(tool)?'stroke':'none'} onPointerDown={e=>p.joinId?arcDown(e,p.joinId):curveDown(e,p.owners[0])}/>)}</g>;
  });
  const o=objectById(d,item.id);if(!o?.visible)return null;
  if(item.kind==='fill'){
   const f=d.fills.find(f=>f.id===item.id)!,g=geometry.get(f.id);if(!g||g.error)return null;
   const path=pathOf(g.shapes,screen,true),selected=pick&&(selectedPaint===f.id||selectedPaints?.includes(f.id));
   if(f.color==='transparent')return pick?<g key={f.id} data-testid="drawing-cutout" data-id={f.id}>
    {selected&&<path d={path} fill="none" stroke="#2589b0" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none"/>}
    <path d={path} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={select&&!o.locked?'stroke':'none'} onPointerDown={e=>paintDown(e,f.id)}/>
   </g>:null;
   const fill=f.mist?.enabled?<MistFill interactive={interactiveEffects} fill={f} shapes={g.shapes} path={path} screen={screen} unit={unit} pick={select&&!o.locked} selected={!!selected} onPointerDown={e=>paintDown(e,f.id)}/>:<path data-testid="drawing-fill" data-id={f.id} d={path} fill={f.color} fillRule="evenodd" stroke={selected?'#2589b0':'none'} strokeWidth="1.5" pointerEvents={select&&!o.locked?'fill':'none'} onPointerDown={e=>paintDown(e,f.id)}/>;
   return <g key={f.id} opacity={opacity?.get(f.id)}>{clips.reduce<ReactNode>((child,c)=><g key={c.id} clipPath={`url(#${c.id})`}>{child}</g>,fill)}</g>;
  }
  const offset=d.offsets.find(x=>x.id===item.id)!,g=offsetGeometry(d,offset);if(g.error)return null;const inkShapes=extendedInk(g.shapes,offset.inkEnds).shapes,runs=inkRuns(g.shapes,offset.width,offset.profile??'UNIFORM',offset.profileReverse,undefined,false,offset.inkEnds,undefined,undefined,undefined,undefined,false,sampling);
  return <g key={offset.id} data-testid="drawing-offset" data-id={offset.id} opacity={opacity?.get(offset.id)}><MistInk runs={runs} mist={offset.mist} screen={screen} unit={unit} width={offset.width} owner={offset.id}/>
  {pick&&(selectedPaint===offset.id||selectedPaints?.includes(offset.id))&&<path d={pathOf(inkShapes,screen)} fill="none" stroke="#2589b0" strokeWidth="1.5" pointerEvents="none"/>}{pick&&<path data-testid="drawing-offset-hit" d={pathOf(inkShapes,screen)} fill="none" stroke="transparent" strokeWidth="13" pointerEvents={select&&!o.locked?'stroke':'none'} onPointerDown={e=>paintDown(e,offset.id)}/>}</g>;
 })}</g>;
 })}</>;
}
