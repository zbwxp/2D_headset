import {shapeOf,nodeAt,members,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {linkedNodeIds} from '../../domain/drawing/endpointLinks';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import {curvePath} from './geometry';

export const MAX_AI_GUIDE_CURVES=32;
export interface AIGuideOptions {curveIds?:readonly string[];grid?:boolean;labels?:boolean;handles?:boolean;diagnostics?:boolean}
export interface AIGuideOverlayProps extends Omit<AIGuideOptions,'curveIds'> {
 d:DrawingDocument;curveIds:readonly string[];screen:(p:Point2)=>Point2;unit:number;width:number;height:number;
}
const short=(id:string)=>id.length>10?`${id.slice(0,6)}…${id.slice(-3)}`:id;
const number=(x:number)=>Math.abs(x)<.00005?'0':String(+x.toFixed(4));
const coordinates=(p:Point2)=>`[${number(p[0])}, ${number(p[1])}]`;
function gridStep(unit:number){const desired=60/unit,power=10**Math.floor(Math.log10(desired)),ratio=desired/power;return (ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power;}
/** Transient inspection aid only. The caller explicitly mounts it; no state, events or persistence. */
export default function AIGuideOverlay({d,curveIds,screen,unit,width,height,grid=true,labels=true,handles=true,diagnostics=true}:AIGuideOverlayProps){
 if(!Number.isFinite(unit)||unit<=0||width<=0||height<=0)return null;
 const requested=[...new Set(curveIds)],selected=d.curves.filter(c=>requested.includes(c.id)).slice(0,MAX_AI_GUIDE_CURVES),ids=new Set(selected.map(c=>c.id)),origin=screen([0,0]),step=gridStep(unit);
 const xs:number[]=[],ys:number[]=[];
 if(grid){
  const minX=-origin[0]/unit,maxX=(width-origin[0])/unit,minY=(origin[1]-height)/unit,maxY=origin[1]/unit;
  for(let i=Math.ceil(minX/step);i<=Math.floor(maxX/step)&&xs.length<100;i++)xs.push(i*step);
  for(let i=Math.ceil(minY/step);i<=Math.floor(maxY/step)&&ys.length<100;i++)ys.push(i*step);
 }
 const errors=diagnostics?[...roundedJoins(d)].filter(([id,g])=>g.error&&d.joins.some(j=>j.id===id&&(ids.has(j.a.curveId)||ids.has(j.b.curveId)))):[];
 const title=`AI 辅助 · ${selected.length} 条曲线 · 源坐标 X→ Y↑${requested.length>MAX_AI_GUIDE_CURVES?` · 仅显示前 ${MAX_AI_GUIDE_CURVES} 条`:''}${!selected.length?' · 请选择曲线':''}`;
 return <g data-testid="ai-guide-overlay" data-ai-guide="true" pointerEvents="none" aria-hidden="true" fontFamily="system-ui,sans-serif">
  {grid&&<g data-testid="ai-coordinate-grid">
   {xs.map(x=>{const px=screen([x,0])[0];return <g key={`x${x}`}><line x1={px} y1={0} x2={px} y2={height} stroke={Math.abs(x)<1e-10?'#1d899c':'#53a0b0'} strokeOpacity={Math.abs(x)<1e-10?.45:.17} strokeWidth={1}/><text x={px+3} y={height-6} fill="#287484" fontSize={10}>{number(x)}</text></g>;})}
   {ys.map(y=>{const py=screen([0,y])[1];return <g key={`y${y}`}><line x1={0} y1={py} x2={width} y2={py} stroke={Math.abs(y)<1e-10?'#1d899c':'#53a0b0'} strokeOpacity={Math.abs(y)<1e-10?.45:.17} strokeWidth={1}/><text x={4} y={py-3} fill="#287484" fontSize={10}>{number(y)}</text></g>;})}
  </g>}
  {selected.map(c=>{const shape=shapeOf(d,c.id),points=shape.map(screen);return <g key={c.id} data-ai-curve-id={c.id}>
   <title>{`${c.name} · curve ${c.id}`}</title>
   <path d={curvePath(shape,screen)} fill="none" stroke="#008caf" strokeWidth={1.3} strokeDasharray="5 3"/>
   {handles&&<g stroke="#9b57bc" strokeWidth={1} strokeDasharray="3 3"><line x1={points[0][0]} y1={points[0][1]} x2={points[1][0]} y2={points[1][1]}/><line x1={points[3][0]} y1={points[3][1]} x2={points[2][0]} y2={points[2][1]}/></g>}
   {([0,1,2,3] as const).filter(i=>handles||i===0||i===3).map(i=>{
    const endpoint=i===0||i===3,end:0|1=i<2?0:1,role=endpoint?`P${end}`:`H${end}`,p=points[i],nodeId=endpoint?c.nodes[end]:undefined;
    const coupled=nodeId&&(members(d,nodeId).length>1||linkedNodeIds(d,nodeId).size>1);
    const detail=`${c.name} · ${c.id} · ${endpoint?'endpoint':'handle'} ${role}${nodeId?` · node ${nodeId}`:''} · ${coordinates(shape[i])}`;
    return <g key={i} data-ai-target-kind={endpoint?'node':'handle'} data-ai-control={role} data-ai-node-id={nodeId}>
     <title>{detail}</title>
     {endpoint?<circle cx={p[0]} cy={p[1]} r={3.5} fill="#fff" stroke={coupled?'#ba4b95':'#008caf'} strokeWidth={1.5}/>:<rect x={p[0]-2.5} y={p[1]-2.5} width={5} height={5} fill="#fff" stroke="#9b57bc" strokeWidth={1.2}/>}
     {coupled&&<path d={`M ${p[0]-6} ${p[1]} h 12 M ${p[0]} ${p[1]-6} v 12`} stroke="#ba4b95" strokeWidth={.8} opacity={.75}/>}
     {labels&&<text x={Math.max(4,Math.min(width-180,p[0]+8))} y={Math.max(36,Math.min(height-16,p[1]+(endpoint?-9:14)))} fill={endpoint?'#006c89':'#793b9a'} fontSize={10} paintOrder="stroke" stroke="#fff" strokeWidth={3} strokeLinejoin="round">{`${short(c.id)} ${role} ${coordinates(shape[i])}`}</text>}
    </g>;
   })}
  </g>;})}
  {errors.map(([id,g])=>{const join=d.joins.find(j=>j.id===id)!,p=screen(nodeAt(d,join.a).position);return <g key={id} data-ai-diagnostic-id={id}><circle cx={p[0]} cy={p[1]} r={10} fill="none" stroke="#d33242" strokeWidth={2}/><title>{`Join ${id}: ${g.error}`}</title></g>;})}
  <rect x={8} y={8} width={Math.min(width-16,Math.max(190,title.length*7.5))} height={22} rx={4} fill="#eaf8fc" fillOpacity={.94} stroke="#79b6c4"/>
  <text x={15} y={23} fontSize={11} fill="#176379">{title}</text>
  {errors.length>0&&<text x={15} y={45} fontSize={11} fill="#bc2338">{`${errors.length} 个所选接点存在几何诊断；查看 SVG title 获取详情`}</text>}
 </g>;
}
