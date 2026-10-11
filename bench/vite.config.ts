import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// hmr off (bowen 1791703582): a code change saved while the bench is open must not swap modules in
// the running page. The drawing lives in app.tsx's module scope and interaction in a React ref, so a
// hot swap split them and the Pen drew into a drawing no longer shown. New code arrives on a refresh.
export default defineConfig({ plugins: [react()], resolve: { dedupe: ['react', 'react-dom'] }, server: { port: 5190, hmr: false, fs: { allow: ['..'] } } })
