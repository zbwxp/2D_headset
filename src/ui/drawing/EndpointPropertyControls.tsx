import PanelSection from '../shared/PanelSection';
import {curveById,nodeAt,members,joinAt,type DrawingDocument} from '../../domain/drawing/model';
import {connect,removeJoin,unbind,unlinkEndpoints} from '../../domain/drawing/commands';
import {linksAtNode} from '../../domain/drawing/endpointLinks';
import type {DrawingSelection} from './session';
import type {DrawingCommandRun,DrawingEndpointTool} from './endpointInteraction';
import EndpointLinkBrushInfo from './EndpointLinkBrushInfo';
import {uiText as t} from '../i18n';

export default function EndpointPropertyControls({d,selection:s,run,choose,tool,editable=true}:{d:DrawingDocument;selection:DrawingSelection;run:DrawingCommandRun;choose:(selection:DrawingSelection)=>void;tool:(tool:DrawingEndpointTool)=>void;editable?:boolean}){
 const ids=s.ids.filter(id=>d.curves.some(curve=>curve.id===id)),endpoint=s.handle??(s.node?members(d,s.node).find(endpoint=>ids.includes(endpoint.curveId)):undefined),node=s.node?d.nodes.find(node=>node.id===s.node):undefined,j=endpoint?joinAt(d,endpoint):undefined,disabled=!editable||ids.some(id=>curveById(d,id).locked);
 return <> {node&&<PanelSection id="drawing.connection-members" title="连接成员" className="drawing-relations">{members(d,node.id).map(e=><button key={`${e.curveId}:${e.end}`} onClick={()=>choose({ids:[e.curveId],node:node.id})}>{curveById(d,e.curveId).name} · {e.end?'P1':'P0'}</button>)}</PanelSection>}
 {endpoint&&<PanelSection id="drawing.endpoint-links" title="端点联动" className="drawing-relations" testId="drawing-endpoint-link-properties">
 <p className="drawing-muted">{t('几何端点联动只约束位置；下列末端笔触属于列出的实际轮廓。')}</p>
 {linksAtNode(d,nodeAt(d,endpoint).id).map(link=>{const other=nodeAt(d,link.a).id===nodeAt(d,endpoint).id?link.b:link.a;return <div key={link.id} className="drawing-endpoint-link-card" data-testid="drawing-endpoint-link" data-link-id={link.id}><EndpointLinkBrushInfo d={d} link={link}/><div className="drawing-property-actions"><button onClick={()=>choose({ids:[other.curveId],node:nodeAt(d,other).id})}>{curveById(d,other.curveId).name} · P{other.end}</button><button disabled={!editable||[link.a,link.b].some(e=>curveById(d,e.curveId).locked)} onClick={()=>run(()=>unlinkEndpoints(d,link.id),{kind:'relation-authoring'})}>{t('解除联动')}</button></div></div>;})}
 <button disabled={disabled} onClick={()=>tool('link')}>{t('联动另一个端点')}</button></PanelSection>}
 {endpoint&&<PanelSection id="drawing.joins" title="本层连接" className="drawing-relations"><span>{t(j?(j.mode==='ARC'?'圆弧接笔':j.mode==='SMOOTH'?'平滑接笔':'尖点接笔'):members(d,nodeAt(d,endpoint).id).length>1?'仅绑定':'未绑定')}</span>
 {linksAtNode(d,nodeAt(d,endpoint).id).length>0&&<p className="drawing-muted">{t('这里只描述本层共享端点的连接；关联末端笔触见上方端点联动。')}</p>}
 {j?.mode==='CUSP'&&<p className="drawing-muted">{t('尖点只影响描边尖角，两侧控制柄独立编辑。')}</p>}
 {j?<><button disabled={disabled} onClick={()=>run(()=>connect(d,j.a,j.b,j.mode==='SMOOTH'?'CUSP':'SMOOTH'))}>{t(j.mode==='SMOOTH'?'改为尖点':'改为平滑')}</button>{j.mode!=='ARC'&&<button disabled={disabled} onClick={()=>run(()=>connect(d,j.a,j.b,'ARC'))}>{t('改为圆弧')}</button>}<button disabled={disabled} onClick={()=>run(()=>removeJoin(d,j.id))}>{t('仅绑定')}</button></>:<div className="drawing-property-actions"><button disabled={disabled} onClick={()=>tool('smooth')}>{t('平滑接笔')}</button><button disabled={disabled} onClick={()=>tool('cusp')}>{t('尖点接笔')}</button><button disabled={disabled} onClick={()=>tool('arc')}>{t('圆弧接笔')}</button></div>}
 {members(d,nodeAt(d,endpoint).id).length>1&&<button disabled={disabled} onClick={()=>run(()=>{const next=unbind(d,endpoint);choose({ids:[endpoint.curveId],node:nodeAt(next,endpoint).id});return next;},{kind:'node-unbind',endpoint})}>{t('解除此端点绑定')}</button>}
 </PanelSection>}
 </>;
}
