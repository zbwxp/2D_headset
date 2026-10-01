import {useId,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,Pin,PinOff} from 'lucide-react';
import {usePanelOpen} from './panelPreferences';
import {uiText as t} from '../i18n';
import './autoHideBar.css';

/** Overlay expansion keeps the canvas rectangle stable during hover and drawing. */
export default function AutoHideBar({label,children,className='',disabled=false,pinId}:{label:string;children:ReactNode;className?:string;disabled?:boolean;pinId?:string}){
 const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),pointer=useRef('');
 const [savedPin,setPinned]=usePanelOpen(pinId??'unused.autohide-pin',false),pinned=!!pinId&&savedPin,expanded=pinned||open;
 if(disabled)return <>{children}</>;
 return <div ref={root} className={`auto-hide-bar ${className}`} data-open={expanded} data-pinned={pinned}
  onPointerEnter={e=>{if(e.pointerType==='mouse'&&e.buttons===0)setOpen(true);}}
  onPointerLeave={()=>{
   // Do not interrupt text editing, native select menus or modal dialogs.
   if(root.current?.querySelector('dialog[open],input:focus,select:focus,textarea:focus'))return;
   setOpen(false);
  }}
  onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}
  onFocus={e=>{if(!e.target.classList.contains('auto-hide-trigger')&&e.target.matches(':focus-visible'))setOpen(true);}}
  onKeyDown={e=>{if(e.key==='Escape'&&!root.current?.querySelector('dialog[open]')){e.stopPropagation();root.current?.querySelector<HTMLButtonElement>('.auto-hide-trigger')?.focus();setOpen(false);}}}>
  <button className="auto-hide-trigger" aria-label={t(label)} aria-expanded={expanded} aria-controls={id}
   title={t('移入展开，移开收起；点击也可开关')} onPointerDown={e=>{pointer.current=e.pointerType;}} onClick={e=>setOpen(v=>e.detail>0&&pointer.current==='mouse'?true:!v)}>
   <span>{t(label)}</span>{expanded?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
  </button>
  {pinId&&<button className="auto-hide-pin" data-testid="drawing-context-pin" aria-label={t(pinned?'取消固定工具栏':'固定工具栏')} aria-pressed={pinned} title={t(pinned?'取消固定，恢复移入展开':'固定在顶部，不自动收起')} onClick={()=>{setPinned(!pinned);setOpen(false);}}>{pinned?<PinOff size={13}/>:<Pin size={13}/>}</button>}
  <div id={id} className="auto-hide-content" hidden={!expanded}>{children}</div>
 </div>;
}
