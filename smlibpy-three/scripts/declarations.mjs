// Finishes the package's type declarations (npm run build, after tsc): the modules at the kernel's
// boundary (kernel, convert, tessellation) are the package's own business, so their declarations
// go, and no declaration that stays may name them or smlibwasm: an app compiles against three's
// types and this package's only. A file that names `Symbol.dispose` references the lib that
// declares it (esnext.disposable), so that an app whose `lib` is older type-checks the package.
// `node scripts/declarations.mjs <dir>` works on <dir>.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url))
const INTERNAL = ['kernel', 'convert', 'tessellation']
for (const name of INTERNAL) rmSync(`${dir}/${name}.d.ts`, { force: true })
const DISPOSABLE = '/// <reference lib="esnext.disposable" />\n'
for (const f of readdirSync(dir).filter((f) => f.endsWith('.d.ts'))) {
  const text = readFileSync(`${dir}/${f}`, 'utf8')
  if (text.includes('Symbol.dispose') && !text.startsWith(DISPOSABLE)) writeFileSync(`${dir}/${f}`, DISPOSABLE + text)
}
const named = new RegExp(`from '\\./(${INTERNAL.join('|')})\\.(ts|js)'|import\\('\\./(${INTERNAL.join('|')})\\.(ts|js)'\\)|@classcad/smlibwasm`)
const bad = readdirSync(dir).filter((f) => f.endsWith('.d.ts') && named.test(readFileSync(`${dir}/${f}`, 'utf8')))
if (bad.length) {
  console.error(`declarations that name the kernel's modules or smlibwasm: ${bad.join(', ')}`)
  process.exit(1)
}
console.log(`${dir}: ${readdirSync(dir).filter((f) => f.endsWith('.d.ts')).length} declaration files, none naming smlibwasm`)
