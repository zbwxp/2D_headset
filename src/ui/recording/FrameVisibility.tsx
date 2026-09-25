import type {RecordedCurve,RecordedPoint,Recording,View} from '../../domain/recording/model';
import {setViewVisibility,visibleAtView} from '../../domain/recording/visibility';
import {uiText as t} from '../i18n';

export default function FrameVisibility({element,recording,view,commit}:{element:RecordedCurve|RecordedPoint;recording:Recording;view:View;commit:(r:Recording)=>void}){
 const visible=visibleAtView(element,view);
 return <div className="recording-frame-visibility">
  <button data-testid="recording-frame-visibility" disabled={element.locked} onClick={()=>commit(setViewVisibility(recording,element.id,view,!visible))}>{t(visible?'在当前帧隐藏/删除':'在当前帧恢复显示')}</button>
  <small>{t('仅记录视角显示状态，保留对象及全部关键帧。')}</small>
  {!element.visible&&<small>{t('对象已全局隐藏，可在列表中开启显示。')}</small>}
 </div>;
}
