import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/fixtures/recording-renderer-benchmark-single-curve.test.ts'],maxWorkers:1,testTimeout:30000},esbuild:{jsx:'automatic'}});
