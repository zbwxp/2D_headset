import {uiText} from "../i18n";
import {Lock,LockOpen} from 'lucide-react';
import {useEditor} from '../../app/store';
import {isLoomisLocked} from '../../domain/head/locks';
export default function LoomisLock({id}:{id:string}){const s=useEditor(),locked=isLoomisLocked(s.project,id);return <button className="loomis-lock" aria-label={uiText(locked?'解锁 Loomis 对象':'锁定 Loomis 对象')} aria-pressed={locked} title={uiText(locked?'已锁定：禁止修改和删除，仍可添加定位点':'锁定对象')} onClick={e=>{e.preventDefault();e.stopPropagation();s.toggleLoomisLock(id);}}>{locked?<Lock size={15}/>:<LockOpen size={15}/>}</button>;}
