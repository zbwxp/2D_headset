// cursor — which cursor a tool shows (bowen 1791708333; docs/rename-and-cursor-plan.md §2). This table
// is the only place a tool's cursor is defined; a tool without a row shows the default arrow. The app
// asks with the tool's name and whether a press it took is held; no imports.

/** An SVG cursor with its hotspot, and a CSS keyword for a browser that refuses the image. */
const svg = (body: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`)}") ${x} ${y}, ${fallback}`
const ink = 'fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"'

/** A pen nib pointing up-left, with its handle; the hotspot is the tip. */
const PEN = svg(`<path ${ink} d="M2 2 L10 5 L17 12 L12 17 L5 10 Z"/><path d="M2 2 L8.5 8.5" stroke="#fff" stroke-width="1"/><circle cx="9.5" cy="9.5" r="1.3" fill="#fff"/><path ${ink} d="M13.5 16.5 L16.5 13.5 L22.5 19.5 L19.5 22.5 Z"/>`, 2, 2, 'crosshair')
/** A tipped paint bucket pouring; the hotspot is the end of the stream. */
const BUCKET = svg(`<g transform="rotate(-45 14 11)"><path ${ink} d="M8 7 L20 7 L18.5 19 L9.5 19 Z"/><path d="M8 7 L20 7" stroke="#fff" stroke-width="1.2"/><path d="M8 7 Q14 -1 20 7" fill="none" stroke="#111" stroke-width="1.5"/></g><path ${ink} d="M4.5 13 C3 16 2 18 3 21 C4.5 19.5 5.5 17 5.5 13.5 Z"/>`, 3, 21, 'crosshair')

/** tool → [not pressed, pressed] */
const TABLE: Readonly<Record<string, readonly [string, string]>> = {
  pen: [PEN, PEN],
  fill: [BUCKET, BUCKET],
  A: ['grab', 'grabbing'],
  V: ['grab', 'grabbing'],
  Z: ['zoom-in', 'zoom-in'],
}

/** The CSS `cursor` for a tool; `pressed` while a press the tool took is held. Unknown tools: the arrow. */
export function cursorFor(tool: string, pressed: boolean): string {
  const row = Object.hasOwn(TABLE, tool) ? TABLE[tool] : undefined
  return row ? row[pressed ? 1 : 0] : 'default'
}
