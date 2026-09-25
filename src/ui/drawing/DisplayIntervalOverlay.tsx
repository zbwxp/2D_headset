import {curveById,editable,visible,type DrawingDocument as Doc,type Point2} from '../../domain/drawing/model';
import {displayPath,displayField} from '../../domain/drawing/displayIntervals';
import {pathOf} from '../../domain/drawing/appearance';
import type {DrawingSelection} from './session';
import {uiText as t} from '../i18n';
export default function DisplayIntervalOverlay({d,selection,screen,pick}:{d:Doc;selection:DrawingSelection;screen:(p:Point2)=>Point2;pick:(e:React.PointerEvent,track:string,range:string,end:0|1)=>void}){
 const seen=new Set<string>(),guides:{key:string;path:string}[]=[],grips:{track:string;range:string;end:0|1;index:number;p:Point2;active:boolean;locked:boolean}[]=[];
 for(const id of selection.ids.filter(id=>curveById(d,id))){
  const path=displayPath(d,id),key=path.segments.map(x=>x.id).sort().join(':');if(seen.has(key)||path.segments.some(x=>!visible(d,x.id)))continue;seen.add(key);
  const f=displayField(d,path);if(!f.tracks.length||!f.total)continue;const locked=path.segments.some(x=>!editable(d,x.id));
  guides.push({key,path:pathOf(f.geometry.shapes,screen,path.closed)});
  let index=0;for(const track of f.tracks)for(const r of track.ranges){index++;for(const end of [0,1] as const)grips.push({track:track.id,range:r.id,end,index,p:screen(f.at(f.native(track,end?r.end:r.start)).p),active:selection.displayInterval?.range===r.id&&selection.displayInterval.end===end,locked});}
 }
 // A selected marker must remain reachable when multiple intervals share a position.
 grips.sort((a,b)=>Number(a.active)-Number(b.active));
 return <g data-testid="drawing-display-interval-overlay">
 {guides.map(g=><path key={g.key} data-testid="drawing-display-guide" d={g.path} stroke="#489487" strokeWidth="1" strokeDasharray="3 5" opacity=".4" fill="none" pointerEvents="none"/>)}
 {grips.map(({track,range,end,index,p,active,locked})=><g key={`${range}:${end}`}><path data-testid="drawing-display-grip" data-track={track} data-range={range} data-end={end} data-active={active} d={`M ${p[0]} ${p[1]-8} l 7 8 l -7 8 l -7 -8 Z`} fill={active?'#168776':'#e5fff7'} stroke="#168776" strokeWidth="1.5" pointerEvents={locked?'none':'all'} style={{cursor:'grab'}} onPointerDown={e=>pick(e,track,range,end)}><title>{t(end?'区间终点':'区间起点')}</title></path><text x={p[0]+10} y={p[1]-10} fill="#168776" fontSize="11" pointerEvents="none">{index}{end?'B':'A'}</text></g>)}
 </g>;
}
