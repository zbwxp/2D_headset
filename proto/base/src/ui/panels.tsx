// Editor skeleton block 1 — toolbar, layers panel, properties panel (React, as the product; reactive reads through
// @tldraw/state-react `useValue`, the same signals the document and the selection already are). Layout and behaviour
// follow Illustrator / Figma defaults; nothing here writes the document except through `editor.apply` commands.
import { atom, type Atom } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'
import { useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import type { Command } from '../commands'
import type { Editor } from '../editor'
import { layerOf } from '../selection'
import type { ContainerRecord, CurveRecord, DocRecord, FillRecord, MaskRecord, ReferenceRecord } from '../schema'
import type { FabricView } from '../view/fabricView'
import { layerRows, rangeOf, type LayerRow } from './layerTree'

export type Tool = 'V' | 'A'
export type Ui = { editor: Editor; view: FabricView; tool: Atom<Tool>; zoom: Atom<number>; apply: (cmd: Command) => void }
export const createTool = () => atom<Tool>('tool', 'A')

const KIND_LABEL: Record<string, string> = { container: '图层', curve: '线', fill: '填充', reference: '引用' }

export function Toolbar({ ui }: { ui: Ui }) {
  const { editor, view } = ui
  const tool = useValue(ui.tool)
  const zoom = useValue(ui.zoom)
  const canUndo = useValue('can undo', () => (void editor.revision, editor.history.undo.length > 0), [editor])
  const canRedo = useValue('can redo', () => (void editor.revision, editor.history.redo.length > 0), [editor])
  const setTool = (t: Tool) => {
    ui.tool.set(t)
    view.setMode(t)
  }
  return (
    <div className="toolbar">
      <div className="group">
        <button id="modeV" className={tool === 'V' ? 'on' : ''} title="选择工具 (V)：点选对象 / 组，拖框选择，⌘ 点击选后面的对象" onClick={() => setTool('V')}>
          V 选择
        </button>
        <button id="modeA" className={tool === 'A' ? 'on' : ''} title="直接选择工具 (A)：拖锚点和手柄" onClick={() => setTool('A')}>
          A 直接选择
        </button>
      </div>
      <div className="group">
        <button id="undo" disabled={!canUndo} title="撤销 (⌘Z)" onClick={() => (editor.undo(), view.selection.prune(editor.reader))}>
          撤销
        </button>
        <button id="redo" disabled={!canRedo} title="重做 (⇧⌘Z)" onClick={() => (editor.redo(), view.selection.prune(editor.reader))}>
          重做
        </button>
      </div>
      <div className="group">
        <button title="缩小 (⌘−)" onClick={() => view.zoomBy(1 / 1.25)}>−</button>
        <span className="zoom" id="zoomLabel">{Math.round(zoom * 100)}%</span>
        <button title="放大 (⌘+)" onClick={() => view.zoomBy(1.25)}>+</button>
        <button title="适合窗口 (⌘0)" onClick={() => view.fitToContent()}>适合</button>
      </div>
      <div className="group debug">
        <button id="unlock" title="样例文档：解锁「阴影」图层" onClick={() => ui.apply({ type: 'setContainerFlags', containerId: 'container:L2' as any, locked: false })}>
          解锁 L2
        </button>
        <label title="A 工具拖引用里的点时改源（否则写覆盖）">
          <input type="checkbox" id="src" onChange={(e) => (view.editSource = e.target.checked)} /> 在引用里改源
        </label>
      </div>
    </div>
  )
}

function Eye({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" strokeWidth="1.3" opacity={on ? 1 : 0.25} />
      {on ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  )
}
function Lock({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden opacity={on ? 1 : 0.25}>
      <rect x="3" y="7" width="10" height="7" rx="1" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" />
      <path d={on ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'} fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function LayersPanel({ ui }: { ui: Ui }) {
  const { editor, view } = ui
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const anchor = useRef<string | null>(null)
  const rows = useValue('layer rows', () => (void editor.revision, layerRows(editor.reader, (id) => !collapsed[id])), [editor, collapsed])
  const selected = useValue('selected ids', () => new Set(view.selection.get()), [view])
  const click = (row: LayerRow, e: RMouseEvent) => {
    // Figma / Finder list conventions: click selects, ⌘ / Ctrl+click toggles, Shift+click selects the range
    if (e.shiftKey && anchor.current) view.selection.set(rangeOf(rows, anchor.current, row.id))
    else if (e.metaKey || e.ctrlKey) view.selection.toggle(row.id)
    else view.selection.set([row.id])
    if (!e.shiftKey) anchor.current = row.id
  }
  return (
    <div className="panel layers" id="layersPanel">
      <div className="panel-title">图层</div>
      <div className="rows" role="tree">
        {rows.map((r) => (
          <div
            key={r.id}
            role="treeitem"
            aria-selected={selected.has(r.id)}
            data-id={r.id}
            className={`row ${selected.has(r.id) ? 'sel' : ''} ${r.hiddenBy || r.visible === false ? 'dim' : ''}`}
            style={{ paddingLeft: 4 + r.depth * 14 }}
            onClick={(e) => click(r, e)}
          >
            <span
              className="twisty"
              onClick={(e) => {
                e.stopPropagation()
                if (r.hasChildren) setCollapsed((c) => ({ ...c, [r.id]: !c[r.id] }))
              }}
            >
              {r.hasChildren ? (collapsed[r.id] ? '▸' : '▾') : ''}
            </span>
            <span className={`kind k-${r.kind}`} title={KIND_LABEL[r.kind]} />
            <span className="name">{r.name || r.id}</span>
            {r.kind === 'container' ? (
              <span className="flags">
                <button className="flag" data-flag="visible" title={r.visible ? '隐藏' : '显示'} onClick={(e) => (e.stopPropagation(), ui.apply({ type: 'setContainerFlags', containerId: r.id as any, visible: !r.visible }))}>
                  <Eye on={!!r.visible} />
                </button>
                <button className="flag" data-flag="locked" title={r.locked ? '解锁' : '锁定'} onClick={(e) => (e.stopPropagation(), ui.apply({ type: 'setContainerFlags', containerId: r.id as any, locked: !r.locked }))}>
                  <Lock on={!!r.locked} />
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

export function PropertiesPanel({ ui }: { ui: Ui }) {
  const { editor, view } = ui
  const info = useValue(
    'properties',
    () => {
      void editor.revision
      const ids = view.selection.get()
      const recs = ids.map((id) => editor.reader.get(id as any) as DocRecord | undefined).filter(Boolean) as DocRecord[]
      const masks = editor.reader.allRecords().filter((r): r is MaskRecord => r.typeName === 'mask')
      return { recs, masks }
    },
    [editor, view],
  )
  const { recs, masks } = info
  if (!recs.length)
    return (
      <div className="panel props" id="propsPanel">
        <div className="panel-title">属性</div>
        <div className="muted">未选择对象。V 点选或拖框选择，A 拖锚点。</div>
      </div>
    )
  if (recs.length > 1) {
    const count: Record<string, number> = {}
    for (const r of recs) count[r.typeName] = (count[r.typeName] ?? 0) + 1
    return (
      <div className="panel props" id="propsPanel">
        <div className="panel-title">属性</div>
        <div>已选 {recs.length} 个：{Object.entries(count).map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`).join('，')}</div>
      </div>
    )
  }
  const r = recs[0]
  const layer = layerOf(editor.reader, r.id)
  const layerName = layer ? (editor.reader.get(layer as any) as ContainerRecord | undefined)?.name : null
  const usedBy = masks.filter((m) => m.targets.includes(r.id) || m.sources.fills.includes(r.id as any) || m.sources.strokes.includes(r.id as any))
  return (
    <div className="panel props" id="propsPanel">
      <div className="panel-title">属性</div>
      <table>
        <tbody>
          <tr><th>类型</th><td>{KIND_LABEL[r.typeName] ?? r.typeName}</td></tr>
          <tr><th>名称</th><td>{'name' in r ? r.name : ''}</td></tr>
          <tr><th>id</th><td className="mono">{r.id}</td></tr>
          {layerName ? <tr><th>所在图层</th><td>{layerName}</td></tr> : null}
          {r.typeName === 'container' ? (
            <>
              <tr><th>显示</th><td><input type="checkbox" checked={(r as ContainerRecord).visible} onChange={(e) => ui.apply({ type: 'setContainerFlags', containerId: r.id as any, visible: e.target.checked })} /></td></tr>
              <tr><th>锁定</th><td><input type="checkbox" checked={(r as ContainerRecord).locked} onChange={(e) => ui.apply({ type: 'setContainerFlags', containerId: r.id as any, locked: e.target.checked })} /></td></tr>
            </>
          ) : null}
          {r.typeName === 'curve' ? (
            <>
              <tr><th>描边</th><td><span className="swatch" style={{ background: (r as CurveRecord).stroke.color }} /> {(r as CurveRecord).stroke.color}，宽 {fmt((r as CurveRecord).stroke.width)}</td></tr>
              <tr><th>锚点</th><td>{Object.keys((r as CurveRecord).anchors).length}{(r as CurveRecord).closed ? '（闭合）' : ''}</td></tr>
            </>
          ) : null}
          {r.typeName === 'fill' ? <tr><th>颜色</th><td><span className="swatch" style={{ background: (r as FillRecord).color }} /> {(r as FillRecord).color}</td></tr> : null}
          {r.typeName === 'reference' ? (
            <>
              <tr><th>源</th><td className="mono">{(r as ReferenceRecord).sourceId}</td></tr>
              <tr><th>变换</th><td className="mono">{Object.values((r as ReferenceRecord).transform).map(fmt).join(', ')}</td></tr>
            </>
          ) : null}
          {usedBy.length ? <tr><th>蒙版</th><td>{usedBy.map((m) => `${m.name}（${m.targets.includes(r.id) ? '被遮' : '作为来源'}${m.enabled ? '' : '，已关闭'}）`).join('；')}</td></tr> : null}
        </tbody>
      </table>
      {r.typeName !== 'container' ? <div className="muted small">只读：这些属性的修改入口在下一块（钢笔与命令入口）。</div> : null}
    </div>
  )
}

export function StatusBar({ status }: { status: Atom<string> }) {
  const s = useValue(status)
  return <div id="status">{s}</div>
}
