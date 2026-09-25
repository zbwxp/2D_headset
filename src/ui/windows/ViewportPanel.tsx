import {isFree3DShape} from '../../domain/curves/model';
import {canonical as curveCanonical} from '../../domain/curves/geometry';
import {useEditor} from '../../app/store';
import {uiText} from '../i18n';
import {useWindows,type PanelId} from './state';
import AddView from './AddView';
import EditView from '../edit2d/EditView';
import {LockKeyhole,Unlock} from 'lucide-react';
import {allowedBasis,motionState,editingBasis,viewIsLocked} from '../../domain/landmarks/model';
import {isDerived,isOnPatch,isHelmetLoop} from '../../domain/curves/model';
export default function ViewportPanel({panelId}:{panelId:PanelId}){
 const editor=useEditor(),layout=useWindows();
 const saved=layout.viewIds[panelId];
 const viewId=editor.project.views.find(v=>v.id===saved)?.id??(panelId==='viewport'?editor.project.views[0]?.id:editor.project.views.find(v=>v.id==='side')?.id??editor.project.views[1]?.id??editor.project.views[0]?.id);
 const s={...editor,viewId},activeView=s.project.views.find(v=>v.id===viewId)!;
 const curve=s.project.curves.find(c=>c.id===s.selectedCurveId),l=s.project.landmarks.find(l=>l.id===s.selectedId),free=l?allowedBasis(s.project,l.id):[];
 const motion=l?motionState(s.project,l.id,activeView):{spatialDof:0,screenDof:0,track:null};
 const editAxes=l?editingBasis(s.project,l.id,activeView):[],lockedViews=s.project.views.filter(v=>viewIsLocked(s.project,v.id));
 const activate=()=>{if(useEditor.getState().viewId!==viewId)useEditor.getState().selectView(viewId);};
 const select=(id:string)=>{layout.setView(panelId,id);editor.selectView(id);};
 return <section className="point-edit-column" data-view-id={viewId} onPointerDownCapture={activate} onFocusCapture={activate} onWheelCapture={activate}>
          <nav className="point-view-tabs">
            {s.project.views.map(v=><AddView key={v.id} view={v} active={v.id===viewId} onSelect={select}/>)}
            <AddView onSelect={select}/>
            <label
              className="point-lock"
              title={uiText("统一开关视图锁；每对镜像点仅约束 driver，follower 通过镜像跟随")}
            >
              <input
                type="checkbox"
                aria-label={uiText("锁定此视图全部点")}
                checked={viewIsLocked(s.project, s.viewId)}
                onChange={(e) => s.setViewLock(s.viewId, e.target.checked)}
              />
              {viewIsLocked(s.project, s.viewId) ? (
                <LockKeyhole size={15} />
              ) : (
                <Unlock size={15} />
              )}{uiText("统一视图锁")}</label>
          </nav>
          <div className="point-global-locks" aria-label={uiText("全部点的视图锁")}>
            <span>{uiText("显式视图锁：")}</span>
            {s.project.views
              .filter((v) => viewIsLocked(s.project, v.id))
              .map((v) => (
                <button
                  key={v.id}
                  aria-label={uiText(`解锁${uiText(v.label)}全部点`)}
                  onClick={() => s.setViewLock(v.id, false)}
                >
                  {uiText(v.label)} <Unlock size={12} />
                </button>
              ))}
            {!s.project.views.some((v) => viewIsLocked(s.project, v.id)) && (
              <span>{uiText("无")}</span>
            )}
          </div>
          <div className="point-edit-basis" data-testid="edit-basis">
            <span>
              {uiText(curve
                ? ('controlPointIds' in curve?'眼睑 Bézier · 拖动眼角和控制柄 · Shift 拖动平移':isOnPatch(curve)?'On Surface Curve · 由 Host Patch Final Surface 派生':isHelmetLoop(curve)?"闭合下缘：调整共同高度；可取点和作为建面边界":isDerived(curve)?"解析 Section：在侧栏调整平面；视图中可选择":(isFree3DShape(curveCanonical(s.project,curve).shape)?"曲线编辑：当前视图内拖动控制柄；深度保持不变":"曲线编辑：固定平面内弯曲；视图锁仅约束语义点"))
                : l?.placement.kind==="LOOMIS_SCAFFOLD" ? "系统派生定位点：调整宿主参数；不可独立拖离" : (l?.placement.kind==="ON_LOOMIS_SURFACE"||l?.placement.kind==="ON_SECTION_CAP") ? "Loomis 面定位：在 2D 贴面拖动，或在行内调整；不受视图锁约束" : l?.placement.kind==="ON_CURVE" ? "结构线定位：2D 沿线拖动或使用在线位置调整；不受视图锁约束" : lockedViews.length
                  ? `移动基准：${lockedViews.map((v) => uiText(v.label)).join("、")}锁约束`
                  : `移动基准：${uiText(activeView.label)}相机平面（深度不变）`)}
            </span>
            {!curve && editAxes.length === 1 && (
              <code>{uiText("方向 X")}{uiText(editAxes[0][0].toFixed(2))}{uiText("/ Y")}{uiText(" ")}
                {uiText(editAxes[0][1].toFixed(2))}{uiText("/ Z")}{uiText(editAxes[0][2].toFixed(2))}
              </code>
            )}
          </div>
          <EditView viewId={viewId} />
          <div className="point-detail">
            <strong>{curve?.name ?? l?.name ?? uiText("未选中语义点")}</strong>
            <span data-testid="dof">
              {uiText(curve ? ('controlPointIds' in curve?'眼睑 Bézier · 拖动眼角和控制柄 · Shift 拖动平移':isOnPatch(curve)?'On Surface Curve · 由 Host Patch Final Surface 派生':isDerived(curve)?"Analytic Curve":(isFree3DShape(curveCanonical(s.project,curve).shape)?"Free 3D Bézier":"Planar Bézier")) : `${l?.placement.kind==="LOOMIS_SCAFFOLD"?0:l?.placement.kind==="ON_SECTION_CAP"?2:l?.placement.kind==="ON_CURVE"?1:l?.placement.kind==="ON_LOOMIS_SURFACE"?(l.type==="CENTERLINE"?1:2):free.length} DOF`)}
            </span>
            <span data-testid="motion-status">
              {uiText(curve
                ? ('controlPointIds' in curve?'眼睑 Bézier · 拖动眼角和控制柄 · Shift 拖动平移':isOnPatch(curve)?'On Surface Curve · 由 Host Patch Final Surface 派生':isDerived(curve)?"解析结构线 · 侧栏调整参数 · 可添加在线定位点":(isFree3DShape(curveCanonical(s.project,curve).shape)?"拖曲线弯曲 · 两个三维控制柄 · 换视图调整深度":"拖曲线弯曲 · 两个控制柄精调 · 平面绕端点连线旋转"))
                : !l
                  ? "空项目 · 撤销或打开项目恢复"
                  : l.placement.kind==="LOOMIS_SCAFFOLD" ? "系统定位点 · 由宿主解析派生" : (l.placement.kind==="ON_LOOMIS_SURFACE"||l.placement.kind==="ON_SECTION_CAP") ? "Loomis Surface · 2D 贴面拖动" : l.placement.kind==="ON_CURVE" ? "结构线定位 · 2D 沿线拖动" : motion.spatialDof === 0
                    ? "已固定 · 解除视图锁以继续"
                    : motion.screenDof === 0
                      ? "仅剩视线方向移动 · 请换视图"
                      : motion.screenDof === 1
                        ? "当前视图：沿虚线移动"
                        : "当前视图：平面内自由移动")}
            </span>
          </div>
        </section>;
}
