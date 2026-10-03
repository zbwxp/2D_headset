import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {addLayer,createCurve,ellipse,curveChange} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {createGroup} from '../domain/drawing/groups';
import {emptyDrawing} from '../domain/drawing/model';
import {groupedLayerSections} from '../ui/drawing/LayerPanel';
import {drawingListRows,selectLayerRows,selectListRows} from '../ui/drawing/listSelection';
import SnapshotLayerPanel,{snapshotLayerPanelModel,snapshotPanelCanonicalSelection,snapshotPanelPresentationSelection,snapshotPanelClipboardSources,snapshotPanelRowId,snapshotPanelCachedPresentation,type SnapshotPanelSource,type SnapshotLayerPanelProps} from '../ui/vectorRecording/SnapshotLayerPanel';

vi.mock('../ui/drawing/workspace',async()=>{const {useDrawing}=await import('../ui/drawing/session');return {useDrawingWorkspace:()=>({session:useDrawing})};});
const ignore=()=>{};
test('a canonical curve stays highlighted when a different view needs a new presentation alias',()=>{const f=fixture(),first=snapshotLayerPanelModel(f.current,[]),second=snapshotLayerPanelModel({...f.current,snapshotId:'view-45'},[]),selection={ids:['brow']},presentation=snapshotPanelPresentationSelection(first,selection,[]),cache={currentSnapshotId:first.currentSnapshotId,canonicalKey:JSON.stringify([['brow'],[],[],null,null]),layersKey:'[]',presentation};expect(snapshotPanelCachedPresentation(first,selection,[],cache)).toBe(presentation);const next=snapshotPanelCachedPresentation(second,selection,[],cache);expect(next.ids).toEqual([snapshotPanelRowId('view-45','brow')]);expect(snapshotPanelCanonicalSelection(second,next).selection.ids).toEqual(['brow']);expect(snapshotPanelCachedPresentation(first,selection,[],cache)).toBe(presentation);});
function fixture(){
 let drawing=addLayer(emptyDrawing(),'Eye');const eye=drawing.layers[0].id,e=ellipse(drawing,eye,[-.4,-.3],[.4,.3],.02);
 drawing=createFill(e.document,e.ids,'white');drawing=createCurve(drawing,eye,[[-.4,.5],[-.2,.7],[.2,.7],[.4,.5]],.01,'Brow','brow');drawing=createOffset(drawing,'brow');drawing=createGroup(drawing,[e.ids[0],'brow'],'Face');
 drawing=addLayer(drawing,'Empty');
 const source:SnapshotPanelSource={snapshotId:'source:one',name:'Source one',drawing};
 return {drawing,eye,source,current:{snapshotId:'view',name:'Current view',drawing:curveChange(drawing,'brow',{visible:false})} satisfies SnapshotPanelSource};
}
function render(overrides:Partial<SnapshotLayerPanelProps>={}){
 const f=fixture();return renderToStaticMarkup(createElement(SnapshotLayerPanel,{current:f.current,sources:[f.source],selection:{ids:[]},onSelection:ignore,editEnabled:true,canPaste:true,onCut:ignore,onCopy:ignore,onPaste:ignore,onVisibilityChange:ignore,onLayerReorder:ignore,...overrides}));
}
const button=(html:string,id:string)=>html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0]??'';
const section=(html:string,id:string)=>html.split(`<div class="drawing-layer-section" data-testid="drawing-layer-section" data-section-id="snapshot-section:${id}">`)[1]?.split('<div class="drawing-layer-section"')[0]??'';

test('current and source rows coexist with independent evaluated appearance and no stored geometry changes',()=>{
 const f=fixture(),before=JSON.stringify(f),model=snapshotLayerPanelModel(f.current,[f.source]);
 expect(model.sections.map(s=>s.name)).toEqual(['Current view','Source one']);
 expect(groupedLayerSections(model.drawing.layers,model.sections).map(s=>s.layers.length)).toEqual([2,2]);
 expect(model.drawing.curves.find(c=>c.id===snapshotPanelRowId('view','brow'))?.visible).toBe(false);
 expect(model.drawing.curves.find(c=>c.id===snapshotPanelRowId(f.source.snapshotId,'brow'))?.visible).toBe(true);
 expect(new Set(model.drawing.curves.map(c=>c.id)).size).toBe(model.drawing.curves.length);
 expect(JSON.stringify(f)).toBe(before);
 const html=render({current:f.current,sources:[f.source]});
 expect((html.match(/data-testid="drawing-group-row"/g)??[])).toHaveLength(1);
 expect((html.match(/data-testid="drawing-paint-row"/g)??[])).toHaveLength(2);
});

test('one shared layer range crosses source sections, including empty layers and repeated canonical IDs',()=>{
 const f=fixture(),second={...f.source,snapshotId:'source:two',name:'Source two'},model=snapshotLayerPanelModel(undefined,[f.source,second]);
 const layers=groupedLayerSections(model.drawing.layers,model.sections).flatMap(g=>g.layers);
 const first=selectLayerRows(layers,null,layers[0].id,[],{shift:false,toggle:false});
 const range=selectLayerRows(layers,first.anchor,layers[3].id,first.ids,{shift:true,toggle:false});
 expect(range.ids).toEqual(layers.map(l=>l.id));expect(range.anchor).toBe(first.anchor);
 const toggled=selectLayerRows(layers,range.anchor,layers[2].id,range.ids,{shift:false,toggle:true});expect(toggled.ids).toEqual([layers[0].id,layers[1].id,layers[3].id]);
 const chosen=snapshotPanelCanonicalSelection(model,{ids:layers.flatMap(l=>l.items),layers:range.ids});
 expect(chosen.selection.layers).toEqual(f.drawing.layers.map(l=>l.id));
 expect(chosen.layerSelections).toHaveLength(4);
 expect(chosen.selection.ids).toEqual([...new Set(chosen.selection.ids)]);
 expect(snapshotPanelClipboardSources(model,{ids:[],layers:range.ids})).toEqual([
  {snapshotId:f.source.snapshotId,layerIds:f.drawing.layers.map(l=>l.id)},
  {snapshotId:second.snapshotId,layerIds:f.drawing.layers.map(l=>l.id)},
 ]);
});

test('canonical object selection round trips with explicit snapshot layer paths and complete group members',()=>{
 const f=fixture(),model=snapshotLayerPanelModel(f.current,[f.source]),rows=drawingListRows(model.drawing,[]),group=f.drawing.groups![0];
 const first=selectListRows(rows,null,`group:${snapshotPanelRowId(f.source.snapshotId,group.id)}`,[],{shift:false,toggle:false});
 const result=snapshotPanelCanonicalSelection(model,{ids:first.ids.filter(id=>model.drawing.curves.some(c=>c.id===id)),paintIds:first.ids.filter(id=>model.drawing.fills.some(fill=>fill.id===id))});
 expect(result.selection.ids).toContain('brow');expect(result.selection.paintIds).toContain(f.drawing.fills[0].id);
 const presentation=snapshotPanelPresentationSelection(model,{ids:['brow'],layers:[f.eye]},[{snapshotId:f.source.snapshotId,layerId:f.eye}]);
 expect(presentation.ids).toContain(snapshotPanelRowId('view','brow'));
 expect(presentation.layers).toEqual([snapshotPanelRowId(f.source.snapshotId,f.eye)]);
});

test('empty established view retains its header and paste toolbar above all source sections',()=>{
 const f=fixture(),html=render({current:{...f.current,drawing:emptyDrawing()},sources:[f.source]});
 expect(html).toContain('data-testid="snapshot-empty-view"');expect(html.indexOf('Current view')).toBeLessThan(html.indexOf('Source one'));
 expect(button(html,'snapshot-paste-selection')).not.toContain('disabled');
 expect(button(html,'snapshot-cut-source')).not.toContain('disabled');
 expect(html).not.toContain('data-testid="drawing-new-layer"');
});

test('editing requires an established view and source rows remain selectable with disabled eyes and reorder',()=>{
 const f=fixture(),html=render({current:f.current,sources:[f.source]});
 const current=section(html,'view'),source=section(html,f.source.snapshotId);
 expect(button(current,'drawing-layer-visibility')).toContain('disabled'); // First layer is empty.
 expect(button(current,'drawing-toggle-all')).not.toContain('disabled');
 expect(button(source,'drawing-toggle-all')).toContain('disabled');
 expect(source).not.toContain('data-testid="drawing-layer-select"');expect(source.match(/<button[^>]*data-testid="drawing-layer-section-toggle"[^>]*>/)?.[0]).toContain('aria-expanded="false"');
 expect(source).not.toContain('draggable="true"');expect(current).toContain('draggable="true"');
 for(const override of [{current:undefined},{editEnabled:false}]){
  const blocked=render(override);
  for(const id of ['snapshot-cut-selection','snapshot-copy-selection','snapshot-paste-selection','snapshot-cut-source','snapshot-copy-source'])expect(button(blocked,id)).toContain('disabled');
 }
});

test('source filtering and repeated current input preserve only requested visible rows without consuming source sections',()=>{
 const f=fixture(),source={...f.source,layerIds:[f.eye]},model=snapshotLayerPanelModel(f.current,[f.current,source]);
 expect(model.sections).toHaveLength(2);expect(model.sections[1].layerIds).toEqual([snapshotPanelRowId(source.snapshotId,f.eye)]);
 expect(snapshotPanelClipboardSources(model,{ids:[]},model.sections[1])).toEqual([{snapshotId:source.snapshotId,layerIds:[f.eye]}]);
});

test('only the current view starts expanded; source sections remain named and available without rendering their member trees',()=>{const f=fixture(),html=render({current:f.current,sources:[f.source,{...f.source,snapshotId:'source:two',name:'Source two'}]});expect(section(html,'view')).toContain('data-testid="drawing-curve-row"');for(const id of [f.source.snapshotId,'source:two']){const source=section(html,id);expect(source).toContain('snapshot-cut-source');expect(source).toContain('aria-expanded="false"');expect(source).not.toContain('data-testid="drawing-curve-row"');}});
