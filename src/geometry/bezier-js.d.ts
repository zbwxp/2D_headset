// Minimal typing for the parts of bezier-js (MIT) this module uses.
declare module 'bezier-js' {
  export class Bezier {
    constructor(...coords: number[])
    length(): number
  }
}
