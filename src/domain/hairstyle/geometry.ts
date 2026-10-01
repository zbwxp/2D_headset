import type {Hairstyle,HairNet,Vec3} from './model';
import type {Cubic,Point2} from '../drawing/model';
import {bangRandom,centerAngles,layoutHairAngles} from './random';
import {resolveHairRange,hairEndpointPosition} from './strandTypes';
import {arcField} from '../drawing/sampling';
import {hairWorld,hairRadiusSquared,pumpkinSurface} from './profile';
import {pumpkinSectionPoints} from './pumpkinSection';
import type {HairStrandSet} from './strandTypes';
import {surfaceHairArc} from './surfaceCurve';
export interface HairMesh {vertices:Vec3[];triangles:[number,number,number][]}
type Cubic3=[Vec3,Vec3,Vec3,Vec3];
export interface SectionArc {kind?:'SURFACE';projectionMisses?:number[];angle:number;normal:Vec3;planeOffset:number;points:Vec3[];cubic:Cubic3;cubics:Cubic3[];inkRange:[number,number];requestedAngle:number}
export interface HairGeometry {shell:HairMesh;base?:HairMesh;rim?:Vec3[];netLines:Vec3[][];crown:Vec3;tip:Vec3;centerTip:Vec3;arcs:[SectionArc,SectionArc];centerArcs:[SectionArc,SectionArc];interiorArcs:(SectionArc&{id:string})[];strands?:(SectionArc&{id:string})[]}
type HairRecipe=Pick<Hairstyle,'net'|'leaf'|'interior'|'bang'|'strandSet'>;
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(p:Vec3):Vec3=>mul(p,1/Math.hypot(...p));
export const world=hairWorld;
const sphere=(az:number,theta:number):Vec3=>[Math.sin(theta)*Math.sin(az),Math.cos(theta),Math.sin(theta)*Math.cos(az)];
// Recipe objects are immutable. Shell buffers live as long as their net; edits
// reuse the saved front solve in the viewport and retain unchanged strand data.
const meshCache=new WeakMap<HairNet,Pick<HairGeometry,'shell'|'netLines'|'base'|'rim'>>();
const recipeCache=new WeakMap<HairNet,WeakMap<HairStrandSet,{key:string;geometry:HairGeometry}>>();
const strandCache=new WeakMap<HairNet,Map<string,{key:string;arc:SectionArc&{id:string}}>>();
const sectionCache=new WeakMap<HairNet,Map<string,SectionArc>>();
function netGeometry(n:HairNet){let g=meshCache.get(n);if(!g){g=n.profile?.version===2?pumpkinMesh(n):{shell:shell(n),netLines:netLines(n)};meshCache.set(n,g);}return g;}
function pumpkinMesh(n:HairNet):Pick<HairGeometry,'shell'|'base'|'rim'|'netLines'> {
 const cols=64,rows=32,vertices:Vec3[]=[],triangles:[number,number,number][]=[],netLines:Vec3[][]=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++)vertices.push(pumpkinSurface(n,i/cols*Math.PI*2,j/rows));
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;triangles.push([a,b,a+1],[a+1,b,b+1]);}
 const rim=vertices.slice(rows*(cols+1)),baseVertices:Vec3[]=[[n.center[0],n.center[1]+(n.profile!.version===2?n.profile!.baseHeight:0)*n.radiusY,n.center[2]],...rim];
 for(let i=0;i<cols;i+=8)netLines.push(Array.from({length:rows+1},(_,j)=>vertices[j*(cols+1)+i]));
 for(let j=4;j<rows;j+=4)netLines.push(vertices.slice(j*(cols+1),(j+1)*(cols+1)));
 return {shell:{vertices,triangles},rim,base:{vertices:baseVertices,triangles:Array.from({length:cols},(_,i)=>[0,i+2,i+1])},netLines};
}
/** The displayed front half is only a guide. Sections use the full closed shell. */
function shell(n:HairNet):HairMesh {
 const vertices:Vec3[]=[],triangles:[number,number,number][]=[],cols=48,rows=48;
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++)vertices.push(world(n,sphere(-Math.PI/2+i/cols*Math.PI,j/rows*Math.PI)));
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;triangles.push([a,a+1,b],[a+1,b+1,b]);}
 return {vertices,triangles};
}
export function generateHair(h:HairRecipe):HairGeometry {
 if(h.strandSet){
  const set=h.strandSet,n=h.net,mode=h.bang?.mode??'SECTION',key=[mode,h.leaf.tipX,h.leaf.tipY??-.2].join('|');
  let recipes=recipeCache.get(n);if(!recipes){recipes=new WeakMap();recipeCache.set(n,recipes);}
  const cached=recipes.get(set);if(cached?.key===key)return cached.geometry;
  const guide=hairSection(n,[0,.8,.6],hairSurfacePoint(h.leaf.tipX,h.leaf.tipY??-.2),0);
  let previous=strandCache.get(n);if(!previous){previous=new Map();strandCache.set(n,previous);}
  const endpoints=new Map(set.endpoints.map(e=>[e.id,hairEndpointPosition(e)]));
  const used=new Set(set.curves.map(c=>c.id));for(const id of previous.keys())if(!used.has(id))previous.delete(id);
  const strands=set.curves.flatMap(c=>{
   const a=endpoints.get(c.nodes[0]),b=endpoints.get(c.nodes[1]);if(!a||!b)return [];
   const key=[...a,...b,...(c.surface?['surface',c.surface.version,c.surface.view.yaw,c.surface.view.pitch,...c.surface.handles.flat(),...c.surface.depths]:[c.angle,mode])].join('|'),old=previous.get(c.id);if(old?.key===key)return [old.arc];
   const arc={...(c.surface?surfaceHairArc(n,a,b,c.surface):hairSection(n,a,b,c.angle,mode)),id:c.id};previous.set(c.id,{key,arc});return [arc];
  });
  const geometry:HairGeometry={...netGeometry(n),crown:guide.cubic[0],tip:guide.cubic[3],centerTip:guide.cubic[3],arcs:[guide,guide],centerArcs:[guide,guide],interiorArcs:[],strands};
  recipes.set(set,{key,geometry});return geometry;
 }
 const n=h.net,{tipX,tipY=-.2,leftAngle,rightAngle}=h.leaf;
 // Fractions refer to R: crown 1/5 R below top; brow 1/5 R below equator.
 const a:Vec3=[0,.8,.6],b:Vec3=[tipX,tipY,Math.sqrt(1-tipX*tipX-tipY*tipY)];
 const A=world(n,a),B=world(n,b);
 const section=(angle:number,end:Vec3=b)=>hairSection(n,a,end,angle,h.bang?.mode??'SECTION');
 const arcs:[SectionArc,SectionArc]=[section(leftAngle),section(-rightAngle)];
 const r=bangRandom(h.bang,'front-layout'),R=n.radiusX;
 // Y is in front-view world units. Both outer visible ends are close in height;
 // leave room on the shell for the central tip's exact additional drop.
 const drop=(.01+.04*r())*R,skew=(2*r()-1)*.05*R,progress=.83+.05*r();
 let lowY=A[1]-(A[1]-B[1])*progress;
 const centerX=tipX*progress+(2*r()-1)*.03;
 const floor=n.center[1]-n.radiusY*Math.sqrt(1-centerX*centerX)+1e-5*R;
 lowY=Math.max(lowY,floor+drop);
 const ys=[lowY+Math.max(0,skew),lowY+Math.max(0,-skew)];
 for(let i=0;i<2;i++){
  const c=arcs[i].cubic;let lo=0,hi=1;
  // First downward crossing, rather than a shortest-arc or camera-space cut.
  for(let j=1;j<=128;j++){if(hairCubicPoint(c,j/128)[1]<=ys[i]){hi=j/128;lo=(j-1)/128;break;}}
  for(let j=0;j<36;j++){const mid=(lo+hi)/2;if(hairCubicPoint(c,mid)[1]>ys[i])lo=mid;else hi=mid;}
  arcs[i].inkRange=[0,hairArcFraction(c,(lo+hi)/2)];
 }
 const cy=(lowY-drop-n.center[1])/n.radiusY,center:Vec3=[centerX,cy,Math.sqrt(Math.max(0,1-centerX*centerX-cy*cy))];
 const angles=centerAngles(h.bang),centerArcs:[SectionArc,SectionArc]=[section(angles[0],center),section(-angles[1],center)];
 centerArcs.forEach((a,i)=>{a.inkRange=[.8+.1*bangRandom(h.bang,'center-tail-'+i)(),1];});
 const tx=norm(sub([1,0,0],mul(center,center[0]))),ty=cross(center,tx),slots=layoutHairAngles(h.leaf,h.bang,h.interior?.curves??[]);
 const interiorArcs=(h.interior?.curves??[]).flatMap(c=>{
  const angle=slots.get(c.id);if(angle===undefined)return [];
  const radius=Math.hypot(...c.offset),direction=radius>0?add(mul(tx,c.offset[0]/radius),mul(ty,c.offset[1]/radius)):tx;
  const chord=(h.interior!.radius*R/Math.max(n.radiusX,n.radiusY,n.radiusZ))*radius,theta=2*Math.asin(Math.min(1,chord/2));
  const endpoint=radius===0||h.interior!.radius===0?center:add(mul(center,Math.cos(theta)),mul(direction,Math.sin(theta)));
  return [{...section(angle,endpoint),id:c.id,inkRange:[.8+.1*bangRandom(h.bang,'tail-'+c.id)(),1] as [number,number]}];
 });
 return {...netGeometry(n),crown:A,tip:B,centerTip:world(n,center),arcs,centerArcs,interiorArcs};
}
function netLines(n:HairNet):Vec3[][] {
 const lines:Vec3[][]=[];
 for(let i=0;i<=8;i++)lines.push(Array.from({length:65},(_,j)=>world(n,sphere(-Math.PI/2+i/8*Math.PI,j/64*Math.PI))));
 for(let j=1;j<8;j++)lines.push(Array.from({length:65},(_,i)=>world(n,sphere(-Math.PI/2+i/64*Math.PI,j/8*Math.PI))));
 return lines;
}
export const hairCubicPoint=(c:Cubic3,t:number):Vec3=>c[0].map((_,k)=>(1-t)**3*c[0][k]+3*(1-t)**2*t*c[1][k]+3*(1-t)*t*t*c[2][k]+t**3*c[3][k]) as Vec3;
export function hairOpeningAngle(c:Cubic3){
 const dx=c[3][0]-c[0][0],dy=c[3][1]-c[0][1],tx=c[1][0]-c[0][0],ty=c[1][1]-c[0][1];
 return -Math.atan2(dx*ty-dy*tx,dx*tx+dy*ty)*180/Math.PI;
}
export const hairFrontShape=(c:Cubic3):Cubic=>c.map(p=>[p[0],p[1]]) as Cubic;
/** Use Drawing's own arc table in both directions so cuts remain on the same 3D
 * point while orbiting, rather than sliding to the new projected length ratio. */
export function arcFractionAt(shape:Cubic,t:number){
 const p=arcField([shape]).parts[0];let i=1;while(i<p.pts.length-1&&p.pts[i].t<t)i++;
 const f=(t-p.pts[i-1].t)/(p.pts[i].t-p.pts[i-1].t||1);
 return p.length>1e-12?(p.dist[i-1]+f*(p.dist[i]-p.dist[i-1]))/p.length:t;
}
export const hairArcFraction=(c:Cubic3,t:number)=>arcFractionAt(hairFrontShape(c),t);
export const hairFrontArcPoint=(c:Cubic3,fraction:number)=>hairCubicPoint(c,arcField([hairFrontShape(c)]).at(fraction).t);
/** Fixed-end least-squares fit. Orthographic projection commutes with this fit. */
export function fitHairCubic(points:Vec3[]):Cubic3 {
 const a=points[0],b=points.at(-1)!,r1:Vec3=[0,0,0],r2:Vec3=[0,0,0];let aa=0,ab=0,bb=0;
 for(let i=1;i<points.length-1;i++){
  const t=i/(points.length-1),u=1-t,x=3*u*u*t,y=3*u*t*t;
  aa+=x*x;ab+=x*y;bb+=y*y;
  for(let k=0;k<3;k++){const r=points[i][k]-u*u*u*a[k]-t*t*t*b[k];r1[k]+=x*r;r2[k]+=y*r;}
 }
 const det=aa*bb-ab*ab;
 return [a,r1.map((v,k)=>(v*bb-r2[k]*ab)/det) as Vec3,r2.map((v,k)=>(v*aa-r1[k]*ab)/det) as Vec3,b];
}
/** One cubic per generated hair, projected into the head's front XY frame. */
export const frontCubics=(h:Pick<Hairstyle,'net'|'leaf'>):[Cubic,Cubic]=>generateHair(h).arcs.map(a=>a.cubic.map(p=>[p[0],p[1]] as Point2) as Cubic) as [Cubic,Cubic];

export function hairSection(n:HairNet,a:Vec3,b:Vec3,angle:number,mode:'SECTION'|'FRONT'='SECTION'):SectionArc {
 let cache=sectionCache.get(n);if(!cache){cache=new Map();sectionCache.set(n,cache);}
 const key=[...a,...b,angle,mode].join('|');let result=cache.get(key);
 if(!result){
  result=solveSection(n,a,b,angle,mode);cache.set(key,result);
  // Bound transient angle searches and endpoint moves; do not retain drag history.
  if(cache.size>512)cache.delete(cache.keys().next().value!);
 }
 // Legacy generators assign inkRange; never expose the shared cached container.
 return {...result,inkRange:[0,1]};
}
function solveSection(n:HairNet,a:Vec3,b:Vec3,angle:number,mode:'SECTION'|'FRONT'):SectionArc {
 const A=world(n,a);
 if(Math.hypot(...sub(a,b))<1e-7){const cubic:Cubic3=[A,A,A,A];return {angle,requestedAngle:angle,normal:[1,0,0],planeOffset:0,points:[A,A],cubic,cubics:[cubic],inkRange:[0,1]};}
 const arc=(degrees:number,endpoint:Vec3=b):SectionArc=>{
  if(mode==='FRONT')return hairSection(n,a,endpoint,degrees);
  const endWorld=world(n,endpoint),axis=norm(sub(endWorld,A)),radial=cross(sub(A,n.center),sub(endWorld,n.center));
  // Antipodal ends have no unique center plane; choose a stable perpendicular.
  const base=norm(Math.hypot(...radial)>1e-9?radial:cross(axis,Math.abs(axis[0])<.9?[1,0,0]:[0,1,0]));
  const radians=degrees*Math.PI/180;
  const normal=add(add(mul(base,Math.cos(radians)),mul(cross(axis,base),Math.sin(radians))),mul(axis,dot(axis,base)*(1-Math.cos(radians))));
  if(n.profile?.version===2){
   const points=pumpkinSectionPoints(n,A,endWorld,normal),cubic=fitHairCubic(points);
   return {angle:degrees,requestedAngle:degrees,normal,planeOffset:dot(normal,sub(A,n.center)),points,cubic,cubics:[cubic],inkRange:[0,1]};
  }
  if(n.profile){
   // The chord midpoint is inside a convex shell. Each in-plane ray has one
   // boundary hit, so this keeps the same oriented branch through +/-90 degrees.
   const center=mul(add(A,endWorld),.5),u=norm(sub(A,center)),v=cross(normal,u),bound=4*Math.max(n.radiusX,n.radiusY,n.radiusZ)*Math.max(1,n.profile.width);
   const cx=(center[0]-n.center[0])/n.radiusX,cy=(center[1]-n.center[1])/n.radiusY,cz=(center[2]-n.center[2])/n.radiusZ;
   // 33 samples suffice for a single cubic. Keep tight intersections, but avoid
   // allocating vectors in the inner root-finding loop (the previous hot path).
   const points:Vec3[]=Array.from({length:33},(_,i)=>{
    if(i===0)return A;if(i===32)return endWorld;
    const t=Math.PI*i/32,d=add(mul(u,Math.cos(t)),mul(v,Math.sin(t))),dx=d[0]/n.radiusX,dy=d[1]/n.radiusY,dz=d[2]/n.radiusZ;let lo=0,hi=bound;
    for(let j=0;j<27;j++){
     const mid=(lo+hi)/2,x=cx+dx*mid,y=cy+dy*mid,z=cz+dz*mid;
     if(x*x+z*z-hairRadiusSquared(n,y)+Math.max(0,Math.abs(y)-1)<0)lo=mid;else hi=mid;
    }
    return add(center,mul(d,(lo+hi)/2));
   });
   const cubic=fitHairCubic(points);
   return {angle:degrees,requestedAngle:degrees,normal,planeOffset:dot(normal,sub(A,n.center)),points,cubic,cubics:[cubic],inkRange:[0,1]};
  }
  const planeOffset=dot(normal,sub(A,n.center)),scaled:Vec3=[normal[0]*n.radiusX,normal[1]*n.radiusY,normal[2]*n.radiusZ],length=Math.hypot(...scaled),N=mul(scaled,1/length),d=planeOffset/length;
  // Transform the world plane into unit-sphere coordinates, intersect analytically,
  // then transform back. XYZ scaling still gives a genuine planar ellipse.
  const center=mul(N,d),radius=Math.sqrt(Math.max(0,1-d*d)),u=norm(sub(a,center)),v=cross(N,u),end=mul(sub(endpoint,center),1/radius);
  const raw=Math.atan2(dot(end,v),dot(end,u)),theta=raw<0?raw+2*Math.PI:raw;
  // Keep the oriented branch continuous at 180°. Choosing the shortest arc here
  // flips to the other half-circle at 90° (or earlier on a nonuniform ellipsoid).
  const localAt=(t:number)=>add(center,mul(add(mul(u,Math.cos(theta*t)),mul(v,Math.sin(theta*t))),radius));
  const points=Array.from({length:65},(_,i)=>world(n,localAt(i/64)));points[0]=A;points[64]=endWorld;
  // Exactly one cubic per hair. Least squares fixes the two ends and fits the
  // interior controls; unlike tan(theta/4), this stays bounded for long arcs.
  const cubic=fitHairCubic(points);
  return {angle:degrees,requestedAngle:degrees,normal,planeOffset,points,cubic,cubics:[cubic],inkRange:[0,1]};
 };
 // FRONT measures the fitted cubic's root tangent against the root-tip chord.
 // Invert the section angle only during construction, never while orbiting.
 const section=(angle:number,end:Vec3=b):SectionArc=>{
  if(mode!=='FRONT')return arc(angle,end);
  const sign=Math.sign(angle),target=Math.abs(angle),measure=(s:SectionArc)=>sign*hairOpeningAngle(s.cubic);
  let best=arc(0,end),bestError=Math.abs(measure(best)-target),previous=best;
  for(let i=1;i<=30;i++){
   const current=arc(sign*i*3,end),value=measure(current),error=Math.abs(value-target);
   if(error<bestError){best=current;bestError=error;}
   if((measure(previous)-target)*(value-target)<=0){
    let lo=(i-1)*3,hi=i*3;
    for(let j=0;j<(n.profile?12:24);j++){const mid=(lo+hi)/2,candidate=arc(sign*mid,end);if(measure(candidate)<target)lo=mid;else hi=mid;}
    best=arc(sign*(lo+hi)/2,end);break;
   }
   previous=current;
  }
  return {...best,requestedAngle:angle};
 };
 return section(angle);
}

export function hairSurfacePoint(x:number,y:number):Vec3 {const scale=Math.max(1,Math.hypot(x,y)/.995);x/=scale;y/=scale;return [x,y,Math.sqrt(Math.max(0,1-x*x-y*y))];}
