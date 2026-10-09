import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// the visual package (../visual) uses React from here: resolve it from the bench, one copy
export default defineConfig({ plugins: [react()], resolve: { dedupe: ['react', 'react-dom'] }, server: { port: 5190, fs: { allow: ['..'] } } })
