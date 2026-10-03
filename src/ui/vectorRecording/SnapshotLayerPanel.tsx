import {useMemo,useRef,type ReactNode} from 'react';
import {Copy,Scissors,ClipboardPaste} from 'lucide-react';
import LayerPanel,{type LayerPanelSection} from '../drawing/LayerPanel';
import {selectedLayers,selectedObjects,type DrawingSelection,type DrawingTool} from '../drawing/session';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {drawingIdentityIds,remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {useLanguage} from '../i18n';
import '../drawing/drawing.css';
import './SceneLayerPanel.css';

export interface SnapshotPanelSource {snapshotId:string;name:string;drawing:DrawingDocument;layerIds?:readonly string[]}
export interface SnapshotLayerSelection {snapshotId:string;layerId:string}
export interface SnapshotLayerClipboardSource {snapshotId:string;layerIds:string[]}
export interface SnapshotLayerPanelProps {
 current?:SnapshotPanelSource;sources:SnapshotPanelSource[];collapseSourcesByDefault?:boolean;
 selection:DrawingSelection;layerSelections?:readonly SnapshotLayerSelection[];
 onSelection:(selection:DrawingSelection,layerSelections?:SnapshotLayerSelection[],tool?:DrawingTool)=>void;
 editEnabled:boolean;canPaste:boolean;
 onEdit?:(before:DrawingDocument,next:DrawingDocument)=>boolean;onError?:(message:string)=>void;onActiveLayer?:(layerId:string)=>void;
 structuralCommands?:{editable:boolean;disabledReason?:string;addLayer:()=>void;duplicateLayers:(ids:string[])=>void;deleteLayers:(ids:string[])=>void;deleteSelection:()=>void};
 onCut:(sources:SnapshotLayerClipboardSource[])=>void;
 onCopy:(sources:SnapshotLayerClipboardSource[])=>void;onPaste:()=>void;
 onVisibilityChange?:(ids:string[],visible:boolean)=>void;
 onLockChange?:(ids:string[],locked:boolean)=>void;
 onLayerReorder?:(id:string,target:string,after:boolean)=>void;
 onSelectSnapshot?:(snapshotId:string,mods:{shift:boolean;toggle:boolean})=>void;
 selectedSnapshotIds?:readonly string[];headerActions?:ReactNode;
}
interface PresentationIdentity {snapshotId:string;id:string}
export interface SnapshotLayerPanelModel {
 drawing:DrawingDocument;sections:LayerPanelSection[];
 identities:Map<string,PresentationIdentity>;currentSectionId:string;
 currentSnapshotId?:string;
}
/** Display IDs preserve the canonical suffix's order. They exist only in this
 * sidebar projection, never in the canvas, a command, or serialized state. */
export const snapshotPanelRowId=(snapshotId:string,id:string)=>`snapshot-row:${snapshotId.length}:${snapshotId}:${id}`;
const sectionId=(snapshotId:string)=>`snapshot-section:${snapshotId}`;

export function snapshotLayerPanelModel(current:SnapshotPanelSource|undefined,sources:readonly SnapshotPanelSource[],emptyName='Current view'):SnapshotLayerPanelModel {
 const drawing=emptyDrawing(),identities=new Map<string,PresentationIdentity>(),sections:LayerPanelSection[]=[];
 const currentSectionId=current?sectionId(current.snapshotId):'$empty-current-view';
 if(!current)sections.push({id:currentSectionId,name:emptyName,layerIds:[]});
 const seen=new Set<string>();
 for(const source of [...(current?[current]:[]),...sources]){
  if(seen.has(source.snapshotId))continue;seen.add(source.snapshotId);
  const id=(canonicalId:string)=>snapshotPanelRowId(source.snapshotId,canonicalId);
  const remapped=remapDrawingIdentities(source.drawing,id);
  for(const canonicalId of drawingIdentityIds(source.drawing))identities.set(id(canonicalId),{snapshotId:source.snapshotId,id:canonicalId});
  const included=source.layerIds&&new Set(source.layerIds.map(id));
  remapped.layers=remapped.layers.filter(layer=>!included||included.has(layer.id));
  sections.push({id:sectionId(source.snapshotId),name:source.name,layerIds:remapped.layers.map(layer=>layer.id)});
  for(const key of ['nodes','curves','fills','offsets','layers','joins'] as const)(drawing[key] as {id:string}[]).push(...remapped[key]);
  for(const key of ['endpointLinks','groups','displayIntervals'] as const){const values=remapped[key];if(values?.length)(drawing[key]??=[] as never[]).push(...values as never[]);}
 }
 return {drawing,sections,identities,currentSectionId,currentSnapshotId:current?.snapshotId};
}
/** Translate the shared sidebar command output exactly once. A displayed
 * source section is read-only even when it reuses every canonical ID here. */
export function snapshotPanelCanonicalEdit(model:SnapshotLayerPanelModel,current:SnapshotPanelSource,next:DrawingDocument):{drawing:DrawingDocument;model:SnapshotLayerPanelModel}{
 if(model.currentSnapshotId!==current.snapshotId)throw Error('The current Snapshot section changed during this edit.');
 const categories=['nodes','curves','fills','offsets','layers','joins','endpointLinks','groups','displayIntervals'] as const,identities=new Map(model.identities),same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 for(const category of categories){const other=(values:readonly {id:string}[])=>values.filter(value=>{const owner=model.identities.get(value.id);return owner&&owner.snapshotId!==current.snapshotId;});if(!same(other(model.drawing[category]??[]),other(next[category]??[])))throw Error('Source sections are read-only. Move or order members only inside the current Snapshot.');}
 const newLayers=next.layers.filter(layer=>!identities.has(layer.id));
 for(const layer of newLayers){if(!layer.items.every(id=>identities.get(id)?.snapshotId===current.snapshotId))throw Error('A new current layer cannot take members from a source section.');identities.set(layer.id,{snapshotId:current.snapshotId,id:layer.id});}
 for(const id of drawingIdentityIds(next))if(!identities.has(id))throw Error('The sidebar command created an unsupported object identity.');
 const projected=emptyDrawing();for(const category of categories)(projected[category] as {id:string}[]|undefined)=((next[category]??[]) as {id:string}[]).filter(value=>identities.get(value.id)?.snapshotId===current.snapshotId);
 const mapped=remapDrawingIdentities(projected,id=>{const ref=identities.get(id);if(!ref||ref.snapshotId!==current.snapshotId)throw Error('A current Snapshot member cannot depend on a displayed source-section identity.');return ref.id;});
 const drawing={...current.drawing};for(const category of categories)Object.assign(drawing,{[category]:mapped[category]});
 return {drawing,model:{...model,identities}};
}

const unique=(ids:string[])=>[...new Set(ids)];
export function snapshotPanelCanonicalSelection(model:SnapshotLayerPanelModel,selection:DrawingSelection):{selection:DrawingSelection;layerSelections:SnapshotLayerSelection[]} {
 const canonical=(ids:readonly string[])=>unique(ids.flatMap(id=>{const ref=model.identities.get(id);return ref?[ref.id]:[];}));
 const layers=canonical(selectedLayers(selection));
 const layerSelections=selectedLayers(selection).flatMap(id=>{const ref=model.identities.get(id);return ref?[{snapshotId:ref.snapshotId,layerId:ref.id}]:[];});
 return {selection:{ids:canonical(selection.ids),...(selection.paintIds?{paintIds:canonical(selection.paintIds)}:{}),...(layers.length?{layers,layer:layers.length===1?layers[0]:undefined}:{}),...(selection.paint?{paint:model.identities.get(selection.paint)?.id}:{}),...(selection.group?{group:model.identities.get(selection.group)?.id}:{})},layerSelections};
}
export function snapshotPanelPresentationSelection(model:SnapshotLayerPanelModel,selection:DrawingSelection,layerSelections?:readonly SnapshotLayerSelection[]):DrawingSelection {
 const rowsFor=(ids:readonly string[])=>[...model.identities].filter(([,ref])=>ids.includes(ref.id)).map(([id])=>id);
 const layers=layerSelections?layerSelections.map(ref=>snapshotPanelRowId(ref.snapshotId,ref.layerId)).filter(id=>model.drawing.layers.some(layer=>layer.id===id)):rowsFor(selectedLayers(selection)).filter(id=>model.drawing.layers.some(layer=>layer.id===id));
 return {ids:rowsFor(selection.ids),...(selection.paintIds?{paintIds:rowsFor(selection.paintIds)}:{}),...(layers.length?{layers,layer:layers.length===1?layers[0]:undefined}:{}),...(selection.paint?{paint:rowsFor([selection.paint])[0]}:{}),...(selection.group?{group:rowsFor([selection.group])[0]}:{})};
}
/** Clipboard payloads identify the exact snapshot membership path even when
 * several displayed rows refer to the same canonical element or layer. */
export function snapshotPanelClipboardSources(model:SnapshotLayerPanelModel,selection:DrawingSelection,section?:LayerPanelSection):SnapshotLayerClipboardSource[] {
 const selected=selectedLayers(selection),scope=section?selected.filter(id=>section.layerIds.includes(id)):selected;
 const ids=scope.length?scope:section?.layerIds??[];
 const batches=new Map<string,string[]>();
 for(const id of ids){const ref=model.identities.get(id);if(!ref||!model.drawing.layers.some(layer=>layer.id===id))continue;const list=batches.get(ref.snapshotId)??[];if(!list.includes(ref.id))list.push(ref.id);batches.set(ref.snapshotId,list);}
 return [...batches].map(([snapshotId,layerIds])=>({snapshotId,layerIds}));
}
const selectionKey=(selection:DrawingSelection)=>JSON.stringify([selection.ids,selection.paintIds??[],selectedLayers(selection),selection.paint??null,selection.group??null]);
export interface SnapshotPanelSelectionCache {currentSnapshotId?:string;canonicalKey:string;layersKey:string;presentation:DrawingSelection}
export function snapshotPanelCachedPresentation(model:SnapshotLayerPanelModel,selection:DrawingSelection,layerSelections:readonly SnapshotLayerSelection[]|undefined,recent:SnapshotPanelSelectionCache|null):DrawingSelection {
 return recent?.currentSnapshotId===model.currentSnapshotId&&recent?.canonicalKey===selectionKey(selection)&&(!layerSelections||recent.layersKey===JSON.stringify(layerSelections))?recent.presentation:snapshotPanelPresentationSelection(model,selection,layerSelections);
}
const ignore=()=>{};

export default function SnapshotLayerPanel({current,sources,selection,layerSelections,onSelection,editEnabled,canPaste,onCut,onCopy,onPaste,onVisibilityChange,onLockChange,onLayerReorder,onSelectSnapshot,selectedSnapshotIds,headerActions,collapseSourcesByDefault=true,structuralCommands,onEdit,onError,onActiveLayer}:SnapshotLayerPanelProps){
 const zh=useLanguage(s=>s.language)==='zh';
 const model=useMemo(()=>snapshotLayerPanelModel(current,sources,zh?'当前视图':'Current view'),[current,sources,zh]);
 const recentSelection=useRef<SnapshotPanelSelectionCache|null>(null);
 const running=useRef(false),pendingSelection=useRef<{selection:DrawingSelection;tool?:DrawingTool}|undefined>(undefined),pendingLayer=useRef<string|undefined>(undefined);
 // Preserve the exact shared-panel selection object on our own round trip, so
 // its single Ctrl/Shift anchor survives canonical ID translation.
 const presented=snapshotPanelCachedPresentation(model,selection,layerSelections,recentSelection.current);
 const choose=(next:DrawingSelection,tool?:DrawingTool)=>{if(running.current){pendingSelection.current={selection:next,tool};return;}const result=snapshotPanelCanonicalSelection(model,next);recentSelection.current={currentSnapshotId:model.currentSnapshotId,canonicalKey:selectionKey(result.selection),layersKey:JSON.stringify(result.layerSelections),presentation:next};onSelection(result.selection,result.layerSelections,tool);};
 const enabled=editEnabled&&!!current;
 const setLayer=(id:string)=>{if(running.current){pendingLayer.current=id;return;}const ref=model.identities.get(id);if(ref?.snapshotId===current?.snapshotId)onActiveLayer?.(ref!.id);};
 const run=(operation:()=>DrawingDocument)=>{if(!enabled||!current||!structuralCommands?.editable||!onEdit)return;running.current=true;pendingSelection.current=undefined;pendingLayer.current=undefined;try{
  const plan=snapshotPanelCanonicalEdit(model,current,operation());if(!onEdit(current.drawing,plan.drawing))return;
  if(pendingLayer.current){const ref=plan.model.identities.get(pendingLayer.current);if(ref?.snapshotId===current.snapshotId)onActiveLayer?.(ref.id);}
  const pending=pendingSelection.current as {selection:DrawingSelection;tool?:DrawingTool}|undefined;if(pending){const result=snapshotPanelCanonicalSelection(plan.model,pending.selection),row=(id:string)=>model.identities.has(id)?id:snapshotPanelRowId(current.snapshotId,plan.model.identities.get(id)!.id),selection=pending.selection,presentation={...selection,ids:selection.ids.map(row),...(selection.layers?{layers:selection.layers.map(row)}:{}),...(selection.layer?{layer:row(selection.layer)}:{}),...(selection.paintIds?{paintIds:selection.paintIds.map(row)}:{}),...(selection.paint?{paint:row(selection.paint)}:{}),...(selection.group?{group:row(selection.group)}:{})};recentSelection.current={currentSnapshotId:model.currentSnapshotId,canonicalKey:selectionKey(result.selection),layersKey:JSON.stringify(result.layerSelections),presentation};onSelection(result.selection,result.layerSelections,pending.tool);}
 }catch(error){onError?.((error as Error).message);}finally{running.current=false;pendingSelection.current=undefined;pendingLayer.current=undefined;}};

 const isCurrent=(id:string)=>!!current&&model.identities.get(id)?.snapshotId===current.snapshotId;
 const canonicalCurrent=(ids:readonly string[])=>unique(ids.flatMap(id=>{const ref=model.identities.get(id);return ref&&ref.snapshotId===current?.snapshotId?[ref.id]:[];}));
 const currentSection=model.sections.find(section=>section.id===model.currentSectionId)!;
 const selectedRows=[...selectedObjects(presented),...selectedLayers(presented)],exactRows=recentSelection.current?.presentation===presented;
 const canDelete=!!structuralCommands?.editable&&selectedRows.length>0&&(exactRows?selectedRows.every(isCurrent):selectedObjects(selection).every(id=>!!current?.drawing.layers.some(layer=>layer.items.includes(id)))&&(layerSelections??[]).every(ref=>ref.snapshotId===current?.snapshotId));
 const clipboard=(section:LayerPanelSection)=>{
  const isView=section.id===model.currentSectionId;
  const batches=isView&&selectedLayers(presented).length?snapshotPanelClipboardSources(model,presented):snapshotPanelClipboardSources(model,presented,section);
  const disabled=!enabled||!batches.length;
  return <div className="drawing-clipboard-actions snapshot-layer-clipboard" data-testid="snapshot-layer-clipboard" data-section-id={section.id}>
   <button type="button" data-testid={isView?'snapshot-cut-selection':'snapshot-cut-source'} aria-label={zh?'取所选图层引用':'Take selected layer references'} title={zh?'取得同 ID 图层引用；来源仍保留':'Take same-ID layer references; keep the source'} disabled={disabled} onClick={()=>{if(!disabled)onCut(batches);}}><Scissors size={14}/></button>
   <button type="button" data-testid={isView?'snapshot-copy-selection':'snapshot-copy-source'} aria-label={zh?'复制所选图层':'Copy selected layers'} title={zh?'按当前形状创建独立副本：新 ID，不再随来源变化':'Create a current-shape independent copy: new IDs, disconnected from the source'} disabled={disabled} onClick={()=>{if(!disabled)onCopy(batches);}}><Copy size={14}/></button>
   {isView&&<button type="button" data-testid="snapshot-paste-selection" aria-label={zh?'粘贴到当前视图':'Paste into current view'} disabled={!enabled||!canPaste} onClick={()=>{if(enabled&&canPaste)onPaste();}}><ClipboardPaste size={14}/></button>}
  </div>;
 };
 return <div className="scene-layer-panel snapshot-layer-panel drawing-sidebar" data-testid="snapshot-layer-panel"><LayerPanel
  document={model.drawing} selection={presented} active={selectedLayers(presented).at(-1)??null} choose={choose} setLayer={setLayer}
  layerSections={model.sections} defaultCollapsedSectionIds={collapseSourcesByDefault?model.sections.filter(section=>section.id!==model.currentSectionId).map(section=>section.id):[]} layerOrder={Object.fromEntries(currentSection.layerIds.map((id,index)=>[id,index+1]))}
  poseMode structuralReadOnly={!structuralCommands?.editable||!onEdit} editEnabled={enabled} headerActions={headerActions} sectionActions={clipboard}
  structuralCommands={structuralCommands?{canEditSection:section=>structuralCommands.editable&&section.id===model.currentSectionId,addLayer:section=>{if(structuralCommands.editable&&section.id===model.currentSectionId)structuralCommands.addLayer();},duplicateLayers:ids=>{if(structuralCommands.editable&&ids.every(isCurrent))structuralCommands.duplicateLayers(canonicalCurrent(ids));},deleteLayers:ids=>{if(structuralCommands.editable&&ids.every(isCurrent))structuralCommands.deleteLayers(canonicalCurrent(ids));},deleteSelection:()=>{if(canDelete)structuralCommands.deleteSelection();},canDeleteSelection:canDelete,disabledReason:structuralCommands.disabledReason}:undefined}
  canEditLayer={isCurrent} fillVisibilityKey={id=>isCurrent(id)?model.identities.get(id)!.id:id}
  sectionEmptyContent={section=>section.id===model.currentSectionId?<p className="drawing-empty" data-testid="snapshot-empty-view">{current?(structuralCommands?.editable?(zh?'新建图层后按 P 绘制，或从下方快照取图层引用。':'Create a layer and press P to draw, or take layer references from a source below.'):(zh?'从下方快照取图层引用，再粘贴到当前视图。':'Take layer references from a source below, then paste into this view.')):(zh?'先建立当前角度的视图，再编辑。':'Create a view at this angle to begin editing.')}</p>:null} emptyContent={null}
  onSectionSelect={onSelectSnapshot?(section,event)=>{const source=section.layerIds[0]&&model.identities.get(section.layerIds[0]);const snapshotId=source?source.snapshotId:section.id===model.currentSectionId?current?.snapshotId:model.sections.find(s=>s.id===section.id)?.id.slice('snapshot-section:'.length);if(snapshotId)onSelectSnapshot(snapshotId,{shift:event.shiftKey,toggle:event.ctrlKey||event.metaKey});}:undefined}
  selectedSectionIds={selectedSnapshotIds?.map(sectionId)}
  onLockChange={onLockChange?(ids,locked)=>{if(enabled&&ids.every(isCurrent)){const canonical=canonicalCurrent(ids);if(canonical.length)onLockChange(canonical,locked);}}:undefined}
  onVisibilityChange={onVisibilityChange?(ids,visible)=>{if(enabled&&ids.every(isCurrent)){const canonical=canonicalCurrent(ids);if(canonical.length)onVisibilityChange(canonical,visible);}}:undefined}
  onLayerReorder={onLayerReorder?(id,target,after)=>{if(enabled&&isCurrent(id)&&isCurrent(target))onLayerReorder(model.identities.get(id)!.id,model.identities.get(target)!.id,after);}:undefined}
  run={run} openProperties={ignore} closeProperties={ignore} upload={ignore} deleteSelected={ignore} cutSelected={ignore} pasteSelected={ignore} canPaste={false}
 /></div>;
}
