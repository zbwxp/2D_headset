import {useEffect,useRef,useState} from 'react';
import {ImagePlus,Move,LockKeyhole,Unlock,RotateCcw,Trash2} from 'lucide-react';
import {useEditor} from '../../app/store';
import {emptyRecording} from '../../domain/recording/model';
import {clampReferenceOffset,recordingReferenceLayout,RECORDING_REFERENCE_IMAGE,RECORDING_REFERENCE_LIMIT,type RecordingReferenceImage} from '../../domain/recording/reference';
import BackgroundStates from './BackgroundStates';
import {readPhoto} from '../edit2d/ReferenceControls';
import FloatingPanel from '../shared/FloatingPanel';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import {uiText as t} from '../i18n';

function save(reference:RecordingReferenceImage|undefined){
 const e=useEditor.getState();e.setRecording({...(e.project.recording??emptyRecording()),reference});
}
function commit(reference:RecordingReferenceImage|undefined){const e=useEditor.getState();if(e.project.recording?.reference===reference)return;e.beginEdit();save(reference);e.endEdit();}
export default function Background({width,height,zoom,pan,moving,setMoving}:{width:number;height:number;zoom:number;pan:[number,number];moving:boolean;setMoving:(value:boolean)=>void}){
 const ref=useEditor(s=>s.project.recording?.reference),projectId=useEditor(s=>s.project.meta.createdAt);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[draft,setDraft]=useState<RecordingReferenceImage|null>(null);
 const input=useRef<HTMLInputElement>(null),request=useRef(0),drag=useRef<{x:number;y:number;source:RecordingReferenceImage;unit:number;next:RecordingReferenceImage|null}|null>(null);
 const image=draft??ref,layout=image?recordingReferenceLayout(image,width,height,zoom,pan):null;
 const cancel=()=>{drag.current=null;setDraft(null);};
 useEffect(()=>{cancel();},[ref,moving,projectId,width,height,zoom,pan]);
 useEffect(()=>{if(!ref?.visible||ref.locked)setMoving(false);},[ref?.visible,ref?.locked]);
 useEffect(()=>{const blur=()=>cancel(),key=(e:KeyboardEvent)=>{
  if(e.key==='Escape'){cancel();setMoving(false);}
  if(drag.current&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();cancel();}
 },hidden=()=>{if(document.hidden)cancel();};
 window.addEventListener('blur',blur);window.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',hidden);
 return()=>{request.current++;window.removeEventListener('blur',blur);window.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',hidden);};},[]);
 useEffect(()=>{request.current++;setBusy(false);setOpen(false);},[projectId]);
 const update=(patch:Partial<RecordingReferenceImage>,atomic=false)=>{const current=useEditor.getState().project.recording?.reference;if(current)(atomic?commit:save)({...current,...patch});};
 const upload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;const ticket=++request.current,origin=useEditor.getState().project;setBusy(true);
  try{const photo=await readPhoto(file,RECORDING_REFERENCE_IMAGE),now=useEditor.getState().project;
   if(ticket!==request.current||now.meta.createdAt!==origin.meta.createdAt||now.recording?.reference!==origin.recording?.reference)return;
   commit(photo);setMoving(false);setOpen(true);
  }catch(error){if(ticket===request.current)useEditor.getState().notify(t((error as Error).message));}
  finally{if(ticket===request.current)setBusy(false);}
 };
 return <>
 {image?.visible&&layout&&<svg className="recording-background-image" width="100%" height="100%" aria-hidden="true">
  <image data-testid="recording-background-image" href={image.dataUrl} x={-layout.width/2} y={-layout.height/2} width={layout.width} height={layout.height} opacity={image.opacity} transform={`translate(${layout.x} ${layout.y}) rotate(${image.rotation})`}/>
 </svg>}
 {moving&&ref?.visible&&!ref.locked&&<div className="recording-background-drag" data-testid="recording-background-drag" onContextMenu={e=>e.preventDefault()}
  onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,source:ref,unit:recordingReferenceLayout(ref,width,height,zoom,pan).unit,next:null};}}
  onPointerMove={e=>{const d=drag.current;if(!d)return;const offset:[number,number]=[clampReferenceOffset(d.source.offset[0]+(e.clientX-d.x)/d.unit),clampReferenceOffset(d.source.offset[1]-(e.clientY-d.y)/d.unit)];
   if(offset.every((x,i)=>x===d.source.offset[i])&&!d.next)return;d.next={...d.source,offset};setDraft(d.next);}}
  onPointerUp={e=>{const next=drag.current?.next;cancel();if(next&&next.offset.some((x,i)=>x!==ref.offset[i]))commit(next);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
  onPointerCancel={cancel} onLostPointerCapture={cancel}
 />}
 <div className="reference-controls recording-background-controls" onPointerDown={e=>e.stopPropagation()}>
  <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" data-testid="recording-background-input" onChange={upload}/>
  <button className="reference-trigger" aria-label={t(ref?'录制背景设置':'插入背景图')} disabled={busy} onClick={()=>ref?setOpen(!open):input.current?.click()}><ImagePlus size={14}/>{t(busy?'正在载入…':ref?'录制背景':'插入背景图')}</button>
  {moving&&<button className="reference-trigger" onClick={()=>setMoving(false)}>{t('完成图片平移')}</button>}
  {open&&<FloatingPanel id="recording-background" title={ref?.name??t('录制背景')} label={t('录制背景设置')} onClose={()=>setOpen(false)}>
   {ref?<>
    <div className="reference-modes">
     <button aria-pressed={moving} disabled={ref.locked||!ref.visible} onClick={()=>setMoving(!moving)}><Move size={13}/>{t(moving?'完成图片平移':'平移图片')}</button>
     <button aria-label={t(ref.locked?'解锁参考图':'锁定参考图')} onClick={()=>{update({locked:!ref.locked},true);setMoving(false);}}>{ref.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>} {t(ref.locked?'已锁定':'锁定')}</button>
    </div>
    <label className="reference-visible"><input type="checkbox" checked={ref.visible} onChange={e=>update({visible:e.target.checked},true)}/>{t('显示参考图')}</label>
    <BackgroundStates reference={ref} change={fn=>{const current=useEditor.getState().project.recording?.reference;if(!current)return;cancel();setMoving(false);commit(fn(current));}}/>
    {([
     ['透明度','opacity',0,1,ref.opacity],['图片缩放','scale',.1,10,ref.scale],
     ['水平位置','x',-RECORDING_REFERENCE_LIMIT,RECORDING_REFERENCE_LIMIT,ref.offset[0]],
     ['垂直位置','y',-RECORDING_REFERENCE_LIMIT,RECORDING_REFERENCE_LIMIT,ref.offset[1]],
     ['旋转','rotation',-180,180,ref.rotation],
    ] as const).map(([label,key,min,max,value])=><NumericSlider key={key} className="reference-slider" label={t(label)} min={min} max={max} value={value} disabled={ref.locked}
     inputScale={key==='opacity'||key==='scale'?100:1} formatValue={x=>key==='opacity'||key==='scale'?formatNumeric(x*100)+'%':formatNumeric(x)+(key==='rotation'?'°':'')}
     onEditStart={()=>useEditor.getState().beginEdit(true)} onEditEnd={()=>useEditor.getState().endEdit()}
     onChange={v=>{const current=useEditor.getState().project.recording?.reference;if(!current)return;update(key==='x'?{offset:[v,current.offset[1]]}:key==='y'?{offset:[current.offset[0],v]}:{[key]:v});}}/>)}
    <div className="reference-actions">
     <button disabled={ref.locked||busy} onClick={()=>input.current?.click()}>{t('替换照片')}</button>
     <button aria-label={t('重置参考图位置')} disabled={ref.locked} onClick={()=>update({offset:[0,0],scale:1,rotation:0},true)}><RotateCcw size={14}/></button>
     <button aria-label={t('移除参考照片')} disabled={ref.locked} onClick={()=>{request.current++;commit(undefined);setMoving(false);setOpen(false);}}><Trash2 size={14}/></button>
    </div>
    <p>{t('录制间共用背景，随项目保存，不进入最终预览。')}</p>
    <p>{t('位置范围 ±10（2D 的 5 倍）。放大九宫格后，平移图片对准需要的格子。')}</p>
   </>:<button onClick={()=>input.current?.click()}>{t('插入背景图')}</button>}
  </FloatingPanel>}
 </div></>;
}
