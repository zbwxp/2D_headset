// Slice page: one Editor, one Fabric projection, and the AI API exposed on window for parity tests.
import { createApi } from './api'
import { Editor } from './editor'
import { evaluate } from './evaluate'
import { ids, loadExample } from './fixture'
import { FabricView } from './view/fabricView'
import { runScopeA } from './bench'
import { onionYaws, syntheticRecords, syntheticTrack } from './synthetic'

const params = new URLSearchParams(location.search)
const bench = params.has('bench')
const editor = new Editor()
const benchRecords = bench ? syntheticRecords({ curves: 121, layers: 8, fills: 15 }) : []
if (bench) editor.store.put(benchRecords)
else loadExample(editor.store)
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

const track = syntheticTrack(benchRecords)
const onionCount = Number(params.get('onion') ?? 0)
if (bench && onionCount) {
  view.onion = { track, yaws: onionYaws(onionCount) }
  view.render()
}
Object.assign(window, {
  __contour: { editor, api, view, evaluate, ids },
  __bench: { scopeA: (n: number, samples = 48) => runScopeA(editor, track, n ? onionYaws(n) : [], samples) },
})
