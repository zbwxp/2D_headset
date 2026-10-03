import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test,vi} from 'vitest';
import LayerPanel,{groupedLayerSections,layerSectionSelectedBatchScope,type LayerPanelSection} from '../ui/drawing/LayerPanel';
import {drawingListRows,layerBatchScope,selectLayerRows,selectListRows} from '../ui/drawing/listSelection';
import {useDrawing,type DrawingSelection} from '../ui/drawing/session';
import {addLayer,createCurve,ellipse,curveChange,reorderLayers,duplicateLayer,deleteLayers} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {createGroup,groupObjectIds} from '../domain/drawing/groups';
import {setObjectState} from '../domain/drawing/objectState';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';

// The mounted view reads the live session. SSR's default external-store snapshot
// is the initial state, so explicitly expose the current state for view assertions.
vi.mock('../ui/drawing/session',async importOriginal=>{
 const m=await importOriginal<typeof import('../ui/drawing/session')>();
 return {...m,useDrawing:Object.assign((selector?:(s:ReturnType<typeof m.useDrawing.getState>)=>unknown)=>selector?selector(m.useDrawing.getState()):m.useDrawing.getState(),m.useDrawing)};
});
const initial=useDrawing.getState();afterEach(()=>useDrawing.setState(initial,true));
const ignore=()=>{};
function fixture(){
 let d=addLayer(emptyDrawing(),'Eye');const eye=d.layers[0].id,e=ellipse(d,eye,[-.4,-.3],[.4,.3],.02);d=createFill(e.document,e.ids,'white');
 d=createCurve(d,eye,[[0,.6],[.1,.7],[.2,.7],[.3,.6]],.01,'Brow','brow');d=createOffset(d,'brow');d=createGroup(d,[e.ids[0],'brow'],'Facial group');d=curveChange(d,'brow',{visible:false,locked:true});
 d=addLayer(d,'Empty');const empty=d.layers[0].id;d=addLayer(d,'Other');const other=d.layers[0].id;d=createCurve(d,other,[[1,0],[1,1],[2,1],[2,0]],.01,'Other line','other');
 return {d,eye,empty,other,ellipseIds:e.ids,section:{id:'drawing-artwork',name:'Current authored drawing',layerIds:d.layers.map(l=>l.id)} satisfies LayerPanelSection};
}
function render(d:DrawingDocument,selection:DrawingSelection={ids:[]},section?:LayerPanelSection|LayerPanelSection[],collapsed:string[]=[]){
 return renderToStaticMarkup(createElement(LayerPanel,{document:d,active:selection.layer??d.layers[0]?.id??null,selection,run:ignore,choose:ignore,setLayer:ignore,openProperties:ignore,closeProperties:ignore,upload:ignore,deleteSelected:ignore,cutSelected:ignore,pasteSelected:ignore,canPaste:true,restoreLayer:ignore,...(section?{layerSections:Array.isArray(section)?section:[section]}:{}),defaultCollapsedSectionIds:collapsed}));
}
function button(html:string,id:string){return html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0]??'';}

test('one Drawing snapshot uses the shared outer section and retains the full authoring toolbar and original rows',()=>{
 const f=fixture(),before=JSON.stringify(f.d),html=render(f.d,{ids:['brow']},f.section);
 expect((html.match(/data-testid="drawing-layer-section-tools"/g)??[])).toHaveLength(1);expect((html.match(/data-testid="drawing-layer-section-toggle"/g)??[])).toHaveLength(1);expect(html).toContain('Current authored drawing');
 for(const id of ['drawing-new-layer','drawing-cut-selection','drawing-paste-selection','drawing-delete-selection','drawing-toggle-all','drawing-toggle-fills','drawing-collapse-all'])expect(html).toContain(`data-testid="${id}"`);
 expect(html).toContain('aria-label="复制图层"');expect(html).toContain('aria-label="删除图层"');expect((html.match(/data-testid="drawing-restore-layer"/g)??[])).toHaveLength(3);expect(html).toContain('data-testid="drawing-group-row"');expect(html).toContain('data-testid="drawing-chain-select"');expect(html).toContain('data-testid="drawing-paint-row"');
 expect(button(html,'drawing-new-layer')).not.toContain('disabled');expect(button(html,'drawing-layer-lock')).not.toContain('disabled');expect(html).not.toContain('drawing-pose-explanation');expect(html).toContain('draggable="true"');expect(JSON.stringify(f.d)).toBe(before);
});

test('an empty Drawing still has an enabled create-layer control in its sole shared section',()=>{
 const d=emptyDrawing(),html=render(d,{ids:[]},{id:'$working',name:'Unsaved drawing',layerIds:[]});expect((html.match(/data-testid="drawing-layer-section-tools"/g)??[])).toHaveLength(1);expect(button(html,'drawing-new-layer')).not.toContain('disabled');expect(button(html,'drawing-new-layer')).not.toBe('');expect(button(html,'drawing-toggle-all')).toContain('disabled');expect(button(html,'drawing-collapse-all')).toContain('disabled');
});

test('Drawing selected-layer batching has exactly the old scope for every subset, including hidden, locked and empty members',()=>{
 const f=fixture();for(const selected of [[],[f.eye],[f.empty],[f.other,f.eye],f.d.layers.map(l=>l.id)])expect(layerSectionSelectedBatchScope(f.d,f.section,selected)).toEqual(layerBatchScope(f.d,selected));
 const scope=layerSectionSelectedBatchScope(f.d,f.section,[f.eye,f.empty]);expect(scope.items).toContain('brow');expect(scope.items).toContain(f.d.fills[0].id);expect(scope.items).toContain(f.d.offsets[0].id);expect(scope.foldIds).toContain(f.d.groups![0].id);expect(scope.items).not.toContain('other');
 const changed=setObjectState(f.d,scope.items,{visible:false,locked:true});expect(changed.curves.find(c=>c.id==='other')).toBe(f.d.curves.find(c=>c.id==='other'));expect(changed.nodes).toBe(f.d.nodes);expect(changed.curves.map(c=>[c.id,c.nodes,c.handles])).toEqual(f.d.curves.map(c=>[c.id,c.nodes,c.handles]));
});

test('Ctrl and Shift layer ranges retain their Drawing anchor across an empty layer in the shared displayed order',()=>{
 const f=fixture(),layers=groupedLayerSections(f.d.layers,[f.section]).flatMap(g=>g.layers),plain={shift:false,toggle:false};expect(layers).toEqual(f.d.layers);
 const first=selectLayerRows(layers,null,f.eye,[],plain),all=selectLayerRows(layers,first.anchor,f.other,first.ids,{shift:true,toggle:false});expect(all.ids).toEqual([f.other,f.empty,f.eye]);expect(all.anchor).toBe(first.anchor);
 const shorter=selectLayerRows(layers,all.anchor,f.empty,all.ids,{shift:true,toggle:false});expect(shorter.ids).toEqual([f.empty,f.eye]);expect(shorter.anchor).toBe(first.anchor);
 expect(selectLayerRows(layers,shorter.anchor,f.empty,shorter.ids,{shift:false,toggle:true}).ids).toEqual([f.eye]);expect(selectLayerRows(layers,first.anchor,f.other,[f.eye],{shift:false,toggle:true}).ids).toEqual([f.other,f.eye]);
});

test('group, stroke and member Ctrl/Shift selection preserves complete Drawing group contents without treating headings as objects',()=>{
 const f=fixture(),g=f.d.groups![0],rows=drawingListRows({...f.d,layers:groupedLayerSections(f.d.layers,[f.section]).flatMap(s=>s.layers)},[]),groupKey=`group:${g.id}`;
 expect(rows.some(r=>r.key==='section:drawing-artwork')).toBe(false);const picked=selectListRows(rows,null,groupKey,[],{shift:false,toggle:false});expect(new Set(picked.ids)).toEqual(new Set(groupObjectIds(f.d,g)));expect(picked.ids).toContain('brow');expect(picked.ids).toContain(f.d.fills[0].id);
 const cross=selectListRows(rows,picked.anchor,'curve:other',picked.ids,{shift:false,toggle:true});expect(cross.ids).toContain('other');expect(groupObjectIds(f.d,g).every(id=>cross.ids.includes(id))).toBe(true);
 expect(selectListRows(rows,cross.anchor,groupKey,cross.ids,{shift:false,toggle:true}).ids).toEqual(['other']);const folded=drawingListRows(f.d,[g.id]);expect(folded.find(r=>r.key===groupKey)?.ids).toEqual(groupObjectIds(f.d,g));expect(folded.some(r=>r.key==='curve:brow')).toBe(false);
});

test('fill preview and folded state stay transient while toolbar labels retain Drawing selected-layer semantics',()=>{
 const f=fixture(),before=JSON.stringify(f.d);useDrawing.getState().set({showFills:true,fillVisibility:{[f.eye]:false},closedLayers:[...layerBatchScope(f.d,[f.eye]).foldIds]});
 const html=render(f.d,{ids:[],layers:[f.eye],layer:f.eye},f.section);expect(button(html,'drawing-toggle-fills')).toContain('aria-label="显示所选图层填充"');expect(button(html,'drawing-toggle-fills')).toContain('aria-pressed="false"');expect(button(html,'drawing-collapse-all')).toContain('aria-label="展开所选图层"');expect(html).toContain('aria-label="复制所选图层"');expect(html).toContain('aria-label="删除所选图层"');expect(JSON.stringify(f.d)).toBe(before);
 const emptyHtml=render(f.d,{ids:[],layers:[f.empty],layer:f.empty},f.section);expect(button(emptyHtml,'drawing-toggle-all')).toContain('disabled');expect(button(emptyHtml,'drawing-toggle-fills')).toContain('disabled');expect(button(emptyHtml,'drawing-collapse-all')).not.toContain('disabled');expect(emptyHtml.match(/<button[^>]*aria-label="复制所选图层"[^>]*>/)?.[0]).not.toContain('disabled');
});

test('single-snapshot grouping does not reorder source layers or change structural duplicate/delete lock rules',()=>{
 const f=fixture(),before=JSON.stringify(f.d),moved=reorderLayers(f.d,f.other,f.eye,true),section={...f.section,layerIds:moved.layers.map(l=>l.id)};
 expect(groupedLayerSections(moved.layers,[section]).flatMap(g=>g.layers.map(l=>l.id))).toEqual([f.empty,f.eye,f.other]);expect([...render(moved,{ids:[]},section).matchAll(/data-testid="drawing-layer" data-id="([^"]+)"/g)].map(m=>m[1])).toEqual([f.empty,f.eye,f.other]);expect(moved.nodes).toBe(f.d.nodes);expect(moved.curves).toBe(f.d.curves);
 expect(()=>deleteLayers(f.d,[f.eye])).toThrow(/锁定/);const copied=duplicateLayer(f.d,f.empty);expect(copied.layers).toHaveLength(f.d.layers.length+1);expect(copied.layers[0].items).toEqual([]);expect(deleteLayers(f.d,[f.empty]).layers.map(l=>l.id)).toEqual([f.other,f.eye]);expect(JSON.stringify(f.d)).toBe(before);
});


test('each snapshot keeps its own title and scoped tools in one sticky chrome while rows remain outside',()=>{
 const f=fixture(),sections=[{id:'current',name:'Current view',layerIds:[f.eye,f.empty]},{id:'source',name:'Source artwork',layerIds:[f.other]}],html=render(f.d,{ids:[],layers:[f.eye,f.other]},sections);
 const chrome=[...html.matchAll(/class="drawing-layer-section-chrome"[^>]*>([\s\S]*?)<\/header><\/div>/g)].map(match=>match[1]);expect(chrome).toHaveLength(2);
 for(const part of chrome){expect(part).toContain('drawing-layer-section-header');expect(part).toContain('drawing-layer-section-tools');expect(part).toContain('drawing-toggle-all');expect(part).toContain('drawing-toggle-fills');expect(part).toContain('drawing-collapse-all');expect(part).not.toContain('data-testid="drawing-layer"');}
 expect(chrome[0]).toContain('Current view');expect(chrome[0]).not.toContain('Source artwork');expect(chrome[1]).toContain('Source artwork');expect((html.match(/data-testid="drawing-layer"/g)??[])).toHaveLength(3);
 const collapsed=render(f.d,{ids:[]},sections,['source']);expect(collapsed).toContain('Source artwork');expect((collapsed.match(/data-testid="drawing-layer-section-chrome"/g)??[])).toHaveLength(2);expect(collapsed).not.toContain(`data-testid="drawing-layer" data-id="${f.other}"`);
});
