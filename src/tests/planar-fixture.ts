/** Legacy planar fixtures exercise the importer and the unchanged Eyes/legacy path. */
import {createCurve as create} from '../domain/curves/management';
import {canonical as base,bodyShape as body,handleShape as handle} from '../domain/curves/geometry';
import {isFree3DShape,type CurveShape} from '../domain/curves/model';
export const planarShape=(shape:CurveShape)=>{if(isFree3DShape(shape))throw Error('Expected legacy planar fixture');return shape;};
export const createCurve=(p:Parameters<typeof create>[0],a:string,b:string,v:Parameters<typeof create>[3],name:string)=>create(p,a,b,v,name,'EYES');
export const canonical=(...args:Parameters<typeof base>)=>{const c=base(...args);return {...c,shape:planarShape(c.shape)};};
export const bodyShape=(...args:Parameters<typeof body>)=>planarShape(body(...args));
export const handleShape=(...args:Parameters<typeof handle>)=>planarShape(handle(...args));
