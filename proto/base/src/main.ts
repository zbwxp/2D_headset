// Slice page: one Editor, one Fabric projection, and the AI API exposed on window for parity tests.
import { counters, resetCounters } from './counters'
import { createApi } from './api'
import { Editor } from './editor'
import { evaluate } from './evaluate'
import { exampleRecords, ids } from './fixture'
import { FabricView } from './view/fabricView'
import { runScopeA } from './bench'
import { onionYaws, syntheticPoses, syntheticRecords } from './synthetic'

const params = new URLSearchParams(location.search)
const bench = params.has('bench')
const benchShapes = bench ? syntheticRecords({ curves: Number(params.get('curves') ?? 121), layers: 8, fills: 15 }) : []
const benchRecords = [...benchShapes, ...syntheticPoses(benchShapes)]
const editor = new Editor(bench ? benchRecords : exampleRecords())
const api = createApi(editor)
const statusEl = document.getElementById('status')!
const view = new FabricView(document.getElementById('c') as HTMLCanvasElement, editor, (s) => (statusEl.textContent = s))

const $ = (id: string) => document.getElementById(id)!
$('modeA').onclick = () => view.setMode('A')
$('modeV').onclick = () => view.setMode('V')
$('unlock').onclick = () => {
  api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
  view.render()
}
$('undo').onclick = () => (editor.undo(), view.render())
$('redo').onclick = () => (editor.redo(), view.render())
;($('src') as HTMLInputElement).onchange = (e) => (view.editSource = (e.target as HTMLInputElement).checked)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') view.cancelGesture()
})

const onionCount = Number(params.get('onion') ?? 0)
if (bench && onionCount) {
  view.onion = { yaws: onionYaws(onionCount) }
  view.render()
}
Object.assign(window, {
  __contour: { editor, api, view, evaluate, ids, counters, resetCounters },
  __bench: { scopeA: (n: number, samples = 48) => runScopeA(editor, n ? onionYaws(n) : [], samples) },
})
