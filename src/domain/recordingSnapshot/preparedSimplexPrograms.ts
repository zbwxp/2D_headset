import type {DrawingDocument} from '../drawing/model';
import {prepareSnapshotSimplexGeometry,type SnapshotSimplexBasis} from './simplexGeometry';

type Program=ReturnType<typeof prepareSnapshotSimplexGeometry>;
interface ProgramCache {drawings:WeakMap<DrawingDocument,ProgramCache>;programs:Map<string,Program>}
const cache:ProgramCache={drawings:new WeakMap(),programs:new Map()};
/** Immutable numeric basis revisions share one compiled topology/control plan.
 * Binding angles remain part of the key because they decide discrete ties. */
export function preparedSnapshotSimplexProgram(bases:readonly SnapshotSimplexBasis[],onPrepare?:()=>void):Program {
 let current=cache;for(const basis of bases){let next=current.drawings.get(basis.drawing);if(!next){next={drawings:new WeakMap(),programs:new Map()};current.drawings.set(basis.drawing,next);}current=next;}
 const key=JSON.stringify(bases.map(basis=>[basis.snapshotId,basis.angle?.x,basis.angle?.y]));let program=current.programs.get(key);
 if(!program){program=prepareSnapshotSimplexGeometry(bases);current.programs.set(key,program);onPrepare?.();}return program;
}
