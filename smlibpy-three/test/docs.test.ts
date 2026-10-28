// The package's page of smlibpy's documentation, docs/three.md: its examples run as written, on the
// package's sources, and print what they say they print (a `console.log(...) // value` prints
// value); its API section is the one `npm run api` writes (CI writes it again after the build and
// compares).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const page = readFileSync(new URL('../../docs/three.md', import.meta.url), 'utf8')
const src = (name: string) => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href)
// (the API section's blocks are declarations: ```ts)
const blocks = [...page.matchAll(/```js\n([^]*?)```/g)].map((m) => m[1])
// blocks that are not a program of their own, by their first line
const SKIP = ['// vite.config.js'] // (a bundler's configuration)

test('the examples of docs/three.md run and print what they say', () => {
  let ran = 0
  for (const block of blocks) {
    if (SKIP.some((first) => block.startsWith(first))) continue
    const code = block
      .replace(/'@classcad\/smlibpy-three\/(worker|init)'/g, (_, entry) => src(`${entry}.ts`))
      .replaceAll("'@classcad/smlibpy-three'", src('index.ts'))
    // (run where the package is, so that 'three' is the package's three)
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 120_000,
    })
    assert.equal(out.status, 0, `${block}\n${out.stderr}`)
    const said = [...block.matchAll(/console\.log\(.*\) \/\/ (.*)$/gm)].map((m) => m[1])
    const printed = out.stdout.trim().split('\n')
    assert.equal(printed.length, said.length, `${block}\nprinted:\n${out.stdout}`)
    said.forEach((s, i) => assert.equal(printed[i], s, `${block}\nprinted ${printed[i]}, the page says ${s}`))
    ran++
  }
  assert.ok(ran >= 1, `${ran} blocks ran`)
})

test('docs/three.md has the API section of every export, and links only to headings it has', () => {
  const api = page.split('\n## API\n')[1]
  assert.ok(api, 'docs/three.md has no "## API" section')
  // every export of the package's entry has its heading there
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const exported = [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((m) =>
    m[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1) as string).filter(Boolean),
  )
  const headings = new Set([...api.matchAll(/^#### (\S+)$/gm)].map((m) => m[1]))
  const missing = exported.filter((name) => !headings.has(name))
  assert.deepEqual(missing, [], 'exports without a heading in the API section (npm run build, then npm run api)')
  // the page's own links (#anchor) go to headings of the page, as MkDocs and the site make them
  const anchors = new Set(
    [...page.matchAll(/^#{1,4} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')),
  )
  const links = [...page.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1])
  assert.deepEqual(links.filter((a) => !anchors.has(a)), [], 'links to headings the page does not have')
})
