import {useEffect,useRef,type HTMLAttributes,type ReactNode} from 'react';
export const PAIR_CLICK_DELAY=400;
interface Props extends Omit<HTMLAttributes<HTMLDivElement>,'children'|'onSelect'> {
 primaryId:string; mirrorId?:string; selectedId:string|null; displayName:string;
 onSelect:(id:string)=>void; onRename?:(id:string)=>void;
 children:(id:string)=>ReactNode;
}
/** Primary is the RIGHT member. Real selection remains owned by the editor. */
export default function SymmetricPairListItem({primaryId,mirrorId,selectedId,displayName,onSelect,onRename,children,className,onKeyDown,onContextMenu,onDragStart,...rest}:Props){
 const active=selectedId===primaryId||!!mirrorId&&selectedId===mirrorId;
 const id=active?selectedId!:primaryId;
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const latest=useRef({id,active,onSelect,onRename});latest.current={id,active,onSelect,onRename};
 const cancel=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;};
 useEffect(()=>cancel,[]);
 useEffect(()=>{cancel();},[selectedId]);
 const select=()=>{const s=latest.current;s.onSelect(mirrorId&&s.active?(s.id===primaryId?mirrorId:primaryId):primaryId);};
 const rename=()=>{cancel();const s=latest.current;if(!s.onRename)return;if(!s.active)s.onSelect(primaryId);s.onRename(s.id);};
 return <div {...rest} role="button" tabIndex={0} aria-label={displayName} aria-pressed={active} data-pair-primary={primaryId} data-pair-mirror={mirrorId} data-active-id={active?id:undefined} className={['symmetric-pair-row',active?'active':'',className??''].join(' ')}
 onClick={e=>{if((e.target as HTMLElement).closest('input,button'))return;if(!mirrorId){onSelect(primaryId);return;}if(e.detail>1){cancel();return;}cancel();timer.current=setTimeout(()=>{timer.current=null;select();},PAIR_CLICK_DELAY);}}
 onDoubleClick={e=>{if((e.target as HTMLElement).closest('input,button'))return;e.preventDefault();e.stopPropagation();rename();}}
 onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='F2'||e.key==='Enter'){e.preventDefault();e.stopPropagation();rename();return;}if(e.key===' '){e.preventDefault();cancel();select();return;}onKeyDown?.(e);}}
 onContextMenu={e=>{cancel();onContextMenu?.(e);}} onDragStart={e=>{cancel();onDragStart?.(e);}}>
 {children(id)}{mirrorId&&<small className="pair-side" aria-label={active?(id===primaryId?'右侧':'左侧'):'默认右侧'}>{id===primaryId?'R':'L'}</small>}
 </div>;
}
