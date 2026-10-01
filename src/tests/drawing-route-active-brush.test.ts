import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyDrawing,type DrawingDocument as Doc,type Cubic} from '../domain/drawing/model';
import {addLayer,createCurve,connect} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {displayPath,localDisplayPath,displayField} from '../domain/drawing/displayIntervals';
import {displayRouteInk,displayRouteInkSupport} from '../domain/drawing/displayRouteInk';
import {curveSamples} from '../domain/drawing/curveProvenance';
import {point} from '../domain/drawing/sampling';
import {fillGeometry} from '../domain/drawing/appearance';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {createArtworkRig,acceptArtworkSource,applyVisibility} from '../domain/vectorRecording/model';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {createWarpGrid,moveWarpNode,deformDrawing} from '../domain/vectorWarp';
import PaintScene from '../ui/drawing/PaintScene';

/** Two closed, independently filled pieces retain their local nodes/ownership. */
function twoFace():Doc{
 let d=emptyDrawing();
 for(const [prefix,side] of [['a',-1],['b',1]] as const){
  d=addLayer(d,prefix);const layer=d.layers[0].id;
  const shapes:Cubic[]=[[[side,1],[side*.8,.5],[side*.4,.12],[0,0]],[[0,0],[-side*.15,.2],[-side*.25,.8],[-side*.2,1]],[[-side*.2,1],[0,1.2],[side*.5,1.2],[side,1]]];
  for(let i=0;i<3;i++)d=createCurve(d,layer,shapes[i],.008,`${prefix}${i}`,`${prefix}${i}`);
  for(let i=0;i<3;i++)d=connect(d,{curveId:`${prefix}${i}`,end:1},{curveId:`${prefix}${(i+1)%3}`,end:0},'POSITION',undefined,true);
  d=createFill(d,[`${prefix}0`,`${prefix}1`,`${prefix}2`],'white');
 }
 const local=localDisplayPath(d,'a0'),seed={segments:local.segments,closed:local.closed},route={seed,throughLinkIds:['chin']};
 return {...d,endpointLinks:[{id:'chin',a:{curveId:'a0',end:1},b:{curveId:'b0',end:1},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.05}}],displayIntervals:[{id:'route-track',anchor:{...seed.segments[0]},displayRoute:route,ranges:[{id:'all',start:0,end:1,mode:'SHOW'}]}]};
}
function scene(d:Doc){const noop=()=>{};return renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d,screen:p=>p,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));}

test.each([.2,.5,.8])('an interval cut at %s of the cross-layer ARC owns its taper and clips all subsequent ARC ink',fraction=>{
 const d=twoFace(),route=d.displayIntervals![0].displayRoute!,field=displayField(d,displayPath(d,'a0'));
 const indices=field.geometry.pieces.flatMap((p,i)=>p.joinId?[i]:[]),a=field.parts[indices[0]].start,z=field.parts[indices.at(-1)!],b=z.start+z.length;
 const cut=(a+(b-a)*fraction)/field.total;
 const source={...d,displayIntervals:d.displayIntervals!.map(t=>({...t,ranges:[{id:'cut',mode:'SHOW' as const,start:0,end:cut,inkEnds:[{taper:0},{taper:.1}] as [{taper:number},{taper:number}]}]}))},before=JSON.stringify(source);
 const resolved=displayField(source,displayPath(source,'a0')),tip=resolved.at(cut).p,plan=displayRouteInk(source,route,new Map()),runs=[...plan.runs.values()].flat();
 expect(plan.diagnostics).toEqual([]);expect(resolved.mask).toEqual([[0,cut]]);
 const terminal=runs.find(r=>r.shapes.some(s=>Math.hypot(s[3][0]-tip[0],s[3][1]-tip[1])<1e-8));expect(terminal).toBeDefined();expect(terminal!.uniform).toBe(false);
 const n=terminal!.outline.length/2,l=terminal!.outline[n-1],r=terminal!.outline[n];expect(Math.hypot(l[0]-r[0],l[1]-r[1])).toBeLessThan(1e-12);
 const arcs=runs.flatMap(r=>r.shapes).filter(s=>new Set(curveSamples(s,.5).map(p=>p.id)).size===2);expect(arcs.length).toBeGreaterThan(0);
 // This fixture's synthetic chin ARC travels monotonically left to right.
 for(const shape of arcs)for(let i=0;i<=20;i++)expect(point(shape,i/20)[0]).toBeLessThanOrEqual(tip[0]+1e-10);
 expect(source.fills.map(f=>fillGeometry(source,f))).toEqual(d.fills.map(f=>fillGeometry(d,f)));expect(JSON.stringify(source)).toBe(before);
});

test('owner ink visibility keeps the structural route field and never awakens dormant geometry-end brushes',()=>{
 const d=twoFace(),route=d.displayIntervals![0].displayRoute!,before=displayField(d,displayPath(d,'a0'));
 const hidden={...d,curves:d.curves.map(c=>c.id==='b0'?{...c,inkVisible:false}:c.id==='a0'?{...c,inkEnds:[{}, {taper:.1,extension:.02}] as [{},{taper:number;extension:number}]}:c)},snapshot=JSON.stringify(hidden);
 const after=displayField(hidden,displayPath(hidden,'a0')),plan=displayRouteInk(hidden,route,new Map());
 expect(after.total).toBe(before.total);expect(after.geometry).toEqual(before.geometry);expect(plan.runs.has('b0')).toBe(false);
 expect(plan.runs.get('a0')!.every(r=>r.uniform&&!r.extensions?.length)).toBe(true);expect(JSON.stringify(hidden)).toBe(snapshot);
});

test('invalid ARC rendering reports its diagnostic and never reinterprets route percentages on local fallback strokes',()=>{
 const d=twoFace(),invalid={...d,curves:d.curves.map(c=>c.id==='a0'?{...c,handles:[c.handles[0],[0,0]] as [[number,number],[number,number]]}:c)},route=d.displayIntervals![0].displayRoute!,snapshot=JSON.stringify(invalid);
 const errors=displayRouteInkSupport(invalid,route);expect(errors.some(message=>message.includes('退化'))).toBe(true);
 const plan=displayRouteInk(invalid,route,new Map());expect(plan.diagnostics).toEqual(errors);expect(plan.runs.size).toBe(0);
 const svg=scene(invalid);expect(svg).toContain('data-testid="drawing-route-error"');expect(svg).toContain('退化');
 expect(svg).not.toContain('data-testid="drawing-depth-ink"');expect(svg).not.toContain('data-testid="drawing-route-ink"');
 expect(svg.match(/data-testid="drawing-fill"/g)).toHaveLength(2);expect(JSON.stringify(invalid)).toBe(snapshot);
});

test('accepting a new route frame resets affected angle ranges and flags while preserving unrelated appearance and Warp data',()=>{
 const d=twoFace(),source:Doc={...d,endpointLinks:d.endpointLinks!.map(l=>({...l,throughDisplay:false,joinBrush:{kind:'SHARP'}})),displayIntervals:[
  {id:'ta',anchor:{id:'a1',reverse:false},ranges:[{id:'wrapped',start:.9,end:.2,mode:'SHOW'}]},
  {id:'tb',anchor:{id:'b0',reverse:false},ranges:[{id:'other',start:0,end:1,mode:'HIDE'}]},
  {id:'local',scope:'CURVE',anchor:{id:'a2',reverse:false},ranges:[{id:'local-cut',start:.2,end:.4,mode:'HIDE'}]},
 ]};
 const rig=createArtworkRig('source',source),grid=createWarpGrid({min:[-2,-1],max:[2,2]},2,2);
 rig.deformers=[{id:'warp',name:'Warp',grid}];rig.keys[0].grids={warp:grid};rig.keys[0].visibility={a0:false};rig.keys[0].intervals={wrapped:false,other:false,'local-cut':false};rig.keys[0].intervalOverrides=structuredClone(source.displayIntervals);
 const before=JSON.stringify(rig);
 const adopted=adoptDisplayRoute(source,'ta','chin').document,derived=adopted.displayIntervals!.flatMap(t=>t.ranges).filter(r=>r.originId==='wrapped');expect(derived.length).toBeGreaterThan(0);
 const accepted=acceptArtworkSource(rig,adopted),pose=accepted.keys[0],visible=applyVisibility(adopted,pose);
 expect(pose.intervalOverrides!.map(t=>t.id)).toEqual(['local']);expect(pose.intervals).toEqual({'local-cut':false});
 for(const r of derived)expect(visible.displayIntervals!.flatMap(t=>t.ranges).find(x=>x.id===r.id)!.enabled).toBe(r.enabled);
 expect(pose.grids).toBe(rig.keys[0].grids);expect(pose.visibility).toEqual({a0:false});expect(accepted.keys.map(k=>[k.id,k.name,k.angle])).toEqual(rig.keys.map(k=>[k.id,k.name,k.angle]));
 expect(accepted.sourceIntervalFrames!.ta.signature).not.toBe(rig.sourceIntervalFrames!.ta.signature);expect(JSON.stringify(rig)).toBe(before);
});

test('an angle override transports its source-curve and synthetic-ARC material positions exactly once through Warp',()=>{
 const d=twoFace(),route=d.displayIntervals![0].displayRoute!,field=createDisplayRouteField(d,route),arcIndices=field.geometry.pieces.flatMap((p,i)=>p.joinId?[i]:[]);
 const first=field.parts[arcIndices[0]],last=field.parts[arcIndices.at(-1)!],cut=(first.start+.2*(last.start+last.length-first.start))/field.total;
 const pose={grids:{},visibility:{},intervals:{},intervalOverrides:d.displayIntervals!.map(t=>({...t,ranges:[{id:'all',mode:'SHOW' as const,start:cut,end:.65}]}))};
 const source=applyVisibility(d,pose),old=createDisplayRouteField(source,route),material=[old.materialAt(cut)!,old.materialAt(.65)!];
 expect(material[0].kind).toBe('join');expect(material[1].kind).toBe('curve');
 const before=JSON.stringify({d,pose});let grid=createWarpGrid({min:[-1.5,-.5],max:[1.5,1.5]},2,2);grid=moveWarpNode(grid,4,[.2,.65]);
 const evaluated=deformDrawing(source,grid,{diagnostics:'preview'}),next=createDisplayRouteField(evaluated.drawing,route),range=evaluated.drawing.displayIntervals![0].ranges[0];
 expect(evaluated.intervalTransportErrors).toEqual([]);expect(range.start).toBeCloseTo(next.positionOf(material[0])!,10);expect(range.end).toBeCloseTo(next.positionOf(material[1])!,10);
 expect(Math.abs(range.start-cut)+Math.abs(range.end-.65)).toBeGreaterThan(1e-5);expect(JSON.stringify({d,pose})).toBe(before);
});
