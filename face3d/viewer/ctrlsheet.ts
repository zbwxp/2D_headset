// 控制线图 30° / 60° (bowen 1792682677): renders the sheets with modelsheet.ts and saves them (glue)
import { PW, PH, SRC, panel, refPanel } from './modelsheet'
const load = (f: string) => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = SRC + f })
const imgs: Record<number, HTMLImageElement> = { 0: await load('yaw00-09.png'), 45: await load('yaw45-11.png'), 90: await load('yaw90-11.png') }
const save = async (cv: HTMLCanvasElement, name: string) => (await fetch('http://127.0.0.1:5199/save?name=' + encodeURIComponent(name), { method: 'POST', body: cv.toDataURL('image/png') })).text()
const out: string[] = []
for (const yaw of [30, 60]) { const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; panel(cv.getContext('2d')!, 0, yaw); out.push(await save(cv, `控制线-yaw${yaw}.png`)) }
const strip = document.createElement('canvas'); strip.width = PW * 5; strip.height = PH; const gs = strip.getContext('2d')!
;[0, 30, 45, 60, 90].forEach((yaw, i) => (yaw % 45 === 0 ? refPanel(gs, i * PW, yaw, imgs[yaw]!) : panel(gs, i * PW, yaw)))
out.push(await save(strip, '五联-0-30-45-60-90.png'))
const view = document.getElementById('view') as HTMLImageElement; view.src = strip.toDataURL(); document.getElementById('status')!.textContent = 'saved: ' + out.join(', ')
