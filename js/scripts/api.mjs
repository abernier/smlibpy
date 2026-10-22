// Writes the API section of docs/javascript.md (everything from its "## API" heading on): the
// package's exports as TypeScript declarations, read from the compiled declarations in dist
// (npm run build first), without comments and without internal members (names starting with _).
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const dist = new URL('../dist/', import.meta.url)
const page = new URL('../../docs/javascript.md', import.meta.url)

// the modules of each section, in the order of the docs' pages
const SECTIONS = [
  ['Geometry', ['geometry', 'align']],
  ['Shapes', ['shapes']],
  ['Curves', ['curves']],
  ['Sketches and text', ['profiles', 'sketches', 'text', 'font']],
  ['Parts and patterns', ['parts', 'locations']],
  ['Features', ['operations', 'defeature']],
  ['Deformations', ['deform']],
  ['Surfaces', ['surfaces']],
  ['Sheet metal', ['sheetmetal']],
  ['Meshes', ['mesh']],
  ['Files', ['exporters', 'step_import', 'iges_import', 'dxf', 'usd', 'occt']],
  ['Pictures and the viewer', ['render', 'viewer']],
  ['Errors', ['kernel']],
]

const parse = (name) =>
  ts.createSourceFile(`${name}.d.ts`, readFileSync(new URL(`${name}.d.ts`, dist), 'utf8'), ts.ScriptTarget.Latest, true)

// what index.d.ts exports from which module
const exported = new Map()
for (const st of parse('index').statements) {
  if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !st.exportClause) continue
  const module = st.moduleSpecifier.text.replace(/^\.\//, '').replace(/\.ts$/, '')
  exported.set(module, new Set(st.exportClause.elements.map((e) => e.name.text)))
}
const listed = new Set(SECTIONS.flatMap(([, modules]) => modules))
const missing = [...exported.keys()].filter((m) => !listed.has(m))
if (missing.length) throw new Error(`modules without a section: ${missing.join(', ')}`)

const f = ts.factory
const internal = (name) => !!name && (ts.isComputedPropertyName(name) || ts.isPrivateIdentifier(name) || name.text?.startsWith('_'))
const isPrivate = (m) => m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)
// Trailing optional parameters named _x are internal and left out; a required one (a placeholder
// in a base class) is shown without its underscore.
function publicParams(params) {
  const out = [...params]
  const hidden = (p) => ts.isIdentifier(p.name) && p.name.text.startsWith('_') && (p.questionToken || p.initializer)
  while (out.length && hidden(out.at(-1))) out.pop()
  return out.map((p) => ts.isIdentifier(p.name) && p.name.text.startsWith('_')
    ? f.updateParameterDeclaration(p, p.modifiers, p.dotDotDotToken, f.createIdentifier(p.name.text.replace(/^_+/, '')),
      p.questionToken, p.type, p.initializer)
    : p)
}
function strip(member) {
  if (internal(member.name) || isPrivate(member)) return null
  if (ts.isConstructorDeclaration(member))
    return f.updateConstructorDeclaration(member, member.modifiers, publicParams(member.parameters), member.body)
  if (ts.isMethodDeclaration(member))
    return f.updateMethodDeclaration(member, member.modifiers, member.asteriskToken, member.name, member.questionToken,
      member.typeParameters, publicParams(member.parameters), member.type, member.body)
  return member
}

function declaration(st) {
  if (ts.isClassDeclaration(st))
    return f.updateClassDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses,
      st.members.map(strip).filter(Boolean))
  if (ts.isInterfaceDeclaration(st))
    return f.updateInterfaceDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses,
      st.members.filter((m) => !internal(m.name)))
  if (ts.isFunctionDeclaration(st))
    return f.updateFunctionDeclaration(st, st.modifiers, st.asteriskToken, st.name, st.typeParameters,
      publicParams(st.parameters), st.type, st.body)
  return st
}

function names(st) {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.text)
  return st.name && ts.isIdentifier(st.name) ? [st.name.text] : []
}

const printer = ts.createPrinter({ removeComments: true })
let out = '## API\n\n' +
  'The exports of `@classcad/smlibwasm` as TypeScript declarations. The [API reference](api.md) describes each of them\n' +
  'under its Python name: `parallel_to` there is `parallelTo` here.\n'
for (const [title, modules] of SECTIONS) {
  const parts = []
  for (const module of modules) {
    const wanted = exported.get(module)
    if (!wanted) continue
    const file = parse(module)
    for (const st of file.statements)
      // and the options the exports take, which index does not export
      if (names(st).some((n) => wanted.has(n) || ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && n.endsWith('Options'))))
        parts.push(printer.printNode(ts.EmitHint.Unspecified, declaration(st), file)
          .replace(/^export declare /gm, 'export ')
          // tuples on one line: [number, number, number]
          .replace(/\[\n((?:[ ]+[^\n\[\]{}]+\n)+)[ ]*\]/g, (_, items) => `[${items.trim().split(/,?\n\s*/).join(', ')}]`))
  }
  if (parts.length) out += `\n### ${title}\n\n\`\`\`ts\n${parts.join('\n')}\n\`\`\`\n`
}

const text = readFileSync(page, 'utf8')
const at = text.indexOf('\n## API\n')
if (at < 0) throw new Error('docs/javascript.md has no "## API" heading')
writeFileSync(page, text.slice(0, at + 1) + out)
console.log(`docs/javascript.md: ${out.split('\n').length} lines of API`)
