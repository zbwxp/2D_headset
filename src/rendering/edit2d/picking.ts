import type {Vec2,Vec3} from '../../domain/project/types';
export interface RenderSurfaceHit {id:string;world:Vec3;depth:number;triangle:number;barycentric:Vec3}
/** View-local query registration; only pointer interactions request a GPU readback. */
export interface SurfacePicker {pick:(screen:Vec2,ids?:ReadonlySet<string>)=>RenderSurfaceHit|null}
export const editSurfacePicker:{current:SurfacePicker|null}={current:null};
