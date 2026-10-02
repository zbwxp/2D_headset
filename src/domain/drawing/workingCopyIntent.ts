import type {DrawingSnapshotState} from './snapshots';
export interface DrawingWorkingCopyIntent {discardIds?:string[];checkpointIds?:string[]}
const intents=new WeakMap<object,DrawingWorkingCopyIntent>();
/** Private transaction intent, never serialized and not writable through JSON. */
export function markDrawingWorkingCopyIntent<T extends DrawingSnapshotState>(state:T,intent:DrawingWorkingCopyIntent):T{intents.set(state,intent);return state;}
export function drawingWorkingCopyIntent(state:DrawingSnapshotState):DrawingWorkingCopyIntent{return intents.get(state)??{};}
