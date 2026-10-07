// Keyboard shortcuts of the editor skeleton — Illustrator defaults (Help › Keyboard shortcuts; macOS ⌘ = Ctrl
// elsewhere): V / A tools, ⌘Z / ⇧⌘Z undo / redo (also Ctrl+Y), Delete / Backspace delete, ⌘A select all, ⇧⌘A
// deselect, arrows nudge 1 (Shift: 10), ⌘+ / ⌘− zoom, ⌘0 fit, ⌘1 actual size, space = hand tool, E while dragging a
// marquee = enclosed mode, Esc = cancel the gesture in progress. Block 2: P Pen, + / = Add and − Delete Anchor Point,
// C Scissors, ⌘J Join; while a pen path is drawn Enter / Esc end it and ⌘Z removes its last anchor. Block 3: ⌘C / ⌘X /
// ⌘V (centre of the view) / ⇧⌘V (in place), ⌘O / ⌘S / ⇧⌘S; ⌘7 / ⌥⌘7 make / release a mask; ⌘] / ⌘[ forward /
// backward (Shift: front / back), ⌘G / ⇧⌘G group / ungroup. Keys typed into a form field are left alone.
import type { Editor } from '../editor'
import type { FabricView, Tool } from '../view/fabricView'
import type { Files } from './files'

export function installShortcuts(editor: Editor, view: FabricView, setTool: (t: Tool) => void, files?: Files, target: Window = window) {
  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    // text entry only: a checkbox / colour well / button keeps the shortcuts (they take no typed keys)
    if (!el) return false
    // arrow keys belong to a focused slider too (it moves itself) — never also nudge the selection (dot 1791365450)
    if (el.tagName === 'INPUT' && e.key.startsWith('Arrow') && (el as HTMLInputElement).type === 'range') return true
    if (el.tagName === 'INPUT') return !['checkbox', 'color', 'radio', 'range', 'button', 'submit'].includes((el as HTMLInputElement).type)
    return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  }
  const down = (e: KeyboardEvent) => {
    if (typing(e)) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    const done = () => e.preventDefault()
    if ((k === 'Escape' || k === 'Enter') && view.pen) return view.finishPen(), done()
    if (k === 'Escape') return view.cancelGesture() && done()
    if (k === ' ') return view.setSpace(true), done()
    if ((k === 'e' || k === 'E') && !mod) {
      if (view.toggleMarqueeMode()) return done()
    }
    if (mod && (k === 'z' || k === 'Z') && !e.shiftKey && view.penUndo()) return done()
    if (mod && (k === 'j' || k === 'J')) return view.join(), done()
    if (mod && (k === 'u' || k === 'U')) return view.setSnap(!view.snapOn.get()), done() // Smart Guides
    if (mod && e.code === 'Digit7') return (e.altKey ? view.releaseMask() : view.makeMask()), done()
    if (mod && e.code === 'BracketRight') return view.arrange(e.shiftKey ? 'front' : 'forward'), done()
    if (mod && e.code === 'BracketLeft') return view.arrange(e.shiftKey ? 'back' : 'backward'), done()
    if (mod && (k === 'g' || k === 'G')) return (e.shiftKey ? view.ungroup() : view.group()), done()
    // asynchronous: any unexpected failure is shown, never left as an unhandled rejection (review of 6c59e19 C6)
    const run = (p: Promise<unknown>) => void p.catch((err) => view.showStatus(`操作失败：${String((err as Error)?.message ?? err)}`))
    if (mod && (k === 'c' || k === 'C')) return run(view.copy()), done()
    if (mod && (k === 'x' || k === 'X')) return run(view.cut()), done()
    if (mod && (k === 'v' || k === 'V')) return run(view.paste(e.shiftKey)), done()
    if (mod && (k === 's' || k === 'S') && files) return run(files.save(e.shiftKey)), done()
    if (mod && (k === 'o' || k === 'O') && files) return run(files.open()), done()
    if (mod && (k === 'n' || k === 'N') && files) return run(files.newDocument()), done()
    if (mod && (k === 'z' || k === 'Z')) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
      view.selection.prune(editor.reader)
      return done()
    }
    if (mod && (k === 'y' || k === 'Y')) return editor.redo(), view.selection.prune(editor.reader), done()
    if (mod && (k === 'a' || k === 'A')) {
      if (e.shiftKey) view.selection.clear()
      else view.selectAll()
      return done()
    }
    if (mod && (k === '=' || k === '+')) return view.zoomBy(1.25), done()
    if (mod && (k === '-' || k === '_')) return view.zoomBy(1 / 1.25), done()
    if (mod && k === '0') return view.fitToContent(), done()
    if (mod && k === '1') return view.actualSize(), done()
    if (mod) return
    if (k === 'v' || k === 'V') return setTool('V'), done()
    if (k === 'a' || k === 'A') return setTool('A'), done()
    if (k === 'p' || k === 'P') return setTool('P'), done()
    if ((k === 'c' || k === 'C') && e.shiftKey) return setTool('N'), done() // ⇧C Convert Anchor Point
    if (k === 'c' || k === 'C') return setTool('C'), done()
    if (k === 'k' || k === 'K') return setTool('K'), done()
    if (k === 'i' || k === 'I') return setTool('I'), done()
    // the colour picker's two modes (doc 18 §31.3 step 6): Tab switches them while I is the tool
    if (k === 'Tab' && view.mode === 'I') return view.pickMode.set(view.pickMode.get() === 'source' ? 'screen' : 'source'), done()
    if (k === '+' || k === '=') return setTool('+'), done()
    if (k === '-' || k === '_') return setTool('-'), done()
    if (k === 'Delete' || k === 'Backspace') return (view.selection.getAnchors().length ? view.deleteSelectedAnchors() : view.deleteSelection()), done()
    const step = e.shiftKey ? 10 : 1
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (arrows[k]) return view.nudge(...arrows[k]), done()
  }
  const up = (e: KeyboardEvent) => {
    // space is the hand tool, never a click on the focused button
    if (e.key === ' ' && !typing(e)) (view.setSpace(false), e.preventDefault())
  }
  target.addEventListener('keydown', down)
  target.addEventListener('keyup', up)
  return () => (target.removeEventListener('keydown', down), target.removeEventListener('keyup', up))
}
