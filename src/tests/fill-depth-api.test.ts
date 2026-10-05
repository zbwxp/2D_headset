import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorCommand,type VectorEditingHost,type VectorResult} from '../app/vectorEditingApi';
import type {LandmarkProject} from '../domain/landmarks/model';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {createFill,changePaint} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {setDepthOffset} from '../domain/drawing/depth';
import AppearanceControls from '../ui/drawing/AppearanceControls';
import SnapshotDrawingProperties from '../ui/vectorRecording/SnapshotDrawingProperties';

function fixture(){
 let drawing=addLayer(emptyDrawing(),'Back');const ellipseResult=ellipse(drawing,drawing.layers[0].id,[-1,-1],[1,1],.01);drawing=createFill(ellipseResult.document,ellipseResult.ids,'white');
 drawing=addLayer(drawing,'Front');drawing=createCurve(drawing,drawing.layers[0].id,[[-1,0],[-.3,0],[.3,0],[1,0]],.05,'Front line','front-line');
 return drawing;
}
function harness(drawing=fixture()){
 let project:LandmarkProject={...createEmptyProject(),drawing},past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const host:VectorEditingHost={getMode:()=> 'drawing',getState:()=>({project,past,future}),commitDrawing(next){past.push(project);project={...project,drawing:next};future=[];},undo(){const next=past.pop();if(next){future.unshift(project);project=next;}},redo(){const next=future.shift();if(next){past.push(project);project=next;}}};
 return {api:createVectorEditingApi(host),state:()=>({project,past,future})};
}
function value<T>(result:VectorResult<T>):T{expect(result.ok,result.ok?'':JSON.stringify(result.error)).toBe(true);if(!result.ok)throw Error(result.error.message);return result.value;}

it('authors a fill depth through the ordinary API, exports matching SVG order and restores one history entry',()=>{
 const h=harness(),before=h.state().project.drawing!,fillId=before.fills[0].id,beforeSvg=value(h.api.preview()).svg;
 const revision=h.api.inspect().revision;
 const dry=value(h.api.execute({commands:[{op:'setDepth',fillId,offset:1,scope:'LAYER'}],expectedRevision:revision,dryRun:true}));expect(dry.applied).toBe(false);expect(h.state().past).toHaveLength(0);
 value(h.api.execute({commands:[{op:'setDepth',fillId,offset:1,scope:'LAYER'}],expectedRevision:revision}));const after=h.state().project.drawing!;
 expect(after.fills[0]).toMatchObject({id:fillId,depthOffset:1,depthScope:'LAYER'});expect(after.layers).toEqual(before.layers);expect(after.nodes).toEqual(before.nodes);expect(after.curves).toEqual(before.curves);expect(after.fills[0].boundary).toEqual(before.fills[0].boundary);expect(h.state().past).toHaveLength(1);
 const afterSvg=value(h.api.preview()).svg,fillMark=`data-testid="drawing-fill" data-id="${fillId}"`,lineMark='data-testid="drawing-hit" data-id="front-line"';
 // Preview export uses preview=true and excludes picking paths; the source
 // stroke's stable owner is also present on its visible ink product.
 expect(beforeSvg).toContain(fillMark);expect(afterSvg).toContain(fillMark);
 const strokeMark='data-stroke="front-line"';expect(beforeSvg).toContain(strokeMark);expect(afterSvg).toContain(strokeMark);
 expect(beforeSvg.indexOf(fillMark)).toBeLessThan(beforeSvg.indexOf(strokeMark));expect(afterSvg.indexOf(fillMark)).toBeGreaterThan(afterSvg.indexOf(strokeMark));expect(afterSvg).not.toContain(lineMark);
 expect(parseDrawing(JSON.parse(JSON.stringify(after))).fills[0]).toMatchObject({depthOffset:1,depthScope:'LAYER'});
 expect(parseDrawing(JSON.parse(value(h.api.exportSource()).json)).fills[0]).toMatchObject({depthOffset:1,depthScope:'LAYER'});
 expect(value(h.api.inspect()).fills.find(fill=>fill.id===fillId)).toMatchObject({depthOffset:1,depthScope:'LAYER'});
 value(h.api.undo());expect(h.state().project.drawing).toBe(before);value(h.api.redo());expect(h.state().project.drawing).toBe(after);
});

it.each([true,false])('Recording consumes the shared fill controls with real-view editability %s',editable=>{
 const drawing=fixture(),fillId=drawing.fills[0].id;
 const html=renderToStaticMarkup(createElement(SnapshotDrawingProperties,{drawing,selection:{ids:[],paint:fillId},choose:()=>{},run:()=>{},preview:()=>{},session:{current:()=>drawing,undo:()=>{},redo:()=>{}},tool:()=>{},transform:()=>{},propertiesEditable:editable,topologyEditable:editable,geometryEditable:true,intervalEditable:true,onPosition:()=>{}}));
 expect(html.match(/data-testid="drawing-depth-controls"/g)).toHaveLength(1);
 const fieldset=html.match(/<fieldset[^>]*class="snapshot-properties-fields"[^>]*>/)?.[0];expect(fieldset).toBeDefined();
 if(editable)expect(fieldset).not.toContain('disabled');else expect(fieldset).toContain('disabled');
});

it('rejects ambiguous targets, invalid depth, missing fills, locked fills and cutouts without partial writes',()=>{
 const drawing=fixture(),fillId=drawing.fills[0].id;
 const commands=[{op:'setDepth',fillId,curveId:'front-line',offset:1},{op:'setDepth',offset:1},{op:'setDepth',fillId,offset:.5},{op:'setDepth',fillId,offset:10001},{op:'setDepth',fillId:'missing',offset:1}];
 for(const command of commands){const h=harness(drawing),before=h.state().project;expect(h.api.execute({commands:[command as VectorCommand]}).ok).toBe(false);expect(h.state().project).toBe(before);expect(h.state().past).toHaveLength(0);}
 for(const patch of [{locked:true},{color:'transparent' as const}]){const h=harness(changePaint(drawing,fillId,patch)),before=h.state().project;expect(h.api.execute({commands:[{op:'setDepth',fillId,offset:1,scope:'LAYER'}]}).ok).toBe(false);expect(h.state().project).toBe(before);expect(h.state().past).toHaveLength(0);}
});

it('shares the same fill depth widgets in appearance controls and clearly disables transparent cutouts',()=>{
 const base=fixture(),fillId=base.fills[0].id,drawing=setDepthOffset(base,fillId,1,'LAYER'),render=(d:DrawingDocument)=>renderToStaticMarkup(createElement(AppearanceControls,{d,selection:{ids:[],paint:fillId},run:()=>{},choose:()=>{},preview:()=>{}}));
 const solid=render(drawing),cutout=render(changePaint(drawing,fillId,{color:'transparent'}));
 expect(solid).toContain('data-testid="drawing-depth-controls"');expect(solid).toContain('所属图层与边界曲线不变');
 expect(cutout).toContain('不按深度排序');expect(cutout).toMatch(/aria-label="深度基准"[^>]*disabled/);expect(cutout).toContain('恢复保存的偏移');
});
