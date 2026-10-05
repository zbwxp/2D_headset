import type {ReactNode} from 'react';
import {uiText as t} from '../i18n';

/** Shared layer-above-properties layout; ownership and editing stay with the host. */
export default function DrawingSidebar({layers,children,open,height,onHeight,className=''}:{layers:ReactNode;children:ReactNode;open:boolean;height:number;onHeight:(value:number)=>void;className?:string}){
 return <aside className={`drawing-sidebar drawing-split-sidebar ${className}`} data-properties-open={open} style={{gridTemplateRows:open?`minmax(100px,${height}fr) 6px minmax(80px,${100-height}fr)`:'minmax(0,1fr) 0px 32px'}}>
  <div className="drawing-sidebar-layers" data-testid="drawing-sidebar-layers" style={{gridRow:1}}>{layers}</div>
  <div hidden={!open} role="separator" aria-label={t('调整图层与属性高度')} className="drawing-sidebar-split" style={{gridRow:2}} onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const bounds=event.currentTarget.parentElement!.getBoundingClientRect();if(bounds.height>0)onHeight(Math.max(20,Math.min(85,(event.clientY-bounds.top)/bounds.height*100)));}} onPointerUp={event=>event.currentTarget.releasePointerCapture(event.pointerId)}/>
  <div className="drawing-sidebar-properties" data-testid="drawing-sidebar-properties" style={{gridRow:3}}>{children}</div>
 </aside>;
}
