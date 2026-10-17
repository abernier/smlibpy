import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app goes into the Python package (src/smlibpy/mcp/app), which serves it next to its session. Relative
// addresses: it works wherever the session server puts it.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'] },
  build: { outDir: '../src/smlibpy/mcp/app', emptyOutDir: true },
})
