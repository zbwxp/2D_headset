import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {parseDrawing,type Point2,type DrawingDocument as Doc} from '../domain/drawing/model';
import {moveNode,moveHandle,transform} from '../domain/drawing/commands';
import {dragNode} from '../domain/drawing/nodeDrag';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {transportDeformedIntervals,deformDrawing} from '../domain/drawing/deform';
import {changeDisplayInterval} from '../domain/drawing/displayIntervals';
import {nudgeSelection} from '../ui/drawing/nudge';
import {createVectorEditingApi,type VectorCommand} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
const source=()=>parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),'utf8')));
const node='3b549fd7-f52f-4bbb-8f26-5062596bc381',jaw='65450d8d-7c62-4d87-b421-616dfbcab097';
function viaApi(d:Doc,commands:VectorCommand[]){let current=d;const api=createVectorEditingApi({getState:()=>({project:{...createEmptyProject(),drawing:current},past:[],future:[]}),getMode:()=> 'drawing',commitDrawing(d){current=d;},undo(){},redo(){}}),r=api.execute({commands});expect(r).toMatchObject({ok:true,value:{applied:true}});return current;}
function cuts(d:Doc){return d.displayIntervals!.map(t=>t.ranges.map(r=>[r.start,r.end]));}
test.each([[0,.01],[.01,0],[0,-.03],[-.03,0]] as Point2[])('pointer, numeric command, keyboard and API node moves share exactly one material transport (%s,%s)',(dx,dy)=>{
 const delta:Point2=[dx,dy],d=source(),before=JSON.stringify(d),p=d.nodes.find(n=>n.id===node)!.position,target:Point2=[p[0]+delta[0],p[1]+delta[1]],pointer=finalizeGeometryEdit(d,dragNode(d,node,target,0)),direct=finalizeGeometryEdit(d,moveNode(d,node,target)),keyboard=finalizeGeometryEdit(d,nudgeSelection(d,{ids:[jaw],node},delta)),api=viaApi(d,[{op:'moveNode',nodeId:node,position:target}]);
 expect(cuts(pointer)).toEqual(cuts(api));expect(cuts(direct)).toEqual(cuts(api));expect(cuts(keyboard)).toEqual(cuts(api));expect(finalizeGeometryEdit(d,pointer)).toBe(pointer);expect(JSON.stringify(d)).toBe(before);
});
test('follow-strength handle rotation finishes before transport and repeat previews always start from the gesture base',()=>{
 const d=source(),p=d.nodes.find(n=>n.id===node)!.position,target:Point2=[p[0]+.02,p[1]+.015],raw=dragNode(d,node,target,.65),preview=finalizeGeometryEdit(d,raw),expected=transportDeformedIntervals(d,raw);
 expect(preview.curves).toEqual(raw.curves);expect(cuts(preview)).toEqual(cuts(expected));expect(cuts(finalizeGeometryEdit(d,dragNode(d,node,target,.65)))).toEqual(cuts(preview));expect(finalizeGeometryEdit(d,preview)).toBe(preview);
});
test('handle and whole-object transformations get the same material result as API, while authored interval edits pass through',()=>{
 const d=source(),h=d.curves.find(c=>c.id===jaw)!.handles[0],target:Point2=[h[0]-.01,h[1]+.02],handle=finalizeGeometryEdit(d,moveHandle(d,{curveId:jaw,end:0},target)),api=viaApi(d,[{op:'moveHandle',curveId:jaw,end:0,position:target}]);expect(cuts(handle)).toEqual(cuts(api));
 const ids=d.curves.map(c=>c.id),moved=finalizeGeometryEdit(d,transform(d,ids,([x,y])=>[x+.01,y+.02],true)),apiMoved=viaApi(d,[{op:'transformCurves',curveIds:ids,matrix:[1,0,0,1,.01,.02],allowRelated:true}]);expect(cuts(moved)).toEqual(cuts(apiMoved));
 const track=d.displayIntervals![0],range=track.ranges[0],edited=changeDisplayInterval(d,track.id,range.id,{start:range.start+.001});expect(finalizeGeometryEdit(d,edited)).toBe(edited);
});
test('quad deformation and already-normalized API results are never transported twice',()=>{
 const d=source(),ids=d.curves.map(c=>c.id),rect={min:[-1.5,-1.5] as Point2,max:[1,1.5] as Point2},quad:[Point2,Point2,Point2,Point2]=[[-1.5,-1.5],[1.02,-1.5],[1,1.52],[-1.5,1.5]],result=deformDrawing(d,ids,rect,quad,true).document;
 expect(result.displayIntervals).not.toBe(d.displayIntervals);expect(finalizeGeometryEdit(d,result)).toBe(result);expect(cuts(result)).not.toEqual(cuts(d));
});
test('the real store finalizes direct property edits once and keeps one exact Undo/Redo transaction',()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();try{useWorkspaceMode.getState().setMode('drawing');const d=source(),project={...createEmptyProject(),drawing:d};useEditor.setState({project,past:[],future:[]});const p=d.nodes.find(n=>n.id===node)!.position,raw=moveNode(d,node,[p[0],p[1]+.01]),expected=finalizeGeometryEdit(d,raw),s=useEditor.getState();s.beginEdit();s.setDrawing(raw);s.endEdit();expect(useEditor.getState().project.drawing).toEqual(expected);expect(useEditor.getState().past).toHaveLength(1);s.undo();expect(useEditor.getState().project).toBe(project);s.redo();expect(useEditor.getState().project.drawing).toEqual(expected);}finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});
