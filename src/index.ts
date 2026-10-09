// Package root: the document entry and the public types only.
export { Core } from './document'
export { save, open } from './archive'
export type { Editor, Snapshot, Geometry } from './document'
export type { Vec } from './geometry'
export type { Clip } from './clipboard'
