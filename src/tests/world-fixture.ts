import type {SemanticLandmark,LandmarkProject} from '../domain/landmarks/model';
import {toHead} from '../domain/head/frame';
/** Legacy mutable WORLD fixtures; migrated projects must supply their frame for reads. */
export function world(l:SemanticLandmark,p?:LandmarkProject){if(l.placement.kind==='WORLD')return l.placement;if(l.placement.kind==='FRAME_RELATIVE'&&p)return {kind:'WORLD' as const,position:toHead(p,l.placement.position)};throw Error('Expected WORLD fixture or explicit project for relative coordinates');}
