import {add,sub,length,finitePoint,curveById,objectById,shapeOf,type DrawingDocument as Doc,type Point2} from './model';
import {transform} from './commands';

/** Translate each selected object once. Fills share boundary geometry; followers
 * retain their source relation and have their own optional placement offset. */
export function translateObjects(d:Doc,ids:string[],delta:Point2):Doc{
 if(!finitePoint(delta)||length(delta)<1e-12)return d;
 const objects=[...new Set(ids)].filter(id=>objectById(d,id));if(!objects.length)return d;
 if(objects.some(id=>objectById(d,id)!.locked))throw Error('对象已锁定。');
 const curves=new Set(objects.filter(id=>curveById(d,id)));
 for(const f of d.fills.filter(f=>objects.includes(f.id))){
  if(f.boundary.some(x=>!curveById(d,x.id)))throw Error('边界未闭合或已断开。');
  f.boundary.forEach(x=>curves.add(x.id));
 }
 // Shared positions move their adjacent handles, not the whole neighbouring
 // curve. Hidden selected members are authorable; locks still protect geometry.
 const next=transform(d,[...curves],p=>add(p,delta),true,true);
 let moved=false;const offsets=next.offsets.map(o=>{
  if(!objects.includes(o.id))return o;
  const sourceMoved=o.source.every(x=>curveById(d,x.id)&&shapeOf(next,x.id).every((p,i)=>length(sub(sub(p,shapeOf(d,x.id)[i]),delta))<1e-10));
  if(sourceMoved)return o; // Already follows the same translation; never apply it twice.
  const translation=add(o.translation??[0,0],delta);if(!finitePoint(translation))throw Error('变换数值无效。');
  moved=true;return {...o,translation};
 });
 return moved?{...next,offsets}:next;
}
