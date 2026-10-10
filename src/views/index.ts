// views — the nine views of a drawing (graph "Views"; docs/architecture-multiview.md §2,
// package 3). Stage 1 holds only their names: yaw −90 / 0 / +90 × pitch −45 / 0 / +45
// (pitch ±45 is a candidate value, graph row "Views"). A view is a shape layer of kind
// 'view' whose key is `view:<yaw>,<pitch>`.

export type Yaw = -90 | 0 | 90
export type Pitch = -45 | 0 | 45
export const YAWS: readonly Yaw[] = Object.freeze([-90, 0, 90])
export const PITCHES: readonly Pitch[] = Object.freeze([-45, 0, 45])

export const key = (yaw: Yaw, pitch: Pitch): string => {
  if (!YAWS.includes(yaw) || !PITCHES.includes(pitch)) throw new Error(`No view at yaw ${yaw}, pitch ${pitch}`)
  return `view:${yaw},${pitch}`
}
/** The front view, 0,0. */
export const FRONT = key(0, 0)
/** All nine view keys, yaw-major. */
export const ALL: readonly string[] = Object.freeze(YAWS.flatMap(y => PITCHES.map(p => key(y, p))))
export const isView = (k: string) => ALL.includes(k)
