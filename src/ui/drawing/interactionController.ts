import type {DrawingSelection,DrawingTool} from './session';
import {isEndpointTool} from './tools';

/** The shared selection/tool result; control focus outside Drawing uses the flag. */
export interface DrawingInteractionTransition {
 tool:DrawingTool;
 selection:DrawingSelection;
 layerId?:string;
 clearActiveControl:boolean;
}

/** Drawing's selection rules, also used by Recording's layer and canvas picks. */
export function chooseDrawingSelection(currentTool:DrawingTool,next:DrawingSelection,mode?:DrawingTool,capabilities:{deformRequiresLayers?:boolean}={}):DrawingInteractionTransition{
 // Structural endpoint tools keep their two-click workflow when its layer changes.
 if(isEndpointTool(currentTool)&&next.layer)return {
  tool:currentTool,selection:{ids:[],layer:next.layer,layers:next.layers},layerId:next.layer,clearActiveControl:true,
 };
 const tool=currentTool==='deform'&&next.ids.length&&!next.node&&!next.handle&&(!capabilities.deformRequiresLayers||!!next.layer||!!next.layers?.length)?'deform':mode??(
  next.ids.length===1&&!next.layer&&!next.layers?.length&&!next.group?'direct':'select'
 );
 return {tool,selection:next,...(next.layer?{layerId:next.layer}:{}),clearActiveControl:tool!=='direct'||!next.node&&!next.handle};
}

/** Tool changes retain the object/layer selection while retiring direct-edit focus. */
export function selectDrawingTool(next:DrawingTool,selection:DrawingSelection):DrawingInteractionTransition&{preview:false}{
 const clearActiveControl=next!=='direct';
 let nextSelection=selection;
 if(clearActiveControl&&(selection.node!==undefined||selection.handle!==undefined)){
  const {node,handle,...persistentSelection}=selection;
  nextSelection=persistentSelection;
 }
 return {tool:next,selection:nextSelection,preview:false,clearActiveControl};
}

const navigationTools:Record<string,DrawingTool>={v:'select',a:'direct',h:'hand',z:'zoom'};
const structuralTools:Record<string,DrawingTool>={p:'pen',l:'ellipse'};
/** Recording uses the same V/A/H/Z mapping with structural authoring disabled. */
export function drawingToolForShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'>,structural=true):DrawingTool|null{
 if(event.ctrlKey||event.metaKey||event.altKey)return null;
 const key=event.key.toLowerCase();
 return navigationTools[key]??(structural?structuralTools[key]:null)??null;
}

/** Input, dialog and embedded-workspace keystrokes belong to their own surface. */
export function isDrawingShortcutInput(target:EventTarget|null):boolean{
 return !!(target as Element|null)?.closest?.('[data-hair-orbit],input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,[role="dialog"],[role="menu"],[role="menuitem"],[data-ui-keyboard]');
}
