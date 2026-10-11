// rename — the one way to rename a name shown in a list (bowen 1791708333; docs/rename-and-cursor-plan.md
// §1): double-click turns the name into a field; Enter or leaving the field commits once, Esc cancels.
// It never decides whether a name is allowed: the caller passes it to core. React only.
// An edit belongs to the name it started from (dot 1791708548): if that name changes under it (an
// undo), or the row goes (the object deleted, another drawing opened: the caller remounts it; React
// delivers no blur to a field it removes, pinned by a test), the edit is dropped, never written to
// whatever now has that id. With an input method, the Enter that picks a word does not commit.
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

export interface RenameProps {
  readonly name: string
  /** Called once with the trimmed new name; never for an empty or unchanged one. */
  onRename(name: string): void
  /** A single click on the name (selecting the row); a double-click edits. */
  onClick?(e: MouseEvent): void
  readonly title?: string
  readonly style?: CSSProperties
  /** The field's look (the panels differ: dark layers panel, light bench panel). */
  readonly fieldStyle?: CSSProperties
}

export function Rename({ name, onRename, onClick, title, style, fieldStyle }: RenameProps) {
  const [editing, setEditing] = useState(false)
  // Enter unmounts the field, and a browser may then send it a blur: one edit commits at most once
  const done = useRef(false)
  const from = useRef(name)
  useEffect(() => { if (editing && name !== from.current) { done.current = true; setEditing(false) } }, [editing, name])
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    const n = value?.trim()
    if (n && n !== name) onRename(n)
  }
  if (!editing) {
    return <span data-name="" title={title ?? '双击改名'} onClick={onClick} onDoubleClick={() => { done.current = false; from.current = name; setEditing(true) }}
      style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}>{name}</span>
  }
  return <input data-rename="" autoFocus defaultValue={name} onFocus={e => e.target.select()}
    style={{ flex: 1, minWidth: 0, font: 'inherit', ...fieldStyle }}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onBlur={e => finish(e.target.value)}
    onKeyDown={e => {
      // a key typed here is the field's own: it never reaches the row, the page or the tool shortcuts,
      // whatever the caller's own typing check does (dot 1791709183)
      e.stopPropagation()
      if (e.nativeEvent.isComposing || e.keyCode === 229) return // the input method's own Enter / Esc
      if (e.key === 'Enter') finish((e.target as HTMLInputElement).value)
      else if (e.key === 'Escape') finish(null)
    }} />
}
