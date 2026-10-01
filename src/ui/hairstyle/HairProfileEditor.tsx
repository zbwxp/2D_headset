import {useEffect,useMemo,useRef} from 'react';
import {defaultPumpkinProfile,PUMPKIN_LIMITS,pumpkinSurface,hairInsetStart,type HairShellProfile,type PumpkinHairProfile} from '../../domain/hairstyle/profile';
import type {HairNet} from '../../domain/hairstyle/model';
import {useLanguage} from '../i18n';
import NumericSlider from '../shared/NumericSlider';

type Props={net:HairNet;change:(p:HairShellProfile|null)=>void;begin:()=>void;end:()=>void;undo:()=>void;redo:()=>void};
export default function HairProfileEditor({net,change,begin,end,undo,redo}:Props){
 const zh=useLanguage(s=>s.language)==='zh',t=(a:string,b:string)=>zh?a:b;
 const p=net.profile?.version===2?net.profile:null;
 const actions=useRef({change,end});actions.current={change,end};
 const pending=useRef<PumpkinHairProfile|null>(null),raf=useRef(0);
 const flush=()=>{cancelAnimationFrame(raf.current);raf.current=0;const value=pending.current;pending.current=null;if(value)actions.current.change(value);};
 const queue=(value:PumpkinHairProfile)=>{pending.current=value;if(!raf.current)raf.current=requestAnimationFrame(flush);};
 const finish=()=>{flush();actions.current.end();};
 useEffect(()=>()=>{cancelAnimationFrame(raf.current);if(pending.current){actions.current.change(pending.current);pending.current=null;actions.current.end();}},[]);
 const reset=(value:HairShellProfile|null)=>{finish();begin();change(value);end();};
 const preview=useMemo(()=>{
  if(!p)return null;
  // A true side section: +Z (forehead) on the left, -Z (nape) on the right.
  const side=(az:number)=>Array.from({length:41},(_,i)=>pumpkinSurface(net,az,i/40));
  const front=side(0),back=side(Math.PI),all=[...back.slice().reverse(),...front];
  const scale=Math.min(98/(net.radiusZ*p.width),165/(net.radiusY*2.2));
  const xy=(v:number[])=>`${140-(v[2]-net.center[2])*scale},${100-(v[1]-net.center[1])*scale}`;
  return {path:'M'+all.map(xy).join(' L')+' Z',rim:'M'+xy(front[40])+' L'+xy(back[40]),startY:100-hairInsetStart(p)*net.radiusY*scale};
 },[net,p]);
 const labels={width:['鼓肩宽度','Shoulder width'],shoulder:['鼓肩高度','Shoulder height'],crown:['顶部圆钝度','Crown roundness'],insetStart:['内收起始高度','Tuck start height'],inset:['下半部内收','Lower tuck'],baseHeight:['底面高度','Base height'],baseTilt:['前后倾斜','Base tilt'],lower:['下部过渡','Lower transition']};
 const slider=(key:keyof typeof labels)=>p&&<NumericSlider key={key} label={t(...labels[key] as [string,string])} value={key==='insetStart'?hairInsetStart(p):p[key]!} min={PUMPKIN_LIMITS[key][0]} max={PUMPKIN_LIMITS[key][1]} step={key==='baseTilt'?1:.01}
  inputScale={key==='crown'||key==='inset'||key==='lower'?100:1}
  formatValue={v=>key==='baseTilt'?v.toFixed(1)+'°':key==='width'||key==='shoulder'||key==='baseHeight'||key==='insetStart'?v.toFixed(2)+' R':Math.round(v*100)+'%'}
  onChange={value=>queue({...p,insetStart:hairInsetStart(p),[key]:value})} onEditStart={begin} onEditEnd={finish} onUndo={undo} onRedo={redo}/>;
 return <details className="hair-profile-editor" open><summary>{t('发网壳形 · 南瓜壳','Hair shell · Pumpkin')}</summary>
  <div className="hair-profile-actions"><button onClick={()=>reset(defaultPumpkinProfile())}>{t(p?'重置南瓜壳':'启用南瓜壳',p?'Reset pumpkin shell':'Use pumpkin shell')}</button><button aria-pressed={!net.profile} onClick={()=>reset(null)}>{t('对照椭球','Compare ellipsoid')}</button></div>
  {preview&&<svg viewBox="0 0 280 205" data-testid="hair-shell-profile" role="img" aria-label={t('南瓜发网侧面：额头高，后颈低','Pumpkin shell side: higher forehead, lower nape')}>
   <line className="axis" x1="140" y1="8" x2="140" y2="190"/>
   <path className="profile" d={preview.path}/><path className="base-rim" d={preview.rim}/>
   <line x1="33" x2="247" y1={preview.startY} y2={preview.startY} stroke="#91d6c5" strokeWidth="1" strokeDasharray="4 3"/>
   <text className="legend" x="244" y={preview.startY-4} textAnchor="end">{t('内收起点','Tuck starts')}</text>
   <text className="legend" x="12" y="194">{t('← 额头（前）','← Forehead')}</text><text className="legend" x="268" y="194" textAnchor="end">{t('后颈（后）→','Nape →')}</text>
  </svg>}
  <p>{t(p?'侧面示意：上部鼓起、下部内收，橙线是实际底面。倾斜 0° 为水平，增大时额头更高、后颈更低。':'当前使用对照椭球。启用南瓜壳即可调节鼓肩、内收和斜底面。',p?'Side view: a full crown and tucked lower flank. Orange marks the actual base; 0° is level, increasing tilt raises the forehead and lowers the nape.':'Using the comparison ellipsoid. Enable the pumpkin shell to edit its shape.')}</p>
  {p&&<><div className="hair-shape-sliders">{(['width','shoulder','crown','insetStart','inset'] as const).map(slider)}<p>{t('起始高度越高，越早向内收拢；0 R 为发网中心，1 R 为顶部。','Higher starts tucking earlier; 0 R is the net center, 1 R is the top.')}</p></div><details open><summary>{t('底面 · 前高后低','Base · High front, low back')}</summary>{slider('baseHeight')}{slider('baseTilt')}</details><details><summary>{t('高级 · 下部过渡','Advanced · Lower transition')}</summary>{slider('lower')}</details></>}
 </details>;
}
