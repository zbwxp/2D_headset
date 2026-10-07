// Operation help (bowen 1791349917; dot 1791349994 / 1791350016): context help that never covers the drawing.
// - a one-line hint BELOW the canvas that follows the tool, the selection and the step in progress — Inkscape's status
//   bar (https://wiki.inkscape.org/wiki/Statusbar_API);
// - a collapsible, closable 「工具说明」 in the side panel for the current tool (Illustrator's on-demand tool help,
//   https://adobe.design/ideas/designing-adobe-illustrator-s-rich-tooltips); closed → the toolbar's「？」 opens it again;
//   the state is remembered per browser (localStorage, best effort).
// Only operations that exist are listed.
import { atom } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'
import type { Tool, Ui } from './panels'

type Phase = 'idle' | 'pen' | 'marquee' | 'marquee-enclosed' | 'move' | 'transform' | 'drag'

/** the hint line for a tool, how much is selected and the step in progress */
export function hintLine(tool: Tool, phase: Phase, selected: number, anchors: number): string {
  if (phase === 'marquee' || phase === 'marquee-enclosed')
    return `拖框中：${phase === 'marquee' ? '碰到就选' : '完全框进才选'} · 按 E 切换 · Shift 追加 · 松开完成`
  if (phase === 'move') return '移动中：Shift 限制在 45° · Esc 取消 · 松开完成'
  if (phase === 'transform') return '变换中：拖角点缩放（Shift 等比）· 拖上方手柄旋转 · Esc 取消'
  if (phase === 'drag') return '拖动锚点 / 手柄中 · Esc 取消 · 松开完成'
  if (phase === 'pen') return '继续点 = 角点，拖 = 平滑点（Shift 45°）· 点起点闭合 · Enter / Esc 结束 · ⌘Z 去掉最后一点'
  switch (tool) {
    case 'V':
      return selected
        ? `已选 ${selected} 个 · 拖动 = 移动 · 拖手柄 = 缩放 / 旋转 · 方向键微移（Shift ×10）· Delete 删除 · ⌘C / ⌘X / ⌘V · ⌘G 编组 · ⌘] / ⌘[ 排列 · ⌘7 蒙版`
        : '点选对象（组整体）· 空白处拖 = 框选 · Shift 加 / 减选 · ⌘ 点击 = 选后面的 · 空格拖动平移 · ⌘ + 滚轮缩放'
    case 'A':
      return anchors
        ? `已选 ${anchors} 个锚点 · 拖动一起移动 · Delete 删除 · ⌘J 连接两个端点 · Shift 点击加 / 减选`
        : '点锚点选中（Shift 加选）· 拖锚点 / 手柄（平滑点两边一起转，⌥ 只动一边）· 空白处拖框选锚点 · 点线 = 选这条线'
    case 'P':
      return '点 = 角点，拖 = 平滑点 · 点开放路径的端点 = 接着画 · 在选中的路径上：点线段加点、点锚点删点'
    case '+':
      return '点在线段上 = 加一个锚点'
    case '-':
      return '点在锚点上 = 删除它（两边接上；端点连同线段删除）'
    case 'C':
      return '点在锚点上 = 在那里剪断 · 点在线段上 = 在那里加点并剪断'
    case 'N':
      return '点锚点 = 变尖角（收起手柄）· 从锚点拖出 = 变平滑（拉出对称手柄）· 拖一个手柄 = 只动这一边'
    case 'K':
      return '点在线围起来的区域里 = 用当前填充色填上（已填的就改颜色）· 线要在锚点处相接'
  }
}

const TOOL_HELP: Record<Tool, { title: string; items: string[] }> = {
  V: { title: 'V 选择', items: ['点一下选对象；组里的东西会选中整组', '空白处拖出框选择；拖的时候按一次 E 切换「完全框进才选」', 'Shift 点击加选 / 减选；⌘ 点击选被挡在后面的对象', '拖动移动（Shift 限 45°）；拖外框手柄缩放、拖上方手柄旋转', '方向键微移（Shift ×10）；Delete 删除'] },
  A: { title: 'A 直接选择', items: ['点锚点选中，Shift 加选；空白处拖框选锚点', '拖锚点或手柄改形状；选中的锚点一起移动', '平滑点的手柄两边一起转；按住 ⌥ 拖就只动一边', 'Delete 删除选中的锚点；⌘J 连接两个端点（同一条线就闭合）'] },
  P: { title: 'P 钢笔', items: ['点 = 角点，按住拖 = 平滑点；Shift 限 45°', '点回起点闭合；Enter / Esc 结束；画的时候 ⌘Z 退一点', '点一条开放线的端点 = 从那里接着画', '在选中的线上：点线段加点，点锚点删点'] },
  '+': { title: '+ 加点', items: ['点在线段上加一个锚点（形状不变）'] },
  '-': { title: '− 删点', items: ['点在锚点上删除它，两边连起来', '点端点会连同那一段一起删除'] },
  C: { title: 'C 剪刀', items: ['点锚点：在那里把线剪成两条', '点线段：先加点再剪断，一次撤销'] },
  N: { title: '⇧C 转换锚点', items: ['点一下锚点：变成尖角（两边手柄收起）', '从锚点拖出：变成平滑点（拉出两边对称的手柄）', '拖一个手柄：只动这一边（两边分开）', 'A 工具里拖平滑点的手柄会两边一起转；按住 ⌥ 拖就只动一边'] },
  K: { title: 'K 填充', items: ['在线围起来的区域里点一下，用工具栏的填充色填上', '已经填过的区域点一下就换成当前颜色', '线要在锚点处相接（或在同一个位置）；只是交叉不算：在交点用 + 加点，或 ⌘J 连接端点', '新填充放在围住它的线下面，线照样显示'] },
}
const GENERAL = ['吸附 ⌘U：画点、拖锚点、移动时吸到别的锚点，或和它们水平 / 竖直对齐（粉色标记）', '⌘Z 撤销 · ⇧⌘Z 重做', '⌘S 保存 · ⌘O 打开 · 新建在工具栏', '⌘C / ⌘X / ⌘V 复制剪切粘贴（⇧⌘V 原位）', '空格拖动平移 · ⌘ + 滚轮缩放 · ⌘0 适合窗口', '双击图层名改名']

type HelpState = 'open' | 'collapsed' | 'closed'
const KEY = 'contour.toolHelp'
const read = (): HelpState => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'collapsed' || v === 'closed' ? v : 'open'
  } catch {
    return 'open'
  }
}
/** the help section's state, remembered (best effort: private windows may refuse storage) */
export const helpState = atom<HelpState>('tool help', read())
export function setHelp(s: HelpState) {
  helpState.set(s)
  try {
    localStorage.setItem(KEY, s)
  } catch {
    // not stored: still works for this page
  }
}

export function HintLine({ ui }: { ui: Ui }) {
  const tool = useValue(ui.tool)
  const phase = useValue(ui.view.phase)
  const selected = useValue('selected count', () => ui.view.selection.get().length, [ui])
  const anchors = useValue('anchor count', () => ui.view.selection.getAnchors().length, [ui])
  return <div id="hint">{hintLine(tool, phase, selected, anchors)}</div>
}

export function ToolHelp({ ui }: { ui: Ui }) {
  const tool = useValue(ui.tool)
  const state = useValue(helpState)
  if (state === 'closed') return null
  const h = TOOL_HELP[tool]
  return (
    <div className="panel help" id="toolHelp" data-state={state}>
      <div className="panel-title with-actions">
        <span className="help-title" onClick={() => setHelp(state === 'open' ? 'collapsed' : 'open')} title={state === 'open' ? '折叠' : '展开'}>
          {state === 'open' ? '▾' : '▸'} 工具说明 · {h.title}
        </span>
        <span className="title-actions">
          <button id="helpClose" title="关闭（工具栏「？」可再打开）" onClick={() => setHelp('closed')}>×</button>
        </span>
      </div>
      {state === 'open' ? (
        <div className="help-body">
          <ul>{h.items.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="muted small">通用：{GENERAL.join(' · ')}</div>
        </div>
      ) : null}
    </div>
  )
}

export function HelpButton() {
  const state = useValue(helpState)
  return (
    <button id="helpOpen" className={state !== 'closed' ? 'on' : ''} title="工具说明" onClick={() => setHelp(state === 'closed' ? 'open' : 'closed')}>
      ？
    </button>
  )
}
