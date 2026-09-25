import {isClosedSource} from '../../domain/curves/model';
import {chinRim} from '../../domain/chin/junction';
import {evaluationContext} from '../../domain/geometry/evaluation';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {boundaryGeometry,wholeBoundary,type PatchBoundaryUse} from '../../domain/patches/boundary';
export interface PatchCreation {mode:'whole'|'span'|'loop';uses:PatchBoundaryUse[];host?:string;start?:string;hover?:string}
/** Transient overlays; never source geometry or saved data. */
export function authoringBoundaries(p:LandmarkProject,state:PatchCreation|null,selectedPatchId?:string|null){
 const uses=state?[...state.uses]:[...(p.patches?.find(x=>x.id===selectedPatchId)?.boundaryUses??[])];
 if(state?.host){if(state.start&&state.hover&&state.start!==state.hover)uses.push({curveId:state.host,startLandmarkId:state.start,endLandmarkId:state.hover});else if(!isClosedSource(p.curves.find(c=>c.id===state.host)!))uses.push(wholeBoundary(p,state.host));}
 return uses.filter(b=>!chinRim(p,b.curveId)).flatMap(b=>{try{return [{use:b,geometry:boundaryGeometry(p,b)}];}catch{return [];}});
}

export function loopCorrespondence(p:LandmarkProject,state:PatchCreation|null){
 if(state?.mode!=='loop'||state.uses.length!==2)return [];
 try{const [a,b]=state.uses.map(b=>boundaryGeometry(p,b));return [0,.125,.25,.375,.5,.625,.75,.875].map(s=>[a.evaluate(s),b.evaluate(s)]);}catch{return [];}
}
