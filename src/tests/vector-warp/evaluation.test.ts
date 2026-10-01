import {describe,it,expect} from 'vitest';
import {createWarpGrid,blendWarpGrids,moveWarpNode,cloneWarpGrid,validateWarpGrid,isIdentityWarpGrid,type WarpGrid} from '../../domain/vectorWarp/model';
import {createWarpMapper,mapPoint,evaluateWarp,mapPointThroughGrids,fitWarpedCubic,deformDrawing,cubicPoint,cubicDerivative,warpPatchControlPoints} from '../../domain/vectorWarp/evaluation';
import {emptyDrawing,shapeOf,parseDrawing,type Cubic,type Point2,type DrawingDocument} from '../../domain/drawing/model';
import * as commands from '../../domain/drawing/commands';

const bounds={min:[-1,-1] as Point2,max:[1,1] as Point2};
const near=(a:Point2,b:Point2,digits=9)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],digits));
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const A=(p:Point2):Point2=>[1.3*p[0]-.4*p[1]+.37,.5*p[0]+.7*p[1]-.2];
function affine(grid:WarpGrid,fn:(p:Point2)=>Point2):WarpGrid {
 const z=fn([0,0]),out=cloneWarpGrid(grid);
 for(const node of out.nodes){node.position=fn(node.position);node.handleU=fn(node.handleU);node.handleV=fn(node.handleV);const t=fn(node.twist);node.twist=[t[0]-z[0],t[1]-z[1]];}
 return out;
}
const line:Cubic=[[-.9,.1],[-.3,.1],[.3,.1],[.9,.1]];
const curve:Cubic=[[-.85,-.3],[-.35,.8],[.7,-.8],[.9,.4]];
function makeDrawing(){
 let d=commands.addLayer(emptyDrawing(),'Lines');
 d=commands.createCurve(d,d.layers[0].id,[[-.9,0],[-.6,.2],[-.3,0],[0,0]],.01,'A','a');
 d=commands.createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.6,-.2],[.9,0]],.01,'B','b');
 return commands.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

/** Independent validation oracle: Bernstein patch evaluation rather than our
 * compiled power basis; cubic uses independent de Casteljau. */
function casteljau(c:Cubic,t:number):Point2 {
 const pts=c.map(p=>[...p] as Point2);for(let n=3;n>0;n--)for(let i=0;i<n;i++)pts[i]=[pts[i][0]*(1-t)+pts[i+1][0]*t,pts[i][1]*(1-t)+pts[i+1][1]*t];return pts[0];
}
function direct(grid:WarpGrid,p:Point2):Point2 {
 const gu=(p[0]-grid.bounds.min[0])/(grid.bounds.max[0]-grid.bounds.min[0])*grid.columns,gv=(p[1]-grid.bounds.min[1])/(grid.bounds.max[1]-grid.bounds.min[1])*grid.rows;
 const col=Math.max(0,Math.min(grid.columns-1,Math.floor(gu))),row=Math.max(0,Math.min(grid.rows-1,Math.floor(gv))),u=gu-col,v=gv-row;
 // Direct Hermite basis, independently constructed from the node jet.
 const h=(t:number)=>[2*t**3-3*t*t+1,-2*t**3+3*t*t,t**3-2*t*t+t,t**3-t*t];
 const hu=h(u),hv=h(v),out:Point2=[0,0];
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){
  const node=grid.nodes[(row+j)*(grid.columns+1)+col+i];
  for(let k=0;k<2;k++)out[k]+=node.position[k]*hu[i]*hv[j]+3*(node.handleU[k]-node.position[k])*hu[i+2]*hv[j]+3*(node.handleV[k]-node.position[k])*hu[i]*hv[j+2]+node.twist[k]*hu[i+2]*hv[j+2];
 }
 return out;
}

describe('continuous shared Bezier/Hermite grid field',()=>{
 it('creates rows/columns of cells and isolated node data',()=>{
  const grid=createWarpGrid(bounds,2,3);expect(grid.nodes).toHaveLength(12);near(grid.nodes[4].position,[-1,0]);near(grid.nodes[0].handleU,[-1+2/9,-1]);near(grid.nodes[0].handleV,[-1,-2/3]);
  grid.bounds.min[0]=-9;expect(bounds.min[0]).toBe(-1);
  expect(()=>createWarpGrid(bounds,0,2)).toThrow();expect(()=>createWarpGrid({min:[1,0],max:[1,1]},2,2)).toThrow();
  expect(()=>validateWarpGrid({...createWarpGrid(bounds),nodes:[]})).toThrow();
 });
 it('reproduces identity inside, on edges, and under boundary-patch extrapolation',()=>{
  const grid=createWarpGrid(bounds,3,4),mapper=createWarpMapper([grid]);
  for(let i=0;i<=60;i++)for(let j=0;j<=30;j++){const p:Point2=[-1.4+i/22,-1.3+j/11];near(mapper.mapPoint(p),p);}
  near(evaluateWarp(grid,[.2,.7]).jacobian[0],[1,0]);near(evaluateWarp(grid,[.2,.7]).jacobian[1],[0,1]);
 });
 it('reproduces affine transforms and their Jacobian',()=>{
  const grid=affine(createWarpGrid(bounds,3,5),A),mapper=createWarpMapper([grid]);
  for(let i=0;i<50;i++){const p:Point2=[Math.sin(i*7)*1.3,Math.cos(i*3)*1.4];near(mapper.mapPoint(p),A(p));}
  const sample=mapper.sample([.43,-.32]);near(sample.jacobian[0],[1.3,-.4]);near(sample.jacobian[1],[.5,.7]);
 });
 it('supports genuinely local interior edits, rather than four-boundary-only warp',()=>{
  const grid=createWarpGrid(bounds,4,4),edited=moveWarpNode(grid,2*5+2,[.15,.32]);near(mapPoint(edited,[0,0]),[.15,.32]);
  near(mapPoint(edited,[-.8,-.8]),[-.8,-.8]);near(mapPoint(edited,[1,1]),[1,1]);expect(distance(mapPoint(edited,[.2,.2]),[.2,.2])).toBeGreaterThan(.05);
  near(grid.nodes[12].position,[0,0]);near([edited.nodes[12].handleU[0]-edited.nodes[12].position[0],edited.nodes[12].handleU[1]-edited.nodes[12].position[1]],[1/6,0]);
 });
 it('keeps value and first derivatives continuous across both cell seam directions',()=>{
  let grid=moveWarpNode(createWarpGrid(bounds,3,3),5,[-.15,.24]);grid.nodes[5].handleU=[.24,.53];grid.nodes[5].handleV=[-.45,.71];grid.nodes[5].twist=[.83,-.71];
  const mapper=createWarpMapper([grid]),epsilon=1e-7;
  for(let k=1;k<=2;k++)for(let i=0;i<=25;i++){
   const seam=-1+2*k/3,z=-.99+1.98*i/25;
   for(const axis of [0,1]){const p:Point2=axis===0?[seam-epsilon,z]:[z,seam-epsilon],q:Point2=axis===0?[seam+epsilon,z]:[z,seam+epsilon],a=mapper.sample(p),b=mapper.sample(q);
    expect(distance(a.point,b.point)).toBeLessThan(1e-5);expect(distance(a.jacobian[0],b.jacobian[0])).toBeLessThan(2e-5);expect(distance(a.jacobian[1],b.jacobian[1])).toBeLessThan(2e-5);
   }
  }
 });
 it('matches independent Hermite evaluation for edited patches and extrapolation',()=>{
  const grid=moveWarpNode(createWarpGrid(bounds,3,4),7,[.6,-.4]);grid.nodes[7].handleU=[-.2,.8];grid.nodes[7].handleV=[.9,.1];grid.nodes[7].twist=[-.65,.88];
  const mapper=createWarpMapper([grid]);for(let i=0;i<400;i++){const p:Point2=[Math.sin(i*3)*1.4,Math.cos(i*7)*1.3];near(mapper.mapPoint(p),direct(grid,p),8);}
  expect(warpPatchControlPoints(grid,1,2)).toHaveLength(16);
 });
 it('permits folded and singular fields with finite forward evaluation',()=>{
  const grid=createWarpGrid(bounds,2,2);
  for(let r=0;r<=2;r++){grid.nodes[r*3+1].position[0]=1.3;grid.nodes[r*3+1].handleU[0]=-.7;}
  const mapper=createWarpMapper([grid]),dets:number[]=[];
  for(let i=0;i<=100;i++){const s=mapper.sample([-1+2*i/100,.17]);expect(s.point.every(Number.isFinite)).toBe(true);dets.push(s.jacobian[0][0]*s.jacobian[1][1]-s.jacobian[0][1]*s.jacobian[1][0]);}
  expect(dets.some(x=>x<0)).toBe(true);expect(dets.some(x=>x>0)).toBe(true);
  const flat=affine(createWarpGrid(bounds),p=>[p[0],0]);near(mapPoint(flat,[.4,.7]),[.4,0]);
 });
 it('composes child then parent, even through noninvertible fields',()=>{
  const child=affine(createWarpGrid(bounds),p=>[p[0]+.4,p[1]-.2]),parent=affine(createWarpGrid(bounds),p=>[2*p[0],.5*p[1]]),p:Point2=[.1,.3];
  near(mapPointThroughGrids(p,[child,parent]),[1,.05]);expect(distance(mapPointThroughGrids(p,[parent,child]),[1,.05])).toBeGreaterThan(.1);
  const flat=affine(createWarpGrid(bounds),p=>[0,p[1]]);near(mapPointThroughGrids(p,[flat,parent]),[0,.15]);
 });
 it('blends jet values, supports signed key interpolation, and rejects incompatible domains',()=>{
  const neutral=createWarpGrid(bounds),x=affine(neutral,p=>[p[0]+.2,p[1]]),y=affine(neutral,p=>[p[0],p[1]+.3]);
  near(mapPoint(blendWarpGrids([{grid:x,weight:1},{grid:y,weight:1},{grid:neutral,weight:-1}]),[.1,.1]),[.3,.4]);
  near(mapPoint(blendWarpGrids([{grid:x,weight:1},{grid:neutral,weight:1}]),[.1,.1]),[.2,.1]);
  expect(()=>blendWarpGrids([{grid:x,weight:1},{grid:y,weight:-1}])).toThrow();expect(()=>blendWarpGrids([{grid:x,weight:1},{grid:createWarpGrid(bounds,3,3),weight:1}])).toThrow();
 });
 it('keeps neutral blends exact but never hides a small intentional edit',()=>{
  const a=createWarpGrid(bounds,3,3),b=cloneWarpGrid(a),mixed=blendWarpGrids([{grid:a,weight:.371},{grid:b,weight:.629}]);expect(isIdentityWarpGrid(mixed)).toBe(true);expect(createWarpMapper([mixed]).isIdentity).toBe(true);
  b.nodes[5].handleU[0]+=1e-12;expect(isIdentityWarpGrid(b)).toBe(false);expect(createWarpMapper([b]).isIdentity).toBe(false);
  const fit=fitWarpedCubic(curve,b,{tolerance:1e-14});expect(fit.validationKind).toBe('sampled');expect(fit.maxError).toBeGreaterThan(0);
 });
 it('compiled mappers snapshot input rather than retaining mutable geometry',()=>{
  const grid=createWarpGrid(bounds),mapper=createWarpMapper([grid]);grid.nodes[4].position=[9,9];near(mapper.mapPoint([0,0]),[0,0]);
 });
});

describe('one output cubic per original segment',()=>{
 it('reproduces identity and affine cubics including original endpoint tangents',()=>{
  for(const grid of [createWarpGrid(bounds,3,3),affine(createWarpGrid(bounds,3,3),A)]){
   const result=fitWarpedCubic(curve,grid),mapper=createWarpMapper([grid]);expect(result.cubic).toHaveLength(4);expect(result.maxError).toBeLessThan(1e-11);expect(result.warning).toBe(false);
   result.cubic.forEach((p,i)=>near(p,mapper.mapPoint(curve[i])));expect(result.tangentStatus).toBe('preserved');if(result.validationKind==='sampled')expect(result.validationSamples).toBeGreaterThanOrEqual(1026);else expect(result.validationSamples).toBe(0);
  }
 });
 it('flags strong bending without silently emitting more cubics',()=>{
  const grid=moveWarpNode(createWarpGrid(bounds,4,4),12,[.65,.75]),result=fitWarpedCubic(curve,grid,{tolerance:1/250});
  expect(result.cubic).toHaveLength(4);expect(result.maxError).toBeGreaterThan(.05);expect(result.exceedsTolerance).toBe(true);expect(result.warning).toBe(true);expect(result.peakT).toBeGreaterThan(0);expect(result.peakT).toBeLessThan(1);
  near(result.peakExpected,direct(grid,casteljau(curve,result.peakT)));near(result.peakActual,casteljau(result.cubic,result.peakT));
 });
 it('detects S-shaped error even when the midpoint error vanishes',()=>{
  let grid=createWarpGrid(bounds,2,4);grid=moveWarpNode(grid,6,[-.5,.6]);grid=moveWarpNode(grid,8,[.5,-.6]);
  const symmetricLine:Cubic=[[-1,0],[-1/3,0],[1/3,0],[1,0]],result=fitWarpedCubic(symmetricLine,grid,{tolerance:.004});
  expect(distance(direct(grid,[0,0]),casteljau(result.cubic,.5))).toBeLessThan(1e-10);expect(result.maxError).toBeGreaterThan(.1);expect(result.warning).toBe(true);
 });
 it('checks folds and strong bends against 20001 independent dense observations',()=>{
  let grid=moveWarpNode(createWarpGrid(bounds,3,4),7,[.95,.8]);grid.nodes[7].handleU=[-.7,-.5];grid.nodes[7].handleV=[1.1,-.8];
  const result=fitWarpedCubic(curve,grid),count=20000;let oracleMax=0;
  for(let i=0;i<=count;i++){const t=i/count;oracleMax=Math.max(oracleMax,distance(direct(grid,casteljau(curve,t)),casteljau(result.cubic,t)));}
  expect(result.maxError).toBeGreaterThanOrEqual(oracleMax-1e-5);expect(result.maxError).toBeLessThan(oracleMax+1e-5);expect(result.warning).toBe(true);
 });
 it('preserves mapped tangent direction through nonlinear nested fields',()=>{
  const child=moveWarpNode(createWarpGrid(bounds,3,3),5,[-.2,.3]),parent=moveWarpNode(createWarpGrid(bounds,3,3),10,[.55,-.1]);
  const result=fitWarpedCubic(curve,[child,parent]),mapper=createWarpMapper([child,parent]);
  for(const end of [0,1]){const t=end,original=cubicDerivative(curve,t),j=mapper.sample(curve[end?3:0]).jacobian,expected:Point2=[j[0][0]*original[0]+j[0][1]*original[1],j[1][0]*original[0]+j[1][1]*original[1]],actual=cubicDerivative(result.cubic,t);
   expect(Math.abs(expected[0]*actual[1]-expected[1]*actual[0])).toBeLessThan(1e-8);expect(expected[0]*actual[0]+expected[1]*actual[1]).toBeGreaterThanOrEqual(0);
  }
 });
 it('keeps preview and full fitted geometry bit-identical while labeling diagnostic quality',()=>{
  const a=moveWarpNode(createWarpGrid(bounds,3,4),7,[.9,.65]),b=moveWarpNode(createWarpGrid(bounds,2,3),5,[.1,-.2]);
  const preview=fitWarpedCubic(curve,[a,b],{diagnostics:'preview'}),full=fitWarpedCubic(curve,[a,b],{diagnostics:'full'});
  expect(preview.cubic).toEqual(full.cubic);expect(preview.diagnosticStage).toBe('preview');expect(preview.validationKind).toBe('sampled-preview');expect(preview.validationSamples).toBe(34);expect(full.diagnosticStage).toBe('full');expect(full.validationSamples).toBeGreaterThanOrEqual(1058);expect(full.maxError).toBeGreaterThanOrEqual(preview.maxError);
  expect(fitWarpedCubic(curve,a,{diagnostics:'full',validationSamples:32}).validationSamples).toBeGreaterThanOrEqual(1058);
 });
 it('handles collapsed endpoint derivatives without inventing exactness',()=>{
  const source:Cubic=[[-.5,0],[-.5,0],[.5,.5],[.5,.5]],r=fitWarpedCubic(source,createWarpGrid(bounds));expect(r.maxError).toBeLessThan(1e-10);expect(r.tangentStatus).toBe('degenerate');expect(r.cubic.every(p=>p.every(Number.isFinite))).toBe(true);
  expect(()=>fitWarpedCubic(line,createWarpGrid(bounds),{tolerance:0})).toThrow();
 });
 it('measures tolerance in logical drawing units, unaffected by document scale convention',()=>{
  const grid=moveWarpNode(createWarpGrid(bounds,2,3),5,[0,.45]),result=fitWarpedCubic(curve,grid,{tolerance:.004});
  const scaled=cloneWarpGrid(grid);scaled.bounds.min=scaled.bounds.min.map(x=>x*250) as Point2;scaled.bounds.max=scaled.bounds.max.map(x=>x*250) as Point2;
  for(const n of scaled.nodes)for(const key of ['position','handleU','handleV','twist'] as const)n[key]=n[key].map(x=>x*250) as Point2;
  const large=fitWarpedCubic(curve.map(p=>p.map(x=>x*250)) as Cubic,scaled,{tolerance:1});expect(large.maxError).toBeCloseTo(result.maxError*250,6);expect(large.exceedsTolerance).toBe(result.exceedsTolerance);
 });
});

describe('transient drawing evaluation and topology',()=>{
 it('does not mutate frozen source/grid, IDs, paths, joins, styles, or visibility',()=>{
  const source=makeDrawing();source.displayIntervals=[{id:'range',anchor:{id:'a',reverse:false},ranges:[{id:'part',start:.1,end:.8}]}];source.curves[0].visible=false;source.curves[0].profile='TAPER_BOTH';source.curves[0].mist={mode:'INK_EDGE',enabled:true,width:.006,density:.6};source.curves[0].inkEnds=[{taperWidthScale:12},{extension:.01}];
  source.fills=[{id:'fill',name:'Fill',visible:true,locked:false,color:'white',boundary:[{id:'a',reverse:false},{id:'b',reverse:false}]}];source.layers[0].items.push('fill');
  const before=structuredClone(source),grid=moveWarpNode(createWarpGrid(bounds,3,3),5,[-.2,.25]);freeze(source);freeze(grid);
  const result=deformDrawing(source,grid);expect(source).toEqual(before);expect(result.drawing).not.toBe(source);expect(result.drawing.curves.map(c=>c.id)).toEqual(source.curves.map(c=>c.id));expect(result.drawing.nodes.map(n=>n.id)).toEqual(source.nodes.map(n=>n.id));
  expect(result.drawing.fills).toEqual(source.fills);expect(result.drawing.layers).toEqual(source.layers);expect(result.drawing.joins).toEqual(source.joins);expect(result.drawing.displayIntervals![0].id).toBe(source.displayIntervals![0].id);expect(result.drawing.displayIntervals![0].ranges[0].id).toBe(source.displayIntervals![0].ranges[0].id);expect(result.drawing.curves[0].visible).toBe(false);expect(result.diagnostics).toHaveLength(2);for(const key of ['width','profile','mist','inkEnds'] as const)expect(result.drawing.curves[0][key]).toEqual(source.curves[0][key]);
  expect(result.drawing.curves[0].nodes[1]).toBe(result.drawing.curves[1].nodes[0]);near(shapeOf(result.drawing,'a')[3],shapeOf(result.drawing,'b')[0]);
 });
 it('preserves SMOOTH tangent alignment under a common regular field',()=>{
  const source=makeDrawing(),grid=moveWarpNode(createWarpGrid(bounds,3,3),5,[-.2,.25]),result=deformDrawing(source,grid),a=shapeOf(result.drawing,'a'),b=shapeOf(result.drawing,'b');
  const va=[a[2][0]-a[3][0],a[2][1]-a[3][1]],vb=[b[1][0]-b[0][0],b[1][1]-b[0][1]];expect(Math.abs(va[0]*vb[1]-va[1]*vb[0])).toBeLessThan(1e-9);expect(va[0]*vb[0]+va[1]*vb[1]).toBeLessThan(0);
  expect(()=>parseDrawing(result.drawing)).not.toThrow();
 });
 it('keeps shared endpoints unique even with conflicting per-curve fields and reports conflict',()=>{
  const source=makeDrawing(),identity=createWarpGrid(bounds),shift=affine(identity,p=>[p[0]+.2,p[1]]),result=deformDrawing(source,id=>[id==='a'?identity:shift]);
  near(shapeOf(result.drawing,'a')[3],shapeOf(result.drawing,'b')[0]);near(shapeOf(result.drawing,'a')[3],[.1,0]);expect(result.conflictingNodeIds).toHaveLength(1);expect(result.warningCurveIds.sort()).toEqual(['a','b']);expect(result.diagnostics.every(d=>d.endpointConflict)).toBe(true);
 });
 it('keeps separate linked node IDs coupled across layers and warns about inconsistent mappings',()=>{
  let source=commands.addLayer(emptyDrawing(),'A');source=commands.createCurve(source,source.layers[0].id,[[-1,0],[-.6,0],[-.3,0],[0,0]],.01,'A','a');source=commands.addLayer(source,'B');source=commands.createCurve(source,source.layers[0].id,[[0,0],[.3,0],[.6,0],[1,0]],.01,'B','b');source=commands.linkEndpoints(source,{curveId:'a',end:1},{curveId:'b',end:0});
  const identity=createWarpGrid(bounds),shift=affine(identity,p=>[p[0],p[1]+.3]),result=deformDrawing(source,id=>[id==='a'?identity:shift]);
  expect(result.drawing.curves[0].nodes[1]).not.toBe(result.drawing.curves[1].nodes[0]);near(shapeOf(result.drawing,'a')[3],shapeOf(result.drawing,'b')[0]);expect(result.drawing.endpointLinks).toEqual(source.endpointLinks);expect(result.conflictingNodeIds).toHaveLength(2);
 });
 it('does not change shared endpoints, controls or appearance when preview diagnostics settle',()=>{
  const source=makeDrawing(),grid=moveWarpNode(createWarpGrid(bounds,3,3),5,[-.1,.23]),preview=deformDrawing(source,grid,{diagnostics:'preview'}),full=deformDrawing(source,grid,{diagnostics:'full'});
  expect(preview.drawing).toEqual(full.drawing);expect(preview.diagnosticStage).toBe('preview');expect(full.diagnosticStage).toBe('full');expect(full.maxError).toBeGreaterThanOrEqual(preview.maxError);
 });
 it('handles an empty artwork and identity chains',()=>{
  expect(deformDrawing(emptyDrawing(),[])).toEqual({drawing:emptyDrawing(),diagnostics:[],diagnosticStage:'full',intervalTransportErrors:[],maxError:0,warningCurveIds:[],conflictingNodeIds:[]});
  const source=makeDrawing(),result=deformDrawing(source,[]);expect(result.warningCurveIds).toEqual([]);for(const c of source.curves)shapeOf(source,c.id).forEach((p,i)=>near(p,shapeOf(result.drawing,c.id)[i]));
 });
});
