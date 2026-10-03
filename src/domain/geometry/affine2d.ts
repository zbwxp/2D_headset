import type {Point2} from '../drawing/model';
import {applyScenePlacementMatrix,type ScenePlacementMatrix} from '../recordingScene/tracks';

export type Affine2D=ScenePlacementMatrix;
export const identityAffine2D=():Affine2D=>[1,0,0,1,0,0];
export const applyAffine2D=applyScenePlacementMatrix;
export const validAffine2D=(matrix:unknown):matrix is Affine2D=>Array.isArray(matrix)&&matrix.length===6&&matrix.every(value=>typeof value==='number'&&Number.isFinite(value));
export const isIdentityAffine2D=(matrix:Affine2D)=>matrix.every((value,index)=>value===(index===0||index===3?1:0));
/** Composition is left · right in the existing SVG/Drawing matrix convention. */
export function composeAffine2D(left:Affine2D,right:Affine2D):Affine2D {
 const [a,b,c,d,e,f]=left,[g,h,i,j,k,l]=right,matrix:Affine2D=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
 if(!validAffine2D(matrix))throw Error('The composed layer affine is not finite.');return matrix;
}
/** A real collapsed axis has no inverse. Never replace it by an epsilon or a
 * pseudoinverse; editing the saved operation can restore its retained input. */
export function inverseAffine2D(matrix:Affine2D):Affine2D|null {
 const [a,b,c,d,e,f]=matrix,scale=Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d));if(scale===0)return null;
 const x=a/scale,y=b/scale,z=c/scale,w=d/scale,det=x*w-y*z;if(det===0)return null;
 const inverse:Affine2D=[w/det/scale,-y/det/scale,-z/det/scale,x/det/scale,0,0];
 const point=applyAffine2D(inverse,[-e,-f]);inverse[4]=point[0];inverse[5]=point[1];return validAffine2D(inverse)?inverse:null;
}
/** Exact operator norm formula, scaled to avoid squaring huge coefficients. */
export function affine2DMaxScale(matrix:Affine2D):number {
 if(matrix[0]===matrix[3]&&matrix[1]===-matrix[2]||matrix[0]===-matrix[3]&&matrix[1]===matrix[2])return Math.hypot(matrix[0],matrix[1]);
 const scale=Math.max(...matrix.slice(0,4).map(Math.abs));if(scale===0)return 0;
 const [a,b,c,d]=matrix.map(value=>value/scale),x=a*a+b*b,y=c*c+d*d,z=a*c+b*d;
 return scale*Math.sqrt((x+y+Math.hypot(x-y,2*z))/2);
}
export function applyAffine2DVector(matrix:Affine2D,vector:Point2):Point2 {return [matrix[0]*vector[0]+matrix[2]*vector[1],matrix[1]*vector[0]+matrix[3]*vector[1]];}
