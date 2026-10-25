// Finishes the package's type declarations (npm run build, after tsc): the modules at the kernel's
// boundary (kernel, convert, tessellation) are the package's own business, so their declarations
// go, and no declaration that stays may name them or smlibwasm: an app compiles against three's
// types and this package's only. `node scripts/declarations.mjs <dir>` works on <dir>.
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url))
const INTERNAL = ['kernel', 'convert', 'tessellation']
for (const name of INTERNAL) rmSync(`${dir}/${name}.d.ts`, { force: true })
const named = new RegExp(`from '\\./(${INTERNAL.join('|')})\\.(ts|js)'|import\\('\\./(${INTERNAL.join('|')})\\.(ts|js)'\\)|@classcad/smlibwasm`)
const bad = readdirSync(dir).filter((f) => f.endsWith('.d.ts') && named.test(readFileSync(`${dir}/${f}`, 'utf8')))
if (bad.length) {
  console.error(`declarations that name the kernel's modules or smlibwasm: ${bad.join(', ')}`)
  process.exit(1)
}
console.log(`${dir}: ${readdirSync(dir).filter((f) => f.endsWith('.d.ts')).length} declaration files, none naming smlibwasm`)
