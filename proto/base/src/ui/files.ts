// Real files (editor skeleton block 3, doc 18 §30.3): open / save / save as, through browser-fs-access (GoogleChromeLabs,
// the library Excalidraw uses): the File System Access API where the browser has it (save writes back to the same
// file), a file input / download otherwise. Conventions of every desktop editor: ⌘O / ⌘S / ⇧⌘S, the file name and an
// unsaved marker in the title, a question before unsaved changes are thrown away (open, leaving the page).
// The document counts as saved only once the write succeeded (Editor.markSaved with the revision that was written).
import { atom } from '@tldraw/state'
import { fileOpen, fileSave } from 'browser-fs-access'
import type { Editor } from '../editor'
import type { Selection } from '../selection'
import { Container, schema } from '../schema'

const EXT = '.contour.json'
const TYPES = { description: 'Contour 文档', extensions: [EXT, '.json'], mimeTypes: ['application/json'] }

/** the file dialogs / writes (browser-fs-access); replaceable so a test can delay them */
export type FileIo = { open: typeof fileOpen; save: typeof fileSave }

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
    readonly io: FileIo = { open: fileOpen, save: fileSave },
  ) {}

  /** ⌘S (or ⇧⌘S = `as`): write the document; returns false when cancelled or failed (the document stays unsaved) */
  async save(as = false): Promise<boolean> {
    // what is written and to which file are fixed when the save STARTS; if another document is opened before the write
    // finishes, the finished save does not touch that document's name, file or saved state (dot, review of 7538032)
    const epoch = this.editor.documentEpoch
    const revision = this.editor.revision
    const snapshot = this.editor.reader.getStoreSnapshot('document')
    const blob = new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' })
    try {
      const handle = await this.io.save(blob, { fileName: this.name.get() ?? `未命名${EXT}`, ...TYPES }, as ? null : this.handle)
      if (this.editor.documentEpoch !== epoch) {
        this.status('保存完成，但期间已打开另一个文档：当前文档的文件和保存状态没有改动')
        return true
      }
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
    const asked = { epoch: this.editor.documentEpoch, revision: this.editor.revision }
    let file: File & { handle?: FileSystemFileHandle }
    try {
      file = await this.io.open(TYPES)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false
      this.status(`打开失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
    let snapshot: any
    try {
      snapshot = JSON.parse(await file.text())
    } catch (e) {
      this.status(`打开失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
    // edits made while the dialog was open are new unsaved changes: ask again (never discarded silently)
    const changed = this.editor.documentEpoch !== asked.epoch || this.editor.revision !== asked.revision
    if (changed && this.editor.isDirty && !this.confirmDiscard()) return false
    try {
      this.editor.load(snapshot)
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

  /**
   * New (⌘N / 新建): an empty document with one layer, as every editor starts (Illustrator: 图层 1); unsaved changes are
   * asked about first; no file yet (the next ⌘S asks where).
   */
  async newDocument(): Promise<boolean> {
    if (this.editor.isDirty && !this.confirmDiscard()) return false
    const layer = Container.create({ id: Container.createId(), name: '图层 1', index: 'a1' })
    this.editor.load({ store: { [layer.id]: layer } as any, schema: schema.serialize() })
    this.selection.clear()
    this.handle = null
    this.name.set(null)
    this.status('')
    return true
  }

  /**
   * Export (File › Export): the drawing as PNG (2× its size, transparent) or SVG — written as a separate file; the
   * document's own file, name and saved state are untouched.
   */
  async exportAs(kind: 'png' | 'svg', view: { exportBlob: (kind: 'png' | 'svg') => Promise<Blob | null> }): Promise<boolean> {
    const blob = await view.exportBlob(kind)
    if (!blob) return this.status('导出：画面上没有可见的内容'), false
    const base = (this.name.get() ?? '未命名').replace(/\.contour\.json$|\.json$/, '')
    try {
      await this.io.save(blob, { fileName: `${base}.${kind}`, extensions: [`.${kind}`], description: kind.toUpperCase(), mimeTypes: [kind === 'png' ? 'image/png' : 'image/svg+xml'] })
      this.status('')
      return true
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false
      this.status(`导出失败：${String((e as Error)?.message ?? e)}`)
      return false
    }
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
