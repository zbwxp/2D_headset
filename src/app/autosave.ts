import type {LandmarkProject} from '../domain/landmarks/model';
import {count,timed} from '../domain/geometry/diagnostics';
const viewJSON=new WeakMap<LandmarkProject['views'],string>();
export function serializeProject(p:LandmarkProject){
 let views=viewJSON.get(p.views);if(views===undefined){views=JSON.stringify(p.views);viewJSON.set(p.views,views);count('referenceSerializations');}
 return '{'+Object.entries(p).filter(([,v])=>v!==undefined).map(([k,v])=>JSON.stringify(k)+':'+(k==='views'?views:JSON.stringify(v))).join(',')+'}';
}
export function createAutosave(write:(p:LandmarkProject)=>void,delay=500){
 let pending:LandmarkProject|undefined,timer:ReturnType<typeof setTimeout>|undefined,editing=false;
 const flush=()=>{clearTimeout(timer);timer=undefined;if(pending){const p=pending;pending=undefined;write(p);}};
 const schedule=()=>{clearTimeout(timer);if(!editing&&pending)timer=setTimeout(flush,delay);};
 return {request(p:LandmarkProject){pending=p;schedule();},begin(){editing=true;clearTimeout(timer);},end(){editing=false;schedule();},flush,cancel(){clearTimeout(timer);pending=undefined;editing=false;}};
}
export function writeAutosave(key:string,p:LandmarkProject){const end=timed('persistence');try{count('autosaveSerializations');const json=serializeProject(p);localStorage.setItem(key,json);count('autosaveWrites');}finally{end();}}
