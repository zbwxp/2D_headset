import { defineConfig } from 'vite'
// JSX of the panels (src/ui/*.tsx): React's automatic runtime, compiled by Vite's esbuild (no plugin needed)
export default defineConfig({ server: { port: 5179, strictPort: true }, esbuild: { jsx: 'automatic' } })
