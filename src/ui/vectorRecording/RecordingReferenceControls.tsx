import {useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import type {ReferenceImage} from '../../domain/project/types';
import {readPhoto} from '../shared/readPhoto';
import DrawingReferenceControls from '../shared/DrawingReferenceControls';
import {uiText as t,useLanguage} from '../i18n';
import {recordingReferenceSession,type RecordingReferenceState} from './recordingReferenceState';
import {matchesReferenceBinding,referenceBindingAt,type ReferenceAngle} from './recordingReferenceBindings';

export function useRecordingReference(sceneKey:string,seedReference?:ReferenceImage,fallbackSceneKey?:string,angle?:ReferenceAngle){
 // The initial scene seed is a detached copy; future source edits are ignored.
 const state=useMemo(()=>recordingReferenceSession(sceneKey,seedReference,fallbackSceneKey),[sceneKey,fallbackSceneKey]);
 const snapshot=useSyncExternalStore(state.subscribe,state.getSnapshot,state.getSnapshot);
 useLayoutEffect(()=>{state.activate(angle);return()=>state.deactivate();},[state]);
 useLayoutEffect(()=>{state.enterAngle(angle);},[state,angle?.x,angle?.y]);
 return {reference:(snapshot.preview??snapshot.document).reference,moving:snapshot.moving,setMoving:state.setMoving,change:state.change,preview:state.preview,current:state.current,
  controls:<RecordingReferenceControls key={sceneKey} state={state}/>};
}

export default function RecordingReferenceControls({state}:{state:RecordingReferenceState}){
 const snapshot=useSyncExternalStore(state.subscribe,state.getSnapshot,state.getSnapshot),input=useRef<HTMLInputElement>(null),zh=useLanguage(s=>s.language)==='zh';
 const reference=snapshot.document.reference,binding=referenceBindingAt(snapshot.bindings,snapshot.angle),changed=!!binding&&!!reference&&!matchesReferenceBinding((snapshot.preview??snapshot.document).reference!,binding);
 return <section className="vr-section vr-reference-controls" data-testid="recording-reference-controls" data-ui-keyboard onKeyDown={e=>e.stopPropagation()}>
  <h2>{t('参考图')}</h2>
  <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" data-testid="recording-reference-input" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void state.upload(file,readPhoto);}}/>
  <DrawingReferenceControls document={snapshot.preview??snapshot.document} current={state.currentDocument} run={state.run} preview={state.previewDocument} upload={()=>input.current?.click()} moveReference={()=>state.setMoving(moving=>!moving)} moving={snapshot.moving} busy={snapshot.busy} help={zh?'工作区参考（本机保存），工程 JSON 不含此项。':'Workspace reference saved on this device; excluded from project JSON.'}/>
  {reference&&snapshot.angle&&<div className="vr-reference-binding" data-testid="recording-reference-binding">
   <p className="drawing-muted">{zh?'当前视角':'Current angle'} · X {snapshot.angle.x}° / Y {snapshot.angle.y}°</p>
   <button type="button" data-testid="recording-reference-bind-angle" disabled={snapshot.busy||snapshot.hydrating||!!snapshot.preview} onClick={state.bindCurrentAngle}>{binding?(zh?'更新当前视角绑定':'Update current angle binding'):(zh?'绑定当前视角':'Bind current angle')}</button>
   <p className="drawing-muted" role="status">{binding?(changed?(zh?'当前为临时调整；返回此角度时恢复已绑定的位置、缩放、旋转和透明度。':'Temporary adjustment; returning to this angle restores the bound position, scale, rotation and opacity.'):(zh?'已绑定；之后的调整须点击更新才会写入此绑定。':'Bound; later adjustments are saved to this binding only when you click Update.')):(zh?'绑定位置、缩放、旋转和透明度；不会建立视角快照。':'Bind position, scale, rotation and opacity without creating a view snapshot.')}</p>
  </div>}
  {(snapshot.hydrating||snapshot.saving)&&<p className="drawing-muted" role="status">{snapshot.hydrating?(zh?'正在恢复本机参考图…':'Restoring local reference…'):(zh?'正在保存到本机…':'Saving on this device…')}</p>}
  {snapshot.persistenceError&&<div className="vr-error" role="alert"><p>{zh?'本机参考图保存或恢复失败，刷新后可能丢失。':'Local reference could not be saved or restored; reloading may lose this reference.'} {snapshot.persistenceError}</p><button onClick={()=>void state.retryStorage()}>{snapshot.persistenceFailure==='restore'?(zh?'重试恢复本机参考图':'Retry local restore'):(zh?'重试保存到本机':'Retry local save')}</button></div>}
  {snapshot.error&&<p className="vr-error" role="alert">{t(snapshot.error)}</p>}
 </section>;
}
