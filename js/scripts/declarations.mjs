// Makes the package's type declarations (the .d.ts files `npm run build` writes to dist) what an
// app compiles against: without the internal members, functions and types (names that start with
// _, which the docs leave out too), as TypeScript's `stripInternal` leaves out what is marked
// @internal, and with what a declaration needs from TypeScript's libraries named in it. Run after
// tsc (`npm run build` does); `node scripts/declarations.mjs <dir>` works on the declarations in
// <dir>.
//
// - Members of classes and interfaces whose names start with _ go (a private member stays, as tsc
//   writes it without its type: it keeps a class from matching another of the same members).
// - A declaration whose name starts with _ (`_Body`, `_fs`) goes unless one that stays names it:
//   `class Part extends _Body` keeps `_Body`, without its own internal members.
// - A type, constant or import that only what went named goes too: `NodeFs` of `_fs`, so that the
//   declarations name no module of Node's and type-check without @types/node. So do the internal
//   names a module passes on from another (`export { _workerArgv } from './_threads.ts'`).
// - A file that names `Symbol.dispose` references the lib that declares it (esnext.disposable),
//   so that an app whose `lib` is older (es2022) type-checks the package.
// An interface that loses every member is an error: it would take anything (`{}`).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dir = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url))
const names = readdirSync(dir).filter((f) => f.endsWith('.d.ts'))
const files = new Map(names.map((f) => [f, ts.createSourceFile(f, readFileSync(`${dir}/${f}`, 'utf8'), ts.ScriptTarget.Latest, true)]))

const internal = (name) => !!name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) && name.text.startsWith('_')
const has = (node, kind) => !!node.modifiers?.some((m) => m.kind === kind)
const exported = (st) => has(st, ts.SyntaxKind.ExportKeyword)

/** The names a top-level statement declares. */
function declared(st) {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
  const named = ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)
  return named && st.name && ts.isIdentifier(st.name) ? [st.name.text] : []
}

/** The names `export { ... } from` passes on (as they are in the other module). */
const passed = (st) =>
  ts.isExportDeclaration(st) && st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)
    ? st.exportClause.elements.map((el) => (el.propertyName ?? el.name).text)
    : []

/** The statement without the internal members of a class or interface, or the internal names it
 * passes on from another module (null: nothing is left of it). */
function stripped(st, file) {
  const keep = (m) => !internal(m.name) || has(m, ts.SyntaxKind.PrivateKeyword)
  if (passed(st).length) {
    const elements = st.exportClause.elements.filter((el) => !el.name.text.startsWith('_'))
    if (!elements.length) return null
    return ts.factory.updateExportDeclaration(st, st.modifiers, st.isTypeOnly, ts.factory.updateNamedExports(st.exportClause, elements), st.moduleSpecifier, st.attributes)
  }
  if (ts.isClassDeclaration(st)) {
    return ts.factory.updateClassDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses, st.members.filter(keep))
  }
  if (ts.isInterfaceDeclaration(st)) {
    const members = st.members.filter(keep)
    if (st.members.length && !members.length) throw new Error(`${file}: interface ${st.name.text} has internal members only: it would take anything once they are left out`)
    return ts.factory.updateInterfaceDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses, members)
  }
  return st
}

/** The identifiers a node names (its own name too). */
function identifiers(node, out = new Set()) {
  if (ts.isIdentifier(node)) out.add(node.text)
  ts.forEachChild(node, (child) => {
    identifiers(child, out) // (forEachChild stops at a callback that returns something)
  })
  return out
}

/** The declaration file of a relative module specifier ('./shapes.ts' -> 'shapes.d.ts'). */
const moduleFile = (specifier) => `${specifier.replace(/^\.\//, '').replace(/\.(ts|js)$/, '')}.d.ts`

// each file's statements, members stripped, and which of them stay so far
const state = new Map()
for (const [f, file] of files) {
  const statements = file.statements.map((st) => stripped(st, f)).filter((st) => st !== null)
  const kept = statements.map((st) => {
    if (ts.isImportDeclaration(st)) return false // (as far as what stays names them, below)
    const n = declared(st)
    if (!n.length) return true // export {...}, export ... from
    return exported(st) && !n.some((x) => x.startsWith('_'))
  })
  state.set(f, { statements, kept })
}

/** The names the statements that stay in `f` name (not its imports). */
function used(f) {
  const { statements, kept } = state.get(f)
  const out = new Set()
  statements.forEach((st, i) => {
    if (kept[i] && !ts.isImportDeclaration(st)) identifiers(st, out)
  })
  return out
}

// what stays keeps what it names: in its own file, or imported from another
for (let changed = true; changed; ) {
  changed = false
  const keep = (f, name) => {
    const s = state.get(f)
    if (!s) return
    s.statements.forEach((st, i) => {
      if (!s.kept[i] && declared(st).includes(name)) {
        s.kept[i] = true
        changed = true
      }
    })
  }
  for (const [f, { statements }] of state) {
    const names = used(f)
    for (const name of names) keep(f, name)
    for (const st of statements) {
      for (const name of passed(st)) keep(moduleFile(st.moduleSpecifier.text), name)
      if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue
      const from = moduleFile(st.moduleSpecifier.text)
      for (const el of st.importClause.namedBindings.elements) if (names.has(el.name.text)) keep(from, (el.propertyName ?? el.name).text)
    }
  }
}

let removed = 0
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
for (const [f, file] of files) {
  const { statements, kept } = state.get(f)
  const names = used(f)
  const out = []
  statements.forEach((st, i) => {
    if (!ts.isImportDeclaration(st)) {
      if (kept[i]) out.push(st)
      else removed++
      return
    }
    const bindings = st.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) return out.push(st) // (a side effect, a namespace)
    const elements = bindings.elements.filter((el) => names.has(el.name.text))
    if (!elements.length) return
    const clause = ts.factory.updateImportClause(st.importClause, st.importClause.isTypeOnly, st.importClause.name, ts.factory.updateNamedImports(bindings, elements))
    out.push(ts.factory.updateImportDeclaration(st, st.modifiers, clause, st.moduleSpecifier, st.attributes))
  })
  let text = printer.printFile(ts.factory.updateSourceFile(file, out))
  if (/\bSymbol\.dispose\b/.test(text)) text = `/// <reference lib="esnext.disposable" />\n${text}`
  writeFileSync(`${dir}/${f}`, text)
}
console.log(`${dir}: ${files.size} declaration files, ${removed} internal declarations left out`)
