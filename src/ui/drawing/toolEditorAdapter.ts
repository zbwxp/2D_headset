import type {DrawingDocument} from '../../domain/drawing/model';
import type {DrawingCommandIntent} from './endpointInteraction';
import type {DrawingSelection,DrawingTool} from './session';

/** The host resolves the real owner and the final-space target transaction.
 * Shared tools own only the Drawing command and a cancellable pointer draft. */
export interface DrawingToolEditorAdapter {
 drawing:DrawingDocument;targetKey:string;historyKey:object;layerId:string|null;
 editable:boolean;topologyEditable:boolean;disabledReason?:string;topologyDisabledReason?:string;
 onPreview?:(before:DrawingDocument,next:DrawingDocument|null,intent?:DrawingCommandIntent)=>boolean;
 onCommit:(before:DrawingDocument,next:DrawingDocument,intent?:DrawingCommandIntent)=>object|undefined;
 onSelection:(selection:DrawingSelection,tool?:DrawingTool)=>void;
 onError:(message:string)=>void;
}
