import type {HairNet} from '../../domain/hairstyle/model';
import {useLanguage} from '../i18n';
import NumericSlider from '../shared/NumericSlider';
import './hairNetPlacement.css';

interface Props {
 net:HairNet;
 onChange:(axis:0|1,value:number)=>void;
 begin:()=>void;end:()=>void;undo:()=>void;redo:()=>void;
}
/** Moves the saved shell itself, so its overlay and baking use the same placement. */
export default function HairNetPlacement({net,onChange,begin,end,undo,redo}:Props){
 const zh=useLanguage(s=>s.language)==='zh';
 return <div className="hair-net-placement" role="group" aria-label={zh?'发网定位':'Net placement'}>
  <span title={zh?'仅移动发网；背景请使用参考图的移动控件。':'Move the net; use the reference controls to move the background.'}>{zh?'发网定位':'Net placement'}</span>
  {([0,1] as const).map(axis=><NumericSlider key={axis}
   label={zh?(axis===0?'发网 X · 左右':'发网 Y · 上下'):(axis===0?'Net X · horizontal':'Net Y · vertical')}
   value={net.center[axis]} min={-3} max={3} step={.01} snapTargets={[0]}
   onChange={value=>onChange(axis,value)} onEditStart={begin} onEditEnd={end} onUndo={undo} onRedo={redo}/>) }
 </div>;
}
