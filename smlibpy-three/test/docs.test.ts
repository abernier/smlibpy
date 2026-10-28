// The package's pages of smlibpy's documentation: the guide, docs/three.md, whose examples run as
// written, on the package's sources, and print what they say they print (a `console.log(...) // value`
// prints value); and its API reference, docs/api/three.md, which `npm run api` writes (CI writes it
// again after the build and compares).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const page = readFileSync(new URL('../../docs/three.md', import.meta.url), 'utf8')
const apiPage = readFileSync(new URL('../../docs/api/three.md', import.meta.url), 'utf8')
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

test('docs/api/three.md has every export, and the pages link only to headings they have', () => {
  // every export of the package's entry has its heading there
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const exported = [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((m) =>
    m[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1) as string).filter(Boolean),
  )
  const headings = new Set([...apiPage.matchAll(/^### (\S+)$/gm)].map((m) => m[1]))
  const missing = exported.filter((name) => !headings.has(name))
  assert.deepEqual(missing, [], 'exports without a heading in docs/api/three.md (npm run build, then npm run api)')
  // each page's own links (#anchor) go to headings of the page, as MkDocs and the site make them
  for (const [name, text] of [['docs/three.md', page], ['docs/api/three.md', apiPage]]) {
    const anchors = new Set(
      [...text.matchAll(/^#{1,4} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')),
    )
    const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1])
    assert.ok(links.length, `${name} has no links to its headings`)
    assert.deepEqual(links.filter((a) => !anchors.has(a)), [], `${name} links to headings it does not have`)
  }
})
