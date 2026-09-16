import { Camera, Vector3 } from 'three';
export interface CurveSegment { id: string; a: Vector3; b: Vector3 }
/** Screen-space tolerance stays constant under orbit, zoom and resize. */
export function pickCurve(segments: CurveSegment[], camera: Camera, width: number, height: number, x: number, y: number, tolerance = 6): string | null {
  let best: { id: string; distance: number; depth: number } | null = null;
  for (const segment of segments) {
    const a = segment.a.clone().project(camera), b = segment.b.clone().project(camera);
    if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
    const ax = (a.x + 1) * width / 2, ay = (1 - a.y) * height / 2;
    const bx = (b.x + 1) * width / 2, by = (1 - b.y) * height / 2;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy), depth = a.z + t * (b.z - a.z);
    if (distance <= tolerance && (!best || distance < best.distance - .25 || (Math.abs(distance - best.distance) <= .25 && depth < best.depth))) best = { id: segment.id, distance, depth };
  }
  return best?.id ?? null;
}

/** Tool-only candidate hit test: pixels first, depth tie-break; no geometry selection. */
export function pickAnchor(candidates:{id:string;position:Vector3}[],camera:Camera,width:number,height:number,x:number,y:number,tolerance=13){
 let best:{id:string;distance:number;depth:number}|undefined;
 for(const c of candidates){const q=c.position.clone().project(camera);if(q.z< -1||q.z>1)continue;const distance=Math.hypot((q.x+1)*width/2-x,(1-q.y)*height/2-y);if(distance<=tolerance&&(!best||distance<best.distance-.25||Math.abs(distance-best.distance)<=.25&&q.z<best.depth))best={id:c.id,distance,depth:q.z};}
 return best?.id??null;
}
