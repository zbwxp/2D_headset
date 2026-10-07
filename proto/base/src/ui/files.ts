// Real files (editor skeleton block 3, doc 18 §30.3): open / save / save as, through browser-fs-access (GoogleChromeLabs,
// the library Excalidraw uses): the File System Access API where the browser has it (save writes back to the same
// file), a file input / download otherwise. Conventions of every desktop editor: ⌘O / ⌘S / ⇧⌘S, the file name and an
// unsaved marker in the title, a question before unsaved changes are thrown away (open, leaving the page).
// The document counts as saved only once the write succeeded (Editor.markSaved with the revision that was written).
import { atom } from '@tldraw/state'
import { fileOpen, fileSave } from 'browser-fs-access'
import type { Editor } from '../editor'
import type { Selection } from '../selection'

const EXT = '.contour.json'
const TYPES = { description: 'Contour 文档', extensions: [EXT, '.json'], mimeTypes: ['application/json'] }

export class Files {
  /** the open file's name (null = never saved) */
  readonly name = atom<string | null>('file name', null)
  private handle: FileSystemFileHandle | null = null

  constructor(
    private readonly editor: Editor,
    private readonly selection: Selection,
    private readonly status: (s: string) => void,
    /** asked before unsaved changes are discarded (window.confirm in the page) */
    private readonly confirmDiscard: () => boolean = () => window.confirm('当前文档有未保存的修改，确定放弃吗？'),
  ) {}

  /** ⌘S (or ⇧⌘S = `as`): write the document; returns false when cancelled or failed (the document stays unsaved) */
  async save(as = false): Promise<boolean> {
    const revision = this.editor.revision
    const snapshot = this.editor.reader.getStoreSnapshot('document')
    const blob = new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' })
    try {
      const handle = await fileSave(blob, { fileName: this.name.get() ?? `未命名${EXT}`, ...TYPES }, as ? null : this.handle)
      if (handle) {
        this.handle = handle
        this.name.set(handle.name)
      } else if (!this.name.get()) this.name.set(`未命名${EXT}`)
      this.editor.markSaved(revision)
      this.status('')
      return true
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false // the user cancelled the dialog
      this.status(`保存失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
  }

  /** ⌘O: read a file and replace the document (checked like any open; a bad file changes nothing and says why) */
  async open(): Promise<boolean> {
    if (this.editor.isDirty && !this.confirmDiscard()) return false
    let file: File & { handle?: FileSystemFileHandle }
    try {
      file = await fileOpen(TYPES)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false
      this.status(`打开失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
    try {
      this.editor.load(JSON.parse(await file.text()))
    } catch (e) {
      this.status(`打开失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
    this.selection.clear()
    this.handle = file.handle ?? null
    this.name.set(file.name)
    this.status('')
    return true
  }

  /** leaving the page with unsaved changes asks first (beforeunload) */
  guardUnload(target: Window = window) {
    target.addEventListener('beforeunload', (e) => {
      if (!this.editor.isDirty) return
      e.preventDefault()
      e.returnValue = ''
    })
  }
}
