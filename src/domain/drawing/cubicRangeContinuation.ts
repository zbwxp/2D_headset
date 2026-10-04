import type {Cubic,Point2} from './model';
import {subcurve} from './roundedJoin';

/** Inverse affine de Casteljau restriction, evaluated with the cubic blossom.
 * The four control points over [lo,hi] determine exactly one polynomial on
 * [0,1]. No fitting, old parent geometry, or retained samples are involved. */
export function assertCubicContinuationRange(lo:number,hi:number):void {
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo<0||hi>1||!(hi>lo))throw Error('Cubic continuation requires 0 ≤ lo < hi ≤ 1.');
 const span=hi-lo,a=-lo/span,b=(1-lo)/span,amplification=Math.max(Math.abs(1-a)+Math.abs(a),Math.abs(1-b)+Math.abs(b))**3;
 if(amplification>2**24)throw Error(`Cubic continuation is ill-conditioned on [${lo}, ${hi}] (amplification ${amplification} exceeds 16777216).`);
}
export function continueCubicRange(shape:Cubic,lo:number,hi:number):Cubic {
 // Each blossom interpolation has absolute row sum |1-t|+|t|. The
 // three-stage product leaves at least about 29 bits of relative precision.
 assertCubicContinuationRange(lo,hi);
 const span=hi-lo,a=-lo/span,b=(1-lo)/span;
 const blend=(p:Point2,q:Point2,t:number):Point2=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
 const blossom=(u:number,v:number,w:number):Point2=>{const first=[blend(shape[0],shape[1],u),blend(shape[1],shape[2],u),blend(shape[2],shape[3],u)],second=[blend(first[0],first[1],v),blend(first[1],first[2],v)];return blend(second[0],second[1],w);};
 const parent:Cubic=[blossom(a,a,a),blossom(a,a,b),blossom(a,b,b),blossom(b,b,b)],scale=Math.max(1,...shape.flat().map(Math.abs));
 if(parent.flat().some(value=>!Number.isFinite(value))||subcurve(parent,lo,hi).some((p,i)=>p.some((value,axis)=>Math.abs(value-shape[i][axis])>1e-8*scale)))throw Error('Cubic continuation cannot replay the surviving interval within numerical precision.');
 return parent;
}
