// Test helper: lets a test name points first and then draw lines between them.
// It only translates into the real public operation — `line` with a new-point
// end where a point is used for the first time — so no lone point is ever made.
import type { Editor, Vec } from '../src'

const sketches = new WeakMap<Editor, Sketch>()
interface Sketch {
  point(id: string, layer: string, position: Vec): void
  line(id: string, a: string, b: string, handles?: { ha: Vec; hb: Vec }): void
}

export function sk(e: Editor): Sketch {
  let s = sketches.get(e)
  if (!s) {
    const pending = new Map<string, { id: string; layer: string; position: Vec }>()
    const end = (x: string) => { const p = pending.get(x); if (p) { pending.delete(x); return p } return x }
    s = {
      point(id, layer, position) { pending.set(id, { id, layer, position: { x: position.x, y: position.y } }) },
      line(id, a, b, handles) { e.line(id, end(a), end(b), handles) },
    }
    sketches.set(e, s)
  }
  return s
}
