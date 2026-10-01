import {shapeOf,type Cubic,type Point2,type DrawingDocument} from '../drawing/model';
import {transportDeformedIntervals} from '../drawing/deform';
import {displayPath} from '../drawing/displayIntervals';
import {validateWarpGrid,isIdentityWarpGrid,type WarpGrid,type WarpChain,type WarpSource} from './model';

export type Jacobian2 = [Point2,Point2]; // rows, d(output component)/d(input x,y)
export interface WarpSample {point:Point2;jacobian:Jacobian2}
export interface WarpMapper {mapPoint:(point:Point2)=>Point2;sample:(point:Point2)=>WarpSample;isIdentity:boolean}
interface Patch {x:number[];y:number[]}
const B=[[1,0,0,0],[-3,3,0,0],[3,-6,3,0],[-1,3,-3,1]];
const copy=(p:Point2):Point2=>[p[0],p[1]];
const add=(a:Point2,b:Point2):Point2=>[a[0]+b[0],a[1]+b[1]];
const sub=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];
const scale=(p:Point2,n:number):Point2=>[p[0]*n,p[1]*n];
const dot=(a:Point2,b:Point2)=>a[0]*b[0]+a[1]*b[1];
const norm=(p:Point2)=>Math.hypot(p[0],p[1]);
const finite=(p:Point2)=>p.every(Number.isFinite);
const multiply=(a:Jacobian2,b:Jacobian2):Jacobian2=>[[a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1]],[a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1]]];
const apply=(a:Jacobian2,p:Point2):Point2=>[dot(a[0],p),dot(a[1],p)];
const identityMapper=():WarpMapper=>({isIdentity:true,mapPoint:copy,sample:p=>({point:copy(p),jacobian:[[1,0],[0,1]]})});

/** 4x4 Bernstein control net of a shared-node bicubic patch, row-major. */
export function warpPatchControlPoints(grid:WarpGrid,row:number,column:number):Point2[] {
 if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||column<0||row>=grid.rows||column>=grid.columns)throw new Error('Invalid warp patch');
 const points:Array<Point2>=Array.from({length:16},()=>[0,0]);
 for(let v=0;v<2;v++)for(let u=0;u<2;u++){
  const n=grid.nodes[(row+v)*(grid.columns+1)+column+u],i=u*3,j=v*3,du=sub(n.handleU,n.position),dv=sub(n.handleV,n.position),su=u?-1:1,sv=v?-1:1;
  points[j*4+i]=copy(n.position);
  points[j*4+i+su]=add(n.position,scale(du,su));
  points[(j+sv)*4+i]=add(n.position,scale(dv,sv));
  points[(j+sv)*4+i+su]=add(add(add(n.position,scale(du,su)),scale(dv,sv)),scale(n.twist,su*sv/9));
 }
 return points;
}
function compileGrid(grid:WarpGrid):WarpMapper {
 validateWarpGrid(grid);
 if(isIdentityWarpGrid(grid))return identityMapper();
 const rows=grid.rows,columns=grid.columns,min=copy(grid.bounds.min),sx=columns/(grid.bounds.max[0]-min[0]),sy=rows/(grid.bounds.max[1]-min[1]);
 const patches:Patch[]=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const net=warpPatchControlPoints(grid,row,col),x=Array(16).fill(0),y=Array(16).fill(0);
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let v=0;v<4;v++)for(let u=0;u<4;u++){
   const weight=B[i][u]*B[j][v];x[j*4+i]+=weight*net[v*4+u][0];y[j*4+i]+=weight*net[v*4+u][1];
  }
  patches.push({x,y});
 }
 const coordinates=(p:Point2)=>{
  const gu=(p[0]-min[0])*sx,gv=(p[1]-min[1])*sy;
  const col=Math.min(columns-1,Math.max(0,Math.floor(gu))),row=Math.min(rows-1,Math.max(0,Math.floor(gv)));
  return {patch:patches[row*columns+col],u:gu-col,v:gv-row};
 };
 const value=(c:number[],u:number,v:number)=>{
  const a=(c[3]*u+c[2])*u*u+c[1]*u+c[0],b=(c[7]*u+c[6])*u*u+c[5]*u+c[4],d=(c[11]*u+c[10])*u*u+c[9]*u+c[8],e=(c[15]*u+c[14])*u*u+c[13]*u+c[12];
  return ((e*v+d)*v+b)*v+a;
 };
 const derivative=(c:number[],u:number,v:number):Point2=>{
  const u0=(3*c[3]*u+2*c[2])*u+c[1],u1=(3*c[7]*u+2*c[6])*u+c[5],u2=(3*c[11]*u+2*c[10])*u+c[9],u3=(3*c[15]*u+2*c[14])*u+c[13];
  const v1=((c[7]*u+c[6])*u+c[5])*u+c[4],v2=((c[11]*u+c[10])*u+c[9])*u+c[8],v3=((c[15]*u+c[14])*u+c[13])*u+c[12];
  return [(((u3*v+u2)*v+u1)*v+u0)*sx,((3*v3*v+2*v2)*v+v1)*sy];
 };
 return {
  isIdentity:false,
  mapPoint(p){if(!finite(p))return [NaN,NaN];const {patch,u,v}=coordinates(p);return [value(patch.x,u,v),value(patch.y,u,v)];},
  sample(p){if(!finite(p))return {point:[NaN,NaN],jacobian:[[NaN,NaN],[NaN,NaN]]};const {patch,u,v}=coordinates(p);return {point:[value(patch.x,u,v),value(patch.y,u,v)],jacobian:[derivative(patch.x,u,v),derivative(patch.y,u,v)]};},
 };
}
/** Snapshot compiler: subsequent edits to input grids do not alter this mapper.
 * Grids are applied child first, then parent; each parent's rest rectangle is in
 * the child's output coordinate system. No inverse is computed. Outside the
 * rest rectangle the nearest boundary PATCH continues polynomially (not clamp).
 * This preserves affine maps/C1 boundary behavior, but distant extrapolation
 * can grow rapidly. It is not a bounded or globally invertible map. */
export function createWarpMapper(grids:WarpChain):WarpMapper {
 const maps=grids.map(compileGrid);
 return composeMappers(maps);
}
function composeMappers(maps:WarpMapper[]):WarpMapper {
 maps=maps.filter(map=>!map.isIdentity);
 if(!maps.length)return identityMapper();
 return {
  isIdentity:false,
  mapPoint(p){let point=copy(p);for(const map of maps)point=map.mapPoint(point);return point;},
  sample(p){let point=copy(p),jacobian:Jacobian2=[[1,0],[0,1]];for(const map of maps){const next=map.sample(point);point=next.point;jacobian=multiply(next.jacobian,jacobian);}return {point,jacobian};},
 };
}
export const mapPoint=(grid:WarpGrid,point:Point2):Point2=>compileGrid(grid).mapPoint(point);
export const evaluateWarp=(grid:WarpGrid,point:Point2):WarpSample=>compileGrid(grid).sample(point);
export const mapPointThroughGrids=(point:Point2,childToParentGrids:WarpChain):Point2=>createWarpMapper(childToParentGrids).mapPoint(point);
export function cubicPoint(c:Cubic,t:number):Point2 {
 const s=1-t,a=s*s*s,b=3*s*s*t,d=3*s*t*t,e=t*t*t;
 return [a*c[0][0]+b*c[1][0]+d*c[2][0]+e*c[3][0],a*c[0][1]+b*c[1][1]+d*c[2][1]+e*c[3][1]];
}
export function cubicDerivative(c:Cubic,t:number):Point2 {
 const s=1-t;return add(add(scale(sub(c[1],c[0]),3*s*s),scale(sub(c[2],c[1]),6*s*t)),scale(sub(c[3],c[2]),3*t*t));
}

export interface WarpFitOptions {
 /** Logical Drawing units, NOT zoomed screen pixels. 1/250 is one nominal pixel. */
 tolerance?:number;
 /** Interior least-squares observations; independent from validation samples. */
 fitSamples?:number;
 /** Preview keeps the SAME fitted cubic, but performs only 32 diagnostic samples
  * and skips peak refinement. A preview pass is never presented as full validation.
  * Use full (default) once input settles; do not change fitSamples between stages. */
 diagnostics?:'preview'|'full';
 /** Full-stage half-offset validation observations (minimum 1024), plus peak refinement.
  * This is numerical validation, not an analytic/certified supremum guarantee. */
 validationSamples?:number;
 /** Shared-node reconciliation positions; never move canonical source points. */
 endpoints?:[Point2,Point2];
}
export interface WarpFitDiagnostic {
 sourceCurveId?:string;
 cubic:Cubic;
 /** Maximum observed same-parameter positional error in logical Drawing units. */
 maxError:number;
 peakT:number;peakExpected:Point2;peakActual:Point2;
 tolerance:number;exceedsTolerance:boolean;warning:boolean;
 diagnosticStage:'preview'|'full';
 validationKind:'sampled'|'sampled-preview'|'identity-exact';validationSamples:number;
 endpointMismatchError:number;endpointConflict:boolean;
 tangentStatus:'preserved'|'degenerate'|'endpoint-conflict';
 tangentDeviationRadians:[number,number];
 nonFinite:boolean;
 /** Material display-range transport can be undefined on a collapsed path. */
 appearanceWarning?:string;
}
const unit=(p:Point2):Point2=>{const n=norm(p);return n>1e-12?scale(p,1/n):[0,0];};
function fitWithMapper(source:Cubic,mapper:WarpMapper,options:WarpFitOptions={}):WarpFitDiagnostic {
 const tolerance=options.tolerance??1/250;
 const diagnosticStage=options.diagnostics??'full';
 if(diagnosticStage!=='preview'&&diagnosticStage!=='full')throw new Error('Invalid warp diagnostic stage');
 if(!Number.isFinite(tolerance)||tolerance<=0)throw new Error('Warp tolerance must be positive logical Drawing units');
 const fitSamples=Math.max(8,Math.min(1024,Math.round(options.fitSamples??64))),validationSamples=diagnosticStage==='preview'?32:Math.max(1024,Math.min(16384,Math.round(options.validationSamples??1024)));
 if(!Number.isFinite(fitSamples)||!Number.isFinite(validationSamples)||source.some(p=>!finite(p)))throw new Error('Invalid warp fitting input');
 if(mapper.isIdentity&&(!options.endpoints||options.endpoints.every((p,i)=>p[0]===source[i?3:0][0]&&p[1]===source[i?3:0][1]))){
  const cubic=source.map(copy) as Cubic;
  return {cubic,maxError:0,peakT:0,peakExpected:copy(source[0]),peakActual:copy(source[0]),tolerance,exceedsTolerance:false,warning:false,diagnosticStage,validationKind:'identity-exact',validationSamples:0,endpointMismatchError:0,endpointConflict:false,tangentStatus:norm(cubicDerivative(source,0))<1e-12||norm(cubicDerivative(source,1))<1e-12?'degenerate':'preserved',tangentDeviationRadians:[0,0],nonFinite:false};
 }
 const at=(t:number)=>mapper.mapPoint(cubicPoint(source,t));
 const start=mapper.sample(source[0]),end=mapper.sample(source[3]),p=copy(options.endpoints?.[0]??start.point),q=copy(options.endpoints?.[1]??end.point);
 const velocityA=apply(start.jacobian,cubicDerivative(source,0)),velocityB=apply(end.jacobian,cubicDerivative(source,1)),ua=unit(velocityA),ub=unit(velocityB);
 const endpointMismatchError=Math.max(norm(sub(p,start.point)),norm(sub(q,end.point))),endpointConflict=endpointMismatchError>1e-8;
 let aa=0,ab=0,bb=0,ar=0,br=0,nonFinite=![p,q,velocityA,velocityB].every(finite);
 const uu=dot(ua,ua),vv=dot(ub,ub),uv=dot(ua,ub);
 for(let i=1;i<=fitSamples;i++){
  const t=i/(fitSamples+1),s=1-t,a=3*s*s*t,b=-3*s*t*t,bp=s*s*s+a,bq=t*t*t-b,target=at(t);
  if(!finite(target)){nonFinite=true;continue;}
  const rx=target[0]-p[0]*bp-q[0]*bq,ry=target[1]-p[1]*bp-q[1]*bq;
  aa+=a*a*uu;ab+=a*b*uv;bb+=b*b*vv;ar+=a*(ua[0]*rx+ua[1]*ry);br+=b*(ub[0]*rx+ub[1]*ry);
 }
 // Two-variable nonnegative least squares keeps each endpoint's directed tangent.
 // Enumerating interior and both boundary optima solves this convex problem.
 const candidates:[number,number][]=[[0,0],[aa>1e-20?Math.max(0,ar/aa):0,0],[0,bb>1e-20?Math.max(0,br/bb):0]],det=aa*bb-ab*ab;
 if(det>1e-20){const a=(ar*bb-br*ab)/det,b=(br*aa-ar*ab)/det;if(a>=0&&b>=0)candidates.push([a,b]);}
 let best=candidates[0],score=Infinity;
 // The normal-equation quadratic ranks candidates without retaining/replaying
 // every observation or allocating temporary vector arrays during interaction.
 for(const candidate of candidates){const [a,b]=candidate,sum=aa*a*a+2*ab*a*b+bb*b*b-2*ar*a-2*br*b;if(sum<score){best=candidate;score=sum;}}
 let cubic:Cubic=[p,add(p,scale(ua,best[0])),sub(q,scale(ub,best[1])),q];
 if(cubic.some(x=>!finite(x))||nonFinite){nonFinite=true;cubic=source.map(copy) as Cubic;}
 let maxError=-1,peakT=0,peakExpected=at(0),peakActual=cubicPoint(cubic,0),evaluations=0;
 const error=(t:number)=>{
  const expected=at(t),actual=cubicPoint(cubic,t),e=finite(expected)&&finite(actual)?norm(sub(expected,actual)):Infinity;evaluations++;
  if(e>maxError){maxError=e;peakT=t;peakExpected=expected;peakActual=actual;}
  return e;
 };
 // A lone midpoint misses S-curves and many folds. Half-offset dense samples are
 // independent from fit observations; each sampled local maximum is refined.
 const ts=[0,...Array.from({length:validationSamples},(_,i)=>(i+.5)/validationSamples),1],errors=ts.map(error);
 // Include the preview observations in full validation so an already-observed
 // error cannot disappear simply because the diagnostic sample lattice changed.
 if(diagnosticStage==='full')for(let i=0;i<32;i++)error((i+.5)/32);
 if(diagnosticStage==='full')for(let i=1;i<ts.length-1;i++)if(errors[i]>=errors[i-1]&&errors[i]>=errors[i+1]&&errors[i]>1e-12){
  let lo=ts[i-1],hi=ts[i+1];const ratio=(Math.sqrt(5)-1)/2;let a=hi-ratio*(hi-lo),b=lo+ratio*(hi-lo),ea=error(a),eb=error(b);
  for(let step=0;step<14;step++)if(ea<eb){lo=a;a=b;ea=eb;b=lo+ratio*(hi-lo);eb=error(b);}else{hi=b;b=a;eb=ea;a=hi-ratio*(hi-lo);ea=error(a);}
 }
 nonFinite=nonFinite||!Number.isFinite(maxError);
 if(nonFinite)maxError=Infinity;
 const angle=(desired:Point2,actual:Point2)=>{const a=norm(desired),b=norm(actual);return a<1e-12||b<1e-12?0:Math.acos(Math.max(-1,Math.min(1,dot(desired,actual)/(a*b))));};
 const tangentStatus=endpointConflict?'endpoint-conflict':norm(velocityA)<1e-12||norm(velocityB)<1e-12||best[0]<1e-12||best[1]<1e-12?'degenerate':'preserved';
 const exceedsTolerance=maxError>tolerance;
 return {cubic,maxError,peakT,peakExpected,peakActual,tolerance,exceedsTolerance,warning:exceedsTolerance||endpointConflict||nonFinite,diagnosticStage,validationKind:diagnosticStage==='preview'?'sampled-preview':'sampled',validationSamples:evaluations,endpointMismatchError,endpointConflict,tangentStatus,tangentDeviationRadians:[angle(velocityA,cubicDerivative(cubic,0)),angle(velocityB,cubicDerivative(cubic,1))],nonFinite};
}
/** Exactly ONE cubic is returned, even when inaccurate. No subdivision, hidden
 * source edits, or multiple-segment rendering fallback is performed. */
export function fitWarpedCubic(source:Cubic,grids:WarpGrid|WarpChain,options:WarpFitOptions={}):WarpFitDiagnostic {
 return fitWithMapper(source,createWarpMapper(Array.isArray(grids)?grids: [grids as WarpGrid]),options);
}
export interface DeformedDrawing {
 /** Transient geometry only; source IDs, nodes, strokes/fill paths and styles retained. */
 drawing:DrawingDocument;
 diagnostics:WarpFitDiagnostic[];
 maxError:number;warningCurveIds:string[];
 diagnosticStage:'preview'|'full';
 intervalTransportErrors:{trackId:string;sourceCurveIds:string[];message:string}[];
 /** Linked nodes whose incident curves request incompatible endpoint positions. */
 conflictingNodeIds:string[];
}
export function deformDrawing(source:DrawingDocument,warps:WarpSource,options:WarpFitOptions={}):DeformedDrawing {
 const drawing=structuredClone(source),compiled=new Map<WarpGrid,WarpMapper>(),mappers=new Map<string,WarpMapper>();
 for(const curve of source.curves){
  const grids=typeof warps==='function'?warps(curve.id):Array.isArray(warps)?warps:[warps as WarpGrid];
  const maps=grids.map(grid=>{let map=compiled.get(grid);if(!map){map=compileGrid(grid);compiled.set(grid,map);}return map;});mappers.set(curve.id,composeMappers(maps));
 }
 const nodeById=new Map(source.nodes.map(n=>[n.id,n])),curveById=new Map(source.curves.map(c=>[c.id,c]));
 const parent=new Map(source.nodes.map(n=>[n.id,n.id]));
 const root=(id:string):string=>{const p=parent.get(id);if(p===undefined)throw new Error('Unknown drawing node');if(p===id)return id;const r=root(p);parent.set(id,r);return r;};
 for(const link of source.endpointLinks??[]){const a=curveById.get(link.a.curveId),b=curveById.get(link.b.curveId);if(a&&b)parent.set(root(b.nodes[link.b.end]),root(a.nodes[link.a.end]));}
 const candidates=new Map<string,Point2[]>();
 for(const curve of source.curves)for(const nodeId of curve.nodes){const mapped=mappers.get(curve.id)!.mapPoint(nodeById.get(nodeId)!.position),key=root(nodeId);if(!finite(mapped))continue;const list=candidates.get(key)??[];list.push(mapped);candidates.set(key,list);}
 const positions=new Map<string,Point2>(),conflicts=new Set<string>();
 for(const [key,points] of candidates){
  // Identical field requests must retain the exact evaluated coordinate. Averaging
  // three identical floating-point values can otherwise introduce rounding drift.
  const first=points[0],mean=points.every(p=>p[0]===first[0]&&p[1]===first[1])?copy(first):scale(points.reduce(add,[0,0]),1/points.length);
  positions.set(key,mean);if(points.some(p=>norm(sub(p,mean))>1e-8))conflicts.add(key);
 }
 for(const node of drawing.nodes)node.position=copy(positions.get(root(node.id))??node.position);
 const outputNodes=new Map(drawing.nodes.map(n=>[n.id,n]));
 const diagnostics=drawing.curves.map(curve=>{
  const diagnostic=fitWithMapper(shapeOf(source,curve.id),mappers.get(curve.id)!,{...options,endpoints:[outputNodes.get(curve.nodes[0])!.position,outputNodes.get(curve.nodes[1])!.position]});
  diagnostic.sourceCurveId=curve.id;
  // Even numeric failure must retain the one shared output endpoint per node.
  diagnostic.cubic[0]=copy(outputNodes.get(curve.nodes[0])!.position);diagnostic.cubic[3]=copy(outputNodes.get(curve.nodes[1])!.position);
  curve.handles=[copy(diagnostic.cubic[1]),copy(diagnostic.cubic[2])];return diagnostic;
 });
 // Display ranges are saved in arc coordinates. Our fit preserves source t, so
 // an identity parameter map transports each material cut to the fitted curve's
 // new arc coordinate. This is geometry work in BOTH stages, not a final-only fix.
 let output=drawing;
 const intervalTransportErrors:DeformedDrawing['intervalTransportErrors']=[];
 if(source.displayIntervals?.length){
  try{output=transportDeformedIntervals(source,drawing);}
  catch{
   // A deliberate fold may collapse one interval's whole path. Preserve a
   // reviewable fallback for that track, report it, and continue other tracks.
   const displayIntervals=source.displayIntervals.map(track=>{
    try{return transportDeformedIntervals({...source,displayIntervals:[track]},drawing).displayIntervals![0];}
    catch(error){
     let sourceCurveIds=[track.anchor.id];try{sourceCurveIds=displayPath(source,track.anchor.id).segments.map(s=>s.id);}catch{/* malformed references are already diagnosed by document parsing */}
     const message=error instanceof Error?error.message:String(error);intervalTransportErrors.push({trackId:track.id,sourceCurveIds,message});
     for(const diagnostic of diagnostics)if(sourceCurveIds.includes(diagnostic.sourceCurveId!)){diagnostic.warning=true;diagnostic.appearanceWarning=message;}
     return track;
    }
   });
   output={...drawing,displayIntervals};
  }
  // The existing transport helper may reuse unchanged tracks. Keep transient
  // output detached even when a track did not need any numeric transport.
  output={...output,displayIntervals:structuredClone(output.displayIntervals)};
 }
 return {drawing:output,diagnostics,diagnosticStage:options.diagnostics??'full',intervalTransportErrors,maxError:diagnostics.reduce((m,d)=>Math.max(m,d.maxError),0),warningCurveIds:diagnostics.filter(d=>d.warning).map(d=>d.sourceCurveId!),conflictingNodeIds:drawing.nodes.filter(n=>conflicts.has(root(n.id))).map(n=>n.id)};
}
