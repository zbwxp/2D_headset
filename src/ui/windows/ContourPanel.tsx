import {useInspectionCamera,useWindows} from './state';
/** Read-only host for the future final-surface contour evaluator. */
export default function ContourPanel(){
 const camera=useInspectionCamera(),threeDVisible=useWindows(s=>s.visible.threeD);
 const delta=camera.target.map((x,i)=>x-camera.position[i]),length=Math.hypot(...delta);
 const direction=delta.map(x=>x/length);
 return <div className="contour-preview" data-testid="contour-preview" data-direction={direction.join(',')}>
 <div className="contour-view-info">正交投影 · {threeDVisible?'跟随 3D 朝向':'保持 3D 最后朝向'}</div>
 <div className="contour-empty"><div><strong>Contour 只读预览</strong><p>轮廓计算器待接入</p><small>这里将显示最终曲面在当前方向下的外轮廓。</small></div></div>
 <div className="contour-view-info">方向 {direction.map(x=>x.toFixed(3)).join(' / ')}</div>
 </div>;
}
