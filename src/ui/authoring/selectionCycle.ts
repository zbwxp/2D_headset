/** View-local selection gesture state, never geometry/history/persistence. */
export class SelectionCycle {
 constructor(private retainClickStack=false){}
 private previous?:{x:number;y:number;keys:string[];index:number;context:unknown;hits:{kind:string;id:string}[]};
 move(x:number,y:number){const p=this.previous;if(p&&Math.hypot(x-p.x,y-p.y)>5)this.reset();}
 reset(){this.previous=undefined;}
 next<T extends {kind:string;id:string}>(hits:T[],x:number,y:number,context:unknown):T|undefined{
  const unique=hits.filter((h,i)=>hits.findIndex(q=>q.kind===h.kind&&q.id===h.id)===i);
  if(!unique.length&&!this.retainClickStack){this.reset();return;}
  const keys=unique.map(h=>h.kind+':'+h.id),p=this.previous;
  const same=p&&p.context===context&&Math.hypot(x-p.x,y-p.y)<=5&&(this.retainClickStack||keys.length===p.keys.length&&keys.every(k=>p.keys.includes(k)));
  // Retain the initial order when tiny pointer motion changes nearest-hit ordering.
  if(!same&&!unique.length){this.reset();return;}
  const available=same&&this.retainClickStack?p.hits as T[]:unique;
  const order=same?p.keys:keys,index=same?(p.index+1)%order.length:0;
  this.previous={x:same?p.x:x,y:same?p.y:y,keys:order,index,context,hits:available};
  return available.find(h=>h.kind+':'+h.id===order[index]);
 }
}
