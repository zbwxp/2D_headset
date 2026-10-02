import type {ReactNode} from 'react';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {ReferenceImage} from '../../domain/project/types';
import {NumberField} from '../drawing/Field';
import ReferencePositionControls from './ReferencePositionControls';
import {uiText as t} from '../i18n';

export interface DrawingReferenceControlsProps {
 document:DrawingDocument;
 current:()=>DrawingDocument|undefined;
 run:(change:()=>DrawingDocument)=>void;
 preview:(drawing:DrawingDocument|null)=>void;
 upload:()=>void;
 moveReference:()=>void;
 moving?:boolean;
 busy?:boolean;
 help?:ReactNode;
}
/** One reference-image UI; each workspace owns its commit and preview adapters. */
export default function DrawingReferenceControls({document:d,current,run,preview,upload,moveReference,moving,busy=false,help}:DrawingReferenceControlsProps){
 const reference=d.reference;
 function patch(change:Partial<ReferenceImage>){
  run(()=>{const base=current()??d;return base.reference?{...base,reference:{...base.reference,...change}}:base;});
 }
 if(!reference)return <button disabled={busy} onClick={upload}>{t(busy?'正在载入…':'载入参考照片')}</button>;
 return <div className="drawing-reference-controls" data-testid="drawing-reference-controls" data-ui-keyboard>
  <strong>{reference.name}</strong><p className="drawing-muted">{help??t('参考图不参与线稿绘制。')}</p>
  <div className="drawing-property-actions">
   <button onClick={upload} disabled={reference.locked||busy}>{t(busy?'正在载入…':'替换照片')}</button>
   <button onClick={moveReference} disabled={reference.locked||!reference.visible||busy} aria-pressed={moving}>{t(moving?'完成图片平移':'平移图片')}</button>
  </div>
  <div className="drawing-property-actions">
   <label className="drawing-check"><input style={{width:'auto'}} type="checkbox" aria-label={t('显示参考图')} checked={reference.visible} onChange={e=>patch({visible:e.target.checked})}/>{t('显示参考图')}</label>
   <button aria-label={t(reference.locked?'解锁参考图':'锁定参考图')} aria-pressed={reference.locked} onClick={()=>patch({locked:!reference.locked})}>{t(reference.locked?'解锁参考图':'锁定参考图')}</button>
  </div>
  <NumberField label="图片透明度 %" value={reference.opacity*100} min={0} max={100} disabled={reference.locked} onChange={v=>patch({opacity:v/100})}/>
  <NumberField label="图片缩放 %" value={reference.scale*100} min={10} max={1000} disabled={reference.locked} onChange={v=>patch({scale:v/100})}/>
  <NumberField label="旋转" value={reference.rotation} min={-180} max={180} disabled={reference.locked} onChange={v=>patch({rotation:v})}/>
  <ReferencePositionControls document={d} current={current} run={run} preview={preview}/>
  <button disabled={reference.locked} onClick={()=>run(()=>({...current()??d,reference:undefined}))}>{t('移除参考照片')}</button>
 </div>;
}
