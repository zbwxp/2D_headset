import {prepareProjectStorage,getInitialAutosave} from './app/projectStorage';
import React from "react";
import ReactDOM from "react-dom/client";
import {prepareStarterProject,finishProjectStartup} from './app/starterProject';
import "./app/styles.css";
const root = ReactDOM.createRoot(document.getElementById('root')!);
async function start() {
  root.render(<main className="startup-screen" role="status"><h1>contour</h1><p>正在打开工程… / Opening your project…</p></main>);
  try {
    // Finish the initial template download before importing the store: never
    // render/edit an empty project while a late response might replace it.
    await prepareProjectStorage();
    await prepareStarterProject({getItem:key=>{if(key==='contour.landmarks.v039'&&getInitialAutosave()!==undefined)return getInitialAutosave()!;try{return localStorage.getItem(key);}catch{return null;}},setItem:(key,value)=>localStorage.setItem(key,value)});
    const [{default:App},{useEditor},{useDrawing},{useDrawing:useAssembly},{useRecording},{connectWorkspaceSession}] = await Promise.all([
      import('./app/App'), import('./app/store'), import('./ui/drawing/session'),
      import('./ui/assemblyDrawing/session'),import('./ui/recording/session'),import('./app/workspaceSession'),
    ]);
    const workspace=connectWorkspaceSession(useEditor,{drawing:useDrawing,assembly:useAssembly,recording:useRecording},{
      getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),
    });
    import.meta.hot?.dispose(()=>workspace.dispose());
    const {registerVectorEditingApi}=await import('./app/vectorEditingApi');
    const unregisterAI=registerVectorEditingApi();
    import.meta.hot?.dispose(()=>unregisterAI());
    finishProjectStartup();
    root.render(<React.StrictMode><App/></React.StrictMode>);
  } catch {
    root.render(<main className="startup-screen" role="alert"><h1>暂时无法打开工程</h1><p>请检查网络后重试。浏览器原有存档未删除。</p><p>Unable to open the project. Please check your connection and retry.</p><button onClick={()=>void start()}>重试 / Retry</button></main>);
  }
}
void start();
