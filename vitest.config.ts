import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'interaction/test/**/*.test.ts', 'visual/test/**/*.test.ts', 'autosave/test/**/*.test.ts', 'rename/test/**/*.test.ts', 'cursor/test/**/*.test.ts', 'pose-pad/test/**/*.test.ts', 'name-labels/test/**/*.test.ts'] } })
