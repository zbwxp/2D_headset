// Minimal typing for bezier-js 6.1.4 (MIT, https://github.com/Pomax/bezierjs) — only what we use.
declare module 'bezier-js' {
  export type Point = { x: number; y: number; t?: number; d?: number }
  export class Bezier {
    constructor(...coords: number[])
    project(p: Point): Point & { t: number; d: number }
    get(t: number): Point
    bbox(): { x: { min: number; max: number }; y: { min: number; max: number } }
    getLUT(steps?: number): Point[]
  }
}
