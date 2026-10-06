// Onion-skin benchmark (15 §2 / §5). Prints numbers; asserts nothing about speed.
// Two scopes reported separately and never mixed: (A) old report's "target construction + synchronous
// display" (no input dispatch / transaction / inverse); (B) pointermove → first animation frame after our
// render during a real mouse drag in A mode. Machine and browser differ from the old report.
import { expect, test } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'

const results: Record<string, unknown> = {
  machine: { platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0]?.model, cores: os.cpus().length },
  workload: '121 synthetic open curves (3 segments each), 8 layers, chained connections, 15 closed-loop fills; single-handle edit',
}

for (const onion of [0, 19]) {
  test(`scope A, onion=${onion}`, async ({ page, browserName }) => {
    await page.goto('/?bench')
    await page.waitForFunction(() => (window as any).__bench)
    const r = await page.evaluate((n) => (window as any).__bench.scopeA(n, 48), onion)
    results[`scopeA_onion${onion}`] = { browser: browserName, ...r }
    console.log(`[bench] scope A onion=${onion}`, JSON.stringify(r))
    expect(r.total.n).toBe(48)
  })

  test(`scope B (input → frame), onion=${onion}`, async ({ page }) => {
    await page.goto(`/?bench&onion=${onion}`)
    await page.waitForFunction(() => (window as any).__contour)
    const box = (await page.locator('canvas.upper-canvas').boundingBox())!
    // curve S12 p1 anchor sits at (x0+5, y0+4) with x0 = 18, y0 = 14  → scene (23, 18)
    const sx = box.x + 150 + 23 * 3
    const sy = box.y + 60 + 18 * 3
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i, sy + (i % 5))
    await page.mouse.up()
    const lat: number[] = await page.evaluate(() => (window as any).__contour.view.latencies)
    const s = [...lat].sort((a, b) => a - b)
    const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)
    const r = { p50: q(0.5), p95: q(0.95), n: s.length }
    results[`scopeB_onion${onion}`] = r
    console.log(`[bench] scope B onion=${onion}`, JSON.stringify(r))
    expect(r.n).toBeGreaterThan(20)
  })
}

test.afterAll(() => {
  mkdirSync('bench-results', { recursive: true })
  writeFileSync(`bench-results/onion-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(results, null, 2))
})
