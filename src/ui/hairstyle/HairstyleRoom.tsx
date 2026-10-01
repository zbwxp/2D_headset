import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Focus,ChevronDown,ChevronRight} from 'lucide-react';
import {useEditor} from '../../app/store';
import {defaultHairstyle,parseHairstyle,type Hairstyle} from '../../domain/hairstyle/model';
import {profileHair,syncStrands,editHairDrawing,addStrand,rerollStrands} from '../../domain/hairstyle/strands';
import {generateHair} from '../../domain/hairstyle/geometry';
import {projectHairDrawing} from '../../domain/hairstyle/drawing';
import {dragHairControl,hairControlEditable,type HairControl} from '../../domain/hairstyle/inverse';
import {saveDrawingSnapshot} from '../../domain/drawing/snapshots';
import {connect,deleteObjects,deleteLayers,unbind,curveChange} from '../../domain/drawing/commands';
import {cutDrawing,pasteDrawingCut,type DrawingCut} from '../../domain/drawing/clipboard';
import {layerFor,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {RECORDING_REFERENCE_IMAGE} from '../../domain/recording/reference';
import type {ReferenceImage} from '../../domain/project/types';
import type {HairView} from '../../domain/hairstyle/projection';
import {type HairEndpoint,type HairStrandRule} from '../../domain/hairstyle/strandTypes';
import {HairDrawingProvider,hairDrawingSession} from '../drawing/workspace';
import {selectedObjects,selectedLayers,type DrawingSelection} from '../drawing/session';
import LayerPanel from '../drawing/LayerPanel';
import {readPhoto} from '../edit2d/ReferenceControls';
import {useHairstyle} from './session';
import {useHairZoom,clampHairZoom} from './useHairZoom';
import {useLanguage} from '../i18n';
import NumericSlider from '../shared/NumericSlider';
import HairStudioRoom from './HairStudioRoom';
import HairScene from './HairScene';
import HairContour from './HairContour';
import HairRangeControl from './HairRangeControl';
import HairReference from './HairReference';
import HairProfileEditor from './HairProfileEditor';
import HairNetPlacement from './HairNetPlacement';
import '../drawing/drawing.css';
import './hairstyle.css';
const DEFAULT=defaultHairstyle();
export function commitHairstyle(next:Hairstyle){const e=useEditor.getState();e.beginEdit();try{e.setHairstyle(next);}finally{e.endEdit();}}
export default function HairstyleRoom(){const mode=useHairstyle(s=>s.workspaceMode);return mode==='studio'?<HairStudioRoom/>:<HairDrawingProvider><HairEditor/></HairDrawingProvider>;}
function HairEditor(){
 const stored=useEditor(s=>s.project.hairstyle),h=useMemo(()=>profileHair(stored?.strandSet?stored:stored?parseHairstyle(stored):DEFAULT),[stored]);
 const session=useHairstyle(),{view,zoom,pan,guides,netOverlay,netOpacity}=session,ds=hairDrawingSession(),{selection}=ds,zh=useLanguage(s=>s.language)==='zh',t=(a:string,b:string)=>zh?a:b;
 const [size,setSize]=useState({width:400,height:500}),host=useRef<HTMLDivElement>(null),drag=useRef<{id:number;x:number;y:number;view:HairView;pan:[number,number];move:boolean}|null>(null),raf=useRef(0),pending=useRef<Partial<typeof session>|null>(null);
 const [tool,setTool]=useState<'select'|'bind'|'cusp'|'zoom'>('select'),[first,setFirst]=useState<Endpoint|null>(null),[hint,setHint]=useState(''),[properties,setProperties]=useState(true),[moving,setMoving]=useState(false),file=useRef<HTMLInputElement>(null);
 const zoomTool=useHairZoom(tool==='zoom');
 const [clipboard,setClipboard]=useState<{cut:DrawingCut;source:Hairstyle}|null>(null);
 const controlDrag=useRef<{source:Hairstyle;view:HairView;id:string;control:HairControl;begun:boolean}|null>(null);
 const geometry=useMemo(()=>generateHair(h),[h.net,h.leaf,h.interior,h.bang,h.strandSet]),drawing=useMemo(()=>projectHairDrawing(h,geometry,view),[h,geometry,view]),unit=Math.min(size.width/2.7,size.height/2.7)*zoom;
 const invalidProjection=(geometry.strands??[]).filter(a=>a.projectionMisses?.length).map(a=>h.drawing.curves.find(c=>c.id===a.id)?.name??a.id);
 const d=h.drawing,active=d.layers.find(l=>l.id===ds.layerId)?.id??d.layers[0]?.id??null,rule=selection.ids.length===1&&!selectedLayers(selection).length?h.strandSet!.curves.find(c=>c.id===selection.ids[0]):undefined,curve=rule?d.curves.find(c=>c.id===rule.id):undefined;
 useEffect(()=>{const s=hairDrawingSession.getState().selection,ids=s.ids.filter(id=>d.curves.some(c=>c.id===id)),layers=selectedLayers(s).filter(id=>d.layers.some(l=>l.id===id));if(ids.length!==s.ids.length||layers.length!==selectedLayers(s).length)hairDrawingSession.getState().set({selection:{...s,ids,layers,layer:s.layer&&layers.includes(s.layer)?s.layer:undefined}});if(first&&!d.curves.some(c=>c.id===first.curveId))setFirst(null);},[d.curves,d.layers,first]);
 useEffect(()=>{if(stored!==h)useEditor.getState().setHairstyle(h);},[stored,h]);
 useEffect(()=>{const observer=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));observer.observe(host.current!);return()=>observer.disconnect();},[]);
 const flush=()=>{cancelAnimationFrame(raf.current);raf.current=0;if(pending.current){useHairstyle.getState().set(pending.current);pending.current=null;}};
 const queue=(value:Partial<typeof session>)=>{pending.current=value;if(!raf.current)raf.current=requestAnimationFrame(flush);};
 useEffect(()=>()=>{cancelAnimationFrame(raf.current);pending.current=null;},[]);
 useEffect(()=>{const el=host.current!,wheel=(e:WheelEvent)=>{e.preventDefault();const s=useHairstyle.getState();s.set({zoom:clampHairZoom(s.zoom*Math.exp(-e.deltaY*.0015))});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 const current=()=>useEditor.getState().project.hairstyle??h,begin=()=>useEditor.getState().beginEdit(true),end=()=>useEditor.getState().endEdit();
 const edit={onEditStart:begin,onEditEnd:end,onUndo:()=>useEditor.getState().undo(),onRedo:()=>useEditor.getState().redo()};
 const error=(e:unknown)=>setHint(e instanceof Error?e.message:String(e));
 const startControl=(id:string,control:HairControl)=>{const source=current();if(!hairControlEditable(source,id,control)){setHint(t('此端点连接着已锁定的发丝。','This endpoint is shared with a locked strand.'));return false;}controlDrag.current={source,view:{...view},id,control,begun:false};setHint('');return true;};
 const moveControl=(target:Point2)=>{const a=controlDrag.current;if(!a)return;try{const next=dragHairControl(a.source,a.id,a.view,a.control,target);if(!a.begun){if(next===a.source)return;begin();a.begun=true;}useEditor.getState().setHairstyle(next);setHint('');}catch(e){error(e);}};
 const finishControl=(cancel=false)=>{const a=controlDrag.current;if(!a)return;controlDrag.current=null;if(a.begun){if(cancel)useEditor.getState().setHairstyle(a.source);end();}};
 const run=(fn:()=>DrawingDocument)=>{try{commitHairstyle(editHairDrawing(current(),fn()));setHint('');}catch(e){error(e);}};
 const choose=(s:DrawingSelection)=>{hairDrawingSession.getState().set({selection:s});setProperties(true);if(!s.reference)setMoving(false);};
 const pick=(id:string,shift:boolean)=>{const c=d.curves.find(c=>c.id===id);if(!c){choose({ids:[],paint:id});return;}choose({ids:shift?selection.ids.includes(id)?selection.ids.filter(x=>x!==id):[...selection.ids,id]:[id]});ds.set({layerId:layerFor(d,id)?.id??active});};
 const change=(fn:(h:Hairstyle)=>Hairstyle)=>{useEditor.getState().setHairstyle(syncStrands(fn(current())));};
 const ruleChange=(id:string,patch:Partial<HairStrandRule>)=>change(h=>({...h,strandSet:{...h.strandSet!,curves:h.strandSet!.curves.map(c=>c.id===id?{...c,...patch}:c)}}));
 const pointChange=(id:string,patch:Partial<HairEndpoint>)=>change(h=>({...h,strandSet:{...h.strandSet!,endpoints:h.strandSet!.endpoints.map(e=>e.id===id?{...e,...patch}:e)}}));
 const reference=(r:ReferenceImage|undefined)=>{const h=current();useEditor.getState().setHairstyle({...h,drawing:{...h.drawing,reference:r}});};
 const deleteSelected=()=>{run(()=>selectedLayers(selection).length?deleteLayers(d,selectedLayers(selection)):deleteObjects(d,selectedObjects(selection)));choose({ids:[]});setFirst(null);};
 const cutSelected=()=>{try{const h=current(),result=cutDrawing(h.drawing,selectedObjects(selection));if(!result)return;setClipboard({cut:result.clipboard,source:h});commitHairstyle(editHairDrawing(h,result.document));choose({ids:[]});}catch(e){error(e);}};
 const pasteSelected=()=>{if(!clipboard||!active)return;try{const h=current(),doc=pasteDrawingCut(h.drawing,clipboard.cut,active),incoming=new Set(clipboard.cut.curves.map(c=>c.id)),set=h.strandSet!,source=clipboard.source.strandSet!,nodes=new Map([...source.endpoints,...set.endpoints].map(e=>[e.id,e]));const base={...h,strandSet:{...set,endpoints:[...nodes.values()],curves:[...set.curves.filter(c=>!incoming.has(c.id)),...source.curves.filter(c=>incoming.has(c.id))]}};commitHairstyle(editHairDrawing(base,doc));choose({ids:[...incoming]});}catch(e){error(e);}};
 const operations=useRef({deleteSelected,cutSelected,pasteSelected});operations.current={deleteSelected,cutSelected,pasteSelected};
 useEffect(()=>{
  const typing=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable=true],[data-ui-keyboard]');
  const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||typing(e.target))return;if(e.key==='Escape'){setFirst(null);setTool('select');setMoving(false);}
   if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&['z','v','a'].includes(e.key.toLowerCase())&&!controlDrag.current&&!drag.current){e.preventDefault();e.stopPropagation();setTool(e.key.toLowerCase()==='z'?'zoom':'select');setFirst(null);setMoving(false);return;}
   const fn=(e.ctrlKey||e.metaKey)?e.key.toLowerCase()==='x'?operations.current.cutSelected:e.key.toLowerCase()==='v'?operations.current.pasteSelected:null:['Delete','Backspace'].includes(e.key)?operations.current.deleteSelected:null;if(fn){e.preventDefault();e.stopPropagation();fn();}};
  // Native Edit-menu commands can dispatch cut/paste without a keyboard event.
  const cut=(e:ClipboardEvent)=>{if(e.defaultPrevented||typing(e.target)||typing(document.activeElement))return;e.preventDefault();operations.current.cutSelected();};
  const paste=(e:ClipboardEvent)=>{if(e.defaultPrevented||typing(e.target)||typing(document.activeElement))return;e.preventDefault();operations.current.pasteSelected();};
  window.addEventListener('keydown',key,true);window.addEventListener('cut',cut);window.addEventListener('paste',paste);
  return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('cut',cut);window.removeEventListener('paste',paste);};
 },[]);
 const endpoint=(p:Endpoint)=>{if(tool==='select'){choose({ids:[p.curveId],node:d.curves.find(c=>c.id===p.curveId)!.nodes[p.end]});return;}if(!first){setFirst(p);return;}if(first.curveId===p.curveId&&first.end===p.end){setFirst(null);return;}try{if(first.curveId===p.curveId)throw Error(t('请选择另一根发丝的端点。','Choose an endpoint on another strand.'));const next=connect(current().drawing,first,p,tool==='cusp'?'CUSP':'POSITION');commitHairstyle(editHairDrawing(current(),next));choose({ids:[first.curveId,p.curveId]});setFirst(null);setHint(t('端点已连接；可继续选择下一对。','Connected; pick the next pair.'));}catch(e){error(e);setFirst(null);}};
 const preset=(yaw:number,pitch=0)=>{flush();session.set({view:{yaw,pitch}});};
 return <main className="hairstyle-room drawing-room" data-testid="hairstyle-room">
  <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{const r=await readPhoto(f,RECORDING_REFERENCE_IMAGE);const h=current();commitHairstyle({...h,drawing:{...h.drawing,reference:r}});choose({ids:[],reference:true});setMoving(true);}catch(e){error(e);}}}/>
  <header className="hair-header"><div><button onClick={()=>session.set({workspaceMode:'studio'})}>{t('绘制与烘焙','Draw & Bake')}</button><button aria-label={t('返回建模间','Back to modeling')} onClick={()=>session.set({room:false})}><ArrowLeft size={18}/></button><strong>{t('发型生成间','Hairstyle Room')}</strong><span>{t('独立发丝 · 曲面构造','Independent strands · Surface construction')}</span></div><div className="hair-presets">{[[0,'正面','Front'],[45,'45°','45°'],[90,'侧面','Side'],[180,'背面','Back']].map(([yaw,cn,en])=><button key={yaw} aria-pressed={view.yaw===yaw&&view.pitch===0} onClick={()=>preset(+yaw)}>{t(String(cn),String(en))}</button>)}<button onClick={()=>preset(view.yaw,45)}>{t('俯视','Above')}</button><button title={t('视图居中','Fit view')} onClick={()=>session.set({zoom:1,pan:[0,0]})}><Focus size={17}/></button></div></header>
  <div className="hair-angle-mode"><span>{t('任意视角编辑二维曲线 → 发网提供深度 → 转头查看变形','Edit 2D in any view → project onto the net → orbit to inspect')}</span></div>
  <div className="hair-workbench">
   <section className="hair-construction"><header><strong>{t('3D · 发网构造','3D · Hair shell')}</strong><label><input type="checkbox" checked={guides} onChange={e=>session.set({guides:e.target.checked})}/>{t('发网','Net')}</label></header>
    <div ref={host} className={"hair-orbit"+(tool==='zoom'?' zoom-tool'+(zoomTool.out?' zoom-out':''):'')} {...zoomTool.handlers} data-testid="hair-orbit" data-hair-orbit tabIndex={0} aria-label={t('发网视图：拖动旋转，右键平移，滚轮缩放','Hair net: drag to orbit, right-drag to pan, scroll to zoom')}
     onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(e.button>2)return;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,view,pan,move:e.button!==0||e.shiftKey};}}
     onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(d.move)queue({pan:[d.pan[0]+dx,d.pan[1]+dy]});else queue({view:{yaw:((d.view.yaw-dx*.35+540)%360)-180,pitch:Math.max(-89,Math.min(89,d.view.pitch+dy*.3))}});}}
     onPointerUp={e=>{flush();drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{flush();drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
     onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();e.stopPropagation();const d=e.shiftKey?10:2;preset(view.yaw+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0),Math.max(-89,Math.min(89,view.pitch+(e.key==='ArrowUp'?d:e.key==='ArrowDown'?-d:0))));}}>
     <HairScene geometry={geometry} view={view} width={size.width} height={size.height} unit={unit} pan={pan} guides={guides} selected={selection.ids}/>
     <button className="hair-front-view" title={t('Yaw 0° · 俯仰 0°','Yaw 0° · Pitch 0°')} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();preset(0,0);}}>{t('回到正脸','Front view')}</button>
     <div className="hair-orientation">Yaw {view.yaw.toFixed(1)}° · {t('俯仰','Pitch')} {view.pitch.toFixed(1)}°</div><div className="hair-navigation-hint">{tool==='zoom'?t('Z 缩放：上拖放大，下拖缩小 · V/A 返回选择','Z zoom: drag up / down · V/A to select'):t('拖动旋转 · 右键 / Shift 平移 · Z / 滚轮缩放','Drag to orbit · Right / Shift pan · Z / Scroll zoom')}</div>
    </div>
    <div className="hair-controls"><HairProfileEditor net={h.net} change={profile=>change(h=>({...h,net:{...h.net,profile}}))} begin={begin} end={end} undo={()=>useEditor.getState().undo()} redo={()=>useEditor.getState().redo()}/><details><summary>{t('发网尺寸','Hair net size')}</summary>{(['radiusX','radiusY','radiusZ'] as const).map((key,i)=><NumericSlider key={key} label={['X','Y','Z'][i]} value={h.net[key]} min={.5} max={2} step={.01} snapTargets={[1]} {...edit} onChange={value=>change(h=>({...h,net:{...h.net,[key]:value}}))}/>)}</details><p>{t('改壳形会带动全部发丝；发根、发梢保持贴壳。转视角不改变构造和随机结果。','Shape edits move all strands; roots and tips stay on the shell. Camera changes preserve construction and randomness.')}</p></div>
   </section>
   <section className="hair-drawing"><header><strong>{t('Contour · 发型轮廓','Contour · Hair')}</strong><button onClick={()=>{const state=saveDrawingSnapshot({drawing,drawingSnapshots:h.drawingSnapshots},`发型 · ${view.yaw.toFixed(1)}° / ${view.pitch.toFixed(1)}°`);commitHairstyle({...h,drawingSnapshots:state.drawingSnapshots});setHint(t('已保存到发型独立快照。','Saved to the private hair snapshots.'));}}>{t('保存当前视角快照','Save view snapshot')}</button></header>
    <div className="hair-tools">{(['select','bind','cusp','zoom'] as const).map((value,i)=><button key={value} aria-pressed={tool===value&&!moving} onClick={()=>{setTool(value);setFirst(null);setMoving(false);}}>{t(['选择发丝','绑定端点','尖点接笔','缩放 Z'][i],['Select strand','Bind endpoints','Cusp join','Zoom Z'][i])}</button>)}<button onClick={()=>{try{const next=addStrand(current(),active,rule?.id);commitHairstyle(next);const id=next.strandSet!.curves.at(-1)!.id;choose({ids:[id]});ds.set({layerId:layerFor(next.drawing,id)?.id??active});}catch(e){error(e);}}}>{t('＋ 添加发丝','＋ Add strand')}</button><button onClick={()=>file.current?.click()}>{t('参考图','Reference')}</button><div className="hair-net-controls"><label><input type="checkbox" checked={netOverlay} onChange={e=>session.set({netOverlay:e.target.checked})}/>{t('叠加发网','Net overlay')}</label><input type="range" aria-label={t('发网叠加不透明度','Net overlay opacity')} title={t('不透明度','Opacity')} min="0" max="100" step="1" value={Math.round(netOpacity*100)} disabled={!netOverlay} onChange={e=>session.set({netOpacity:Number(e.target.value)/100})}/><output>{Math.round(netOpacity*100)}%</output></div></div>
    <HairNetPlacement net={h.net} onChange={(axis,value)=>change(h=>({...h,net:{...h.net,center:[axis===0?value:h.net.center[0],axis===1?value:h.net.center[1],h.net.center[2]]}}))} begin={begin} end={end} undo={()=>useEditor.getState().undo()} redo={()=>useEditor.getState().redo()}/>
    <HairContour geometry={geometry} netOverlay={netOverlay} netOpacity={netOpacity} drawing={drawing} view={view} zoom={zoom} orbitBaseUnit={unit/zoom} pan={[pan[0]/unit,pan[1]/unit]} selection={selection} choose={pick} tool={tool} active={active} endpoint={endpoint} first={first} moving={moving} changeReference={reference} begin={begin} end={end} showFills={ds.showFills} fillVisibility={ds.fillVisibility} startControl={startControl} moveControl={moveControl} finishControl={finishControl}/>
    <div className="hair-footer" role="status">{hint||(invalidProjection.length?t('未完全贴合发网：','Not fully projected onto the net: ')+invalidProjection.join('、'):t('每根发丝一段 Bézier · 参数与参考图仅保存在发型文档','One Bézier per strand · Parameters and reference belong to the hair document'))}<span className="hair-zoom-value" aria-label={t('视图缩放','View zoom')}>{Math.round(zoom*100)}%</span><span>{h.drawingSnapshots?.items.length??0} {t('快照','snapshots')}</span></div>
   </section>
   <aside className="hair-sidebar drawing-sidebar">
    <LayerPanel document={d} active={active} selection={selection} run={run} choose={choose} setLayer={id=>ds.set({layerId:id})} upload={()=>file.current?.click()} openProperties={()=>setProperties(true)} closeProperties={()=>setProperties(false)} deleteSelected={deleteSelected} cutSelected={cutSelected} pasteSelected={pasteSelected} canPaste={!!clipboard&&!!active}/>
    <section className={'hair-properties'+(properties?' open':'')}><button className="hair-properties-title" aria-expanded={properties} onClick={()=>setProperties(!properties)}>{properties?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{t('属性','Properties')}</strong><span>{selection.reference?t('参考图','Reference'):curve?.name??t('选择发丝','Select strand')}</span></button>
     {properties&&<div className="hair-properties-content">
      {selection.reference?<HairReference reference={d.reference} change={reference} upload={()=>file.current?.click()} moving={moving} setMoving={setMoving} begin={begin} end={end}/>:rule&&curve?<>
       <input key={curve.id+curve.name} aria-label={t('发丝名称','Strand name')} defaultValue={curve.name} onBlur={e=>{if(e.target.value.trim()&&e.target.value!==curve.name)run(()=>curveChange(d,curve.id,{name:e.target.value.trim()}));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
       <p>{t('像普通二维曲线一样拖动端点和两个 handle。发网自动提供深度，转动视角只改变观察方向。','Drag endpoints and both handles as a normal 2D curve. The net supplies depth; orbiting only changes the view.')}</p>
       {rule.nodes.map((id,i)=>{const p=h.strandSet!.endpoints.find(p=>p.id===id)!,shared=h.strandSet!.curves.filter(c=>c.nodes.includes(id)).length,pointLocked=d.curves.some(c=>c.locked&&c.nodes.includes(id));return <details open key={i}><summary>{i?t('发梢位置','Tip position'):t('发根位置','Root position')}{shared>1&&<span> · {shared} {t('根共用','linked')}</span>}</summary>{(['x','y'] as const).map((axis)=><HairRangeControl key={axis} label={(i?t('发梢','Tip'):t('发根','Root'))+' '+axis.toUpperCase()} value={p[axis]} sample={p.sample[axis==='x'?0:1]} min={-.99} max={.99} spread={.5} onChange={v=>pointChange(id,{[axis]:v})} begin={begin} end={end} disabled={pointLocked}/>)}{(tool==='bind'||tool==='cusp')&&<button disabled={curve.locked} onClick={()=>endpoint({curveId:rule.id,end:i as 0|1})}>{i?t('选择发梢端点','Pick tip endpoint'):t('选择发根端点','Pick root endpoint')}</button>}{shared>1&&<button disabled={curve.locked} onClick={()=>run(()=>unbind(d,{curveId:rule.id,end:i as 0|1}))}>{t('解除此端点绑定','Unbind this endpoint')}</button>}</details>;})}
       <details open><summary>{t('显示区间','Display interval')}</summary>{(['start','end'] as const).map((key,i)=><HairRangeControl key={key} label={t('显示区间 ','Display interval ')+['A','B'][i]} value={rule[key]} sample={rule.sample[i]} min={0} max={1} spread={1} percent onChange={v=>ruleChange(rule.id,{[key]:v})} begin={begin} end={end} disabled={curve.locked}/>)}<p>{t('A、B 从发根到发梢计量；随机后超出 0–100% 的部分自动限幅。','A and B follow root to tip; random results are clamped to 0–100%.')}</p></details>
      </>:<p>{t('展开笔画，选择单根发丝调整曲线、发根、发梢与显示区间。','Expand a stroke and select a strand to edit its shape, root, tip and display interval.')}</p>}
      {!selection.reference&&<div className="hair-actions"><button disabled={!selection.ids.length} onClick={()=>commitHairstyle(rerollStrands(current(),selection.ids))}>{t('随机所选','Reroll selected')}</button><button disabled={!h.strandSet!.curves.length} onClick={()=>commitHairstyle(rerollStrands(current()))}>{t('随机全部','Reroll all')}</button></div>}
      {!d.reference&&<button onClick={()=>file.current?.click()}>{t('插入背景参考图','Insert reference image')}</button>}
      {useEditor.getState().project.drawing?.reference&&<button onClick={()=>{const source=useEditor.getState().project.drawing?.reference;if(!source)return;const h=current();commitHairstyle({...h,drawing:{...h.drawing,reference:structuredClone(source)}});choose({ids:[],reference:true});}}>{t('从绘制间复制参考图','Copy reference from Drawing')}</button>}
     </div>}
    </section>
   </aside>
  </div>
 </main>;
}
