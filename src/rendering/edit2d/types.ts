/** Renderer-owned, world-space buffers. Consumers must not mutate shared cached arrays.
 * No Landmark/Curve/Patch source records, solver settings or placement semantics cross this boundary.
 */
export interface SurfaceRenderData {
 readonly id:string;
 readonly positions:Float32Array;
 readonly indices:Uint32Array;
 readonly normals?:Float32Array;
 readonly geometryToken:string;
 readonly warning?:string;
 readonly invalid?:string;
}
export interface CurveRenderData {
 readonly dashed?:boolean;
 readonly id:string;
 readonly samples:Float32Array;
 readonly geometryToken:string;
}
export interface EditRenderSnapshot {
 readonly surface:readonly SurfaceRenderData[];
 readonly curves:readonly CurveRenderData[];
 readonly geometryToken:string;
}
/** Display/selection never invalidate or mutate geometry buffers. */
export interface EditRenderStyle {
 surfaceOpacity:number;
 hiddenCurveOpacity:number;
 selectedCurveIds:ReadonlySet<string>;
}
export const EDIT_OPACITY_PRESETS=[.5,.75,1] as const;
export const HIDDEN_CURVE_OPACITY=.25;
export function editSurfaceOpacity(value:number|undefined){
 if(value===undefined)return .75;
 return EDIT_OPACITY_PRESETS.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);
}
