import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyDrawing,parseDrawing,layerFor,type DrawingDocument as Doc,type Point2,type Cubic,type DepthAppearance} from '../domain/drawing/model';
import {depthContext,depthPaintBatches,setDepthOffset} from '../domain/drawing/depth';
import {changePaint,movePaint} from '../domain/drawing/paintCommands';
import {duplicateLayer,moveToLayer} from '../domain/drawing/commands';
import {cutDrawing,pasteDrawingCut} from '../domain/drawing/clipboard';
import {fillGeometry,displayInkSampling} from '../domain/drawing/appearance';
import {prepareDrawingReadContext,retainPreparedDrawingReadContext,withDrawingReadScope} from '../domain/drawing/readContext';
import {createPaintProductReader} from '../ui/drawing/paintProducts';
import PaintScene from '../ui/drawing/PaintScene';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function addLayer(d:Doc,id:string){d.layers.push({id,name:id,visible:true,locked:false,items:[]});}
function addLoop(d:Doc,layerId:string,id:string,x=0){
 const points:Point2[]=[[x,0],[x+1,0],[x,.8]],ids=points.map((_,i)=>`${id}${i}`);
 d.nodes.push(...points.map((position,i)=>({id:`${ids[i]}:node`,position})));
 d.curves.push(...points.map((p,i)=>{const next=(i+1)%points.length,shape=line(p,points[next]);return {id:ids[i],name:ids[i],visible:true,locked:false,width:.02,nodes:[`${ids[i]}:node`,`${ids[next]}:node`] as [string,string],handles:[shape[1],shape[2]] as [Point2,Point2]};}));
 const fill={id:`${id}:fill`,name:`${id} fill`,visible:true,locked:false,color:'white' as const,boundary:ids.map(id=>({id,reverse:false}))};d.fills.push(fill);d.layers.find(l=>l.id===layerId)!.items.push(...ids,fill.id);
 return ids;
}
function fixture(){const d=emptyDrawing();addLayer(d,'layer');addLoop(d,'layer','a');addLoop(d,'layer','b',.2);return d;}
const order=(d:Doc)=>depthPaintBatches(d).map(b=>b.owner??b.item.id);
const batch=(d:Doc,id:string)=>depthPaintBatches(d).find(b=>(b.owner??b.item.id)===id)!;
const render=(d:Doc,preview=true)=>renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d,screen:(p:Point2)=>p,unit:250,preview,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}})));

test('absent and explicit zero fill depth retain the exact legacy queue and SVG',()=>{
 const d=fixture(),zero={...d,fills:d.fills.map(f=>({...f,depthOffset:0,depthScope:'PARENT' as const}))};
 expect(order(d)).toEqual(['a0','a:fill','b0','b:fill']);expect(depthPaintBatches(zero)).toBe(depthPaintBatches(d));expect(render(zero)).toBe(render(d));
 expect(parseDrawing(d).fills.every(f=>!Object.hasOwn(f,'depthOffset')&&!Object.hasOwn(f,'depthScope'))).toBe(true);expect(setDepthOffset(d,'a:fill',0)).toBe(d);
});

test('a fill crosses its structural sibling independently from its boundary ink and retains all ownership and geometry',()=>{
 const d=fixture(),n=setDepthOffset(d,'a:fill',-1),forward=setDepthOffset(d,'b:fill',1);
 expect(depthContext(n,'a:fill').target.ids).toEqual(['b0','b1','b2','b:fill']);expect(order(n)).toEqual(['a0','b0','b:fill','a:fill']);expect(order(forward)).toEqual(['b:fill','a0','a:fill','b0']);
 expect(n.curves).toBe(d.curves);expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(n.layers).toBe(d.layers);expect(n.fills[0].boundary).toBe(d.fills[0].boundary);expect(fillGeometry(n,n.fills[0])).toEqual(fillGeometry(d,d.fills[0]));
 expect(depthPaintBatches(n).filter(b=>b.item.stroke)).toEqual(depthPaintBatches(d).filter(b=>b.item.stroke));expect(batch(n,'a:fill').layerId).toBe('layer');expect(parseDrawing(JSON.parse(JSON.stringify(n)))).toEqual(n);
});

test('mist fills use the same independent queue entry',()=>{
 const d=fixture();d.fills[0].mist={enabled:true,side:'BOTH',width:.02,opacity:.6};const n=setDepthOffset(d,'a:fill',-1);
 expect(order(n).at(-1)).toBe('a:fill');expect(n.fills[0].mist).toBe(d.fills[0].mist);expect(fillGeometry(n,n.fills[0])).toEqual(fillGeometry(d,d.fills[0]));
});

test('parent scope stays inside a group, counts hidden sibling strokes and clamps to that level',()=>{
 const d=fixture();addLoop(d,'layer','outside',2);d.groups=[{id:'group',name:'Group',visible:true,locked:false,curveIds:d.curves.filter(c=>!c.id.startsWith('outside')).map(c=>c.id)}];
 d.curves=d.curves.map(c=>c.id.startsWith('b')?{...c,visible:false}:c);d.fills[1].visible=false;
 const n=setDepthOffset(d,'a:fill',-99),context=depthContext(n,'a:fill');
 expect(context.siblings.map(s=>s.id)).toEqual(['a0','b0']);expect(context.effective).toBe(-1);expect(context.target.ids).toContain('b:fill');expect(order(n)).toEqual(['a0','b0','b:fill','a:fill','outside0','outside:fill']);expect(n.fills[0].depthOffset).toBe(-99);
});

test('layer scope preserves empty and hidden slots, source layer identity and future relative offsets',()=>{
 const d=fixture();addLayer(d,'empty');addLayer(d,'bottom');addLoop(d,'bottom','c',2);d.curves.filter(c=>c.id.startsWith('c')).forEach(c=>c.visible=false);
 const n=setDepthOffset(d,'a:fill',-1,'LAYER');expect(depthContext(n,'a:fill').target.id).toBe('empty');expect(order(n)).toEqual(['a0','b0','b:fill','a:fill','c0','c:fill']);
 const farther=setDepthOffset(n,'a:fill',-2);expect(order(farther).at(-1)).toBe('a:fill');expect(batch(farther,'a:fill').layerId).toBe('layer');
 const reordered={...farther,layers:[farther.layers[2],farther.layers[1],farther.layers[0]]};expect(depthContext(reordered,'a:fill').effective).toBe(0);expect(reordered.fills[0].depthOffset).toBe(-2);expect(reordered.layers[2].items).toBe(d.layers[0].items);
});

test('standalone and multi-stroke fills fall back to their structural group or layer without borrowing a foreign boundary owner',()=>{
 let d=fixture();d.fills[0].boundary=[d.fills[0].boundary[0],d.fills[1].boundary[0]];d.groups=[{id:'group',name:'Group',visible:true,locked:false,curveIds:d.curves.map(c=>c.id)}];addLoop(d,'layer','outside',2);
 expect(depthContext(d,'a:fill').parent.id).toBe('group');expect(depthContext(setDepthOffset(d,'a:fill',-1),'a:fill').target.id).toBe('outside0');
 addLayer(d,'other');d=movePaint(d,'a:fill','other');expect(depthContext(d,'a:fill').parent.id).toBe('other');expect(depthContext(setDepthOffset(d,'a:fill',1),'a:fill').target.id).toBe('layer');
});

test('crossing overrides use base structural targets, never recursively follow each other; ties retain list order',()=>{
 const d=fixture(),a=setDepthOffset(d,'a:fill',-1),b=setDepthOffset(d,'b:fill',1),both=setDepthOffset(a,'b:fill',1);
 expect(batch(both,'a:fill').position).toBe(batch(a,'a:fill').position);expect(batch(both,'b:fill').position).toBe(batch(b,'b:fill').position);expect(order(both)).toEqual(['b:fill','a0','b0','a:fill']);
 const extra={...d.fills[0],id:'a:second'};d.fills.push(extra);d.layers[0].items.splice(4,0,extra.id);
 const tied=setDepthOffset(setDepthOffset(d,'a:fill',-1),extra.id,-1);expect(order(tied).slice(-2)).toEqual(['a:fill','a:second']);expect(batch(tied,'a:fill').position).toBe(batch(tied,extra.id).position);
});

test('transparent cutouts keep stored depth inactive, reject edits and restore it when made solid',()=>{
 const d=setDepthOffset(fixture(),'a:fill',-1),cut=changePaint(d,'a:fill',{color:'transparent'}),originalCut=changePaint(fixture(),'a:fill',{color:'transparent'});
 expect(cut.fills[0]).toMatchObject({depthOffset:-1,depthScope:'PARENT',color:'transparent'});expect(depthContext(cut,'a:fill').effective).toBe(-1);expect(depthPaintBatches(cut)).toEqual(depthPaintBatches(originalCut));expect(render(cut)).toBe(render(originalCut));expect(parseDrawing(cut).fills[0].depthOffset).toBe(-1);
 for(const value of [-1,0,1])expect(()=>setDepthOffset(cut,'a:fill',value)).toThrow('透明挖空不支持深度偏移');expect(()=>changePaint(cut,'a:fill',{depthScope:'LAYER'})).toThrow('透明挖空不支持深度偏移');
 expect(order(changePaint(cut,'a:fill',{color:'black'}))).toEqual(order(d));
});

test('fill depth validates exactly like curve depth, including locks, nonintegers, limits and scope',()=>{
 const d=fixture();for(const id of ['a0','a:fill']){
  for(const value of [.5,NaN,Infinity,-Infinity,10001,-10001,Number.MAX_SAFE_INTEGER])expect(()=>setDepthOffset(d,id,value)).toThrow('深度偏移须为整数');
  for(const value of [-10000,0,10000])expect(()=>setDepthOffset(d,id,value,'LAYER')).not.toThrow();expect(()=>setDepthOffset(d,id,1,'SCENE' as never)).toThrow();
 }
 for(const patch of [{depthOffset:.5},{depthOffset:Infinity},{depthOffset:10001},{depthOffset:-10001},{depthOffset:'1'},{depthOffset:null},{depthScope:'SCENE'},{depthScope:null}]){
  expect(()=>parseDrawing({...d,fills:d.fills.map((f,i)=>i?f:{...f,...patch})})).toThrow();expect(()=>changePaint(d,'a:fill',patch as DepthAppearance)).toThrow();
 }
 const locked={...d,fills:d.fills.map((f,i)=>i?f:{...f,locked:true})};expect(()=>setDepthOffset(locked,'a:fill',1)).toThrow('对象已锁定');expect(()=>changePaint(locked,'a:fill',{depthOffset:1})).toThrow('对象已锁定');expect(setDepthOffset(d,'missing',1)).toBe(d);
});

test('moving, cutting, pasting and duplicating preserve fill depth and canonical ownership semantics',()=>{
 const d=setDepthOffset(fixture(),'a:fill',-2,'LAYER');addLayer(d,'destination');const moved=moveToLayer(d,['a0','a1','a2'],'destination');
 expect(moved.fills[0]).toEqual(d.fills[0]);expect(layerFor(moved,'a:fill')!.id).toBe('destination');
 const cut=cutDrawing(d,['a0'])!,pasted=pasteDrawingCut(cut.document,cut.clipboard,'destination');expect(pasted.fills.find(f=>f.id==='a:fill')).toEqual(d.fills[0]);expect(layerFor(pasted,'a:fill')!.id).toBe('destination');
 const copied=duplicateLayer(d,'layer'),clone=copied.fills.find(f=>!d.fills.some(old=>old.id===f.id)&&f.name==='a fill')!;
 expect(clone).toMatchObject({depthOffset:-2,depthScope:'LAYER'});expect(clone.id).not.toBe('a:fill');expect(clone.boundary.every(use=>!d.curves.some(c=>c.id===use.id))).toBe(true);expect(layerFor(copied,clone.id)!.id).toBe(copied.layers[0].id);expect(parseDrawing(copied)).toEqual(copied);
});

test('mutable fill depth, scope and color invalidate paint queues and renderer products without document identity changes',()=>{
 const d=fixture();addLayer(d,'other');addLoop(d,'other','c',2);const read=()=>withDrawingReadScope(()=>createPaintProductReader(d,displayInkSampling(250))),before=read().batches,original=render(d);
 d.fills[0].depthOffset=-1;const parent=read().batches;expect(parent).not.toBe(before);expect(render(d)).not.toBe(original);expect(read().batches).toBe(parent);
 d.fills[0].depthScope='LAYER';const layer=read().batches;expect(layer).not.toBe(parent);expect(layer.at(-1)!.item.id).toBe('a:fill');const solid=render(d);
 d.fills[0].color='transparent';const cut=read().batches;expect(cut).not.toBe(layer);expect(cut.map(b=>b.item.id)).toEqual(before.map(b=>b.item.id));expect(render(d)).not.toBe(solid);
 d.fills[0].color='black';expect(read().batches.at(-1)!.item.id).toBe('a:fill');expect(render(d)).toBe(render({...d}));
});

test('prepared topology retains live fill appearance and creates a fresh queue for an immutable depth edit',()=>{
 const d=fixture(),context=prepareDrawingReadContext(d),before=createPaintProductReader(d,displayInkSampling(250)),next=setDepthOffset(d,'a:fill',-1),retained=retainPreparedDrawingReadContext(next,d)!;
 expect(retained.topology).toBe(context.topology);expect(retained.fills.get('a:fill')).toBe(next.fills[0]);const after=createPaintProductReader(next,displayInkSampling(250));expect(after.batches).not.toBe(before.batches);expect(after.batches.at(-1)!.item.id).toBe('a:fill');expect(render(next)).not.toBe(render(d));
});

/** Record ancestor clips/layers at the actual SVG fill path, not only queue IDs. */
function renderedFills(svg:string){
 const stack:string[]=[],result:{id:string;ancestors:string[]}[]=[];
 for(const match of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*)>/g)){
  const [,closing,tag,attributes]=match;if(closing){stack.pop();continue;}
  if(tag==='path'&&attributes.includes('data-testid="drawing-fill"'))result.push({id:attributes.match(/data-id="([^"]+)"/)![1],ancestors:[...stack]});
  if(!attributes.endsWith('/'))stack.push(attributes);
 }
 return result;
}

test('the actual SVG paints moved fills in kernel order while each cutout clips only fills owned by its original layer',()=>{
 let d=emptyDrawing();for(const id of ['upper','lower']){addLayer(d,id);addLoop(d,id,id,id==='upper'?0:2);d.fills.push({...d.fills.at(-1)!,id:`${id}:cut`,color:'transparent'});d.layers.at(-1)!.items.push(`${id}:cut`);}
 d=setDepthOffset(d,'upper:fill',-1,'LAYER');const svg=render(d),fills=renderedFills(svg),expected=depthPaintBatches(d).filter(b=>b.item.kind==='fill'&&!b.item.id.endsWith(':cut')).reverse().map(b=>b.item.id);
 expect(fills.map(f=>f.id)).toEqual(expected);expect(expected).toEqual(['upper:fill','lower:fill']);
 for(const id of ['upper','lower']){
  const fill=fills.find(f=>f.id===`${id}:fill`)!;expect(fill.ancestors.some(a=>a.includes('data-testid="drawing-paint-layer"')&&a.includes(`data-id="${id}"`))).toBe(true);
  const clips=fill.ancestors.flatMap(a=>[...a.matchAll(/clip-path="url\(#([^)]*)\)"/g)].map(m=>m[1]));expect(clips).toHaveLength(1);
  const definition=svg.match(new RegExp(`<clipPath[^>]*id="${clips[0]}"[^>]*>(.*?)</clipPath>`))![1];const start=id==='upper'?'M 0,0':'M 2,0';expect(definition).toContain(start);
 }
 expect(fills[0].ancestors.filter(a=>a.includes('clip-path='))).not.toEqual(fills[1].ancestors.filter(a=>a.includes('clip-path=')));
});
