import FloatingPanel from '../shared/FloatingPanel';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import {backgroundTransform} from '../../domain/head/inspectionBackground';
import {useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import {readPhoto} from '../edit2d/ReferenceControls';
export default function InspectionBackground(){
 const bg=useEditor(s=>s.project.inspectionBackground),set=useEditor(s=>s.setInspectionBackground),input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[settings,setSettings]=useState(false);
 const images=bg?.images??[],active=images.find(x=>x.id===bg?.activeId);
 const transform=active?backgroundTransform(active):null;
 const update=(patch:Partial<NonNullable<typeof transform>>)=>{const latest=useEditor.getState().project.inspectionBackground;if(!active||!latest)return;set({...latest,images:latest.images.map(x=>x.id===active.id?{...x,...patch}:x)});};
 const upload=async(files:File[])=>{setBusy(true);try{for(const file of files){const current=useEditor.getState().project.inspectionBackground??{images:[],activeId:null};if(current.images.length>=6){useEditor.getState().notify('3D 背景图最多六张，请先删除一张。');break;}const photo=await readPhoto(file),latest=useEditor.getState().project.inspectionBackground??current;if(latest.images.length>=6)break;const image={id:crypto.randomUUID(),name:photo.name,dataUrl:photo.dataUrl};set({images:[...latest.images,image],activeId:image.id});}}catch(e){useEditor.getState().notify((e as Error).message);}finally{setBusy(false);if(input.current)input.current.value='';}};
 return <>{active&&transform&&<div className="inspection-background-layer"><img className="inspection-background-image" src={active.dataUrl} alt="3D 背景" style={{transform:`translate(${transform.offsetX}%, ${transform.offsetY}%) rotate(${transform.rotation}deg) scale(${transform.scale})`,opacity:transform.opacity}}/></div>}<aside className="inspection-background-tools" data-ui-keyboard aria-label="3D 背景图">
 <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e=>void upload(Array.from(e.target.files??[]))}/>
 <button disabled={busy||images.length>=6} onClick={()=>input.current?.click()}>{busy?'载入中…':`＋背景 ${images.length}/6`}</button>
 {images.map((img,i)=><div className="inspection-background-thumb" key={img.id}><button aria-label={'切换背景 '+(i+1)} aria-pressed={active?.id===img.id} title={img.name} onClick={()=>set({images,activeId:img.id})}><img src={img.dataUrl} alt={img.name}/></button><button className="background-remove" aria-label={'删除背景 '+(i+1)} onClick={()=>set({images:images.filter(x=>x.id!==img.id),activeId:bg?.activeId===img.id?null:bg?.activeId??null})}>×</button></div>)}
 {active&&<button onClick={()=>setSettings(true)}>背景设置</button>}
 {!!images.length&&<button aria-pressed={!active} onClick={()=>set({images,activeId:null})}>无背景</button>}
 </aside>{settings&&<FloatingPanel id="inspection-background" title="3D 背景设置" onClose={()=>setSettings(false)}>{active&&transform?<div className="inspection-background-settings"><strong>{active.name}</strong>{([
 ['scale','背景缩放',.1,5],['rotation','背景旋转',-180,180],['offsetX','背景水平位置',-100,100],['offsetY','背景垂直位置',-100,100],['opacity','背景不透明度',0,1]
 ] as const).map(([key,label,min,max])=><NumericSlider key={key} label={label} min={min} max={max} value={transform[key]} snapTargets={key==='scale'?[1]:[0]} inputScale={key==='scale'||key==='opacity'?100:1} formatValue={v=>formatNumeric(key==='scale'||key==='opacity'?v*100:v)+(key==='rotation'?'°':'%')} onChange={v=>update({[key]:v})}/>)}<button onClick={()=>update({scale:1,rotation:0,offsetX:0,offsetY:0,opacity:1})}>重置背景变换</button><small>位置相对于窗口尺寸；仅调整背景，不移动 3D 相机。</small></div>:<p>请选择一张背景图。</p>}</FloatingPanel>}</>;
}
