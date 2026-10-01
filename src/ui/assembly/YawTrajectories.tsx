import type {Point2} from '../../domain/drawing/model';
import type {Vec3} from '../../domain/assembly/model';
import type {LocatorYawOrbit,LocatorYawSample} from '../../domain/assembly/trajectories';

export type TrajectoryScope='recorded'|'full';
const colors=['#168caa','#9c69c9','#d48c28','#398f60','#b65779','#607dd0'];
interface Props {
 orbits:LocatorYawOrbit[]; mode:'all'|'selected'|'off'; scope:TrajectoryScope;
 selected?:string; project:(v:Vec3)=>Point2; inspection:boolean;
}
/** Read-only overlay. Key dots are saved poses; the moving locator is drawn by
 * RigLines so an unsaved draft can intentionally sit off this saved trajectory. */
export default function YawTrajectories({orbits,mode,scope,selected,project,inspection}:Props){
 if(mode==='off')return null;
 return <g pointerEvents="none">{orbits.map((o,index)=>{
  const active=o.locatorId===selected;
  if(mode==='selected'&&!active)return null;
  const visible=(s:LocatorYawSample)=>s.covered!==false&&(scope==='full'||s.recorded!==false);
  const path=o.samples.map((s,i)=>visible(s)?(i&&visible(o.samples[i-1])?'L':'M')+project(s.world):'').join('')+(o.closed&&o.samples.every(visible)?'Z':'');
  const color=active?'#d38922':colors[index%colors.length];
  const seen=new Set<string>(),marks=o.samples.filter(s=>{if(!visible(s)||!s.keyId||seen.has(s.keyId))return false;seen.add(s.keyId);return true;});
  const labels:{x:number;y:number;w:number}[]=[];
  const labelFor=(p:Point2,text:string)=>{
   const font=inspection?9:11,w=text.length*font*.62;
   for(const dy of [16,-10,32,-26,48,-42,64,-58,80]){
    const candidate={x:p[0]+6,y:p[1]+dy,w};
    if(labels.every(b=>candidate.x>b.x+b.w+3||candidate.x+w+3<b.x||Math.abs(candidate.y-b.y)>font+3)){
     labels.push(candidate);return candidate;
    }
   }
   const candidate={x:p[0]+6,y:Math.max(p[1],...labels.map(l=>l.y))+16,w};labels.push(candidate);return candidate;
  };
  return <g key={o.locatorId}>
   {!inspection&&<path d={path} fill="none" stroke="white" strokeOpacity=".8" strokeWidth={active?4:2.7}/>}
   <path data-testid="assembly-yaw-trajectory" data-id={o.locatorId} data-selected={active} data-scope={scope} d={path} fill="none" stroke={color} strokeWidth={active?2:1.2} strokeOpacity={active?1:.65} strokeDasharray={scope==='full'?'4 3':undefined} pointerEvents="none"/>
   {marks.map(s=>{const p=project(s.world),text=`${Number(s.yaw.toFixed(1))}°`,label=active?labelFor(p,text):null;return <g key={s.keyId} data-testid="assembly-trajectory-key" data-locator={o.locatorId} data-key={s.keyId} data-yaw={s.yaw}>
    <circle cx={p[0]} cy={p[1]} r={active?3.8:2.2} fill={inspection?'#202b30':'white'} stroke={color} strokeWidth={active?1.8:1.2}/>
    {label&&<><path d={`M${p}L${label.x},${label.y-4}`} stroke={color} strokeWidth=".7" strokeOpacity=".6"/><text x={label.x} y={label.y} fill={inspection?'#ffd08b':'#925500'} stroke={inspection?'#202b30':'white'} strokeWidth="3" paintOrder="stroke" fontSize={inspection?9:11} data-testid="assembly-trajectory-angle">{text}</text></>}
   </g>;})}
  </g>;
 })}</g>;
}
