import {useId,type ReactNode} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {uiText as t} from '../i18n';

export default function DrawingPropertiesPanel({open,setOpen,children,context,className='',testId}:{open:boolean;setOpen:(value:boolean)=>void;children:ReactNode;context?:string;className?:string;testId?:string}){
 const bodyId=useId();
 return <section className={`drawing-properties ${className}`} data-testid={testId} aria-label={t('绘图属性')}>
  <header><button className="drawing-properties-toggle" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(!open)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{t('属性')}</strong>{context&&<span>{context}</span>}</button></header>
  <div id={bodyId} className="drawing-properties-content" hidden={!open}>{children}</div>
 </section>;
}
