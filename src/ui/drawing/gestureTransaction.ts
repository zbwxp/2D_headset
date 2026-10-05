/** One pending target per pointer/keyboard gesture. Preview rejection retires
 * the previous target too: the screen and the value eligible for commit agree. */
export interface GesturePreviewTarget<T> {target?:T}

export function clearGestureTarget<T>(state:GesturePreviewTarget<T>|undefined):void {
 if(state)delete state.target;
}

export function previewGestureTarget<T>(state:GesturePreviewTarget<T>,produce:()=>T|undefined,publish:(target:T|null)=>boolean|void):boolean {
 clearGestureTarget(state);
 try {
  const target=produce();
  if(target===undefined||publish(target)===false){publish(null);return false;}
  state.target=target;return true;
 } catch(error){publish(null);throw error;}
}

/** Taking the target consumes it before calling an adapter, including adapters
 * that throw. Repeated releases and late callbacks cannot commit it twice. */
export function takeGestureTarget<T>(state:GesturePreviewTarget<T>|undefined):T|undefined {
 const target=state?.target;clearGestureTarget(state);return target;
}

export type EditorHistoryAction='cancel-gesture'|'cancel-anchor'|'history';
export function editorHistoryAction(redo:boolean,activeGesture:boolean,pendingAnchor:boolean):EditorHistoryAction {
 return activeGesture?'cancel-gesture':!redo&&pendingAnchor?'cancel-anchor':'history';
}
export interface EditorHistoryActions {
 activeGesture:boolean;pendingAnchor:boolean;
 cancelGesture:()=>void;cancelAnchor:()=>void;undo:()=>void;redo:()=>void;
}
export function runEditorHistory(redo:boolean,actions:EditorHistoryActions):EditorHistoryAction {
 const action=editorHistoryAction(redo,actions.activeGesture,actions.pendingAnchor);
 if(action==='cancel-gesture')actions.cancelGesture();
 else if(action==='cancel-anchor')actions.cancelAnchor();
 else if(redo)actions.redo();else actions.undo();
 return action;
}

type HistoryKeyEvent=Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'defaultPrevented'|'isComposing'|'preventDefault'|'stopImmediatePropagation'>;
/** The canvas and application fallback share key recognition and consumption.
 * A handled event cannot also reach another history listener. */
export function consumeEditorHistoryShortcut(event:HistoryKeyEvent,run:(redo:boolean)=>void):boolean {
 if(event.defaultPrevented||event.isComposing||!(event.ctrlKey||event.metaKey))return false;
 const key=event.key.toLowerCase();if(key!=='z'&&key!=='y')return false;
 event.preventDefault();event.stopImmediatePropagation();run(key==='y'||event.shiftKey);return true;
}
