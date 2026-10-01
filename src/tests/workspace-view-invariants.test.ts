import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import rawSource from '../assets/hairless-symmetric-two-face.json';
import mirrorRecipe from '../../docs/examples/two-face-mirror-editing-setup.json';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {emptyWorkspaceView,getWorkspaceView,prepareWorkspaceView,replaceWorkspaceView,type WorkspaceView} from '../app/workspaceView';
import {snapWorkspacePoint,visibleSnapFragments} from '../app/workspaceViewSnap';
import {nodeAt,shapeOf,parseDrawing,emptyDrawing,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';
import {addLayer,createCurve,moveHandle} from '../domain/drawing/commands';
import {dragNode} from '../domain/drawing/nodeDrag';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {validateMirrorEditing,type MirrorEditingConfig} from '../domain/drawing/mirrorEditing';
import {point} from '../domain/drawing/sampling';
import {displayPath,displayField} from '../domain/drawing/displayIntervals';
import ArtworkReference,{cachedArtworkReference} from '../ui/workspaceView/ArtworkReference';
import ViewGuidesOverlay from '../ui/workspaceView/ViewGuidesOverlay';

const source=parseDrawing(rawSource),saved=saveDrawingSnapshot({drawing:source},'Actual two-face'),library=saved.drawingSnapshots!,artworkId=library.activeId!;
const recording={...emptyVectorRecording(),rigs:[createArtworkRig(artworkId,source)]},project={...createEmptyProject(),...saved,vectorRecording:recording};
const val=<T>(r:{ok:true;value:T}|{ok:false;error:unknown})=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const link=source.endpointLinks!.find(l=>l.throughDisplay)!,route=source.displayIntervals!.find(t=>t.displayRoute)!.displayRoute!;

test('actual source, artwork library, rig, history, revision and clean JSON/SVG are untouched by view edits',()=>{
 let view=emptyWorkspaceView();const before=JSON.stringify(project),api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=> 'recording',getView:()=>view,replaceView(v){view=v;},commitDrawing(){throw Error('Source commit forbidden');},commitRecording(){throw Error('Rig commit forbidden');},undo(){throw Error('History mutation forbidden');},redo(){}}),revision=api.inspect().revision;
 const sourceExport=val(api.exportSource()),sourceSvg=val(api.preview({showFills:false})).svg,poseSvg=val(api.previewRecording({showFills:false})).svg;
 val(api.view({commands:[{op:'setReference',artworkId,offset:[2.5,-.4],scale:1.7,opacity:.4,snap:true},{op:'addGuide',id:'x-review',axis:'x',value:.3},{op:'addGuide',id:'y-review',axis:'y',value:-.2},{op:'setGuideOptions',rulers:true}]}));
 expect(view.reference?.artworkId).toBe(artworkId);expect(view.guides).toHaveLength(2);expect(api.inspect().revision).toBe(revision);expect(JSON.stringify(project)).toBe(before);expect(project.drawing).toBe(source);expect(project.drawingSnapshots).toBe(library);expect(project.vectorRecording).toBe(recording);
 expect(val(api.exportSource()).json).toBe(sourceExport.json);expect(val(api.exportSource({includeReference:true})).json).not.toContain('x-review');expect(val(api.preview({showFills:false})).svg).toBe(sourceSvg);expect(val(api.previewRecording({showFills:false})).svg).toBe(poseSvg);
 for(const svg of [sourceSvg,poseSvg]){expect(svg).not.toContain('artwork-view-reference');expect(svg).not.toContain('workspace-view-guides');}
});

test.each([{unit:125,pan:[0,0] as Point2},{unit:250,pan:[57,-31] as Point2},{unit:1000,pan:[-310,145] as Point2}])('guide world coordinates track camera pan/zoom $unit/$pan',({unit,pan})=>{
 const view=prepareWorkspaceView(emptyWorkspaceView(),[{op:'addGuide',id:'vertical',axis:'x',value:.25},{op:'addGuide',id:'horizontal',axis:'y',value:-.3},{op:'setGuideOptions',rulers:true}]),screen=([x,y]:Point2):Point2=>[320+x*unit+pan[0],240-y*unit+pan[1]],svg=renderToStaticMarkup(createElement(ViewGuidesOverlay,{view,screen,unit,width:640,height:480}));
 const vertical=svg.match(/<line[^>]*data-guide-id="vertical"[^>]*>/)![0],horizontal=svg.match(/<line[^>]*data-guide-id="horizontal"[^>]*>/)![0];
 expect(vertical).toContain(`x1="${screen([.25,0])[0]}"`);expect(vertical).toContain(`x2="${screen([.25,0])[0]}"`);expect(horizontal).toContain(`y1="${screen([0,-.3])[1]}"`);expect(horizontal).toContain(`y2="${screen([0,-.3])[1]}"`);expect(vertical).toContain('pointer-events="none"');expect(horizontal).toContain('pointer-events="none"');
});

test.each([125,250,1000])('snap capture remains8 CSS pixels at zoom%s',pixelsPerUnit=>{
 const view=prepareWorkspaceView(emptyWorkspaceView(),[{op:'addGuide',id:'height',axis:'y',value:.17}]),exclude=source.curves.map(c=>c.id),unit=1/pixelsPerUnit;
 expect(snapWorkspacePoint(source,library,view,[3,.17+7.9*unit],unit,8,exclude)?.point).toEqual([3,.17]);expect(snapWorkspacePoint(source,library,view,[3,.17+8.1*unit],unit,8,exclude)).toBeNull();
});

test('actual transformed reference intersection reports canonical source t after clipping/reversal',()=>{
 const ref={artworkId,offset:[2.5,-.4] as Point2,scale:1.7,opacity:.4,visible:true,snap:true},before=JSON.stringify({source,library}),exclude=source.curves.map(c=>c.id);
 for(const id of [link.a.curveId,link.b.curveId]){
  const p=point(shapeOf(source,id),.5),mapped:Point2=[p[0]*ref.scale+ref.offset[0],p[1]*ref.scale+ref.offset[1]],view:WorkspaceView={...emptyWorkspaceView(),reference:ref,guides:[{id:'height',axis:'y',value:mapped[1]}]},hit=snapWorkspacePoint(source,library,view,[mapped[0]+.002,mapped[1]+.001],1/250,8,exclude)!;
  expect(hit.kind).toBe('curve-guide');expect(hit.target?.source).toBe('reference');expect(hit.target?.curveId).toBe(id);expect(hit.target&&'sourceT'in hit.target?hit.target.sourceT:undefined).toBeCloseTo(.5,10);expect(distance(hit.point,mapped)).toBeLessThan(1e-10);
  const hidden=snapWorkspacePoint(source,library,{...view,reference:{...ref,visible:false}},[mapped[0]+.002,mapped[1]+.001],1/250,8,exclude)!;expect(hidden.kind).toBe('guide');
 }
 expect(JSON.stringify({source,library})).toBe(before);
});

test('hidden closure centerlines are absent while the visible linked ARC retains derived provenance',()=>{
 const path=displayPath(source,link.a.curveId),fragments=visibleSnapFragments(source),closedEnds=[path.segments[0].id,path.segments.at(-1)!.id];expect(path.closed).toBe(false);
 for(const id of closedEnds)expect(fragments.some(f=>f.curveIds.includes(id))).toBe(false);
 const arc=fragments.find(f=>f.joinId)!,p=point(arc.curve,.5),view:WorkspaceView={...emptyWorkspaceView(),guides:[{id:'arc-crossing',axis:'x',value:p[0]}]},hit=snapWorkspacePoint(source,library,view,[p[0]+.001,p[1]+.001],1/250)!;
 expect(hit.kind).toBe('curve-guide');expect(hit.target&&'joinId'in hit.target?hit.target.joinId:undefined).toBe(arc.joinId);expect(hit.target?.curveIds.slice().sort()).toEqual([link.a.curveId,link.b.curveId].sort());expect(hit.target).not.toHaveProperty('sourceT');expect(distance(hit.point,p)).toBeLessThan(1e-10);
});

test('reference rendering uses a nonselectable isolated image with the same scale/offset as snapping',()=>{
 const before=useEditor.getState(),oldView=getWorkspaceView();let d=addLayer(emptyDrawing(),'Reference');d=createCurve(d,d.layers[0].id,[[-1,-.5],[-.3,.4],[.3,.4],[1,-.5]],.01);const snapshot=saveDrawingSnapshot({drawing:d},'Small reference'),ref={artworkId:snapshot.drawingSnapshots!.activeId!,offset:[2,3] as Point2,scale:1.7,opacity:.4,visible:true,snap:true},savedDrawing=snapshot.drawingSnapshots!.items[0].drawing;
 // The client component reads live Zustand state. SSR normally substitutes its
 // boot snapshot, so this renderer-only seam selects the same live read as UI.
 const live=vi.spyOn(React,'useSyncExternalStore').mockImplementation((_,read)=>read());
 try{useEditor.setState({project:{...project,drawingSnapshots:snapshot.drawingSnapshots}});replaceWorkspaceView({...emptyWorkspaceView(),reference:ref});const unit=175,screen=([x,y]:Point2):Point2=>[300+x*unit+17,240-y*unit-22],image=cachedArtworkReference(savedDrawing),p=screen([image.min[0]*ref.scale+2,image.max[1]*ref.scale+3]),svg=renderToStaticMarkup(createElement(ArtworkReference,{screen,unit}));
  expect(svg).toMatch(/^<image /);expect(svg).toContain('data-testid="artwork-view-reference"');expect(svg).toContain('pointer-events="none"');expect(svg).toContain(`x="${p[0]}"`);expect(svg).toContain(`y="${p[1]}"`);expect(svg).toContain(`width="${(image.max[0]-image.min[0])*ref.scale*unit}"`);expect(svg).not.toContain('data-node=');expect(svg).not.toContain('data-testid="drawing-curve"');
 }finally{live.mockRestore();useEditor.setState(before,true);replaceWorkspaceView(oldView);}
});

test('snap suggestions still pass through linked/mirror constraints and locked followers cannot be bypassed',()=>{
 const d:DrawingDocument={...source,mirrorEditing:structuredClone(mirrorRecipe.config) as MirrorEditingConfig},before=JSON.stringify(d),axis=d.mirrorAxisX!,node=nodeAt(d,link.a),view:WorkspaceView={...emptyWorkspaceView(),guides:[{id:'off-axis',axis:'x',value:axis+.008}]},exclude=d.curves.map(c=>c.id),hit=snapWorkspacePoint(d,library,view,[axis+.009,node.position[1]-.015],1/250,8,exclude)!;
 expect(hit.point[0]).toBe(axis+.008);const raw=dragNode(d,node.id,hit.point,0),actual=raw.nodes.find(n=>n.id===node.id)!.position,next=finalizeGeometryEdit(d,raw,{nodes:[{nodeId:node.id,position:actual}]});
 expect(nodeAt(next,link.a).position).toEqual([axis,hit.point[1]]);expect(nodeAt(next,link.b).position).toEqual(nodeAt(next,link.a).position);expect(validateMirrorEditing(next).enabled).toBe(true);expect(displayField(next,displayPath(next,link.a.curveId)).mask).toHaveLength(1);
 const self=d.mirrorEditing!.curvePairs.find(p=>p.a===p.b&&!p.reverse)!,handle=d.curves.find(c=>c.id===self.a)!.handles[0],handleHit=snapWorkspacePoint(d,library,view,[axis+.009,handle[1]+.01],1/250,8,exclude)!,moved=moveHandle(d,{curveId:self.a,end:0},handleHit.point),final=finalizeGeometryEdit(d,moved,{handles:[{curveId:self.a,end:0,position:handleHit.point}]});expect(final.curves.find(c=>c.id===self.a)!.handles[0][0]).toBe(axis);expect(validateMirrorEditing(final).enabled).toBe(true);
 const locked={...d,curves:d.curves.map(c=>c.id===link.b.curveId?{...c,locked:true}:c)};expect(()=>dragNode(locked,node.id,hit.point,0)).toThrow(/锁定/);expect(JSON.stringify(d)).toBe(before);expect(next.fills).toEqual(d.fills);expect(next.layers).toEqual(d.layers);
});
