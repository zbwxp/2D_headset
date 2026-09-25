import {DEFAULT_FILL_MIST,validFillMist,type Cubic,type FillMist,type DrawingDocument as Doc} from './model';

export function setFillMist(d:Doc,id:string,change:Partial<FillMist>):Doc{
 const f=d.fills.find(f=>f.id===id);if(!f)return d;if(f.locked)throw Error('对象已锁定。');
 const mist={...DEFAULT_FILL_MIST,...f.mist,...change};if(!validFillMist(mist))throw Error('雾化填充参数无效。');
 if(f.color==='transparent'&&mist.enabled)throw Error('透明挖空不能同时使用雾化填充。');
 if(JSON.stringify(f.mist)===JSON.stringify(mist))return d;
 return {...d,fills:d.fills.map(x=>x===f?{...f,mist}:x)};
}
/** Gaussian alpha by distance to the closest point of the *whole* boundary.
 * Width is the 3-sigma extent. Subtract the small tail so the bitmap reaches
 * exact zero at its bounds; bands never sum at curve seams or narrow corners. */
export function fillMistAlpha(distance:number,width:number){
 if(distance>=width)return 0;const tail=Math.exp(-4.5),q=Math.max(0,distance)/width;
 return (Math.exp(-4.5*q*q)-tail)/(1-tail);
}
export function fillMistLayout(shapes:Cubic[],mist:FillMist){
 if(!shapes.length)return null;const origin=shapes[0][0];
 const relative=shapes.map(s=>s.map(p=>[+(p[0]-origin[0]).toFixed(10),+(p[1]-origin[1]).toFixed(10)])) as Cubic[];
 const pad=(mist.side==='INSIDE'?0:mist.width*250)+2;
 const b=relative.flat().reduce((b,p)=>[Math.min(b[0],p[0]*250),Math.min(b[1],p[1]*250),Math.max(b[2],p[0]*250),Math.max(b[3],p[1]*250)],[Infinity,Infinity,-Infinity,-Infinity]);
 const w=b[2]-b[0]+2*pad,h=b[3]-b[1]+2*pad,scale=Math.min(2,2048/Math.max(w,h),Math.sqrt(1_500_000/(w*h)));
 const nx=Math.max(1,Math.ceil(w*scale)),ny=Math.max(1,Math.ceil(h*scale)),x0=b[0]-pad,y1=b[3]+pad;
 return {relative,origin,nx,ny,scale,bounds:[x0,y1-ny/scale,x0+nx/scale,y1] as [number,number,number,number]};
}
/** Exact squared Euclidean distance transform on raster boundary seeds, O(pixels).
 * The lower envelope of parabolas in each row/column avoids per-pixel searches
 * over all Bézier segments. Finite sentinel also handles completely empty rows. */
export function boundaryDistances(seeds:Uint8Array,nx:number,ny:number):Float32Array{
 const out=new Float32Array(nx*ny),max=Math.max(nx,ny),f=new Float64Array(max),g=new Float64Array(max),v=new Int32Array(max),z=new Float64Array(max+1),far=1e12;
 const transform=(n:number)=>{
  let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
  for(let q=1;q<n;q++){let s:number;for(;;){const p=v[k];s=((f[q]+q*q)-(f[p]+p*p))/(2*(q-p));if(s>z[k]||k===0)break;k--;}
   k++;v[k]=q;z[k]=s!;z[k+1]=Infinity;
  }
  k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;const dx=q-v[k];g[q]=dx*dx+f[v[k]];}
 };
 for(let y=0;y<ny;y++){for(let x=0;x<nx;x++)f[x]=seeds[y*nx+x]?0:far;transform(nx);for(let x=0;x<nx;x++)out[y*nx+x]=g[x];}
 for(let x=0;x<nx;x++){for(let y=0;y<ny;y++)f[y]=out[y*nx+x];transform(ny);for(let y=0;y<ny;y++)out[y*nx+x]=Math.sqrt(g[y]);}
 return out;
}
