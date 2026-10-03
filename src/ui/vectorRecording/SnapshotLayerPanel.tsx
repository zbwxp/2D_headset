import {useMemo,useRef,type ReactNode} from 'react';
import {Copy,Scissors,ClipboardPaste} from 'lucide-react';
import LayerPanel,{type LayerPanelSection} from '../drawing/LayerPanel';
import {selectedLayers,type DrawingSelection,type DrawingTool} from '../drawing/session';
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
 onCut:(sources:SnapshotLayerClipboardSource[])=>void;
 onCopy:(sources:SnapshotLayerClipboardSource[])=>void;onPaste:()=>void;
 onVisibilityChange?:(ids:string[],visible:boolean)=>void;
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

export default function SnapshotLayerPanel({current,sources,selection,layerSelections,onSelection,editEnabled,canPaste,onCut,onCopy,onPaste,onVisibilityChange,onLayerReorder,onSelectSnapshot,selectedSnapshotIds,headerActions,collapseSourcesByDefault=true}:SnapshotLayerPanelProps){
 const zh=useLanguage(s=>s.language)==='zh';
 const model=useMemo(()=>snapshotLayerPanelModel(current,sources,zh?'当前视图':'Current view'),[current,sources,zh]);
 const recentSelection=useRef<SnapshotPanelSelectionCache|null>(null);
 // Preserve the exact shared-panel selection object on our own round trip, so
 // its single Ctrl/Shift anchor survives canonical ID translation.
 const presented=snapshotPanelCachedPresentation(model,selection,layerSelections,recentSelection.current);
 const choose=(next:DrawingSelection,tool?:DrawingTool)=>{const result=snapshotPanelCanonicalSelection(model,next);recentSelection.current={currentSnapshotId:model.currentSnapshotId,canonicalKey:selectionKey(result.selection),layersKey:JSON.stringify(result.layerSelections),presentation:next};onSelection(result.selection,result.layerSelections,tool);};
 const enabled=editEnabled&&!!current;
 const isCurrent=(id:string)=>!!current&&model.identities.get(id)?.snapshotId===current.snapshotId;
 const canonicalCurrent=(ids:readonly string[])=>unique(ids.flatMap(id=>{const ref=model.identities.get(id);return ref&&ref.snapshotId===current?.snapshotId?[ref.id]:[];}));
 const currentSection=model.sections.find(section=>section.id===model.currentSectionId)!;
 const clipboard=(section:LayerPanelSection)=>{
  const isView=section.id===model.currentSectionId;
  const batches=isView&&selectedLayers(presented).length?snapshotPanelClipboardSources(model,presented):snapshotPanelClipboardSources(model,presented,section);
  const disabled=!enabled||!batches.length;
  return <div className="drawing-clipboard-actions snapshot-layer-clipboard" data-testid="snapshot-layer-clipboard" data-section-id={section.id}>
   <button type="button" data-testid={isView?'snapshot-cut-selection':'snapshot-cut-source'} aria-label={zh?'剪切所选图层':'Cut selected layers'} title={zh?'转移图层引用；保留原始元素':'Move layer references; preserve original elements'} disabled={disabled} onClick={()=>{if(!disabled)onCut(batches);}}><Scissors size={14}/></button>
   <button type="button" data-testid={isView?'snapshot-copy-selection':'snapshot-copy-source'} aria-label={zh?'复制所选图层':'Copy selected layers'} title={zh?'复制为新的独立元素':'Copy as new independent elements'} disabled={disabled} onClick={()=>{if(!disabled)onCopy(batches);}}><Copy size={14}/></button>
   {isView&&<button type="button" data-testid="snapshot-paste-selection" aria-label={zh?'粘贴到当前视图':'Paste into current view'} disabled={!enabled||!canPaste} onClick={()=>{if(enabled&&canPaste)onPaste();}}><ClipboardPaste size={14}/></button>}
  </div>;
 };
 return <div className="scene-layer-panel snapshot-layer-panel drawing-sidebar" data-testid="snapshot-layer-panel"><LayerPanel
  document={model.drawing} selection={presented} active={selectedLayers(presented).at(-1)??null} choose={choose} setLayer={ignore}
  layerSections={model.sections} defaultCollapsedSectionIds={collapseSourcesByDefault?model.sections.filter(section=>section.id!==model.currentSectionId).map(section=>section.id):[]} layerOrder={Object.fromEntries(currentSection.layerIds.map((id,index)=>[id,index+1]))}
  poseMode structuralReadOnly editEnabled={enabled} headerActions={headerActions} sectionActions={clipboard}
  canEditLayer={isCurrent} fillVisibilityKey={id=>isCurrent(id)?model.identities.get(id)!.id:id}
  sectionEmptyContent={section=>section.id===model.currentSectionId?<p className="drawing-empty" data-testid="snapshot-empty-view">{current?(zh?'从下方快照剪切或复制图层，再粘贴到当前视图。':'Cut or copy layers from a snapshot below, then paste into this view.'):(zh?'先建立当前角度的视图，再编辑。':'Create a view at this angle to begin editing.')}</p>:null} emptyContent={null}
  onSectionSelect={onSelectSnapshot?(section,event)=>{const source=section.layerIds[0]&&model.identities.get(section.layerIds[0]);const snapshotId=source?source.snapshotId:section.id===model.currentSectionId?current?.snapshotId:model.sections.find(s=>s.id===section.id)?.id.slice('snapshot-section:'.length);if(snapshotId)onSelectSnapshot(snapshotId,{shift:event.shiftKey,toggle:event.ctrlKey||event.metaKey});}:undefined}
  selectedSectionIds={selectedSnapshotIds?.map(sectionId)}
  onVisibilityChange={onVisibilityChange?(ids,visible)=>{if(enabled&&ids.every(isCurrent)){const canonical=canonicalCurrent(ids);if(canonical.length)onVisibilityChange(canonical,visible);}}:undefined}
  onLayerReorder={onLayerReorder?(id,target,after)=>{if(enabled&&isCurrent(id)&&isCurrent(target))onLayerReorder(model.identities.get(id)!.id,model.identities.get(target)!.id,after);}:undefined}
  run={ignore} openProperties={ignore} closeProperties={ignore} upload={ignore} deleteSelected={ignore} cutSelected={ignore} pasteSelected={ignore} canPaste={false}
 /></div>;
}
