// 候选对比 (bowen 1792682677): each generated candidate placed by its own fit (uniform scale + shift, never deformed;
// bench-tasks/控制线-30-60/angle.py → fits.json) under the model drawn at the yaw it matches best. Saves one sheet. Glue.
import { PW, PH, panel } from './modelsheet'
const DIR = '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/' + encodeURI('控制线-30-60/')
const FITS: Record<string, { s: number; tx: number; ty: number; yaw: number; rms_x: number }> = await (await fetch(DIR + 'fits.json?t=' + Date.now())).json()
const pick = (new URLSearchParams(location.search).get('c') ?? 'yaw30-09,yaw30-04,yaw60-08,yaw60-09,yaw60-10,yaw60-07').split(',')
const load = (f: string) => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = DIR + encodeURI('候选/') + f + '.png' })
const cv = document.createElement('canvas'); cv.width = PW * pick.length; cv.height = PH; const g = cv.getContext('2d')!
for (const [i, name] of pick.entries()) {
  const f = FITS[name]!, img = await load(name)
  panel(g, i * PW, Math.round(f.yaw * 10) / 10, (gg, P) => { const [x0, y0] = P([f.tx, f.ty]), [x1, y1] = P([f.tx + img.width * f.s, f.ty + img.height * f.s]); gg.drawImage(img, x0, y0, x1 - x0, y1 - y0) })
  g.fillStyle = '#c00'; g.font = 'bold 40px "PingFang SC", system-ui'; g.fillText(`${name}：最贴 ${f.yaw}°（横向平均差 ${f.rms_x}）`, i * PW + 20, 115)
}
// a 3-column grid of the face region (panel y 420 … 1520) for viewing
const cols = 3, Y = 420, HH = 1100, grid = document.createElement('canvas'); grid.width = PW * cols; grid.height = HH * Math.ceil(pick.length / cols)
const gg = grid.getContext('2d')!; gg.fillStyle = '#fff'; gg.fillRect(0, 0, grid.width, grid.height)
pick.forEach((name, i) => { gg.drawImage(cv, i * PW, Y, PW, HH, (i % cols) * PW, Math.floor(i / cols) * HH, PW, HH); gg.fillStyle = '#c00'; gg.font = 'bold 44px "PingFang SC", system-ui'
  gg.fillText(`${name}：最贴 ${FITS[name]!.yaw}°（横向平均差 ${FITS[name]!.rms_x}）`, (i % cols) * PW + 20, Math.floor(i / cols) * HH + 50); gg.strokeStyle = '#999'; gg.strokeRect((i % cols) * PW, Math.floor(i / cols) * HH, PW, HH) })
await fetch('http://127.0.0.1:5199/save?name=' + encodeURIComponent('对比网格.png'), { method: 'POST', body: grid.toDataURL('image/png') })
const r = await (await fetch('http://127.0.0.1:5199/save?name=' + encodeURIComponent('对比-' + pick.join('_') + '.png'), { method: 'POST', body: cv.toDataURL('image/png') })).text()
const view = document.getElementById('view') as HTMLImageElement; view.src = cv.toDataURL(); document.getElementById('status')!.textContent = 'saved: ' + r
