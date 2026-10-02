import {isValidElement,type ReactElement} from 'react';
import {expect,test,vi} from 'vitest';
import SceneAnglePad from '../ui/vectorRecording/SceneAnglePad';

vi.mock('react',async original=>({...await original<typeof import('react')>(),useRef:(current:unknown)=>({current})}));
type Props={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];return [tree,...elements(tree.props.children)];}
function harness(){
 const onChange=vi.fn(),view={id:'right',name:'Right',angle:{x:90,y:0}},all=elements(SceneAnglePad({angle:view.angle,views:[view],onChange})),pad=all.find(e=>e.props['data-testid']==='scene-angle-pad')!,mark=all.find(e=>e.props['data-view-id']==='right')!;
 const currentTarget={getBoundingClientRect:()=>({left:0,top:0,width:180,height:180}),setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
 const event=(x:number,y:number,hit=true)=>({button:0,pointerId:1,clientX:x,clientY:y,currentTarget,target:{closest:()=>hit?{getAttribute:()=>view.id}:null},preventDefault:vi.fn(),stopPropagation:vi.fn()});
 return {onChange,view,pad,mark,event};
}
test('a short click on an established marker jumps to its exact angle instead of rounded pointer coordinates',()=>{
 const h=harness();h.pad.props.onPointerDown(h.event(179,89));h.pad.props.onPointerUp(h.event(179,89));expect(h.onChange.mock.calls).toEqual([[h.view.angle]]);
});
test('dragging from an established marker navigates freely and a following pointer click cannot jump back',()=>{
 const h=harness();h.pad.props.onPointerDown(h.event(180,90));h.pad.props.onPointerMove(h.event(120,60));h.pad.props.onPointerUp(h.event(120,60));h.mark.props.onClick({detail:1,stopPropagation:vi.fn()});expect(h.onChange.mock.calls).toEqual([[{x:30,y:30}],[{x:30,y:30}]]);
});
test('blank pad dragging and keyboard activation both keep their expected navigation behavior',()=>{
 const h=harness();h.pad.props.onPointerDown(h.event(90,90,false));h.pad.props.onPointerMove(h.event(30,150,false));h.pad.props.onPointerUp(h.event(30,150,false));expect(h.onChange).toHaveBeenLastCalledWith({x:-60,y:-60});h.mark.props.onClick({detail:0,stopPropagation:vi.fn()});expect(h.onChange).toHaveBeenLastCalledWith(h.view.angle);
});
