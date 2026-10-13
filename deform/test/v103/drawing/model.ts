// Frozen copy for the deform port's comparison tests: the four helpers and two types the v103 deformation
// files import, from /Users/bowen/Documents/headset 7205381:src/domain/drawing/model.ts (lines 88–91, verbatim).
export type Point2=[number,number];
export type Cubic=[Point2,Point2,Point2,Point2];
export const add=(a:Point2,b:Point2):Point2=>[a[0]+b[0],a[1]+b[1]];
export const sub=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];
export const mul=(a:Point2,s:number):Point2=>[a[0]*s,a[1]*s];
export const length=(a:Point2)=>Math.hypot(...a);
