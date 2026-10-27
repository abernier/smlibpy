// Writes API.md, the API reference: what `@classcad/smlibpy-three` and its other entries export, as
// the TypeScript declarations in dist (npm run build first) with their doc comments, one heading per
// class, function, constant and type, in sections by subject. `node scripts/api.mjs [dist] [page]`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dist = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url))
const page = process.argv[3] ?? fileURLToPath(new URL('../API.md', import.meta.url))

// the modules of each section, in the order of the page (a module that index exports from must have one)
const SECTIONS = [
  ['Shapes', ['shapes'], 'Bodies (Part, Shell, Sketch) are THREE.Meshes, faces THREE.Meshes, edges and wires THREE.Lines, vertices THREE.Points.'],
  ['Solids', ['primitives'], 'smlibpy\'s solids, made as three\'s geometries are: their arguments, defaults and placement.'],
  ['Sketches and text', ['sketches', 'profiles', 'font'], 'Regions in the sketch\'s own 2D coordinates, which are three\'s x and y: in the XY plane of its frame, facing +z.'],
  ['Curves', ['curves'], 'Edges and wires of their own: points are Vector3s, angles radians, planar curves lie in the XY plane.'],
  ['Operations and patterns', ['operations'], 'Every operation of a body is a method and a function: the function takes the body first, as the receiver. Patterns are Matrix4s.'],
  ['Measurements', ['properties'], 'Records in three\'s types, in the frame of what was measured.'],
  ['Deformations', ['deformations']],
  ['Surfaces', ['surfaces']],
  ['Sheet metal', ['sheetmetal']],
  ['Triangle meshes', ['mesh']],
  ['Files', ['files', 'drawing'], 'Loaders (THREE.Loader: load, loadAsync, parse) and exporters (parse); files are read and written as they are.'],
  ['Pictures', ['pictures']],
  ['Memory and settings', ['memory']],
  ['Errors and types', ['errors', 'types']],
]
// the package's other entries, each with everything it exports
const ENTRIES = [
  ['The worker: @classcad/smlibpy-three/worker', 'worker'],
  ['Loading the kernel: @classcad/smlibpy-three/init', 'init'],
]

const read = (name) => {
  try {
    return ts.createSourceFile(`${name}.d.ts`, readFileSync(`${dist}/${name}.d.ts`, 'utf8'), ts.ScriptTarget.Latest, true)
  } catch {
    return null
  }
}

// what index.d.ts exports from which module
const exported = new Map()
for (const st of read('index').statements) {
  if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !st.exportClause) continue
  const module = st.moduleSpecifier.text.replace(/^\.\//, '').replace(/\.(ts|js)$/, '')
  if (!exported.has(module)) exported.set(module, new Set())
  for (const e of st.exportClause.elements) exported.get(module).add(e.name.text)
}
const listed = new Set(SECTIONS.flatMap(([, modules]) => modules))
const missing = [...exported.keys()].filter((m) => !listed.has(m))
if (missing.length) throw new Error(`modules without a section: ${missing.join(', ')}`)

const f = ts.factory
const hidden = (m) =>
  (m.name && (ts.isPrivateIdentifier(m.name) || ts.isComputedPropertyName(m.name))) || m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)
// (a class without its private members, which tsc writes without types)
function declaration(st) {
  if (ts.isClassDeclaration(st)) return f.updateClassDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses, st.members.filter((m) => !hidden(m)))
  return st
}
function names(st) {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.text)
  return st.name && ts.isIdentifier(st.name) ? [st.name.text] : []
}
const kind = (st) =>
  ts.isClassDeclaration(st) ? 'class' : ts.isFunctionDeclaration(st) ? 'function' : ts.isVariableStatement(st) ? 'const' : ts.isInterfaceDeclaration(st) ? 'interface' : 'type'

const printer = ts.createPrinter({ removeComments: false })
const print = (st, file) =>
  printer
    .printNode(ts.EmitHint.Unspecified, declaration(st), file)
    .replace(/^export declare /gm, 'export ')
    .replace(/^declare /gm, '')
    // tuples on one line: [number, number, number]
    .replace(/\[\n((?:[ ]+[^\n\[\]{}]+\n)+)[ ]*\]/g, (_, items) => `[${items.trim().split(/,?\n\s*/).join(', ')}]`)

// classes first, then functions and constants, then the types they take
const ORDER = { class: 0, function: 1, const: 2, interface: 3, type: 3 }

/** The declarations of `names` in `file` (and the options and types they name that index does not
 * export), grouped by name: overloads under one heading. */
function entries(file, wanted) {
  const out = new Map()
  for (const st of file.statements) {
    const exportedHere = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exportedHere) continue
    const own = names(st).filter((n) => wanted === null || wanted.has(n) || ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && n.endsWith('Options')))
    if (!own.length) continue
    const name = own[0]
    if (!out.has(name)) out.set(name, { kind: kind(st), text: [] })
    out.get(name).text.push(print(st, file))
  }
  return out
}

const anchor = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')
let toc = ''
let body = ''
const section = (title, note, items) => {
  if (!items.size) return
  toc += `- [${title}](#${anchor(title)}): ${[...items.keys()].map((n) => `\`${n}\``).join(', ')}\n`
  body += `\n## ${title}\n\n${note ? `${note}\n\n` : ''}`
  for (const [name, item] of items) body += `### ${name}\n\n\`\`\`ts\n${item.text.join('\n')}\n\`\`\`\n\n`
}
for (const [title, modules, note] of SECTIONS) {
  const items = new Map()
  for (const module of modules) {
    const wanted = exported.get(module)
    const file = wanted && read(module)
    if (file) for (const [k, v] of entries(file, wanted)) items.set(k, v)
  }
  section(title, note, new Map([...items].sort(([, a], [, b]) => ORDER[a.kind] - ORDER[b.kind])))
}
for (const [title, module] of ENTRIES) {
  const file = read(module)
  if (file) section(title, '', new Map([...entries(file, null)].sort(([, a], [, b]) => ORDER[a.kind] - ORDER[b.kind])))
}

const intro = `# smlibpy-three API

The exports of \`@classcad/smlibpy-three\` (and its entries \`/worker\` and \`/init\`) as TypeScript
declarations with their doc comments, written by \`npm run api\` from the package's declarations. The
[README](README.md) has the design: three's types and coordinates (Y up), shapes taken where they
are, results in the frame of what an operation was called on, angles in radians. smlibpy's
[documentation](https://smlibpy.classcad.ch/docs/) describes the operations themselves.

`
writeFileSync(page, `${intro}${toc}${body}`.replace(/\n{3,}/g, '\n\n'))
console.log(`${page}: ${body.split('\n').length} lines, ${(toc.match(/`/g) ?? []).length / 2} entries`)
