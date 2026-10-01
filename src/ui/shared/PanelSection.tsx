import {useId,type ReactNode} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {usePanelOpen} from './panelPreferences';
import {uiText as t} from '../i18n';

export default function PanelSection({id,title,children,className='',initial=true,testId}:{id:string;title:ReactNode;children:ReactNode;className?:string;initial?:boolean;testId?:string}){
 const [open,setOpen]=usePanelOpen(id,initial),bodyId=useId();
 return <section className={`drawing-disclosure ${className}`} data-testid={testId} data-open={open}>
  <button className="drawing-disclosure-toggle" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(!open)}>
   {open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<strong>{typeof title==='string'?t(title):title}</strong>
  </button>
  <div id={bodyId} className="drawing-disclosure-body" hidden={!open}>{children}</div>
 </section>;
}
