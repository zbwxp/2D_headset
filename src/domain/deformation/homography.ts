import type {Point2} from '../drawing/model';

export type Matrix3=[number,number,number,number,number,number,number,number,number];
export const identity3=():Matrix3=>[1,0,0,0,1,0,0,0,1];
export const multiply3=(a:Matrix3,b:Matrix3):Matrix3=>Array.from({length:9},(_,i)=>{
 const r=Math.floor(i/3),c=i%3;return a[r*3]*b[c]+a[r*3+1]*b[c+3]+a[r*3+2]*b[c+6];
}) as Matrix3;
export function inverse3(m:Matrix3):Matrix3 {
 const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=f*g-d*i,C=d*h-e*g,det=a*A+b*B+c*C;
 if(!Number.isFinite(det)||Math.abs(det)<1e-10)throw Error('当前图层接近侧立，请转回一些角度再调整四角。');
 return [A,c*h-b*i,b*f-c*e,B,a*i-c*g,c*d-a*f,C,b*g-a*h,a*e-b*d].map(v=>v/det) as Matrix3;
}
export function map3(m:Matrix3,[x,y]:Point2):Point2 {
 const w=m[6]*x+m[7]*y+m[8];if(!Number.isFinite(w)||Math.abs(w)<1e-8)throw Error('透视超出有效范围。');
 return [(m[0]*x+m[1]*y+m[2])/w,(m[3]*x+m[4]*y+m[5])/w];
}
export const fromCSS=(m:number[]):Matrix3=>[m[0],m[4],m[12],m[1],m[5],m[13],m[3],m[7],m[15]];
export const toCSS=(m:Matrix3):number[]=>[m[0],m[3],0,m[6],m[1],m[4],0,m[7],0,0,1,0,m[2],m[5],0,m[8]];
