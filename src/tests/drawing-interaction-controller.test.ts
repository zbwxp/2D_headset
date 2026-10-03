import {test,expect} from 'vitest';
import {chooseDrawingSelection,selectDrawingTool,drawingToolForShortcut,isDrawingShortcutInput} from '../ui/drawing/interactionController';
import type {DrawingSelection,DrawingTool} from '../ui/drawing/session';

test.each<[string,DrawingSelection,DrawingTool]>([
 ['one ungrouped curve',{ids:['curve']},'direct'],
 ['empty selection',{ids:[]},'select'],
 ['multiple curves',{ids:['curve','second']},'select'],
 ['a layer containing one curve',{ids:['curve'],layer:'layer'},'select'],
 ['an empty layer',{ids:[],layer:'layer'},'select'],
 ['a layer list without a primary layer',{ids:['curve'],layers:['layer','empty']},'select'],
 ['a single selected layer ID',{ids:['curve'],layers:['layer']},'select'],
 ['a one-curve group',{ids:['curve'],group:'group'},'select'],
])('Drawing selection defaults: %s',(_label,selection,tool)=>{
 const before=structuredClone(selection),transition=chooseDrawingSelection('zoom',selection);
 expect(transition.tool).toBe(tool);
 expect(transition.selection).toBe(selection);
 expect(transition.layerId).toBe(selection.layer);
 expect(transition.clearActiveControl).toBe(true);
 expect(selection).toEqual(before);
});

test('an explicit canvas selection mode wins over default scope rules',()=>{
 expect(chooseDrawingSelection('hand',{ids:['curve']},'select').tool).toBe('select');
 expect(chooseDrawingSelection('select',{ids:['first','second'],group:'group'},'direct').tool).toBe('direct');
 expect(chooseDrawingSelection('direct',{ids:[]},'zoom').tool).toBe('zoom');
});

test('Drawing preserves the deform selection exception, but a node or handle can leave the cage',()=>{
 expect(chooseDrawingSelection('deform',{ids:['curve'],layer:'layer'},'select').tool).toBe('deform');
 expect(chooseDrawingSelection('deform',{ids:[]}).tool).toBe('select');
 for(const selection of [{ids:['curve'],node:'node'},{ids:['curve'],handle:{curveId:'curve',end:0 as const}}]){
  const transition=chooseDrawingSelection('deform',selection);
  expect(transition.tool).toBe('direct');expect(transition.selection).toBe(selection);expect(transition.clearActiveControl).toBe(false);
 }
});

test.each<DrawingTool>(['merge','link','bind','smooth','cusp','arc'])('changing the target layer preserves the %s structural tool',tool=>{
 expect(chooseDrawingSelection(tool,{ids:['curve'],node:'node',layer:'next',layers:['next','other']},'select')).toEqual({
  tool,selection:{ids:[],layer:'next',layers:['next','other']},layerId:'next',clearActiveControl:true,
 });
});

test.each<DrawingTool>(['select','hand','zoom','deform','pen','ellipse','split','mirror','merge','link','bind','smooth','cusp','arc'])('the %s tool clears control focus and retains persistent selection',tool=>{
 const persistent:DrawingSelection={ids:['curve','second'],group:'group',layer:'layer',layers:['layer','other'],paintIds:['fill']};
 const selection:DrawingSelection={...persistent,node:'node',handle:{curveId:'curve',end:0}},before=structuredClone(selection);
 expect(selectDrawingTool(tool,selection)).toEqual({tool,selection:persistent,preview:false,clearActiveControl:true});
 expect(selection).toEqual(before);
});

test('direct selection retains the current active node or handle',()=>{
 const selection:DrawingSelection={ids:['curve'],node:'node',handle:{curveId:'curve',end:1}};
 const transition=selectDrawingTool('direct',selection);
 expect(transition).toEqual({tool:'direct',selection,preview:false,clearActiveControl:false});
 expect(transition.selection).toBe(selection);
});

const shortcut=(key:string,modifiers:Partial<Pick<KeyboardEvent,'ctrlKey'|'metaKey'|'altKey'>>={})=>({key,ctrlKey:false,metaKey:false,altKey:false,...modifiers});
test('Drawing and Recording share V/A/H/Z shortcuts, with Drawing retaining P/L',()=>{
 for(const [key,tool] of [['v','select'],['a','direct'],['h','hand'],['z','zoom']]){
  expect(drawingToolForShortcut(shortcut(key))).toBe(tool);expect(drawingToolForShortcut(shortcut(key.toUpperCase()),false)).toBe(tool);
 }
 expect(drawingToolForShortcut(shortcut('p'))).toBe('pen');expect(drawingToolForShortcut(shortcut('l'))).toBe('ellipse');
 expect(drawingToolForShortcut(shortcut('p'),false)).toBeNull();expect(drawingToolForShortcut(shortcut('l'),false)).toBeNull();
 expect(drawingToolForShortcut(shortcut('q'))).toBeNull();
});

test('tool shortcuts leave modifier commands and editable inputs isolated',()=>{
 for(const modifier of ['ctrlKey','metaKey','altKey'])expect(drawingToolForShortcut(shortcut('z',{[modifier]:true}))).toBeNull();
 const matches:string[]=[];
 const input={closest:(selector:string)=>{matches.push(selector);return {};}} as unknown as EventTarget;
 expect(isDrawingShortcutInput(input)).toBe(true);expect(matches[0]).toContain('input,textarea,select');
 expect(matches[0]).toContain('[contenteditable]:not([contenteditable="false"])');expect(matches[0]).toContain('[role="dialog"]');
 for(const selector of ['dialog','[role="menu"]','[role="menuitem"]','[data-ui-keyboard]'])expect(matches[0].split(',')).toContain(selector);
 expect(isDrawingShortcutInput(null)).toBe(false);expect(isDrawingShortcutInput({} as EventTarget)).toBe(false);
 expect(isDrawingShortcutInput({closest:()=>null} as unknown as EventTarget)).toBe(false);
});
