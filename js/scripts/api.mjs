// Writes docs/api/wasm.md, smlibwasm's page of the API reference (Python, WASM, three.js): the
// package's exports as TypeScript declarations, read from the compiled declarations in dist
// (npm run build first), without comments and without internal members (names starting with _).
// A class that extends an internal one (`Part extends _Body`) shows the members it inherits from
// it as its own, and extends what that one extends (`Shape`); constructors that only the package
// calls (they take its internal types) are left out. `node scripts/api.mjs <dist> <page>` reads
// the declarations in <dist> and writes the Markdown file <page>.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = (path) => pathToFileURL(path.endsWith('/') ? path : `${path}/`)
const dist = process.argv[2] ? dir(process.argv[2]) : new URL('../dist/', import.meta.url)
const page = process.argv[3] ? pathToFileURL(process.argv[3]) : new URL('../../docs/api/wasm.md', import.meta.url)

// the modules of each section, in the order of the docs' pages
const SECTIONS = [
  ['Geometry', ['geometry', 'align']],
  ['Shapes', ['shapes']],
  ['Curves', ['curves']],
  ['Sketches and text', ['profiles', 'sketches', 'text', 'font']],
  ['Parts and patterns', ['parts', 'locations']],
  ['Features', ['operations', 'defeature', 'molding']],
  ['Deformations', ['deformations']],
  ['Surfaces', ['surfaces']],
  ['Sheet metal', ['sheetmetal']],
  ['Meshes', ['mesh']],
  ['Files', ['exporters', 'step_import', 'iges_import', 'dxf', 'drawing', 'usd', 'occt', '_bytes']],
  ['Pictures and the viewer', ['pictures', 'viewer']],
  ['Errors and memory', ['_errors', 'kernel']],
]
// the package's other entries (the exports of package.json), each with everything it exports
const ENTRIES = [
  ['The worker entry: @classcad/smlibwasm/worker', 'worker'],
  ['Loading the kernel: @classcad/smlibwasm/init', 'init'],
  ['The raw kernel layer (no stable API): @classcad/smlibwasm/kernel', 'kernel'],
]

const parse = (name) =>
  ts.createSourceFile(`${name}.d.ts`, readFileSync(new URL(`${name}.d.ts`, dist), 'utf8'), ts.ScriptTarget.Latest, true)

// what index.d.ts exports from which module
const exported = new Map()
for (const st of parse('index').statements) {
  if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !st.exportClause) continue
  const module = st.moduleSpecifier.text.replace(/^\.\//, '').replace(/\.ts$/, '')
  // (a module's values and its types come in separate statements)
  if (!exported.has(module)) exported.set(module, new Set())
  for (const e of st.exportClause.elements) exported.get(module).add(e.name.text)
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
// whether a type names an internal type (`_Body`), or is a symbol (the token of a constructor that
// only the package calls)
const mentions = (type, test) => {
  let found = false
  const visit = (n) => {
    if (test(n)) found = true
    ts.forEachChild(n, visit)
  }
  if (type) visit(type)
  return found
}
const internalType = (type) => mentions(type, (n) => ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text.startsWith('_'))
const token = (type) => mentions(type, (n) => n.kind === ts.SyntaxKind.SymbolKeyword)
function strip(member) {
  if (internal(member.name) || isPrivate(member)) return null
  if (ts.isConstructorDeclaration(member)) {
    // trailing optional parameters of internal types are left out; one that is required makes the
    // constructor the package's own (`new Face(owner, kface)`)
    const params = [...member.parameters]
    if (params.some((p) => token(p.type))) return null
    while (params.length && (params.at(-1).questionToken || params.at(-1).initializer) && internalType(params.at(-1).type)) params.pop()
    if (params.some((p) => internalType(p.type))) return null
    return f.updateConstructorDeclaration(member, member.modifiers, publicParams(params), member.body)
  }
  if (ts.isMethodDeclaration(member))
    return f.updateMethodDeclaration(member, member.modifiers, member.asteriskToken, member.name, member.questionToken,
      member.typeParameters, publicParams(member.parameters), member.type, member.body)
  return member
}

// every class of the declarations, by name (for the internal ones a public class extends)
const classes = new Map()
for (const name of [...listed, ...ENTRIES.map(([, m]) => m), 'shapes']) {
  let file
  try {
    file = parse(name)
  } catch {
    continue
  }
  for (const st of file.statements) if (ts.isClassDeclaration(st) && st.name) classes.set(st.name.text, st)
}
const memberName = (m) => (m.name ? m.name.getText() : ts.isConstructorDeclaration(m) ? 'constructor' : '')
const superclass = (st) => {
  const clause = st.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
  const type = clause?.types[0]
  return type && ts.isIdentifier(type.expression) ? type.expression.text : null
}
/** A class as the docs show it: the members of the internal classes it extends (not those it
 * overrides) after its own, and the first public class up the chain as the one it extends. */
function flattened(st) {
  const members = [...st.members]
  let clauses = st.heritageClauses
  for (let base = superclass(st); base !== null && base.startsWith('_') && classes.has(base); ) {
    const cls = classes.get(base)
    const own = new Set(members.map(memberName))
    members.push(...cls.members.filter((m) => !ts.isConstructorDeclaration(m) && !own.has(memberName(m))))
    clauses = cls.heritageClauses
    base = superclass(cls)
  }
  return [members, clauses]
}

function declaration(st) {
  if (ts.isClassDeclaration(st)) {
    const [members, clauses] = flattened(st)
    return f.updateClassDeclaration(st, st.modifiers, st.name, st.typeParameters, clauses, members.map(strip).filter(Boolean))
  }
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
let out = '# WASM API\n\n' +
  'The exports of `@classcad/smlibwasm` as TypeScript declarations (`js/scripts/api.mjs` writes them from the\n' +
  'package\'s declarations). The [Python API](index.md) describes each of them under its Python name: `parallel_to`\n' +
  'there is `parallelTo` here. [JavaScript (WASM)](../javascript.md) is the guide: installing, the browser, memory\n' +
  'and workers.\n'
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
  if (parts.length) out += `\n## ${title}\n\n\`\`\`ts\n${parts.join('\n')}\n\`\`\`\n`
}
for (const [title, module] of ENTRIES) {
  const file = parse(module)
  const exporting = (st) => st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const parts = file.statements
    .filter((st) => exporting(st) && names(st).length && names(st).every((n) => !n.startsWith('_')))
    .map((st) => printer.printNode(ts.EmitHint.Unspecified, declaration(st), file).replace(/^export declare /gm, 'export '))
  out += `\n## ${title}\n\n\`\`\`ts\n${parts.join('\n')}\n\`\`\`\n`
}

writeFileSync(page, out)
console.log(`${fileURLToPath(page)}: ${out.split('\n').length} lines of API`)
