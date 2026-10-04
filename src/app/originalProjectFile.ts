import type {LandmarkProject} from '../domain/landmarks/model';

// Session-local original bytes, separate from project data and its JSON schema.
// Project identity also makes Undo restore the exact pre-reset download.
const originals=new WeakMap<LandmarkProject,string>();
export function retainOriginalProjectFile(project:LandmarkProject,text:string):void{originals.set(project,text);}
export function originalProjectFile(project:LandmarkProject):string|undefined{return originals.get(project);}
