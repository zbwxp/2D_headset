import type {Cubic,Point2} from './model';

/** Transient view geometry. x is a vertical line; y is a horizontal line. */
export interface ViewGuide {id:string;axis:'x'|'y';value:number}
export interface ViewGuideSnap {
 point:Point2;
 kind:'guide'|'guide-intersection'|'curve-guide';
 guideIds:string[];
 /** Index in the caller's drawing/reference curve array; t is Bézier t. */
 curveIndex?:number;
 t?:number;
}

const finitePoint=(p:unknown):p is Point2=>Array.isArray(p)&&p.length===2&&[p[0],p[1]].every(x=>typeof x==='number'&&Number.isFinite(x));
const fail=():never=>{throw new RangeError('View-guide snapping requires finite points, valid unique guides, a positive unitsPerPixel and a nonnegative pixel threshold');};
const axisIndex=(g:ViewGuide)=>g.axis==='x'?0:1;
const lerp=(a:number,b:number,t:number)=>a*(1-t)+b*t;
const bezier=(v:readonly number[],t:number)=>lerp(lerp(lerp(v[0],v[1],t),lerp(v[1],v[2],t),t),lerp(lerp(v[1],v[2],t),lerp(v[2],v[3],t),t),t);
const at=(c:Cubic,t:number):Point2=>[bezier(c.map(p=>p[0]),t),bezier(c.map(p=>p[1]),t)];
const unique=(values:number[])=>values.sort((a,b)=>a-b).filter((x,i,a)=>i===0||Math.abs(x-a[i-1])>16*Number.EPSILON);

/** Stable quadratic formula, including derivative degeneracy. */
function quadratic(a:number,b:number,c:number):number[]{
 if(a===0)return b===0?[]:[-c/b];
 const product=4*a*c,discriminant=b*b-product,tolerance=16*Number.EPSILON*(b*b+Math.abs(product));
 if(discriminant < -tolerance)return [];
 const root=Math.sqrt(Math.max(0,discriminant));
 if(root===0)return [-b/(2*a)];
 const q=-.5*(b+(b<0?-root:root));
 return [q/a,c/q];
}

/**
 * Isolate all roots in [0,1] using exact derivative partitions rather than a
 * sampled polyline. Stationary points are checked explicitly for tangencies.
 * An entirely coincident cubic has no isolated intersection: ordinary guide
 * projection handles it without inventing a curve parameter.
 */
function guideRoots(c:Cubic,axis:number,value:number):number[]{
 const raw=c.map(p=>p[axis]-value);
 // Subtraction of opposite finite extremes can overflow; normalize first only
 // in that case. For ordinary coordinates direct subtraction retains accuracy.
 const scale=raw.every(Number.isFinite)?Math.max(...raw.map(Math.abs)):Math.max(Math.abs(value),...c.map(p=>Math.abs(p[axis])));
 if(scale===0)return [];
 const v=raw.every(Number.isFinite)?raw.map(x=>x/scale):c.map(p=>p[axis]/scale-value/scale);
 const a=-v[0]+3*v[1]-3*v[2]+v[3],b=3*v[0]-6*v[1]+3*v[2],cc=3*(v[1]-v[0]);
 const cuts=unique([0,...quadratic(3*a,2*b,cc).filter(t=>t>0&&t<1),1]),roots:number[]=[];
 const tolerance=32*Number.EPSILON*Math.max(...v.map(Math.abs));
 for(const t of cuts)if(Math.abs(bezier(v,t))<=tolerance)roots.push(t);
 for(let i=1;i<cuts.length;i++){
  let lo=cuts[i-1],hi=cuts[i],left=bezier(v,lo);const right=bezier(v,hi);
  if(left===0||right===0||(left<0)===(right<0))continue;
  // A cubic is monotone within this bracket. Fixed bounded bisection also
  // handles very flat roots without prematurely stopping on a small residual.
  for(let j=0;j<64;j++){
   const mid=(lo+hi)/2;if(mid===lo||mid===hi)break;
   const value=bezier(v,mid);
   if(value===0){lo=hi=mid;break;}
   if((value<0)===(left<0)){lo=mid;left=value;}else hi=mid;
  }
  roots.push((lo+hi)/2);
 }
 return unique(roots);
}

interface Candidate {snap:ViewGuideSnap;distance:number}
const compare=(a:Candidate,b:Candidate)=>a.distance-b.distance||
 (a.snap.kind===b.snap.kind?0:a.snap.kind==='guide-intersection'?-1:b.snap.kind==='guide-intersection'?1:0)||
 a.snap.guideIds.join('\u0000').localeCompare(b.snap.guideIds.join('\u0000'))||
 (a.snap.curveIndex??-1)-(b.snap.curveIndex??-1)||(a.snap.t??-1)-(b.snap.t??-1);

/**
 * Snap in one shared drawing coordinate system; reference cubics are eligible
 * when the caller includes their already-transformed copies in `curves`.
 * Distances and the inclusive capture radius are measured in screen pixels.
 * The nearest discrete intersection is preferred only when it is at most two
 * pixels farther than the nearest guide projection, and still within radius.
 * Ties are stable by kind, guide IDs, curve index, then t. Inputs never change.
 * Bypass is a caller concern: do not invoke this helper while bypass is held.
 * Invalid inputs throw RangeError; no candidate in range returns null.
 */
export function snapViewGuides(point:Point2,guides:readonly ViewGuide[],curves:readonly Cubic[],unitsPerPixel:number,thresholdPx=8):ViewGuideSnap|null{
 if(!finitePoint(point)||!Array.isArray(guides)||!Array.isArray(curves)||!Number.isFinite(unitsPerPixel)||unitsPerPixel<=0||!Number.isFinite(thresholdPx)||thresholdPx<0)return fail();
 const ids=new Set<string>();
 for(const g of guides){if(!g||typeof g.id!=='string'||!g.id||ids.has(g.id)||!['x','y'].includes(g.axis)||!Number.isFinite(g.value))return fail();ids.add(g.id);}
 for(const c of curves)if(!Array.isArray(c)||c.length!==4||![c[0],c[1],c[2],c[3]].every(finitePoint))return fail();
 let projection:Candidate|undefined,intersection:Candidate|undefined;
 const offer=(snap:ViewGuideSnap)=>{
  const distance=Math.hypot((snap.point[0]-point[0])/unitsPerPixel,(snap.point[1]-point[1])/unitsPerPixel);
  if(!Number.isFinite(distance)||distance>thresholdPx)return;
  const candidate={snap,distance};
  if(snap.kind==='guide'){if(!projection||compare(candidate,projection)<0)projection=candidate;}
  else if(!intersection||compare(candidate,intersection)<0)intersection=candidate;
 };
 const nearby=guides.filter(g=>Math.abs((g.value-point[axisIndex(g)])/unitsPerPixel)<=thresholdPx);
 for(const g of nearby){const p:Point2=[...point];p[axisIndex(g)]=g.value;offer({point:p,kind:'guide',guideIds:[g.id]});}
 for(const x of nearby.filter(g=>g.axis==='x'))for(const y of nearby.filter(g=>g.axis==='y'))offer({point:[x.value,y.value],kind:'guide-intersection',guideIds:[x.id,y.id].sort()});
 for(let curveIndex=0;curveIndex<curves.length;curveIndex++){
  const c:Cubic=curves[curveIndex];
  // The Bézier curve is contained in its control hull. This cheap box bound
  // excludes distant reference/artwork curves before doing any root solving.
  const distance=Math.hypot(...([0,1] as const).map(axis=>Math.max(0,Math.min(...c.map(p=>p[axis]))-point[axis],point[axis]-Math.max(...c.map(p=>p[axis])))/unitsPerPixel));
  if(distance>thresholdPx)continue;
  for(const g of nearby)for(const t of guideRoots(c,axisIndex(g),g.value)){
   const p=at(c,t);p[axisIndex(g)]=g.value;
   offer({point:p,kind:'curve-guide',guideIds:[g.id],curveIndex,t});
  }
 }
 return intersection&&(!projection||intersection.distance<=projection.distance+Math.min(2,thresholdPx))?intersection.snap:projection?.snap??null;
}
