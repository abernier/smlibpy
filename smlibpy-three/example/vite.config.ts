// The example page (npm run example): the package from its sources, smlibwasm (and its
// WebAssembly kernel) from the repository's js/ folder, which Vite must leave as it is.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: { '@classcad/smlibpy-three': fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
  },
  // (its prebundling would lose the kernel's WebAssembly file next to it)
  optimizeDeps: { exclude: ['@classcad/smlibwasm'] },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
})
