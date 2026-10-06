// Slice page: one Editor, one Fabric projection, and the AI API exposed on window for parity tests.
import { counters, resetCounters } from './counters'
import { createApi } from './api'
import { Editor } from './editor'
import { evaluate, hitTest } from './evaluate'
import { exampleRecords, ids } from './fixture'
import { FabricView } from './view/fabricView'
import { runScopeA } from './bench'
import { onionYaws, syntheticPoses, syntheticRecords } from './synthetic'
import { paintCases } from './paintCases'

const params = new URLSearchParams(location.search)
const bench = params.has('bench')
const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined)
const benchShapes = bench
  ? syntheticRecords({ curves: num('curves') ?? 121, layers: 8, fills: num('fills') ?? 15, fillSize: num('fillSize'), fillSpacing: num('fillSpacing'), fillCols: num('fillCols') })
  : []
const benchRecords = [...benchShapes, ...syntheticPoses(benchShapes)]
// ?case=<name>: one of the paint-order contract's small documents (PAINT-ORDER.md §2)
const paintCase = params.has('case') ? paintCases[params.get('case')!] : undefined
if (params.has('case') && !paintCase) throw Error(`unknown case ${params.get('case')}`)
const editor = new Editor(paintCase ? paintCase.records() : bench ? benchRecords : exampleRecords())
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

// benchmark documents are fitted to the canvas, so every item is on screen (Fabric skips off-screen
// objects; measuring a mostly off-screen drawing would understate the real cost)
if (bench) view.fitToContent()
if (paintCase) (view.canvas.setViewportTransform([3, 0, 0, 3, 20, 20]), view.render())
// ?renderer=b: draw A-mode scenes with the Canvas2D reference path (same output) instead of Fabric
if (params.get('renderer') === 'b') view.useCanvas2DRef()
const onionCount = Number(params.get('onion') ?? 0)
if (bench && onionCount) {
  view.onion = { yaws: onionYaws(onionCount) }
  view.render()
}
Object.assign(window, {
  __contour: { editor, api, view, evaluate, hitTest, ids, counters, resetCounters, paintCase },
  __bench: { scopeA: (n: number, samples = 48) => runScopeA(editor, n ? onionYaws(n) : [], samples) },
})
