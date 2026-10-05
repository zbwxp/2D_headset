import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test,vi} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {instanceObjectId} from '../domain/recordingScene/model';
import SceneWarpCanvas,{recordingCurveSelection,recordingZoomAt} from '../ui/vectorRecording/SceneWarpCanvas';
import {useDrawing} from '../ui/drawing/session';

vi.mock('../ui/drawing/session',async importOriginal=>{
 const actual=await importOriginal<typeof import('../ui/drawing/session')>();
 return {...actual,useDrawing:Object.assign((selector:(s:ReturnType<typeof actual.useDrawing.getState>)=>unknown)=>selector(actual.useDrawing.getState()),actual.useDrawing)};
});
afterEach(()=>useDrawing.getState().set({showFills:true,fillVisibility:{}}));
const id=(name:string,instance='instance/one')=>instanceObjectId(instance,name);
function fixture(){
 const d=emptyDrawing();d.layers=[{id:id('layer'),name:'Layer',visible:true,locked:false,items:[]}];
 function line(name:string,a:Point2,b:Point2,options:{start?:string;end?:string;visible?:boolean;locked?:boolean;instance?:string}={}){
  const objectId=id(name,options.instance),from=id(options.start??`${name}-start`,options.instance),to=id(options.end??`${name}-end`,options.instance);
  if(!d.nodes.some(n=>n.id===from))d.nodes.push({id:from,position:a});if(!d.nodes.some(n=>n.id===to))d.nodes.push({id:to,position:b});
  d.curves.push({id:objectId,name,nodes:[from,to],handles:[[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3]],visible:options.visible??true,locked:options.locked??false,width:.01});d.layers[0].items.push(objectId);
 }
 line('a',[0,0],[1,0],{end:'shared'});line('b',[1,0],[2,0],{start:'shared'});line('separate',[0,1],[1,1]);line('hidden',[0,2],[1,2],{visible:false});line('locked',[1,2],[2,2],{locked:true});line('a',[0,3],[1,3],{instance:'instance/two'});
 return d;
}
test('V follows continuous stroke topology, while A preserves the exact compiled source-curve ID',()=>{
 const d=fixture(),before=JSON.stringify(d);
 expect(recordingCurveSelection(d,{ids:[]},id('a'),'select')?.ids).toEqual([id('a'),id('b')]);
 expect(recordingCurveSelection(d,{ids:[id('a'),id('b')]},id('b'),'direct')?.ids).toEqual([id('b')]);
 expect(recordingCurveSelection(d,{ids:[]},id('a','instance/two'),'select')?.ids).toEqual([id('a','instance/two')]);
 expect(JSON.stringify(d)).toBe(before);
});
test('V keeps an existing complete multi-selection when clicking one selected stroke',()=>{const d=fixture(),selected={ids:[id('a'),id('b'),id('separate')]};expect(recordingCurveSelection(d,selected,id('a'),'select')?.ids).toEqual(selected.ids);expect(recordingCurveSelection(d,selected,id('a'),'direct')?.ids).toEqual([id('a')]);});
test('V retains complete organizational groups including hidden and locked members; Shift toggles the unit',()=>{
 const d=fixture();d.groups=[{id:id('group'),name:'Group',visible:true,locked:false,curveIds:['a','b','separate','hidden','locked'].map(name=>id(name))}];
 const selected=recordingCurveSelection(d,{ids:[]},id('a'),'select')!;expect(selected.ids).toEqual(['a','b','separate','hidden','locked'].map(name=>id(name)));
 expect(recordingCurveSelection(d,{ids:[id('a','instance/two'),id('hidden')]},id('a'),'select',true)?.ids).toEqual([id('a','instance/two'),id('hidden'),...selected.ids.filter(value=>value!==id('hidden'))]);
 expect(recordingCurveSelection(d,selected,id('a'),'select',true)?.ids).toEqual([]);
 expect(recordingCurveSelection(d,selected,id('hidden'),'direct')).toBeNull();expect(recordingCurveSelection(d,selected,id('locked'),'select')).toBeNull();
});
test.each([.0001,.5,1.3,7,100])('zoom %s preserves its pointer anchor with translated center and existing pan',value=>{
 const view={center:[7,-3] as Point2,size:{width:800,height:650},unit:250,zoom:2},point:Point2=[143,219],pan:Point2=[34,-51],anchor:Point2=[(point[0]-400-pan[0])/250+7,-(point[1]-325-pan[1])/250-3],next=recordingZoomAt(point,anchor,view,value),unit=view.unit*next.zoom/view.zoom;
 expect(next.zoom).toBeGreaterThanOrEqual(.1);expect(next.zoom).toBeLessThanOrEqual(12);
 expect(400+(anchor[0]-7)*unit+next.pan[0]).toBeCloseTo(point[0],10);expect(325-(anchor[1]+3)*unit+next.pan[1]).toBeCloseTo(point[1],10);
});
function render(d:DrawingDocument){return renderToStaticMarkup(createElement(SceneWarpCanvas,{source:d,drawing:d,grid:createWarpGrid({min:[-1,-1],max:[3,3]}),targetKey:'fixture',label:'Fixture',zh:false,editEnabled:false,selection:{ids:[id('a'),id('hidden'),id('locked')]},onPreview:()=>{},onCommit:()=>{throw Error('Source is read-only');}}));}
test('read-only view renders Drawing navigation tools and filtered selections without source edit controls',()=>{
 const d=fixture(),before=JSON.stringify(d),html=render(d);
 for(const tool of ['select','direct','hand','zoom'])expect(html).toContain(`data-testid="vr-tool-${tool}"`);
 expect(html).toContain('data-edit-enabled="false"');expect(html.match(/data-testid="vr-node"/g)).toHaveLength(9);expect(html.match(/data-testid="vr-selected-curve"/g)).toHaveLength(1);
 expect(html).not.toContain('data-testid="drawing-node"');expect(html).not.toContain('data-testid="drawing-handle"');expect(html).not.toContain('data-testid="drawing-tool-pen"');expect(JSON.stringify(d)).toBe(before);
});
test('without an active Warp, Recording labels describe curve selection and endpoint editing',()=>{
 const d=fixture(),html=renderToStaticMarkup(createElement(SceneWarpCanvas,{source:d,drawing:d,targetKey:'no-warp',label:'Fixture',zh:false,onPreview:()=>{},onCommit:()=>{}}));
 expect(html).toContain('aria-label="Recording drawing canvas"');expect(html).toContain('drawing-tools recording-drawing-tools');expect(html).toContain('V selects strokes · A endpoints/handles');expect(html).not.toContain('select layers to create a Warp');
});
test('PaintScene receives both global and per-layer fill visibility from the shared Drawing session',()=>{
 const d=emptyDrawing(),points:Point2[]=[[0,0],[1,0],[1,1],[0,1]],layer=id('fills');d.layers=[{id:layer,name:'Fills',visible:true,locked:false,items:[]}];
 points.forEach((p,i)=>d.nodes.push({id:id(`n${i}`),position:p}));points.forEach((p,i)=>{const q=points[(i+1)%4],curve=id(`c${i}`);d.curves.push({id:curve,name:curve,nodes:[id(`n${i}`),id(`n${(i+1)%4}`)],handles:[[p[0]+(q[0]-p[0])/3,p[1]+(q[1]-p[1])/3],[p[0]+2*(q[0]-p[0])/3,p[1]+2*(q[1]-p[1])/3]],visible:false,locked:false,width:.01});d.layers[0].items.push(curve);});
 d.fills=[{id:id('fill'),name:'Fill',visible:true,locked:false,color:'black',boundary:points.map((_,i)=>({id:id(`c${i}`),reverse:false}))}];d.layers[0].items.push(id('fill'));
 useDrawing.getState().set({showFills:true,fillVisibility:{[layer]:false}});expect(render(d)).not.toContain('data-testid="drawing-fill"');
 useDrawing.getState().set({showFills:false,fillVisibility:{[layer]:true}});expect(render(d)).toContain('data-testid="drawing-fill"');
 useDrawing.getState().set({showFills:false,fillVisibility:{}});expect(render(d)).not.toContain('data-testid="drawing-fill"');
});
