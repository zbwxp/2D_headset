// The bench's entry: mounts the app (src/app.tsx).
import { createRoot } from 'react-dom/client'
import { App } from './app'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
import.meta.hot?.dispose(() => root.unmount())
