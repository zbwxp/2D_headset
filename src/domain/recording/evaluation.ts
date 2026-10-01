import {canonical, sameView, VIEW_EPS, type RecordedCurve, type View, type Cubic, type Point2} from './model';
type Triangle=[number,number,number];
const cross=(a:Point2,b:Point2,c:Point2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export interface Coverage { points:Point2[]; order:number[]; triangles:Triangle[]; hull:number[] }
const cache=new WeakMap<RecordedCurve,Coverage>();
/** Deterministic hull triangulation + Lawson flips; sorted insertion fixes cocircular ties. */
export function coverage(c:RecordedCurve):Coverage {
 const hit=cache.get(c);if(hit)return hit;
 const order=c.keys.map((_,i)=>i).sort((a,b)=>c.keys[a].yaw-c.keys[b].yaw||c.keys[a].pitch-c.keys[b].pitch);
 const points:Point2[]=order.map(i=>[c.keys[i].yaw,c.keys[i].pitch]);
 const chain=(indices:number[])=>{const h:number[]=[];for(const i of indices){while(h.length>=2&&cross(points[h.at(-2)!],points[h.at(-1)!],points[i])<=1e-10)h.pop();h.push(i);}return h;};
 const indices=points.map((_,i)=>i),lo=chain(indices),hi=chain([...indices].reverse());
 const hull=points.length===1?[0]:[...lo.slice(0,-1),...hi.slice(0,-1)];
 let triangles:Triangle[]=[];
 if(hull.length>=3){
  const orient=(a:number,b:number,c:number):Triangle=>cross(points[a],points[b],points[c])>0?[a,b,c]:[b,a,c];
  for(let i=1;i<hull.length-1;i++)triangles.push(orient(hull[0],hull[i],hull[i+1]));
  // Start with the actual hull: a finite supertriangle clips valid extremely skinny triangles.
  for(const i of indices.filter(i=>!hull.includes(i))){
   const containing=triangles.filter(t=>t.every((a,j)=>cross(points[a],points[t[(j+1)%3]],points[i])>=-1e-12));
   triangles=triangles.filter(t=>!containing.includes(t));
   for(const t of containing)for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3];if(Math.abs(cross(points[a],points[b],points[i]))>1e-12)triangles.push(orient(a,b,i));}
  }
  // Lawson flips. Sorted insertion and strict incircle comparisons make cocircular ties stable.
  let changed=true;
  while(changed){changed=false;
   const edges=new Map<string,{triangle:Triangle;opposite:number}>();
   outer:for(const t of triangles)for(let j=0;j<3;j++){
    const a=t[j],b=t[(j+1)%3],d=t[(j+2)%3],key=[Math.min(a,b),Math.max(a,b)].join(':'),other=edges.get(key);
    if(!other){edges.set(key,{triangle:t,opposite:d});continue;}
    const e=other.opposite;
    if(cross(points[d],points[e],points[a])*cross(points[d],points[e],points[b])>=0)continue;
    const [u,v,w]=[a,b,d].map(k=>[points[k][0]-points[e][0],points[k][1]-points[e][1]] as Point2);
    const terms=[(u[0]**2+u[1]**2)*(v[0]*w[1]-v[1]*w[0]),-(v[0]**2+v[1]**2)*(u[0]*w[1]-u[1]*w[0]),(w[0]**2+w[1]**2)*(u[0]*v[1]-u[1]*v[0])];
    const det=terms.reduce((x,y)=>x+y,0),eps=64*Number.EPSILON*terms.reduce((x,y)=>x+Math.abs(y),0);
    if(det>eps){triangles=triangles.filter(x=>x!==t&&x!==other.triangle);triangles.push(orient(d,e,a),orient(e,d,b));changed=true;break outer;}
   }
  }
 }

 const result={points,order,triangles,hull};cache.set(c,result);return result;
}
export interface Evaluated { shape:Cubic; status:'key'|'interpolation'|'frozen'; at:View }
export interface ViewWeights {weights:{index:number;weight:number}[];status:Evaluated['status'];at:View}
export function evaluateWeights(c:RecordedCurve,view:View,canonicalView=true):ViewWeights {
 const v=canonicalView?canonical(view):view,exact=c.keys.find(k=>sameView(k,v));if(exact)return {weights:[{index:c.keys.indexOf(exact),weight:1}],status:'key',at:v};
 const g=coverage(c),p:Point2=[v.yaw,v.pitch];
 const blend=(ids:number[],w:number[],at:Point2,status:Evaluated['status']):ViewWeights=>({weights:ids.map((id,i)=>({index:g.order[id],weight:w[i]})),status,at:{yaw:at[0],pitch:at[1]}});
 for(const t of g.triangles){const [a,b,d]=t.map(i=>g.points[i]),den=cross(a,b,d);const w=[cross(p,b,d)/den,cross(a,p,d)/den,cross(a,b,p)/den];if(w.every(x=>x>=-1e-10))return blend(t,w,p,'interpolation');}
 if(g.points.length===1)return blend([0],[1],g.points[0],'frozen');
 // Split hull edges at all collinear samples: frozen shapes must match the
 // complete boundary field, including keys omitted by the convex hull.
 const edges=g.triangles.length?g.hull.flatMap((a,i)=>{
  const b=g.hull[(i+1)%g.hull.length],x=g.points[a],y=g.points[b];
  const dx=y[0]-x[0],dy=y[1]-x[1],length2=dx*dx+dy*dy;
  const ids=g.points.map((p,id)=>({id,t:((p[0]-x[0])*dx+(p[1]-x[1])*dy)/length2}))
   .filter(({id,t})=>t>=0&&t<=1&&Math.abs(cross(x,y,g.points[id]))<=1e-10)
   .sort((a,b)=>a.t-b.t).map(x=>x.id);
  return ids.slice(1).map((b,i)=>[ids[i],b]);
 }):g.points.slice(1).map((_,i)=>[i,i+1]);
 let best={distance:Infinity,ids:[0,0],t:0,q:g.points[0]};
 for(const [a,b] of edges){const x=g.points[a],y=g.points[b],dx=y[0]-x[0],dy=y[1]-x[1];const t=Math.max(0,Math.min(1,((p[0]-x[0])*dx+(p[1]-x[1])*dy)/(dx*dx+dy*dy)));const q:Point2=[x[0]+t*dx,x[1]+t*dy],distance=Math.hypot(q[0]-p[0],q[1]-p[1]);if(distance<best.distance)best={distance,ids:[a,b],t,q};}
 return blend(best.ids,[1-best.t,best.t],best.q,best.distance<=VIEW_EPS?'interpolation':'frozen');
}

export function evaluate(c:RecordedCurve,view:View):Evaluated {
 const {weights,status,at}=evaluateWeights(c,view);
 return {shape:[0,1,2,3].map(j=>[0,1].map(d=>weights.reduce((sum,w)=>sum+w.weight*c.keys[w.index].shape[j][d],0))) as Cubic,status,at};
}
