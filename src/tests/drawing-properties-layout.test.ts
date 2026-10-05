import {createElement,isValidElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import DrawingSidebar from '../ui/drawing/DrawingSidebar';
import DrawingPropertiesPanel from '../ui/drawing/DrawingPropertiesPanel';
import AppearanceControls from '../ui/drawing/AppearanceControls';
import {addLayer,ellipse} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing} from '../domain/drawing/model';

type ElementProps={children?:unknown;[key:string]:any};
function elements(value:unknown):ReactElement<ElementProps>[] {if(Array.isArray(value))return value.flatMap(elements);return isValidElement<ElementProps>(value)?[value,...elements(value.props.children)]:[];}

it.each(['','vr-sidebar vr-right'].flatMap(className=>[false,true].map(open=>({className,open}))))('keeps layer content above one property pane for $className, open=$open',({className,open})=>{
 const html=renderToStaticMarkup(createElement(DrawingSidebar,{className,open,height:65,onHeight:vi.fn(),layers:createElement('p',null,'LAYER-CONTENT'),children:createElement(DrawingPropertiesPanel,{open,setOpen:vi.fn(),children:'PROPERTY-CONTENT'})}));
 expect(html.indexOf('LAYER-CONTENT')).toBeLessThan(html.indexOf('drawing-sidebar-split'));
 expect(html.indexOf('drawing-sidebar-split')).toBeLessThan(html.indexOf('PROPERTY-CONTENT'));
 expect(html).toContain(open?'minmax(100px,65fr) 6px minmax(80px,35fr)':'minmax(0,1fr) 0px 32px');expect(html).toContain(`aria-expanded="${open}"`);
 // A hidden separator leaves no grid item: the bottom pane must not auto-place
 // into its zero-height row when collapsed.
 expect(html).toContain('data-testid="drawing-sidebar-layers" style="grid-row:1"');
 expect(html).toContain('data-testid="drawing-sidebar-properties" style="grid-row:3"');
 if(open)expect(html).not.toMatch(/class="drawing-properties-content" hidden=""/);else expect(html).toMatch(/class="drawing-properties-content" hidden=""/);
});

it('resizes only a captured split gesture and clamps both panes to the common limits',()=>{
 const onHeight=vi.fn(),tree=DrawingSidebar({open:true,height:65,onHeight,layers:null,children:null}),separator=elements(tree).find(element=>element.props.role==='separator')!.props;
 let captured=false;const target={setPointerCapture:()=>{captured=true;},hasPointerCapture:()=>captured,releasePointerCapture:()=>{captured=false;},parentElement:{getBoundingClientRect:()=>({top:100,height:500})}};
 const event=(clientY:number)=>({currentTarget:target,pointerId:1,clientY});
 separator.onPointerMove(event(350));expect(onHeight).not.toHaveBeenCalled();separator.onPointerDown(event(350));separator.onPointerMove(event(350));expect(onHeight).toHaveBeenLastCalledWith(50);
 separator.onPointerMove(event(0));expect(onHeight).toHaveBeenLastCalledWith(20);separator.onPointerMove(event(900));expect(onHeight).toHaveBeenLastCalledWith(85);
 separator.onPointerUp(event(900));separator.onPointerMove(event(350));expect(onHeight).toHaveBeenCalledTimes(3);
});

it('labels boundary selection separately from layer ownership and preserves the selection-only action',()=>{
 const d0=addLayer(emptyDrawing(),'Source'),ellipseResult=ellipse(d0,d0.layers[0].id,[-1,-1],[1,1],.01),drawing=createFill(ellipseResult.document,ellipseResult.ids,'white'),fill=drawing.fills[0],choose=vi.fn(),run=vi.fn(),before=JSON.stringify(drawing);
 const props={d:drawing,selection:{ids:[],paint:fill.id},choose,run,preview:vi.fn()};
 const html=renderToStaticMarkup(createElement(AppearanceControls,props));expect(html).toContain('选择边界曲线');expect(html).toContain('所属图层与顺序');expect(html).toContain('边界曲线仍在原处');
 const button=elements(AppearanceControls(props)).find(element=>element.type==='button'&&element.props.children==='选择边界曲线')!;
 button.props.onClick();expect(choose).toHaveBeenCalledWith({ids:fill.boundary.map(use=>use.id)});expect(run).not.toHaveBeenCalled();expect(JSON.stringify(drawing)).toBe(before);
});
