/** Historical authoring fixture loader. Not imported by the current app. */
import {parseDrawing,type DrawingDocument} from '../domain/drawing/model';
export async function loadHairlessExample(load=async()=>{const response=await fetch(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('阶段画稿载入失败');return response.text();}):Promise<DrawingDocument>{return parseDrawing(JSON.parse(await load()));}
