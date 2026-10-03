import {createContext,useContext,type ReactNode} from 'react';
import type {DrawingDocument} from '../../domain/drawing/model';
import {currentDrawingPresentation} from './snapshotPresentation';
import {useDrawingWorkspace} from './workspace';

export interface DrawingPropertySession {
 /** Committed gesture baseline, never the preview currently being rendered. */
 current:()=>DrawingDocument;
 token?:()=>unknown;
 undo:()=>void;
 redo:()=>void;
}
const Context=createContext<DrawingPropertySession|null>(null);
export function DrawingPropertySessionProvider({session,children}:{session:DrawingPropertySession;children:ReactNode}){return <Context.Provider value={session}>{children}</Context.Provider>;}
export function useDrawingPropertySession():DrawingPropertySession {
 const override=useContext(Context),{editor,id}=useDrawingWorkspace();
 return override??{current:()=>currentDrawingPresentation(editor.getState().project,id),undo:()=>editor.getState().undo(),redo:()=>editor.getState().redo()};
}
