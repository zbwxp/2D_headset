import type {LandmarkProject} from '../../domain/landmarks/model';
import type {ToolDraft} from './state';
/** A draft is detached from project/history. Cancelling means dropping this value. */
export function createToolDraft(base:LandmarkProject):ToolDraft {
 return {base,points:[],curves:[],patches:[]};
}
export function stageToolDraft(draft:ToolDraft,delta:Partial<Pick<ToolDraft,'points'|'curves'|'patches'>>):ToolDraft {
 return {...draft,...delta};
}
/** Commands must validate their domain geometry before submitting this atomic delta. */
export function materializeToolDraft(current:LandmarkProject,draft:ToolDraft):LandmarkProject {
 if(current!==draft.base)throw Error('Source changed during creation; restart this tool.');
 for(const [existing,added] of [[current.landmarks,draft.points],[current.curves,draft.curves],[current.patches??[],draft.patches]]){
  const ids=new Set(existing.map(x=>x.id));
  for(const x of added){if(ids.has(x.id))throw Error('Draft contains a duplicate object ID.');ids.add(x.id);}
 }
 return {...current,landmarks:[...current.landmarks,...draft.points],curves:[...current.curves,...draft.curves],patches:[...(current.patches??[]),...draft.patches],centerlineOrder:[...current.centerlineOrder,...draft.points.filter(p=>p.type==='CENTERLINE').map(p=>p.id)]};
}
