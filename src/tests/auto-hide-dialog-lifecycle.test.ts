import {afterEach,describe,expect,it,vi} from 'vitest';
import {watchAutoHideDialogs} from '../ui/shared/AutoHideBar';

class Observer {
 static instances:Observer[]=[];
 constructor(readonly callback:MutationCallback){Observer.instances.push(this);}
 observe=vi.fn();disconnect=vi.fn();
 mutate(){this.callback([],this as unknown as MutationObserver);}
}
afterEach(()=>{vi.unstubAllGlobals();Observer.instances=[];});
describe('auto-hide toolbar preserves native modal lifetime',()=>{
 it('holds a dialog that opens after select blur, then releases on cancel or submit',()=>{
  vi.stubGlobal('MutationObserver',Observer);let open=false;
  const root={querySelector:vi.fn((selector:string)=>selector==='dialog[open]'&&open?{}:null)} as unknown as HTMLElement;
  const changes:boolean[]=[],stop=watchAutoHideDialogs(root,value=>changes.push(value)),observer=Observer.instances[0];
  expect(changes).toEqual([false]);expect(observer.observe).toHaveBeenCalledWith(root,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  // Native select focus can leave first. The later showModal open mutation is
  // authoritative even when ordinary hover/focus expansion has already closed.
  open=true;observer.mutate();expect(changes.at(-1)).toBe(true);
  open=false;observer.mutate();expect(changes.at(-1)).toBe(false);
  open=true;observer.mutate();expect(changes.at(-1)).toBe(true);
  stop();expect(observer.disconnect).toHaveBeenCalledOnce();
 });
 it('detects an already-open dialog and child removal without relying on focus events',()=>{
  vi.stubGlobal('MutationObserver',Observer);let present=true;
  const root={querySelector:()=>present?{}:null} as unknown as HTMLElement,changes:boolean[]=[];
  watchAutoHideDialogs(root,value=>changes.push(value));expect(changes).toEqual([true]);
  present=false;Observer.instances[0].mutate();expect(changes).toEqual([true,false]);
 });
});
