import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'interaction/test/**/*.test.ts', 'visual/test/**/*.test.ts'] } })
