import {uid,type DrawingDocument,type DrawingCurve,type Cubic,type Point2,type StrokeDisplayIntervals} from '../drawing/model';
import {generateHair,hairFrontShape,arcFractionAt,type HairGeometry} from './geometry';
import {hairBasis,type HairView} from './projection';
import type {Hairstyle} from './model';
import {randomUnit,seededHairRandom} from './random';
import {arcField} from '../drawing/sampling';

/** Missing centerIds marks the older two-boundary recipe and triggers migration. */
export interface HairGenerated {layerId:string;boundaryIds:[string,string];centerIds?:[string,string];curveIds:string[]}
/** View geometry is derived; persistent IDs, ordering, styles and display intervals
 * come from the private hair document. Camera changes never create an Undo entry. */
export function projectHairDrawing(h:Hairstyle,g:HairGeometry,view:HairView):DrawingDocument {
 if(!h.generated&&!h.strandSet)return h.drawing;
 const {right,up}=hairBasis(view),dot=(p:number[],v:number[])=>p.reduce((s,x,i)=>s+x*v[i],0);
 const sections=new Map(h.strandSet?(g.strands??[]).map(a=>[a.id,a] as const):[...h.generated!.boundaryIds.map((id,i)=>[id,g.arcs[i]] as const),...(h.generated!.centerIds??[]).map((id,i)=>[id,g.centerArcs[i]] as const),...g.interiorArcs.map(a=>[a.id,a] as const)]);
 const shapes=new Map<string,Cubic>([...sections].map(([id,a])=>[id,a.cubic.map(p=>[dot(p,right),dot(p,up)] as Point2) as Cubic]));
 const owned=new Set(h.strandSet?.curves.map(c=>c.id)??h.generated!.curveIds);
 const positions=new Map<string,Point2>(),same=(a:Point2,b:Point2)=>a[0]===b[0]&&a[1]===b[1];
 const curves=h.drawing.curves.map(c=>{const s=shapes.get(c.id);if(!s)return owned.has(c.id)?{...c,visible:false}:c;positions.set(c.nodes[0],s[0]);positions.set(c.nodes[1],s[3]);return same(c.handles[0],s[1])&&same(c.handles[1],s[2])?c:{...c,handles:[s[1],s[2]] as [Point2,Point2]};});
 const displayIntervals=h.drawing.displayIntervals?.map(track=>{const a=sections.get(track.anchor.id),shape=shapes.get(track.anchor.id);if(!a||!shape||view.yaw===0&&view.pitch===0)return track;
  const field=arcField([hairFrontShape(a.cubic)]);return {...track,ranges:track.ranges.map(r=>({...r,start:arcFractionAt(shape,field.at(r.start).t),end:arcFractionAt(shape,field.at(r.end).t)}))};});
 const nodes=h.drawing.nodes.map(n=>{const p=positions.get(n.id);return p&&!same(n.position,p)?{...n,position:p}:n;});
 if(curves.every((c,i)=>c===h.drawing.curves[i])&&nodes.every((n,i)=>n===h.drawing.nodes[i])&&displayIntervals?.every((t,i)=>t===h.drawing.displayIntervals?.[i]))return h.drawing;
 return {...h.drawing,curves,displayIntervals,nodes};
}
/** Refresh the saved front document after construction edits. Only owned generated
 * curves are replaced; other private layers and the main Drawing stay untouched. */
export function syncHairDrawing(h:Hairstyle,random?:()=>number):Hairstyle {
 if(!h.bang){const r=random??seededHairRandom(h.drawing.curves.map(c=>c.id).join('|'));h={...h,bang:{version:1,mode:'SECTION',seed:Math.floor(randomUnit(r)*0x100000000)}};}
 const geometry=generateHair(h);
 const d=h.drawing,legacy=!h.generated?d.layers.find(l=>l.name==='正刘海'&&['左边界','右边界'].every(name=>d.curves.some(c=>c.name===name&&l.items.includes(c.id)))):undefined;
 const boundaryIds=h.generated?.boundaryIds??(['左边界','右边界'].map(name=>d.curves.find(c=>legacy?.items.includes(c.id)&&c.name===name)?.id??uid()) as [string,string]);
 const centerIds=h.generated?.centerIds??boundaryIds.map(id=>id+':center') as [string,string];
 const layerId=h.generated?.layerId??legacy?.id??uid(),ids=[...boundaryIds,...centerIds,...(h.interior?.curves.map(c=>c.id)??[])],oldIds=new Set(h.generated?.curveIds??boundaryIds),removed=new Set([...oldIds].filter(id=>!ids.includes(id)));
 const generated:HairGenerated={layerId,boundaryIds,centerIds,curveIds:ids};
 const nodePositions=new Map(d.nodes.map(n=>[n.id,n.position]));
 const generatedCurves=ids.map((id,i):DrawingCurve=>{
  const old=d.curves.find(c=>c.id===id),nodes:[string,string]=[id+':root',centerIds.includes(id)?centerIds[0]+':tip':id+':tip'];
  return {...old,id,nodes,name:old?.name??(i<4?['左边界','右边界','中央尖角 · 左','中央尖角 · 右'][i]:`发丝 ${String(i-3).padStart(2,'0')}`),visible:old?.visible??true,locked:old?.locked??false,handles:old?.handles??[[0,0],[0,0]],width:old?.width??.008,inkEnds:old?.inkEnds??[{taper:0},{taper:0}]};
 });
 const curves=[...d.curves.filter(c=>!oldIds.has(c.id)&&!ids.includes(c.id)),...generatedCurves],usedNodes=new Set(curves.flatMap(c=>c.nodes));
 const nodes=[...usedNodes].map(id=>({id,position:nodePositions.get(id)??[0,0] as Point2}));
 const tracks=(d.displayIntervals??[]).filter(t=>!removed.has(t.anchor.id));
 const ranges=new Map([...boundaryIds.map((id,i)=>[id,geometry.arcs[i].inkRange] as const),...centerIds.map((id,i)=>[id,geometry.centerArcs[i].inkRange] as const),...geometry.interiorArcs.map(a=>[a.id,a.inkRange] as const)]);
 for(const id of ids){
  const index=tracks.findIndex(t=>t.anchor.id===id),old=tracks[index],range=ranges.get(id)??[.85,1];
  const track:StrokeDisplayIntervals={id:old?.id??id+':display',anchor:{id,reverse:false},scope:'CURVE',ranges:[{...old?.ranges[0],id:old?.ranges[0]?.id??id+':range',mode:'SHOW',start:range[0],end:range[1],inkEnds:old?.ranges[0]?.inkEnds??[{taper:0},{taper:0}]}]};
  if(index>=0)tracks[index]=track;else tracks.push(track);
 }
 const existing=d.layers.find(l=>l.id===layerId),keptItems=existing?.items.filter(id=>!removed.has(id))??[];
 const layer={id:layerId,name:existing?.name??'正刘海',visible:true,locked:false,items:[...keptItems,...ids.filter(id=>!keptItems.includes(id))]};
 const drawing:DrawingDocument={...d,curves,nodes,displayIntervals:tracks,layers:existing?d.layers.map(l=>l.id===layerId?layer:{...l,items:l.items.filter(id=>!removed.has(id))}):[layer,...d.layers],
  joins:[...d.joins.filter(j=>!oldIds.has(j.a.curveId)&&!oldIds.has(j.b.curveId)),{id:centerIds[0]+':cusp',a:{curveId:centerIds[0],end:1},b:{curveId:centerIds[1],end:1},mode:'CUSP'}],
  ...(d.endpointLinks?{endpointLinks:d.endpointLinks.filter(l=>!oldIds.has(l.a.curveId)&&!oldIds.has(l.b.curveId))}:{}),
  ...(d.groups?{groups:d.groups.map(g=>({...g,curveIds:g.curveIds.filter(id=>!removed.has(id))})).filter(g=>g.curveIds.length)}:{}),
  fills:d.fills.filter(f=>!f.boundary.some(c=>removed.has(c.id))),offsets:d.offsets.filter(o=>!o.source.some(c=>removed.has(c.id)))};
 // Removed dependent paint objects must also leave their layer lists.
 const objects=new Set([...drawing.curves,...drawing.fills,...drawing.offsets].map(o=>o.id));
 drawing.layers=drawing.layers.map(l=>({...l,items:l.items.filter(id=>objects.has(id))}));
 const next={...h,generated,drawing};
 const projected=projectHairDrawing(next,geometry,{yaw:0,pitch:0});
 // Dormancy is a display consequence of angle capacity, not a saved visibility edit.
 projected.curves=projected.curves.map(c=>({...c,visible:drawing.curves.find(old=>old.id===c.id)!.visible}));
 return {...next,drawing:projected};
}
