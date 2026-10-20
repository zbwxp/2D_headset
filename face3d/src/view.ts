// Camera (PLAN §1): orthographic. Turn the head by yaw about y (yaw > 0: the face turns toward the screen's right), then
// tilt by pitch about x (pitch > 0: looking up at the face, 仰视). Head space: x right, y up, z toward the viewer at 0, 0.
export type V3 = readonly [number, number, number]
export interface View { readonly yaw: number; readonly pitch: number }

const D = Math.PI / 180

/** Head space → camera space: [screen x (right), screen y (up), depth toward the viewer]. */
export function rotate(p: V3, v: View): V3 {
  const cy = Math.cos(v.yaw * D), sy = Math.sin(v.yaw * D)
  const x = cy * p[0] + sy * p[2], z0 = -sy * p[0] + cy * p[2]
  const c = Math.cos(v.pitch * D), s = Math.sin(v.pitch * D)
  return [x, p[1] * c + z0 * s, z0 * c - p[1] * s]
}

/** The direction toward the camera, in head space (the inverse rotation of +z). */
export function toCamera(v: View): V3 {
  const c = Math.cos(v.pitch * D), s = Math.sin(v.pitch * D), cy = Math.cos(v.yaw * D), sy = Math.sin(v.yaw * D)
  // camera z axis in head space: rotate^T applied to (0, 0, 1)
  const y = -s, z0 = c
  return [-sy * z0, y, cy * z0]
}

/** The camera's screen axes (right, up) in head space. */
export function screenAxes(v: View): { right: V3; up: V3 } {
  const c = Math.cos(v.pitch * D), s = Math.sin(v.pitch * D), cy = Math.cos(v.yaw * D), sy = Math.sin(v.yaw * D)
  return { right: [cy, 0, sy], up: [-sy * s, c, cy * s] }
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const mirror = (a: V3): V3 => [-a[0], a[1], a[2]]
