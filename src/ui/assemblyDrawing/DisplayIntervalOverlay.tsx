import {curveById,editable,visible,type DrawingDocument as Doc,type Point2,type Cubic} from '../../domain/drawing/model';
import {displayPath,displayField,intervalMode} from '../../domain/drawing/displayIntervals';
import {pathOf} from '../../domain/drawing/appearance';
import type {DrawingSelection} from './session';
import {uiText as t} from '../i18n';
// Match both endpoints to their interval number, independently of selection and mode.
function intervalColor(index:number,light=false){return `hsl(${(165+(index-1)*137.508)%360} 65% ${light?94:34}%)`;}
export default function DisplayIntervalOverlay({d,selection,screen,pick,projectShapes,projectPoint}:{projectPoint?:(p:Point2,s:Cubic,t:number)=>Point2;projectShapes?:(shapes:Cubic[])=>Cubic[];d:Doc;selection:DrawingSelection;screen:(p:Point2)=>Point2;pick:(e:React.PointerEvent,track:string,range:string,end:0|1)=>void}){
 const seen=new Set<string>(),guides:{key:string;path:string}[]=[],grips:{track:string;range:string;end:0|1;mode:'SHOW'|'HIDE';index:number;p:Point2;active:boolean;locked:boolean;enabled:boolean}[]=[];
 for(const id of selection.ids.filter(id=>curveById(d,id))){
  const path=displayPath(d,id),key=path.segments.map(x=>x.id).sort().join(':');if(seen.has(key)||path.segments.some(x=>!visible(d,x.id)))continue;seen.add(key);
  const f=displayField(d,path);if(!f.tracks.length||!f.total)continue;const locked=path.segments.some(x=>!editable(d,x.id));
  guides.push({key,path:projectShapes?pathOf(projectShapes(f.geometry.shapes),p=>p,path.closed):pathOf(f.geometry.shapes,screen,path.closed)});
  let index=0;for(const track of f.tracks)for(const r of track.ranges){index++;for(const end of [0,1] as const)grips.push({track:track.id,range:r.id,end,mode:intervalMode(r),enabled:r.enabled!==false,index,p:(()=>{const q=f.at(f.native(track,end?r.end:r.start));return projectPoint?projectPoint(q.p,q.shape,q.t):screen(q.p);})(),active:selection.displayInterval?.range===r.id&&selection.displayInterval.end===end,locked});}
 }
 // A selected marker must remain reachable when multiple intervals share a position.
 grips.sort((a,b)=>Number(a.active)-Number(b.active));
 return <g data-testid="assembly-drawing-display-interval-overlay">
 {guides.map(g=><path key={g.key} data-testid="assembly-drawing-display-guide" d={g.path} stroke="#489487" strokeWidth="1" strokeDasharray="3 5" opacity=".4" fill="none" pointerEvents="none"/>)}
 {grips.map(({track,range,end,mode,index,p,active,locked,enabled})=><g key={`${range}:${end}`} opacity={enabled?1:.4} data-enabled={enabled}><path data-testid="assembly-drawing-display-grip" data-track={track} data-range={range} data-end={end} data-mode={mode} data-active={active} d={`M ${p[0]} ${p[1]-8} l 7 8 l -7 8 l -7 -8 Z`} fill={intervalColor(index,!active)} stroke={intervalColor(index)} strokeWidth="1.5" pointerEvents={locked?'none':'all'} style={{cursor:'grab'}} onPointerDown={e=>pick(e,track,range,end)}><title>{t(mode==='HIDE'?'断线区间':'显线区间')} · {t(end?'区间终点':'区间起点')}</title></path><text x={p[0]+10} y={p[1]-10} fill={intervalColor(index)} fontSize="11" pointerEvents="none">{index}{end?'B':'A'}</text></g>)}
 </g>;
}
