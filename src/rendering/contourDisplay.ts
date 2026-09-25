import {displayTransform} from './moduleDisplay';
import {irisRims} from '../domain/eyes/gaze';
import type {Vec3} from '../domain/project/types';
import type {contourSource} from '../domain/contour/source';
/** Pose final evaluated geometry and real open boundaries together. No changes
 * to contour extraction, occlusion, or the source surface evaluator. */
export function contourDisplay(source:ReturnType<typeof contourSource>,facing:Vec3,hideEyes=false){
 const vertices=[...source.baseVertices],boundaries=[...source.baseBoundaries];
 const transforms=new Map<string,ReturnType<typeof displayTransform>>();
 const pose=(id:string)=>{let t=transforms.get(id);if(!t){t=displayTransform(source.project,id,facing);transforms.set(id,t);}return t;};
 for(const {start,count,id} of source.displayVertices){const t=pose(id);if(t.active)for(let i=start;i<start+count;i++)vertices[i]=t.display(source.baseVertices[i]);}
 for(const {index,id} of source.displayBoundaries){const t=pose(id);if(t.active)boundaries[index]=source.baseBoundaries[index].map(t.display);}
 return {...source.mesh,vertices,boundaries,alwaysLines:hideEyes?[]:irisRims(source.project,facing)};
}
