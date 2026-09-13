import {contourSource,type ContourSource} from '../../domain/contour/source';
import {silhouette,type Orientation} from '../../domain/contour/silhouette';
export interface ContourRequest {id:number;revision:string;orientation:Orientation;source?:ContourSource}
let revision='',geometry:ReturnType<typeof contourSource>|undefined;
self.onmessage=(event:MessageEvent<ContourRequest>)=>{
 const request=event.data;
 try{
 if(request.revision!==revision||!geometry){if(!request.source)throw Error('轮廓源未准备');geometry=contourSource(request.source);revision=request.revision;}
 const result=silhouette(geometry.mesh,request.orientation);
 self.postMessage({id:request.id,revision:request.revision,...result,invalid:geometry.invalid,triangleCount:geometry.mesh.triangles.length});
 }catch(e){self.postMessage({id:request.id,revision:request.revision,error:(e as Error).message});}
};
