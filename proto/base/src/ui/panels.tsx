// Editor skeleton block 1 — toolbar, layers panel, properties panel (React, as the product; reactive reads through
// @tldraw/state-react `useValue`, the same signals the document and the selection already are). Layout and behaviour
// follow Illustrator / Figma defaults; nothing here writes the document except through `editor.apply` commands.
import { atom, type Atom } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'
import { useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import type { Command } from '../commands'
import type { Editor } from '../editor'
import { layerOf } from '../selection'
import type { ContainerRecord, CurveRecord, DocRecord, FillRecord, MaskRecord, ReferenceRecord } from '../schema'
import type { FabricView, Tool as ViewTool } from '../view/fabricView'
import { layerRows, rangeOf, type LayerRow } from './layerTree'
import type { Files } from './files'

export type Tool = ViewTool
export type Ui = { editor: Editor; view: FabricView; tool: Atom<Tool>; zoom: Atom<number>; apply: (cmd: Command) => void; files: Files }
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
  const fileName = useValue(ui.files.name)
  const dirty = useValue('dirty', () => editor.isDirty, [editor])
  return (
    <div className="toolbar">
      <div className="group">
        <button id="fileOpen" title="打开 (⌘O)" onClick={() => void ui.files.open()}>打开</button>
        <button id="fileSave" title="保存 (⌘S)" onClick={() => void ui.files.save()}>保存</button>
        <button id="fileSaveAs" title="另存为 (⇧⌘S)" onClick={() => void ui.files.save(true)}>另存为</button>
        <span id="fileName" className="file" title={dirty ? '有未保存的修改' : '已保存'}>{dirty ? '● ' : ''}{fileName ?? '未命名'}</span>
      </div>
      <div className="group">
        <button id="modeV" className={tool === 'V' ? 'on' : ''} title="选择工具 (V)：点选对象 / 组，拖框选择，⌘ 点击选后面的对象" onClick={() => setTool('V')}>
          V 选择
        </button>
        <button id="modeA" className={tool === 'A' ? 'on' : ''} title="直接选择工具 (A)：点选 / 框选锚点，拖锚点和手柄" onClick={() => setTool('A')}>
          A 直接选择
        </button>
        <button id="modeP" className={tool === 'P' ? 'on' : ''} title="钢笔 (P)：点 = 角点，拖 = 平滑点，点起点闭合，Enter / Esc 结束；在选中的路径上点 = 加点 / 删点" onClick={() => setTool('P')}>
          P 钢笔
        </button>
        <button id="modeAdd" className={tool === '+' ? 'on' : ''} title="添加锚点 (+)：点在线段上" onClick={() => setTool('+')}>
          + 加点
        </button>
        <button id="modeDel" className={tool === '-' ? 'on' : ''} title="删除锚点 (−)：点在锚点上，两边连起来" onClick={() => setTool('-')}>
          − 删点
        </button>
        <button id="modeC" className={tool === 'C' ? 'on' : ''} title="剪刀 (C)：点在锚点或线段上剪断" onClick={() => setTool('C')}>
          C 剪刀
        </button>
        <button id="join" title="连接 (⌘J)：A 选两个端点 → 连接（同一条线则闭合）；V 选一条开放路径 → 闭合" onClick={() => view.join()}>
          连接
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
  const [renaming, setRenaming] = useState<string | null>(null)
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
            {renaming === r.id ? (
              <input
                className="rename"
                data-rename={r.id}
                autoFocus
                defaultValue={r.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setRenaming(null)
                  if (e.target.value.trim() && e.target.value !== r.name) ui.apply({ type: 'setProps', id: r.id, name: e.target.value })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    ;(e.currentTarget as HTMLInputElement).value = r.name
                    setRenaming(null)
                  }
                }}
              />
            ) : (
              <span className="name" title="双击改名" onDoubleClick={(e) => (e.stopPropagation(), setRenaming(r.id))}>{r.name || r.id}</span>
            )}
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
/** #rgb → #rrggbb (what a colour input shows) */
const hex6 = (c: string) => (/^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c)

/** A text field that writes once: Enter or leaving the field commits a change, Esc puts the value back (one undo step). */
function CommitInput({ value, onCommit, prop, type = 'text', step }: { value: string; onCommit: (v: string) => void; prop: string; type?: 'text' | 'number'; step?: number }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v !== value) onCommit(v)
  }
  return (
    <input
      data-prop={prop}
      type={type}
      step={step}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(value)
          e.stopPropagation()
        }
      }}
    />
  )
}

/** A colour well that writes when the picker is closed (the native `change`), not on every drag of the picker. */
function ColorInput({ value, onCommit, prop }: { value: string; onCommit: (v: string) => void; prop: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current!
    const h = () => el.value !== hex6(value).toLowerCase() && onCommit(el.value)
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [value, onCommit])
  return <input ref={ref} data-prop={prop} type="color" key={value} defaultValue={hex6(value)} />
}

function AnchorsSection({ ui }: { ui: Ui }) {
  const { editor, view } = ui
  const info = useValue(
    'selected anchors',
    () => {
      void editor.revision
      return view.selection.getAnchors().flatMap((k) => {
        const [c, a] = k.split('#')
        const curve = editor.reader.get(c as any) as CurveRecord | undefined
        const an = curve?.anchors[a]
        if (!curve || !an) return []
        const conns = editor.reader.allRecords().filter((r: any) => r.typeName === 'connection' && r.ends.some((e: any) => e.curveId === c && e.anchorId === a)) as any[]
        const end = !curve.closed && (!curve.segments.some((s) => s.to === a) || !curve.segments.some((s) => s.from === a))
        return [{ key: k, name: curve.name, p: an.p, end, conns: conns.map((x) => ({ id: x.id as string, with: x.ends.filter((e: any) => !(e.curveId === c && e.anchorId === a)).map((e: any) => `${(editor.reader.get(e.curveId) as any)?.name ?? e.curveId}#${e.anchorId}`) })) }]
      })
    },
    [editor, view],
  )
  if (!info.length) return null
  return (
    <div className="anchors" id="anchorsSection">
      <div className="sub">锚点（{info.length}）</div>
      {info.map((a) => (
        <div key={a.key} className="anchor-row" data-anchor={a.key}>
          <span className="mono">{a.name}#{a.key.split('#')[1]}</span> ({fmt(a.p.x)}, {fmt(a.p.y)}){a.end ? ' 端点' : ''}
          {a.conns.map((c) => (
            <div key={c.id} className="conn">
              连着 {c.with.join('、')} <button data-unbind={c.id} title="断开这个连接点（两边各留一个端点）" onClick={() => view.unbind(c.id)}>断开</button>
            </div>
          ))}
        </div>
      ))}
      <div className="actions">
        <button id="anchorDelete" title="删除锚点和它的线段 (Delete)" onClick={() => view.deleteSelectedAnchors()}>删除</button>
        {info.length === 1 && !info[0].end ? <button id="anchorRemoveJoin" title="删除锚点，两边连起来（− 工具）" onClick={() => view.deleteAnchor(info[0].key.split('#')[0], info[0].key.split('#')[1])}>删点并接上</button> : null}
        {info.length === 1 && !info[0].end ? <button id="anchorCut" title="在这个锚点剪断（C 工具）" onClick={() => ui.apply({ type: 'breakAt', curveId: info[0].key.split('#')[0] as any, anchorId: info[0].key.split('#')[1] })}>剪断</button> : null}
        {info.length === 2 && info.every((a) => a.end) ? <button id="anchorJoin" title="连接两个端点 (⌘J)" onClick={() => view.join()}>连接</button> : null}
      </div>
    </div>
  )
}

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
        <AnchorsSection ui={ui} />
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
          <tr><th>名称</th><td>{'name' in r ? <CommitInput prop="name" value={r.name} onCommit={(v) => ui.apply({ type: 'setProps', id: r.id, name: v })} /> : ''}</td></tr>
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
              <tr><th>描边</th><td className="inline">
                <ColorInput prop="strokeColor" value={(r as CurveRecord).stroke.color} onCommit={(v) => ui.apply({ type: 'setProps', id: r.id, stroke: { color: v } })} />
                <span>宽</span>
                <CommitInput prop="strokeWidth" type="number" step={0.5} value={fmt((r as CurveRecord).stroke.width)} onCommit={(v) => ui.apply({ type: 'setProps', id: r.id, stroke: { width: Number(v) } })} />
              </td></tr>
              <tr><th>锚点</th><td>{Object.keys((r as CurveRecord).anchors).length}{(r as CurveRecord).closed ? '（闭合）' : ''}</td></tr>
            </>
          ) : null}
          {r.typeName === 'fill' ? <tr><th>颜色</th><td><ColorInput prop="fillColor" value={(r as FillRecord).color} onCommit={(v) => ui.apply({ type: 'setProps', id: r.id, color: v })} /></td></tr> : null}
          {r.typeName === 'reference' ? (
            <>
              <tr><th>源</th><td className="mono">{(r as ReferenceRecord).sourceId}</td></tr>
              <tr><th>变换</th><td className="mono">{Object.values((r as ReferenceRecord).transform).map(fmt).join(', ')}</td></tr>
            </>
          ) : null}
          {usedBy.length ? <tr><th>蒙版</th><td>{usedBy.map((m) => `${m.name}（${m.targets.includes(r.id) ? '被遮' : '作为来源'}${m.enabled ? '' : '，已关闭'}）`).join('；')}</td></tr> : null}
        </tbody>
      </table>
      <AnchorsSection ui={ui} />
      {r.typeName === 'reference' ? <div className="muted small">引用的源和变换在画布上改（V 移动 / 变换框）。</div> : null}
    </div>
  )
}

export function StatusBar({ status }: { status: Atom<string> }) {
  const s = useValue(status)
  return <div id="status">{s}</div>
}
