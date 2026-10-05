import {constrainMirrorNodePosition} from './mirrorEditing';
import {moveNode} from './commands';
import {linkedNodeIds} from './endpointLinks';
import {add,sub,length,endKey,curveById,type DrawingDocument,type Point2} from './model';

const smoothstep=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
function chordTurn(before:Point2,after:Point2):number{
 const a=length(before),b=length(after);
 if(a<1e-9||b<1e-9)return 0;
 const dot=(before[0]*after[0]+before[1]*after[1])/(a*b);
 const angle=Math.atan2(before[0]*after[1]-before[1]*after[0],before[0]*after[0]+before[1]*after[1]);
 // Fade near a collapsed chord and its antipode so +π/-π approach the same
 // result when the pointer passes the opposite endpoint.
 return angle*smoothstep(b/(a*.05))*smoothstep((dot+1)/.25);
}

/** Pointer editing, always evaluated from the gesture's original document.
 * strength is 0..1. Numeric moves, nudges and binding keep using moveNode.
 * The result is ordinary cubic geometry, with no persisted follow relation. */
export function dragNode(base:DrawingDocument,nodeId:string,position:Point2,strength:number,allowHidden=false):DrawingDocument{
 position=constrainMirrorNodePosition(base,nodeId,position);
 const next=moveNode(base,nodeId,position,allowHidden);
 if(next===base||!Number.isFinite(strength)||strength<=0)return next;
 const amount=Math.min(1,strength),moving=linkedNodeIds(base,nodeId);
 const before=new Map(base.nodes.map(n=>[n.id,n.position])),after=new Map(next.nodes.map(n=>[n.id,n.position]));
 const turns=new Map<string,{angle:number;chordLength:number}>();
 for(const c of base.curves)for(const end of [0,1] as const)if(moving.has(c.nodes[end])){
  const oldChord=sub(before.get(c.nodes[1-end])!,before.get(c.nodes[end])!);
  const newChord=sub(after.get(c.nodes[1-end])!,after.get(c.nodes[end])!);
  turns.set(endKey({curveId:c.id,end}),{angle:chordTurn(oldChord,newChord),chordLength:length(oldChord)});
 }
 // A smooth pair shares one rotation, weighted by adjacent chord lengths.
 // Rotating both existing vectors preserves unequal lengths and strict G1.
 for(const j of base.joins)if(j.mode==='SMOOTH'){
  const a=turns.get(endKey(j.a)),b=turns.get(endKey(j.b));
  if(!a||!b)continue;
  const total=a.chordLength+b.chordLength,angle=total>1e-9?(a.angle*a.chordLength+b.angle*b.chordLength)/total:0;
  a.angle=angle;b.angle=angle;
 }
 for(const c of base.curves)for(const end of [0,1] as const){
  const turn=turns.get(endKey({curveId:c.id,end}));if(!turn||turn.angle===0)continue;
  const h=sub(c.handles[end],before.get(c.nodes[end])!),angle=turn.angle*amount,cos=Math.cos(angle),sin=Math.sin(angle);
  curveById(next,c.id).handles[end]=add(after.get(c.nodes[end])!,[h[0]*cos-h[1]*sin,h[0]*sin+h[1]*cos]);
 }
 return next;
}
