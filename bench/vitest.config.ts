import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config'
export default mergeConfig(base, defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.tsx'] } }))
