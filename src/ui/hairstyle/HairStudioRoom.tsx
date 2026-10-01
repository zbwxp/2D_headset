import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,Focus} from 'lucide-react';
import {useEditor} from '../../app/store';
import {defaultHairstyle,type Hairstyle,type HairNet} from '../../domain/hairstyle/model';
import {createHairStudio,importHairStudio,hairBakeSource,type HairBake} from '../../domain/hairstyle/studio';
import {snapshotDrawing} from '../../domain/drawing/snapshots';
import {generateHair} from '../../domain/hairstyle/geometry';
import type {HairView} from '../../domain/hairstyle/projection';
import DrawingRoom,{type DrawingUnderlay,type DrawingArtworkPreview} from '../drawing/DrawingRoom';
import {HairStudioProvider,hairStudioSession} from '../drawing/workspace';
import NumericSlider from '../shared/NumericSlider';
import HairProfileEditor from './HairProfileEditor';
import HairNetPlacement from './HairNetPlacement';
import HairNetOverlay from './HairNetOverlay';
import HairScene from './HairScene';
import BakedHairScene from './BakedHairScene';
import {prepareHairBake} from './hairBakePreview';
import {useHairstyle} from './session';
import {useLanguage} from '../i18n';
import './hairStudio.css';
const SourceEditor=memo(DrawingRoom);
const FRONT:HairView={yaw:0,pitch:0};
function commit(h:Hairstyle){const e=useEditor.getState();e.beginEdit();try{e.setHairstyle(h);}finally{e.endEdit();}}
function useSize(){const ref=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:400,height:400});useEffect(()=>{if(!ref.current)return;const obs=new ResizeObserver(([e])=>e.contentRect.width>0&&e.contentRect.height>0&&setSize({width:e.contentRect.width,height:e.contentRect.height}));obs.observe(ref.current);return()=>obs.disconnect();},[]);return {ref,size};}
export default function HairStudioRoom(){return <HairStudioProvider><Studio/></HairStudioProvider>;}
function Studio(){
 const stored=useEditor(s=>s.project.hairstyle),fallback=useMemo(()=>defaultHairstyle(),[]),h=stored??fallback,sourceSnapshots=useEditor(s=>s.project.drawingSnapshots);
 const ds=hairStudioSession(),hs=useHairstyle(),{view,guides,netOverlay,netOpacity}=hs;
 const zh=useLanguage(s=>s.language)==='zh',t=(cn:string,en:string)=>zh?cn:en;
 const [preview,setPreview]=useState(false),[construction,setConstruction]=useState(true),[importing,setImporting]=useState(false),[source,setSource]=useState(''),[busy,setBusy]=useState(false),[hint,setHint]=useState('');
 const [zoom,setZoom]=useState(1),[pan,setPan]=useState<[number,number]>([0,0]);
 const {ref,size}=useSize();
 const drag=useRef<{id:number;x:number;y:number;view:HairView;pan:[number,number];zoom:number;kind:'rotate'|'pan'}|null>(null),pending=useRef<HairView|null>(null),raf=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;cancelAnimationFrame(raf.current);};},[]);
 useEffect(()=>{if(!h.studio)useEditor.getState().setHairstyle({...h,studio:createHairStudio(h.drawing)});},[h]);
 const current=()=>useEditor.getState().project.hairstyle??h;
 const begin=()=>useEditor.getState().beginEdit(true),end=()=>useEditor.getState().endEdit(),undo=()=>useEditor.getState().undo(),redo=()=>useEditor.getState().redo();
 const changeNet=(net:HairNet)=>{setPreview(false);useEditor.getState().setHairstyle({...current(),net});};
 const geometry=useMemo(()=>({...generateHair({...h,strandSet:{version:1,endpoints:[],curves:[]}}),strands:[]}),[h.net]);
 const baked=h.studio?.baked;
 const bakedGeometry=useMemo(()=>baked?{...generateHair({...h,net:baked.net,strandSet:{version:1,endpoints:[],curves:[]}}),strands:[]}:undefined,[baked]);
 const shownGeometry=preview&&bakedGeometry?bakedGeometry:geometry;
 const underlay=useCallback(({width,height,unit,pan}:DrawingUnderlay)=><HairNetOverlay {...shownGeometry} view={preview?view:FRONT} width={width} height={height} unit={unit} panX={pan[0]/unit} panY={pan[1]/unit} opacity={netOpacity}/>,[shownGeometry,preview,view,netOpacity]);
 const editSource=useCallback(()=>{setPreview(false);setHint('');useHairstyle.getState().set({view:FRONT});},[]);
 const artworkPreview=useMemo<DrawingArtworkPreview|undefined>(()=>preview&&baked?{
  render:({width,height,unit,pan})=><foreignObject width={width} height={height} pointerEvents="none" data-testid="hair-baked-canvas"><div style={{position:'relative',width:'100%',height:'100%'}}><BakedHairScene bake={baked} view={view} width={width} height={height} unit={unit} pan={pan}/></div></foreignObject>,
  hint:zh?`烘焙贴壳 · Yaw ${view.yaw.toFixed(1)}° / Pitch ${view.pitch.toFixed(1)}° · 左侧转动发网，背景可平移缩放`:`Baked on net · Yaw ${view.yaw.toFixed(1)}° / Pitch ${view.pitch.toFixed(1)}° · Orbit on the left; move/scale the reference`,
  edit:editSource,
 }:undefined,[preview,baked,view,zh,editSource]);
 useEffect(()=>{if(!baked)setPreview(false);},[baked]);
 const dirty=useMemo(()=>!!baked&&(JSON.stringify(h.net)!==JSON.stringify(baked.net)||JSON.stringify(hairBakeSource(h.studio!.drawing,ds.showFills,ds.fillVisibility))!==JSON.stringify(baked.drawing)),[baked,h.net,h.studio?.drawing,ds.showFills,ds.fillVisibility]);
 const flush=()=>{cancelAnimationFrame(raf.current);raf.current=0;if(pending.current){useHairstyle.getState().set({view:pending.current});pending.current=null;}};
 const queue=(v:HairView)=>{pending.current=v;if(!raf.current)raf.current=requestAnimationFrame(flush);};
 const preset=(yaw:number,pitch=0)=>{pending.current=null;cancelAnimationFrame(raf.current);raf.current=0;hs.set({view:{yaw,pitch}});};
 const events={
  onContextMenu:(e:React.MouseEvent)=>e.preventDefault(),
  onPointerDown:(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button>2||(e.target as HTMLElement).closest('button'))return;e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,view,pan,zoom,kind:e.button!==0||e.shiftKey?'pan':'rotate'};},
  onPointerMove:(e:React.PointerEvent<HTMLDivElement>)=>{const a=drag.current;if(!a||a.id!==e.pointerId)return;const dx=e.clientX-a.x,dy=e.clientY-a.y;if(a.kind==='pan')setPan([a.pan[0]+dx,a.pan[1]+dy]);else queue({yaw:((a.view.yaw+dx*.35+540)%360)-180,pitch:Math.max(-90,Math.min(90,a.view.pitch+dy*.35))});},
  onPointerUp:()=>{drag.current=null;flush();},onPointerCancel:()=>{drag.current=null;flush();},onLostPointerCapture:()=>{drag.current=null;flush();},
  onWheel:(e:React.WheelEvent)=>setZoom(z=>Math.max(.25,Math.min(10,z*Math.exp(-e.deltaY*.001))))
 };
 const load=()=>{try{const p=useEditor.getState().project,d=source==='current'?p.drawing:p.drawingSnapshots&&snapshotDrawing(p.drawingSnapshots,source);if(!d)throw Error(t('请选择绘制间快照。','Choose a Drawing snapshot.'));commit(importHairStudio(current(),d));hairStudioSession.getState().set({selection:{ids:[]},layerId:d.layers[0]?.id??null,showFills:true,fillVisibility:{},zoom:1,pan:[0,0],preview:false,tool:'select'});setImporting(false);setPreview(false);setHint(t('已载入独立副本。请只显示面发，再对齐发网并烘焙。','Independent copy loaded. Show only the front hair, align the net, then bake.'));}catch(e){setHint(e instanceof Error?e.message:String(e));}};
 const bake=async()=>{
  if(busy)return;const start=current(),studio=start.studio;if(!studio)return;setBusy(true);setHint('');
  const state=hairStudioSession.getState(),result:HairBake={version:1,net:structuredClone(start.net),drawing:hairBakeSource(studio.drawing,state.showFills,state.fillVisibility)};
  try{await prepareHairBake(result);if(!alive.current)return;const now=current();if(now.studio?.drawing!==studio.drawing||now.net!==start.net)throw Error(t('烘焙期间内容已修改，请重新烘焙。','The source changed during baking. Please bake again.'));commit({...now,studio:{...now.studio!,baked:result}});setPreview(true);hairStudioSession.getState().set({selection:{ids:[]},tool:'select'});preset(0);setZoom(1);setPan([0,0]);setHint(t('烘焙完成，已显示在原画布和发网上。左侧转动发网，画布上方可平移参考图。','Baked onto the net in the same canvas. Orbit on the left; use Move reference above the canvas to compare.'));}catch(e){if(alive.current)setHint(e instanceof Error?e.message:String(e));}finally{if(alive.current)setBusy(false);}
 };
 const netControls=(['radiusX','radiusY','radiusZ'] as const).map((key,i)=><NumericSlider key={key} label={t(['发网宽度 X','发网高度 Y','发网深度 Z'][i],['Net width X','Net height Y','Net depth Z'][i])} value={h.net[key]} min={.5} max={2} step={.01} onChange={v=>changeNet({...current().net,[key]:v})} onEditStart={begin} onEditEnd={end} onUndo={undo} onRedo={redo}/>);
 return <main className="hair-studio" data-testid="hair-studio">
  <header className="hair-studio-toolbar">
   <button aria-label={t('返回建模间','Back to modeling')} onClick={()=>hs.set({room:false})}><ArrowLeft size={17}/></button><strong>{t('发型 · 绘制与烘焙','Hair · Draw & Bake')}</strong>
   <button disabled={busy} onClick={()=>{setSource(sourceSnapshots?.activeId??sourceSnapshots?.items[0]?.id??'current');setImporting(true);}}>{t('载入绘制间快照','Load Drawing snapshot')}</button>
   <button aria-pressed={!preview} disabled={busy} onClick={editSource}>{t('二维编辑 · 正面','2D editing · Front')}</button>
   <button aria-pressed={preview} disabled={!baked||busy} onClick={()=>{hairStudioSession.getState().set({selection:{ids:[]},tool:'select'});setHint('');setPreview(true);}}>{t('烘焙贴壳','Baked on net')}{dirty?' · *':''}</button>
   <button className="hair-bake-primary" disabled={busy||!h.studio} onClick={bake}>{busy?t('烘焙中…','Baking…'):t('烘焙可见内容到发网','Bake visible artwork')}</button>
   <button className="hair-studio-legacy" disabled={busy} onClick={()=>hs.set({workspaceMode:'strands'})}>{t('参数发丝','Parametric strands')}</button>
  </header>
  <div className="hair-studio-status" role="status">{hint||t('载入正脸快照 → 隐藏其他图层 → 调整发网叠底 → 烘焙。背景图不会被烘焙。','Load a front snapshot → hide other layers → align the net → bake. The reference is excluded.')}{dirty&&<span>{t('源稿或发网已修改，预览保留上次烘焙。','Source or net changed; preview shows the previous bake.')}</span>}</div>
  <div className={'hair-studio-body'+(!construction?' construction-collapsed':'')}>
   <aside className="hair-studio-net">
    <button className="hair-studio-collapse" onClick={()=>setConstruction(!construction)} title={t('发网构造','Net construction')}>{construction?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}<span>{t('3D 发网','3D net')}</span></button>
    <div className="hair-studio-net-content" hidden={!construction}>
     <div className="hair-orbit" ref={ref} tabIndex={0} {...events} data-hair-orbit data-testid="hair-studio-orbit">
      <HairScene geometry={shownGeometry} view={view} width={size.width} height={size.height} unit={Math.min(size.width,size.height)/2.7*zoom} pan={pan} guides={guides}/>
      {preview&&baked&&<BakedHairScene bake={baked} view={view} width={size.width} height={size.height} unit={Math.min(size.width,size.height)/2.7*zoom} pan={pan}/>}
      <div className="hair-orientation">Yaw {view.yaw.toFixed(1)}° · Pitch {view.pitch.toFixed(1)}°</div>
      <button className="hair-front-view" onClick={()=>preset(0)}>{t('回到正脸','Front view')}</button>
     </div>
     <div className="hair-studio-net-controls">
      <div className="hair-presets">{[0,45,90,180].map(a=><button key={a} onClick={()=>preset(a)}>{a}°</button>)}<button title={t('视图居中','Fit view')} onClick={()=>{setZoom(1);setPan([0,0]);}}><Focus size={15}/></button></div>
      <NumericSlider label="Yaw" value={view.yaw} min={-180} max={180} step={1} onChange={v=>preset(v,view.pitch)}/>
      <NumericSlider label={t('俯仰 Pitch','Pitch')} value={view.pitch} min={-90} max={90} step={1} onChange={v=>preset(view.yaw,v)}/>
      <label><input type="checkbox" checked={netOverlay} onChange={e=>hs.set({netOverlay:e.target.checked})}/>{t('二维画布叠加发网','Overlay net on 2D canvas')}</label>
      <details open><summary>{t('发网大小','Net size')}</summary>
       {netControls}
      </details>
      <HairProfileEditor net={h.net} change={profile=>changeNet({...current().net,profile})} begin={begin} end={end} undo={undo} redo={redo}/>
     </div>
    </div>
   </aside>
   <section className="hair-studio-editor" aria-busy={busy}>
    <HairNetPlacement net={h.net} onChange={(axis,value)=>{const net=current().net,center=[...net.center] as HairNet['center'];center[axis]=value;changeNet({...net,center});}} begin={begin} end={end} undo={undo} redo={redo}/>
    {h.studio&&<SourceEditor underlay={netOverlay?underlay:undefined} artworkPreview={artworkPreview}/>}
    {busy&&<div className="hair-bake-busy">{t('正在烘焙可见内容…','Baking visible artwork…')}</div>}
   </section>
  </div>
  {importing&&<div className="hair-import-backdrop" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setImporting(false);}}}><section role="dialog" aria-modal="true" aria-label={t('载入绘制间快照','Load Drawing snapshot')} data-ui-keyboard>
   <h3>{t('载入绘制间快照','Load Drawing snapshot')}</h3><p>{t('替换发型间的二维工作稿。原绘制间不受影响；本次载入可撤销。','Replace the hair working drawing with an independent copy. The original is unchanged; loading can be undone.')}</p>
   <select aria-label={t('来源快照','Source snapshot')} value={source} onChange={e=>setSource(e.target.value)} autoFocus>{sourceSnapshots?.items.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="current">{t('绘制间当前工作稿','Current Drawing document')}</option></select>
   <footer><button onClick={()=>setImporting(false)}>{t('取消','Cancel')}</button><button onClick={load}>{t('载入独立副本','Load independent copy')}</button></footer>
  </section></div>}
 </main>;
}
