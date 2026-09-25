import {junctionEnabled} from '../../domain/recording/bindingState';
import {setBindingState} from '../../domain/recording/commands';
import KeyList from './KeyList';
import {sameView} from '../../domain/recording/model';
import {evaluateRecording} from '../../domain/recording/junctions';
import {useState} from 'react';
import {useEditor} from '../../app/store';
import {editSmoothStyle,setSmoothMode,smoothEditable,smoothStyle} from '../../domain/recording/smooth';
import type {Recording,RecordingJunction,View} from '../../domain/recording/model';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t} from '../i18n';
export default function JunctionInspector({recording:r,junction:j,view,selectView,warning}:{recording:Recording;junction:RecordingJunction;view:View;selectView:(v:View)=>void;warning?:string}){
 const [error,setError]=useState('');
 const commit=(next:Recording)=>{const e=useEditor.getState();if(next===e.project.recording)return;e.beginEdit();e.setRecording(next);e.endEdit();};
 const position=evaluateRecording(r,view),outside=[j.masterCurveId,j.followerCurveId].some(id=>position.get(id)?.status==='frozen');
 const bound=junctionEnabled(j,view);
 const disabled=!smoothEditable(r,j),style=j.mode==='SMOOTH'?smoothStyle(j,view):null;
 return <section data-testid="junction-inspector"><h3>{t('连接点')}</h3>
 <p>{r.curves.find(c=>c.id===j.masterCurveId)?.name} ↔ {r.curves.find(c=>c.id===j.followerCurveId)?.name}</p>
 <p data-testid="binding-state">{t(bound?'当前视角：绑定':'当前视角：解绑')}</p>
 <button disabled={disabled} onClick={()=>commit(setBindingState(r,j.id,view,!bound))}>{t(bound?'在此视角解绑':'在此视角绑定')}</button>
 <small>{t('解绑保留源曲线位置，圆滑过渡消失；状态以 0.5 为界切换。')}</small>
 {r.curves.some(c=>c.id===j.followerCurveId&&c.semantic)&&<p>{t('此处解绑只关闭曲线连接，端点仍跟随同一个语义点。')}</p>}
 {j.bindingKeys&&<div className="binding-keys"><h4>{t('绑定状态帧')}</h4>{[...j.bindingKeys].sort((a,b)=>a.yaw-b.yaw||a.pitch-b.pitch).map(k=><button key={`${k.yaw}:${k.pitch}`} onClick={()=>selectView(k)}>Yaw {+k.yaw.toFixed(2)}° · Pitch {+k.pitch.toFixed(2)}° · {t(k.bound?'绑定':'解绑')}</button>)}</div>}
 <button disabled={disabled} onClick={()=>{const next=setSmoothMode(r,j.id,view,j.mode!=='SMOOTH');setError(next===r?t('无法启用：端点已参与圆滑连接或当前视角未共同覆盖'):'');commit(next);}}>{t(j.mode==='SMOOTH'?'恢复位置绑定':'启用圆滑连接')}</button>
 {error&&<p role="status">{error}</p>}
 {warning&&<p role="status">{t(warning)}</p>}
 {style&&<><p>{t('切线约束 · 保持 G1')}</p>{(['radiusScale','tensionA','tensionB'] as const).map((key,i)=><NumericSlider key={key} label={['圆滑范围','切线长度 A','切线长度 B'][i]} value={style[key]} min={key==='radiusScale'?.1:.05} max={key==='radiusScale'?8:4} disabled={disabled||outside||!bound} onEditStart={()=>useEditor.getState().beginEdit()} onEditEnd={()=>useEditor.getState().endEdit()} onChange={value=>{const e=useEditor.getState(),r=e.project.recording!;e.setRecording(editSmoothStyle(r,j.id,view,{[key]:value}));}}/>)}
 <h4>{t('圆滑关键帧')}</h4>{j.mode==='SMOOTH'&&<KeyList key={j.id} keys={j.smoothKeys} minKeys={0} disabled={disabled} deleteLabel="删除圆滑关键帧" navigate={selectView} onDelete={views=>commit({...r,junctions:r.junctions!.map(x=>x===j?{...j,smoothKeys:j.smoothKeys.filter(k=>!views.some(v=>sameView(v,k)))}:x)})}/>}</>}
 </section>;
}
