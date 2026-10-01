import type {Cubic,Point2} from '../drawing/model';
import type {HairNet,Hairstyle,Vec3} from './model';
import {dot,hairOpeningAngle,hairSection,hairSurfacePoint,world,generateHair} from './geometry';
import {hairBasis,type HairView} from './projection';
import {resolveHairRange,hairEndpointPosition} from './strandTypes';
import {syncStrands} from './strands';
import {hairLocal,hairRadiusSquared,hairShellField} from './profile';
import {surfaceFromView,hairSketchProjector} from './surfaceCurve';

export type HairControl = 0|1|2|3; // root, root handle, tip handle, tip
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const sq=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
const cap=.995,minZ=Math.sqrt(1-cap*cap);
export function projectedHairControl(p:Vec3,view:HairView):Point2 {
 const {right,up}=hairBasis(view);return [dot(p,right),dot(p,up)];
}

/** Orthographic ray/ellipsoid intersection, retaining the original depth branch.
 * Outside the editable front cap, the nearest projection lies on its rim or on
 * the ellipsoid silhouette. Searching those two circles avoids depth flips and
 * ill-conditioned XY gradient steps at the silhouette. */
export function locateHairEndpoint(net:HairNet,view:HairView,target:Point2,previous:Vec3):Vec3 {
 if(net.profile?.version===2)return locatePumpkinEndpoint(net,view,target,previous);
 if(net.profile)return locateProfileEndpoint(net,view,target,previous);
 const {right,up,forward}=hairBasis(view),r=[net.radiusX,net.radiusY,net.radiusZ];
 const x=target[0]-dot(net.center,right),y=target[1]-dot(net.center,up);
 const a=right.map((v,i)=>(v*x+up[i]*y)/r[i]) as Vec3,b=forward.map((v,i)=>v/r[i]) as Vec3;
 const aa=dot(b,b),ab=dot(a,b),disc=ab*ab-aa*(dot(a,a)-1);
 if(disc>=-1e-12){
  const candidates=[-1,1].map(sign=>a.map((v,i)=>v+b[i]*(-ab+sign*Math.sqrt(Math.max(0,disc)))/aa) as Vec3).filter(p=>p[2]>=minZ-1e-9);
  if(candidates.length)return candidates.sort((p,q)=>sq(p,previous)-sq(q,previous))[0];
 }
 const error=(p:Vec3)=>p[2]<minZ-1e-9?Infinity:sq(projectedHairControl(world(net,p),view),target);
 let best=previous,bestError=error(best);
 const test=(p:Vec3)=>{const e=error(p);if(e<bestError){best=p;bestError=e;}return e;};
 const normal=b.map(v=>v/Math.hypot(...b)) as Vec3;
 const seed:Vec3=Math.abs(normal[1])<.9?[0,1,0]:[1,0,0];
 const u=seed.map((v,i)=>v-normal[i]*dot(seed,normal)) as Vec3,ul=Math.hypot(...u);u.forEach((v,i)=>u[i]=v/ul);
 const v:Vec3=[normal[1]*u[2]-normal[2]*u[1],normal[2]*u[0]-normal[0]*u[2],normal[0]*u[1]-normal[1]*u[0]];
 const rings=[(t:number):Vec3=>[cap*Math.cos(t),cap*Math.sin(t),minZ],(t:number):Vec3=>u.map((x,i)=>x*Math.cos(t)+v[i]*Math.sin(t)) as Vec3];
 for(const at of rings){
  const step=2*Math.PI/64;let theta=0,score=Infinity;
  for(let i=0;i<64;i++){const e=test(at(i*step));if(e<score){score=e;theta=i*step;}}
  if(!Number.isFinite(score))continue;
  let lo=theta-step,hi=theta+step;
  for(let i=0;i<32;i++){const l=lo+(hi-lo)/3,h=hi-(hi-lo)/3;if(test(at(l))<test(at(h)))hi=h;else lo=l;}
  test(at((lo+hi)/2));
 }
 return hairSurfacePoint(best[0],best[1]);
}

/** The inward lower flank can give more than two ray crossings. Bracket every
 * crossing of the body, discard the part below the sloped base, then retain the
 * closest attachment branch. Endpoints belong to the curved side, not the disk. */
function locatePumpkinEndpoint(net:HairNet,view:HairView,target:Point2,previous:Vec3):Vec3 {
 if(sq(projectedHairControl(world(net,previous),view),target)<1e-20)return previous;
 const {right,up,forward}=hairBasis(view),r=[net.radiusX,net.radiusY,net.radiusZ];
 const x=target[0]-dot(net.center,right),y=target[1]-dot(net.center,up);
 const origin=net.center.map((c,i)=>c+right[i]*x+up[i]*y) as Vec3;
 const a=origin.map((v,i)=>(v-net.center[i])/r[i]),b=forward.map((v,i)=>v/r[i]),w=net.profile!.width;
 const bounds=[[-w,w],[-1.2,1],[-w,w]];
 let low=-Infinity,high=Infinity;
 for(let i=0;i<3;i++){
  if(Math.abs(b[i])<1e-12){if(a[i]<bounds[i][0]||a[i]>bounds[i][1]){low=1;high=0;break;}continue;}
  const ends=bounds[i].map(v=>(v-a[i])/b[i]).sort((a,b)=>a-b);low=Math.max(low,ends[0]);high=Math.min(high,ends[1]);
 }
 if(low<=high){
  const field=(t:number)=>Math.hypot(a[0]+b[0]*t,a[2]+b[2]*t)-Math.sqrt(hairRadiusSquared(net,a[1]+b[1]*t));
  const candidates:Vec3[]=[];let last=low,f=field(last);
  for(let i=1;i<=96;i++){
   const next=low+(high-low)*i/96,g=field(next);
   if(f*g<=0){
    let lo=last,hi=next,fl=f;
    for(let j=0;j<28;j++){const mid=(lo+hi)/2,fm=field(mid);if(fl*fm<=0)hi=mid;else{lo=mid;fl=fm;}}
    const at=(lo+hi)/2,p=origin.map((v,i)=>v+forward[i]*at) as Vec3,q=hairLocal(net,p);
    if(hairShellField(net,p)<1e-7&&q[1]>=-1&&q[1]<=1&&q[2]>=minZ-1e-8)candidates.push(q);
   }
   last=next;f=g;
  }
  if(candidates.length){const q=candidates.sort((p,q)=>sq(p,previous)-sq(q,previous))[0];return hairSurfacePoint(q[0],q[1]);}
 }
 return nearestProfileEndpoint(net,view,target,previous);
}

/** Intersect the current-view ray with the convex profile shell. The minimum
 * of radial distance minus the concave meridian brackets both depth branches. */
function locateProfileEndpoint(net:HairNet,view:HairView,target:Point2,previous:Vec3):Vec3 {
 const {right,up,forward}=hairBasis(view),r=[net.radiusX,net.radiusY,net.radiusZ];
 const x=target[0]-dot(net.center,right),y=target[1]-dot(net.center,up);
 const origin=net.center.map((c,i)=>c+right[i]*x+up[i]*y) as Vec3;
 const a=origin.map((v,i)=>(v-net.center[i])/r[i]),b=forward.map((v,i)=>v/r[i]),bounds=[net.profile!.width,1,net.profile!.width];
 let low=-Infinity,high=Infinity;
 for(let i=0;i<3;i++){
  if(Math.abs(b[i])<1e-12){if(Math.abs(a[i])>bounds[i]){low=1;high=0;break;}continue;}
  const ends=[(-bounds[i]-a[i])/b[i],(bounds[i]-a[i])/b[i]].sort((a,b)=>a-b);low=Math.max(low,ends[0]);high=Math.min(high,ends[1]);
 }
 const point=(t:number)=>origin.map((v,i)=>v+forward[i]*t) as Vec3;
 if(low<=high){
  const field=(t:number)=>Math.hypot(a[0]+b[0]*t,a[2]+b[2]*t)-Math.sqrt(hairRadiusSquared(net,a[1]+b[1]*t));
  let lo=low,hi=high;
  for(let i=0;i<42;i++){const l=lo+(hi-lo)/3,h=hi-(hi-lo)/3;if(field(l)<field(h))hi=h;else lo=l;}
  const middle=(lo+hi)/2;
  if(field(middle)<=1e-8){
   const candidates=[low,high].map(edge=>{let inside=middle,outside=edge;for(let i=0;i<38;i++){const t=(inside+outside)/2;if(field(t)<=0)inside=t;else outside=t;}return hairLocal(net,point((inside+outside)/2));}).filter(p=>p[2]>=minZ-1e-8);
   if(candidates.length){const q=candidates.sort((p,q)=>sq(p,previous)-sq(q,previous))[0];return hairSurfacePoint(q[0],q[1]);}
  }
 }
 return nearestProfileEndpoint(net,view,target,previous);
}
function nearestProfileEndpoint(net:HairNet,view:HairView,target:Point2,previous:Vec3):Vec3 {
 // Unreachable targets: keep the best front-cap projection. Starting at the
 // previous attachment prevents a worse result or a depth flip at a silhouette.
 let best=previous,error=sq(projectedHairControl(world(net,previous),view),target);
 const test=(p:Vec3)=>{const e=sq(projectedHairControl(world(net,p),view),target);if(e<error-1e-16){best=p;error=e;}};
 for(let j=0;j<=12;j++)for(let i=0;i<=20;i++){
  const theta=.03+(Math.PI-.06)*j/12,az=-Math.PI/2+Math.PI*i/20;test(hairSurfacePoint(Math.sin(theta)*Math.sin(az),Math.cos(theta)));
 }
 for(let step=.16;step>1e-6;step*=.5)for(let run=0;run<16;run++){
  const before=best;for(let i=0;i<8;i++){const a=i*Math.PI/4;test(hairSurfacePoint(before[0]+step*Math.cos(a),before[1]+step*Math.sin(a)));}if(best===before)break;
 }
 return best;
}

/** Handles are references for a surface section, not free saved controls.
 * Search the section angle while holding both endpoints fixed. A weak prior
 * prefers the original angle where the projection is ambiguous. */
export function inferHairAngle(net:HairNet,root:Vec3,tip:Vec3,angle:number,mode:'SECTION'|'FRONT',view:HairView,control:1|2,target:Point2):number {
 const original=hairSection(net,root,tip,angle,mode),physical=original.angle;
 const regularization=(net.radiusX*.003)**2;
 const evaluate=(degrees:number)=>{
  const arc=hairSection(net,root,tip,degrees),opening=hairOpeningAngle(arc.cubic);
  if(mode==='FRONT'&&Math.abs(opening)>90+1e-7)return Infinity;
  return sq(projectedHairControl(arc.cubic[control],view),target)+regularization*(degrees-physical)**2/8100;
 };
 const before=sq(projectedHairControl(original.cubic[control],view),target);
 if(before<1e-20)return angle;
 let best=physical,error=before;
 const test=(a:number)=>{const e=evaluate(a);if(e<error){best=a;error=e;}return e;};
 test(physical);for(let a=-90;a<=90;a+=6)test(a);
 let lo=Math.max(-90,best-6),hi=Math.min(90,best+6);
 // About 0.1 degree is enough for a handle reference; no extra solve on release.
 for(let i=0;i<12;i++){const l=lo+(hi-lo)/3,r=hi-(hi-lo)/3;if(test(l)<test(r))hi=r;else lo=l;}
 test((lo+hi)/2);
 const result=mode==='SECTION'?best:clamp(hairOpeningAngle(hairSection(net,root,tip,best).cubic),-90,90);
 // FRONT inversion can choose a different branch. Validate the real forward map.
 const after=sq(projectedHairControl(hairSection(net,root,tip,result,mode).cubic[control],view),target);
 return Number.isFinite(after)&&after<before?result:angle;
}

export function hairControlEditable(h:Hairstyle,id:string,control:HairControl):boolean {
 const rule=h.strandSet?.curves.find(c=>c.id===id),curve=h.drawing.curves.find(c=>c.id===id);
 if(!rule||!curve||curve.locked)return false;
 return control===1||control===2||!h.drawing.curves.some(c=>c.locked&&c.nodes.includes(rule.nodes[control===0?0:1]));
}

/** Called against the pointer-down recipe for every frame: no accumulated drift,
 * reroll, ID changes, or edits to the source Drawing document. */
export function dragHairControl(h:Hairstyle,id:string,view:HairView,control:HairControl,target:Point2):Hairstyle {
 if(!target.every(Number.isFinite)||!hairControlEditable(h,id,control))return h;
 const set=h.strandSet!,c=set.curves.find(c=>c.id===id)!;
 const nodes=c.nodes.map(id=>set.endpoints.find(e=>e.id===id)!);
 const positions=nodes.map(hairEndpointPosition),geometry=generateHair(h),arc=geometry.strands!.find(s=>s.id===id)!;
 const validate=(next:Hairstyle,ids:Set<string>)=>{
  if(generateHair(next).strands!.some(s=>ids.has(s.id)&&s.projectionMisses?.length))throw Error('曲线超出当前视角的发网投影范围，请缩短控制柄或调整发网。 / Curve extends outside the hair net projection; shorten the handle or adjust the net.');
  return next;
 };
 if(control===1||control===2){
  if(sq(projectedHairControl(arc.cubic[control],view),target)<1e-20)return h;
  const surface=surfaceFromView(h.net,arc,view),anchor=projectedHairControl(arc.cubic[control===1?0:3],view);
  surface.handles[control-1]=target.map((v,i)=>(v-anchor[i])/h.net.radiusX) as Point2;
  return validate(syncStrands({...h,strandSet:{...set,curves:set.curves.map(r=>r.id===id?{...r,surface}:r)}}),new Set([id]));
 }
 const index=control===0?0:1,e=nodes[index],before=world(h.net,positions[index]);
 if(sq(projectedHairControl(before,view),target)<1e-20)return h;
 const projected=hairSketchProjector(h.net,view)(target,dot(before,hairBasis(view).forward));
 if(!projected)throw Error('此位置没有可投影的发网表面，请在发网范围内移动。 / No hair surface at this position; move within its projection.');
 const p=hairLocal(h.net,projected);
 // Move the base, retaining the random offsets and the current random sample.
 const x={...e.x,value:clamp(e.x.value+p[0]-resolveHairRange(e.x,e.sample[0]),-1,1)},y={...e.y,value:clamp(e.y.value+p[1]-resolveHairRange(e.y,e.sample[1]),-1,1)};
 if(Math.abs(x.value-e.x.value)+Math.abs(y.value-e.y.value)<1e-10&&(p[2]<0?-1:1)===(e.side??1))return h;
 // Rebase every incident curve to the current 2D view. Moving one endpoint
 // translates only its adjacent handle, just like the ordinary Drawing editor.
 const curves=set.curves.map(r=>{
  if(!r.nodes.includes(e.id))return r;
  return {...r,surface:surfaceFromView(h.net,geometry.strands!.find(s=>s.id===r.id)!,view)};
 });
 return validate(syncStrands({...h,strandSet:{...set,curves,endpoints:set.endpoints.map(n=>n.id===e.id?{...n,x,y,side:p[2]<0?-1:1}:n)}}),new Set(curves.filter(r=>r.nodes.includes(e.id)).map(r=>r.id)));
}

/** The dotted drag guide is UI-only, not an additional authoritative curve. */
export function hairDragGuide(shape:Cubic,control:HairControl,target:Point2):Cubic {
 const next=shape.map(p=>[...p]) as Cubic;
 if(control===0||control===3){const handle=control===0?1:2;next[handle]=next[handle].map((v,i)=>v+target[i]-shape[control][i]) as Point2;}
 next[control]=target;return next;
}
