import {it,expect} from 'vitest';
import {SelectionCycle} from '../ui/authoring/selectionCycle';
it('cycles unique objects, preserves initial order under jitter, resets by area/context/membership',()=>{
 const c=new SelectionCycle(),p={},a={kind:'curve',id:'a'},b={kind:'curve',id:'b'},s={kind:'surface',id:'s'};
 expect(c.next([a,b,a,s],10,10,p)).toBe(a);expect(c.next([b,a,s],11,10,p)).toBe(b);expect(c.next([a,b,s],10,10,p)).toBe(s);expect(c.next([a,b,s],10,10,p)).toBe(a);
 expect(c.next([a,b,s],30,10,p)).toBe(a);expect(c.next([a,b,s],30,10,{})).toBe(a);expect(c.next([b,s],30,10,p)).toBe(b);
 c.reset();expect(c.next([a,b],30,10,p)).toBe(a);expect(c.next([],30,10,p)).toBeUndefined();
});
it('retains the original click stack when selecting an object reflows the 2D viewport',()=>{
 const c=new SelectionCycle(true),p={},a={kind:'curve',id:'a'},b={kind:'curve',id:'b'},s={kind:'surface',id:'s'};
 expect(c.next([a,b,s],10,10,p)).toBe(a);expect(c.next([s],10,10,p)).toBe(b);expect(c.next([],10,10,p)).toBe(s);
 c.move(30,10);expect(c.next([s],30,10,p)).toBe(s);
});
