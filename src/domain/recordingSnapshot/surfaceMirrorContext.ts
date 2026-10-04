import type {SnapshotScalarTarget} from './simplexGeometry';
import type {SnapshotSimplexLocation} from './triangulation';
import type {SnapshotSmoothProjectionContract} from './responseExpressions';

/** Prepared, runtime-only source geometry. Persistence owns the relation and
 * native response maps; it never owns sampled mirrored controls. */
export interface SnapshotSurfaceMirrorSample {
 scalar:(target:SnapshotScalarTarget,axis:0|1)=>number|undefined;
 corners:(target:SnapshotScalarTarget,axis:0|1)=>readonly (number|undefined)[];
 contracts:readonly SnapshotSmoothProjectionContract[];
 diagnostics:readonly string[];
}
export interface SnapshotSurfaceMirrorContext {
 sample:(location:SnapshotSimplexLocation,weights:readonly number[])=>SnapshotSurfaceMirrorSample|undefined;
}
