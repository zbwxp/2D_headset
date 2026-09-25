import {objectHidden} from './visibility';
import {useEditor} from '../../app/store';
import {canPickModule} from '../../domain/modules/ownership';
/** Picking only: never use this to filter rendering. */
export function modulePickable(id:string){const s=useEditor.getState();return !objectHidden(id,false)&&canPickModule(s.project,id,s.activeModule);}
