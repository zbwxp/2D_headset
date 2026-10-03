import {isLayerControlResponseDomain} from '../../domain/recordingSnapshot/layerDomainControlEdit';
import {NumberField} from './Field';
import {useLanguage} from '../i18n';
import type {SnapshotLayerDomain} from '../../domain/recordingSnapshot/layerDomains';

export default function LayerDomainControls({domains,layerName,onScale,onEnabled,disabled=false}:{domains:readonly SnapshotLayerDomain[];layerName:(id:string)=>string;onScale?:(axis:'x'|'y',scale:number)=>void;disabled?:boolean;onEnabled:(id:string,enabled:boolean)=>void}) {
 const zh=useLanguage(state=>state.language)==='zh';
 const revision=JSON.stringify(domains.map(domain=>[domain.id,domain.enabled,domain]));
 return <div className="drawing-layer-domain-controls" data-testid="drawing-layer-domain-controls">
  {onScale&&<div className="drawing-fields" key={revision}><NumberField label={zh?'宽度缩放 %':'Scale width %'} value={100} min={-1000} max={1000} onChange={value=>onScale('x',value/100)}/><NumberField label={zh?'高度缩放 %':'Scale height %'} value={100} min={-1000} max={1000} onChange={value=>onScale('y',value/100)}/></div>}
  {domains.map((domain,index)=><div className="drawing-property-actions" key={domain.id} data-domain-id={domain.id}>
   <span>{domain.kind==='h-coons'?(zh?'曲边域':'Cage'):isLayerControlResponseDomain(domain)?(zh?'控制点修正':'Control response'):(zh?'变换':'Transform')} {index+1} · {domain.layerIds.map(layerName).join(' / ')}</span>
   <button disabled={disabled} data-testid="drawing-layer-domain-reset" onClick={()=>onEnabled(domain.id,domain.enabled===false)}>{domain.enabled===false?(zh?'恢复变换':'Restore transform'):(zh?'重置变换':'Reset transform')}</button>
  </div>)}
 </div>;
}
