import {describe,it,expect} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {extractEndpointOnionInk} from '../../ui/vectorRecording/endpointOnionInk';

const straight=():DrawingDocument=>({...emptyDrawing(),nodes:[{id:'z',position:[0,0]},{id:'a',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['z','a'],handles:[[1/3,0],[2/3,0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]});
const corner=(route=false):DrawingDocument=>({...emptyDrawing(),nodes:[{id:'a',position:[-1,0]},{id:'b',position:[0,0]},...(route?[{id:'d',position:[0,0] as [number,number]}]:[]),{id:'c',position:[0,1]}],curves:[{id:'left',name:'Left',nodes:['a','b'],handles:[[-2/3,0],[-1/3,0]],visible:true,locked:false,width:.01},{id:'up',name:'Up',nodes:[route?'d':'b','c'],handles:[[0,1/3],[0,2/3]],visible:true,locked:false,width:.01}],layers:route?[{id:'first',name:'First',visible:true,locked:false,items:['left']},{id:'second',name:'Second',visible:true,locked:false,items:['up']}]:[{id:'layer',name:'Layer',visible:true,locked:false,items:['left','up']}],joins:route?[]:[{id:'corner',a:{curveId:'left',end:1},b:{curveId:'up',end:0},mode:'ARC',radius:.2}],...(route?{endpointLinks:[{id:'explicit-link',a:{curveId:'left',end:1 as const},b:{curveId:'up',end:0 as const},throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.2}}],displayIntervals:[{id:'route',anchor:{id:'left',reverse:false},ranges:[{id:'coverage',start:0,end:1}],displayRoute:{seed:{segments:[{id:'left',reverse:false}],closed:false},throughLinkIds:['explicit-link']}}]}:{})});

describe('endpoint-only onion centerline extraction',()=>{
 it('maps SHOW/HIDE coverage back to canonical t despite reversed path traversal',()=>{
  const d=straight();d.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'show',start:.1,end:.9},{id:'hide',mode:'HIDE',start:.4,end:.6}]}];const before=JSON.stringify(d),ink=extractEndpointOnionInk(d),segments=ink.curves.curve.segments;
  expect(segments).toHaveLength(2);expect(segments[0].start).toBeCloseTo(.1);expect(segments[0].end).toBeCloseTo(.4);expect(segments[1].start).toBeCloseTo(.6);expect(segments[1].end).toBeCloseTo(.9);expect(segments[0].cubic).toEqual(shapeOf(d,'curve'));expect(JSON.stringify(d)).toBe(before);
 });
 it('retains hidden endpoint geometry while marking it ineligible for visible ink',()=>{
  const d=straight();d.curves[0].inkVisible=false;let ink=extractEndpointOnionInk(d);expect(ink.curves.curve.visible).toBe(false);expect(ink.curves.curve.cubic).toEqual(shapeOf(d,'curve'));d.curves[0].inkVisible=true;d.curves[0].visible=false;ink=extractEndpointOnionInk(d);expect(ink.curves.curve.visible).toBe(false);expect(ink.curves.curve.segments).toHaveLength(0);expect(ink.curves.curve.masks!.length).toBeGreaterThan(0);
 });
 it('retains final local ARC pieces under an explicit join identity and trims raw curves',()=>{
  const d=corner(),ink=extractEndpointOnionInk(d),key=JSON.stringify(['join','corner']);expect(ink.diagnostics).toEqual([]);expect(ink.arcs[key].length).toBeGreaterThan(0);expect(ink.curves.left.segments[0].end).toBeCloseTo(.8);expect(ink.curves.up.segments[0].start).toBeCloseTo(.2);expect(ink.arcs[key][0][0][0]).toBeCloseTo(-.2);expect(ink.arcs[key].at(-1)![3][1]).toBeCloseTo(.2);expect(ink.arcPieceCounts![key]).toBe(ink.arcSegments![key].length);
 });
 it('clips cross-layer ARC material and keys it by the real endpoint link',()=>{
  const d=corner(true);d.displayIntervals![0].ranges=[{id:'arc-only',start:.47,end:.53}];const ink=extractEndpointOnionInk(d),key=JSON.stringify(['link','explicit-link']);expect(ink.diagnostics).toEqual([]);expect(Object.values(ink.curves).every(c=>c.segments.length===0)).toBe(true);expect(ink.arcs[key].length).toBeGreaterThan(0);expect(ink.arcSegments![key].some(s=>s.start>0||s.end<1)).toBe(true);expect(Object.keys(ink.arcs)).toEqual([key]);
 });
 it('keeps stable range IDs and empty material spans when an endpoint range misses a curve',()=>{
  const d=corner(true);d.displayIntervals![0].ranges=[{id:'moving',start:.1,end:.3}];const first=extractEndpointOnionInk(d),id=JSON.stringify(['route','moving']);expect(first.curves.up.masks![0].id).toBe(id);expect(first.curves.up.masks![0].spans[0].start).toBe(first.curves.up.masks![0].spans[0].end);
  d.curves[1].visible=false;d.displayIntervals![0].ranges=[{id:'moving',start:.7,end:.9}];const second=extractEndpointOnionInk(d);expect(second.curves.up.visible).toBe(false);expect(second.curves.up.masks![0].id).toBe(id);expect(second.curves.up.masks![0].spans[0].end).toBeGreaterThan(second.curves.up.masks![0].spans[0].start);expect(second.curves.up.cubic).toEqual(first.curves.up.cubic);expect(second.arcGeometry![JSON.stringify(['link','explicit-link'])].length).toBeGreaterThan(0);
 });
 it('keeps material coordinates finite through a true zero affine placement',()=>{
  const source=straight();source.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.25,end:.75}]}];const drawing=structuredClone(source);drawing.nodes=drawing.nodes.map(n=>({...n,position:[0,0]}));drawing.curves=drawing.curves.map(c=>({...c,handles:[[0,0],[0,0]]}));registerEvaluatedAffine(drawing,source,()=>({point:()=>[0,0],maxScale:0}));const ink=extractEndpointOnionInk(drawing);expect(ink.diagnostics).toEqual([]);expect(ink.curves.curve.segments[0].start).toBeCloseTo(.25);expect(ink.curves.curve.segments[0].end).toBeCloseTo(.75);expect(ink.curves.curve.segments[0].cubic.flat().every(Number.isFinite)).toBe(true);
 });
});
