// Runs before npm pack and npm publish: the package holds the WebAssembly module (npm run wasm
// builds it), the TypeScript compiled afresh to dist, and the repository's license texts.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'

const js = new URL('..', import.meta.url)
for (const file of ['wasm/smlibjs.mjs', 'wasm/smlibjs.wasm'])
  if (!existsSync(new URL(file, js))) throw new Error(`${file} is missing: run npm run wasm first`)
rmSync(new URL('dist', js), { recursive: true, force: true })
execFileSync('npm', ['run', 'build'], { cwd: js, stdio: 'inherit' })
cpSync(new URL('../LICENSE', js), new URL('LICENSE', js))
cpSync(new URL('../third_party/usd-brep/LICENSE', js), new URL('LICENSE.usd-brep', js))
