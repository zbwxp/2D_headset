/** An index accelerates successful lookups without making mutable command drafts
 * appear immutable. Read the current slot, validate its ID, and repair on a miss
 * (splice/reorder/replacement); appending/removing rebuilds once. No object copies
 * or document references are retained, and array lifetime bounds cache lifetime. */
const indices=new WeakMap<object,{length:number;slots:Map<string,number>}>();
export function drawingItemById<T extends {id:string}>(items:T[],id:string):T|undefined{
 let index=indices.get(items);
 if(!index||index.length!==items.length){
  index={length:items.length,slots:new Map(items.map((item,i)=>[item.id,i]))};
  indices.set(items,index);
 }
 const slot=index.slots.get(id);
 if(slot!==undefined&&items[slot]?.id===id)return items[slot];
 // Do not cache missing IDs: a private draft may replace an item in place.
 const found=items.findIndex(item=>item.id===id);
 if(found<0){index.slots.delete(id);return undefined;}
 index.slots.set(id,found);return items[found];
}
