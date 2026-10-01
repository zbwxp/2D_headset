import AssemblyRoom from '../ui/assembly/AssemblyRoom';
import {useDrawing as useAssembly} from '../ui/assemblyDrawing/session';
import {createAssembly} from '../domain/assembly/model';
import {serializeProject} from './autosave';
import AutoHideBar from '../ui/shared/AutoHideBar';
import {isFree3DShape} from '../domain/curves/model';
import {canonical as curveCanonical} from '../domain/curves/geometry';
import ViewportPanel from '../ui/windows/ViewportPanel';
import DrawingRoom from '../ui/drawing/DrawingRoom';
import {useDrawing} from '../ui/drawing/session';
import RecordingRoom from '../ui/recording/RecordingRoom';
import {useRecording} from '../ui/recording/session';
import {uiText,useLanguage} from "../ui/i18n";
import CreationShelf from '../ui/authoring/CreationShelf';
import ObjectSidebar from '../ui/authoring/ObjectSidebar';
import {APP_VERSION} from './version';
import {loadStarterProject,finishProjectStartup} from './starterProject';
import AddView from '../ui/windows/AddView';
import {isDerived,isOnPatch,isHelmetLoop} from '../domain/curves/model';
import {pointPosition} from "../domain/geometry/evaluation";
import {ensureSmooth} from "../domain/continuity/service";
import {subscribeSmooth,smoothVersion} from "../domain/continuity/evaluation";
import ContourPanel from "../ui/windows/ContourPanel";
import MainPanels from "../ui/windows/MainPanels";
import EditorActions from "../ui/EditorActions";
import { useUI } from "../ui/session";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  LockKeyhole,
  Unlock,
  Box,
  CircleHelp,
} from "lucide-react";
import { useEditor } from "./store";
import {
  modelStateCode,
  viewIsLocked,
} from "../domain/landmarks/model";
import { parseLandmarks } from "../domain/landmarks/persistence";
import EditView from "../ui/edit2d/EditView";
import InspectView from "../ui/inspect3d/InspectView";
export default function App() {
  const {language,setLanguage}=useLanguage();
  const [loadingStarter,setLoadingStarter]=useState(false);
  const room=useRecording(s=>s.room),drawingRoom=useDrawing(s=>s.room),assemblyRoom=useAssembly(s=>s.room);
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';},[language]);

  useSyncExternalStore(subscribeSmooth,smoothVersion);
  const ui = useUI();
  const s = useEditor(),
    file = useRef<HTMLInputElement>(null),
    patch = s.project.patches?.find(p=>p.id===s.selectedPatchId),
    curve = s.project.curves.find((c) => c.id === s.selectedCurveId),
    l = s.project.landmarks.find((l) => l.id === s.selectedId),
    partner = s.project.landmarks.find((x) => x.id === l?.mirrorPartnerId);
  // Independent editors never change HeadSet geometry. Do not hash/solve it on
  // every drawing/assembly pointer frame; refresh normally when returning to the model.
  useEffect(()=>{if(assemblyRoom&&!s.project.assembly)useAssembly.getState().set({room:false});},[assemblyRoom,s.project.assembly]);
  useEffect(()=>{if(!assemblyRoom&&!drawingRoom)ensureSmooth(s.project);},[s.project,assemblyRoom,drawingRoom]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { useEditor.getState().cancelTool(); }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (
        t.closest(
          '[role="dialog"],[data-ui-keyboard],[contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      if (
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLInputElement && ["text", "number"].includes(t.type))
      )
        return;
      e.preventDefault();
      const s = useEditor.getState();
      e.shiftKey ? s.redo() : s.undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const openStarter=async()=>{
    const before=useEditor.getState().project;
    setLoadingStarter(true);
    try {
      const p=await loadStarterProject();
      if(useEditor.getState().project!==before){s.notify(language==='zh'?'工程在加载期间已修改，请再次载入基础脸模。':'The project changed while loading. Please try again.');return;}
      s.load(p);s.endEdit();finishProjectStartup();
      useRecording.getState().set({room:false});useAssembly.getState().set({room:false});
      useDrawing.getState().set({room:true,selection:{ids:[]},layerId:null,tool:'select',zoom:1,pan:[0,0]});
      s.notify(language==='zh'?'已载入基础脸模，可撤销返回原工程。':'Starter face loaded. Undo returns to the previous project.');
    } catch {s.notify(language==='zh'?'基础脸模加载失败，请检查网络后重试。':'Could not load the starter face. Please retry.');}
    finally {setLoadingStarter(false);}
  };
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([serializeProject(s.project)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = s.project.meta.name + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={`point-app ${drawingRoom?'drawing-workspace-active':assemblyRoom?'assembly-workspace-active':''}`}>
      <AutoHideBar label="菜单 · 文件与工作区" className="app-menu-bar" disabled={!drawingRoom&&!assemblyRoom}>
      <header className="topbar">
        <div className="brand">
          <Box size={25} />{uiText("contour")}<span className="point-version">{uiText(APP_VERSION)}</span>
        </div>
        <input
          className="point-name"
          aria-label={uiText("项目名称")}
          value={s.project.meta.name}
          onChange={(e) => s.rename(e.target.value)}
        />
        <div className="point-top-actions">
          <button data-testid="drawing-room-toggle" onClick={()=>{s.cancelTool();useAssembly.getState().set({room:false});useRecording.getState().set({room:false});useDrawing.getState().set({room:!drawingRoom});}}>{uiText(drawingRoom?"返回建模间":"进入绘制间")}</button>
          <button data-testid="room-toggle" onClick={()=>{s.cancelTool();useAssembly.getState().set({room:false});useDrawing.getState().set({room:false});useRecording.getState().set({room:!room});}}>{uiText(room?"返回建模间":"进入录制间")}</button>
          <button data-testid="assembly-room-toggle" onClick={()=>{s.cancelTool();useDrawing.getState().set({room:false});useRecording.getState().set({room:false});if(!assemblyRoom&&!s.project.assembly){s.beginEdit();s.setAssembly(createAssembly());s.endEdit();}useAssembly.getState().set({room:!assemblyRoom});}}>{language==='zh'?(assemblyRoom?'返回建模间':'进入组装间'):(assemblyRoom?'Back to modeling':'Assembly Room')}</button>
          <button data-testid="language-toggle" aria-label={language==='zh'?'Switch interface to English':'切换为中文界面'} title={language==='zh'?'切换为英文界面':'Switch interface to Chinese'} onClick={()=>setLanguage(language==='zh'?'en':'zh')}>{uiText(language==='zh'?'English':'中文')}</button>
          <a className="trial-help-link" href="./help.html" target="_blank" rel="noopener noreferrer" title={language==='zh'?'使用帮助与问题反馈':'Help & feedback'} aria-label={language==='zh'?'使用帮助与问题反馈':'Help & feedback'}><CircleHelp size={18}/></a>
          <button
            title={uiText("撤销 Ctrl Z")}
            aria-label={uiText("撤销")}
            disabled={!s.past.length}
            onClick={s.undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title={uiText("重做 Ctrl Shift Z")}
            aria-label={uiText("重做")}
            disabled={!s.future.length}
            onClick={s.redo}
          >
            <Redo2 size={17} />
          </button>
          <button disabled={!s.project.landmarks.length} onClick={s.reset}>
            <Plus size={16} />{uiText("新建")}</button>
          <button onClick={() => file.current?.click()}>
            <Upload size={16} />{uiText("打开")}</button>
          <button data-testid="load-starter" disabled={loadingStarter} onClick={()=>void openStarter()} title={language==='zh'?'载入网站基础脸模，可撤销返回原工程':'Load starter face; Undo returns to your project'}>{language==='zh'?(loadingStarter?'载入中…':'载入基础脸模'):(loadingStarter?'Loading…':'Starter face')}</button>
          <button onClick={save}>
            <Download size={16} />{uiText("保存 JSON")}</button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              s.load(parseLandmarks(await f.text()));
            } catch (error) {
              s.notify((error as Error).message);
            }
          }}
        />
      </header>
      </AutoHideBar>
      {assemblyRoom&&s.project.assembly?<AssemblyRoom/>:drawingRoom?<DrawingRoom/>:room?<RecordingRoom/>:<main
        className="point-workspace"
        tabIndex={-1}
        onPointerDownCapture={(e) => {
          const t = e.target as HTMLElement;
          if (
            e.currentTarget.contains(t) &&
            !t.closest(
              'input,textarea,button,[contenteditable],[role="button"]',
            )
          )
            e.currentTarget.focus({ preventScroll: true });
        }}
      >
        <aside className="point-sidebar unified-sidebar"><ObjectSidebar/></aside>
        <div className="authoring-workspace"><CreationShelf/>
        <MainPanels viewport={<ViewportPanel panelId="viewport"/>
        } threeD={<section className="point-inspect-column">
          <div className="point-panel-title">{uiText("3D · 空间检查")}<span>
              {s.project.landmarks.length}{uiText("点 ·")}{s.project.curves.length}{uiText("线 ·")}{(s.project.patches?.length??0)+(s.project.chinScaffold?1:0)+(s.project.loomisScaffold?1:0)+(s.project.loomisCaps?.length??0)}{uiText("面")}{uiText(s.project.loomisRegions?.length?` · ${s.project.loomisRegions.length} 球面区域`:"")}
            </span>
          </div>
          <InspectView />
        </section>} contour={<ContourPanel/>} />
      </div>
      </main>}
      {!room&&!drawingRoom&&!assemblyRoom&&<footer className="point-footer">
        <div>
          <b>{patch ? `${patch.name??uiText(patch.type==='lens'?'两边面':patch.type==='loop'?'环形面':patch.type==='tri'?'三边面':'四边面')} · ${uiText("边界派生")}` : curve?.name ?? l?.name ?? uiText("未选择对象")}</b>
          <code data-testid="position">
            {uiText(curve
              ? ('controlPointIds' in curve?'眼睑 Bézier · 拖动眼角和控制柄 · Shift 拖动平移':isOnPatch(curve)?'On Surface Curve · 由 Host Patch Final Surface 派生':isHelmetLoop(curve)?"Rim 与水平环同高 · 衔接处切线连续":isDerived(curve)?"Loomis Frame + Section Plane":(isFree3DShape(curveCanonical(s.project,curve).shape)?"固定端点 · 自由三维控制柄":"固定端点 · 平面内形状"))
              : (l ? pointPosition(s.project,l.id).map((n) => n.toFixed(4)).join(" / ") : undefined))}
          </code>
        </div>
        <span>
          {uiText(curve
            ? curve.mirrorPartnerCurveId
              ? "左右镜像 · 一套独立形状"
              : "正中矢状面曲线"
            : l?.placement.kind==="ON_CURVE" ? "结构线定位 · 在线位置共享" : partner
              ? `Driver：${l?.name} → Follower：${partner.name}`
              : l
                ? "正中矢状面 x = 0"
                : "无语义点")}
        </span>
        <span>{uiText("显式视图锁：")}{uiText(s.project.views
            .filter((v) => viewIsLocked(s.project, v.id))
            .map((v) => uiText(v.label))
            .join("、") || "无")}
        </span>
        <span
          className="point-save-scope"
          title={uiText("浏览器各自保存项目；要在另一浏览器使用同一状态，请保存 JSON 后在那里打开。画布布局和缩放不影响此状态码。")}
        >{uiText("本浏览器存档 · 模型状态")}{uiText(" ")}
          <code data-testid="model-state">{uiText(modelStateCode(s.project))}</code>
        </span>
        <span>{uiText("撤销")}{s.past.length} / 100</span>
      </footer>}
      {!room&&!drawingRoom&&!assemblyRoom&&<EditorActions />}
      {uiText(s.message && (
        <div
          role="status"
          className="point-message"
          onClick={() => s.notify("")}
        >
          {uiText(s.message)}
          <button aria-label={uiText("关闭提示")}>×</button>
        </div>
      ))}
    </div>
  );
}
