import { defineConfig } from 'vitest/config'
// testTimeout: the workload tests (yaw.test.ts) take ~1.5 s alone and assert COUNTS, not times; with the stage 1–2
// suites running in parallel they can pass 5 s from CPU contention alone (measured: 1441 ms on 4ce06df vs 1477 ms
// now, run alone). A longer limit, not a changed assertion.
export default defineConfig({ test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 20000 } })
