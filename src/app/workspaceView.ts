import {create} from 'zustand';
import {uid,type Point2} from '../domain/drawing/model';
import type {DrawingSnapshots} from '../domain/drawing/snapshots';
export interface ViewGuide {id:string;axis:'x'|'y';value:number}
export interface ArtworkReferenceView {artworkId:string;offset:Point2;scale:number;opacity:number;visible:boolean;snap:boolean}
export interface WorkspaceView {reference?:ArtworkReferenceView;guides:ViewGuide[];guidesVisible:boolean;snappingEnabled:boolean;rulersVisible:boolean}
export type WorkspaceViewCommand = {op:'setReference';artworkId?:string|null;placement?:'left'|'right'|'overlay';offset?:Point2;scale?:number;opacity?:number;visible?:boolean;snap?:boolean}|{op:'addGuide';id?:string;axis:'x'|'y';value:number}|{op:'changeGuide';id:string;value:number}|{op:'deleteGuides';ids:string[]}|{op:'setGuideOptions';visible?:boolean;snapping?:boolean;rulers?:boolean}|{op:'resetView'};
export const emptyWorkspaceView=():WorkspaceView=>({guides:[],guidesVisible:true,snappingEnabled:true,rulersVisible:false});
export const useWorkspaceView=create<WorkspaceView>(()=>emptyWorkspaceView());
export const getWorkspaceView=()=>useWorkspaceView.getState();
export const replaceWorkspaceView=(next:WorkspaceView)=>useWorkspaceView.setState(next,true);
const finite=(x:unknown,lo=-1e5,hi=1e5):number=>{if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)throw Error('View coordinate is outside the supported finite range');return x;};
const bool=(v:unknown)=>{if(typeof v!=='boolean')throw Error('Expected a boolean view option');return v;};
const id=(v:unknown)=>{if(typeof v!=='string'||!v||v.length>256)throw Error('Invalid view ID');return v;};
const keys=(c:Record<string,unknown>,allowed:string[])=>{if(Object.keys(c).some(k=>!allowed.includes(k)))throw Error('Unknown view command field');};
/** View-only authoring aids. Never stored in DrawingDocument or project history. */
export function prepareWorkspaceView(before:WorkspaceView,commands:readonly WorkspaceViewCommand[],library?:DrawingSnapshots):WorkspaceView{
 if(!Array.isArray(commands)||commands.length>200)throw Error('Expected up to 200 view commands');let next=structuredClone(before);
 for(const raw of commands){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid view command');const c=raw as unknown as Record<string,unknown>;
  switch(c.op){
   case 'setReference':{keys(c,['op','artworkId','placement','offset','scale','opacity','visible','snap']);if(c.artworkId===null){if(Object.keys(c).some(k=>k!=='op'&&k!=='artworkId'))throw Error('Clear reference cannot include transform options');delete next.reference;break;}const artworkId=id(c.artworkId??next.reference?.artworkId),item=library?.items.find(a=>a.id===artworkId);if(!item)throw Error('Reference artwork is not in the saved artwork library');let ref:ArtworkReferenceView=next.reference?.artworkId===artworkId?{...next.reference}:{artworkId,offset:[0,0],scale:1,opacity:.3,visible:true,snap:false};
    if(c.placement!==undefined){if(!['left','right','overlay'].includes(c.placement as string))throw Error('Invalid reference placement');const xs=item.drawing.nodes.map(n=>n.position[0]),width=xs.length?Math.max(...xs)-Math.min(...xs):1;ref.offset=[c.placement==='overlay'?0:(c.placement==='left'?-1:1)*(width+.2),0];}
    if(c.offset!==undefined){if(!Array.isArray(c.offset)||c.offset.length!==2)throw Error('Expected reference [x,y]');ref.offset=[finite(c.offset[0]),finite(c.offset[1])];}if(c.scale!==undefined)ref.scale=finite(c.scale,.01,100);if(c.opacity!==undefined)ref.opacity=finite(c.opacity,0,1);if(c.visible!==undefined)ref.visible=bool(c.visible);if(c.snap!==undefined)ref.snap=bool(c.snap);next.reference=ref;break;}
   case 'addGuide':{keys(c,['op','id','axis','value']);if(c.axis!=='x'&&c.axis!=='y')throw Error('Invalid guide axis');const guideId=c.id===undefined?uid():id(c.id);if(next.guides.length>=100||next.guides.some(g=>g.id===guideId))throw Error('Duplicate guide ID or guide limit');next.guides.push({id:guideId,axis:c.axis,value:finite(c.value)});break;}
   case 'changeGuide':keys(c,['op','id','value']);if(!next.guides.some(g=>g.id===id(c.id)))throw Error('Guide not found');next.guides=next.guides.map(g=>g.id===c.id?{...g,value:finite(c.value)}:g);break;
   case 'deleteGuides':keys(c,['op','ids']);if(!Array.isArray(c.ids)||c.ids.some(v=>typeof v!=='string'||!next.guides.some(g=>g.id===v)))throw Error('Guide not found');next.guides=next.guides.filter(g=>!(c.ids as string[]).includes(g.id));break;
   case 'setGuideOptions':keys(c,['op','visible','snapping','rulers']);if(c.visible!==undefined)next.guidesVisible=bool(c.visible);if(c.snapping!==undefined)next.snappingEnabled=bool(c.snapping);if(c.rulers!==undefined)next.rulersVisible=bool(c.rulers);break;
   case 'resetView':keys(c,['op']);next=emptyWorkspaceView();break;
   default:throw Error('Unknown view command');
  }
 }
 return next;
}
export function applyWorkspaceView(commands:readonly WorkspaceViewCommand[],library?:DrawingSnapshots){const next=prepareWorkspaceView(getWorkspaceView(),commands,library);replaceWorkspaceView(next);return next;}
