export interface InspectionBackground {images:{id:string;name:string;dataUrl:string;scale?:number;rotation?:number;offsetX?:number;offsetY?:number;opacity?:number}[];activeId:string|null}
export function parseInspectionBackground(value:unknown):InspectionBackground|undefined {
 if(value===undefined)return undefined;const v=value as InspectionBackground;
 if(!v||!Array.isArray(v.images)||v.images.length>6||new Set(v.images.map(x=>x.id)).size!==v.images.length||v.images.some(x=>!x||typeof x.id!=='string'||typeof x.name!=='string'||x.name.length>120||typeof x.dataUrl!=='string'||x.dataUrl.length>350000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.dataUrl))||v.activeId!==null&&!v.images.some(x=>x.id===v.activeId))throw Error('3D 背景图数据无效');
 return {images:v.images.map(image=>{const {id,name,dataUrl}=image,t=backgroundTransform(image);if(![t.scale,t.rotation,t.offsetX,t.offsetY,t.opacity].every(Number.isFinite)||t.scale<.1||t.scale>5||Math.abs(t.rotation)>180||Math.abs(t.offsetX)>100||Math.abs(t.offsetY)>100||t.opacity<0||t.opacity>1)throw Error('3D 背景图变换无效');return {id,name,dataUrl,...t};}),activeId:v.activeId};
}

export const backgroundTransform=(image:InspectionBackground["images"][number])=>({scale:image.scale??1,rotation:image.rotation??0,offsetX:image.offsetX??0,offsetY:image.offsetY??0,opacity:image.opacity??1});
