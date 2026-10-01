import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {TOOLS,CONNECTION_TOOLS,type ConnectionTool} from './tools';
import type {DrawingTool} from './session';
import {uiText as t} from '../i18n';
import PenSettings from './PenSettings';
import DirectSettings from './DirectSettings';
const grouped=(tool:string):tool is ConnectionTool=>(CONNECTION_TOOLS as readonly string[]).includes(tool);
export default function ToolBar({tool,select}:{tool:DrawingTool;select:(tool:DrawingTool)=>void}){
 const [settings,setSettings]=useState<'pen'|'direct'|null>(null);
 const [remembered,setRemembered]=useState<ConnectionTool>('bind'),[menu,setMenu]=useState<{left:number;top:number}|null>(null),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),longOpened=useRef(false),held=useRef(false);
 const current=grouped(tool)?tool:remembered,definition=TOOLS.find(x=>x[0]===current)!,Icon=definition[4];
 const cancelTimer=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
 function open(keyboard=false){cancelTimer();const r=button.current!.getBoundingClientRect();setMenu({left:Math.min(r.right+6,window.innerWidth-340),top:Math.max(8,Math.min(r.top,window.innerHeight-275))});if(keyboard)requestAnimationFrame(()=>panel.current?.querySelector<HTMLElement>('[role=menuitemradio]')?.focus());}
 function choose(value:ConnectionTool){setRemembered(value);setMenu(null);held.current=false;select(value);button.current?.focus({preventScroll:true});}
 useEffect(()=>{if(grouped(tool))setRemembered(tool);},[tool]);
 useEffect(()=>()=>cancelTimer(),[]);
 useEffect(()=>{const release=()=>cancelTimer();window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('blur',release);return()=>{window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('blur',release);};},[]);
 useEffect(()=>{if(!menu)return;const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setMenu(null);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setMenu(null);button.current?.focus();}};const close=()=>setMenu(null);window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);window.addEventListener('resize',close);window.addEventListener('blur',close);return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('blur',close);};},[menu]);
 return <><nav className="drawing-tools" aria-label={t('绘图工具')}>{TOOLS.map(([value,label,key,help,ToolIcon])=>{
  if(grouped(value)){if(value!=='link')return null;return <button key="connections" ref={button} data-testid={`drawing-tool-${current}`} data-tool-group="connections" aria-label={t(definition[1])} aria-haspopup="menu" aria-expanded={!!menu} title={`${t(definition[1])} — ${t('右键或长按切换连接工具')}`} aria-pressed={grouped(tool)} className={`drawing-tool-group drawing-tool-break ${grouped(tool)?'active':''}`}
   onContextMenu={e=>{e.preventDefault();e.stopPropagation();held.current=false;open();}}
   onPointerDown={e=>{if(e.button!==0)return;longOpened.current=false;held.current=false;cancelTimer();timer.current=setTimeout(()=>{longOpened.current=true;held.current=true;open();},450);}}
   onPointerLeave={()=>{if(!menu)cancelTimer();}} onPointerUp={cancelTimer} onPointerCancel={cancelTimer}
   onClick={()=>{if(longOpened.current){longOpened.current=false;return;}setMenu(null);select(current);}}
   onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();open(true);}}}>
   <Icon size={19}/><span>{t(definition[1])}</span><i className="drawing-tool-corner" aria-hidden="true"/>
  </button>;}
  const configurable=value==='pen'||value==='direct';
  return <button key={value} data-testid={`drawing-tool-${value}`} aria-label={t(label)} title={`${t(label)}${key?' ('+key+')':''} — ${t(help)}${value==='pen'?' · '+t('双击或右键设置默认收尖'):value==='direct'?' · '+t('双击或右键设置方向跟随'):''}`} aria-pressed={tool===value} aria-haspopup={configurable?'dialog':undefined} className={`${tool===value?'active':''} ${['pen','split','hand'].includes(value)?'drawing-tool-break':''}`}
   onDoubleClick={configurable?()=>{setMenu(null);setSettings(value);}:undefined}
   onContextMenu={configurable?e=>{e.preventDefault();setMenu(null);setSettings(value);}:undefined}
   onKeyDown={configurable?e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setMenu(null);setSettings(value);}}:undefined}
   onClick={()=>{setMenu(null);if(value!=='pen'||tool!=='pen')select(value);}}><ToolIcon size={19}/><span>{t(label)}</span>{key&&<kbd>{key}</kbd>}</button>;
 })}</nav>
 {menu&&createPortal(<div ref={panel} className="drawing-tool-menu" data-testid="drawing-connection-menu" role="menu" aria-label={t('连接工具')} style={{left:menu.left,top:menu.top}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=[...panel.current!.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')],i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}}}>
 {TOOLS.filter(x=>grouped(x[0])).map(([value,label,,help,ToolIcon])=><button key={value} role="menuitemradio" aria-checked={current===value} data-testid={`drawing-tool-choice-${value}`} onPointerUp={e=>{if(e.button===0&&held.current)choose(value as ConnectionTool);}} onClick={()=>choose(value as ConnectionTool)}><ToolIcon size={19}/><span><strong>{t(label)}</strong><small>{t(help)}</small></span></button>)}
 </div>,document.body)}
 {settings==='pen'&&<PenSettings close={()=>setSettings(null)}/>}
 {settings==='direct'&&<DirectSettings close={()=>setSettings(null)}/>}
 </>;
}
