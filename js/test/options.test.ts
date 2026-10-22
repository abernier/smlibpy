// tests/test_js_options.py: options objects are checked as Python checks keyword arguments, against
// the table of smlibpy's signatures (src/_options.ts, made by tools/gen_js_options.py).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import * as api from '../src/index.ts'
import { Align, Axis, Box, Lattice, Line, Polyline, Profile, Rectangle, fold, offset } from '../src/index.ts'
import { OPTIONS } from '../src/_options.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: calls JavaScript allows and TypeScript does not
type Any = any

const folded = () => fold(Box(100, 40, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] }), new Axis([20, 0, 2], [0, 1, 0]), 90, { radius: 2 })

test('an option spelled as in Python, a typo or a number for the options is a TypeError', () => {
  const p = folded()
  // the options are camelCase: k_factor was the default K-factor, without a word
  approx(p.bends({ kFactor: 0.3 })[0].allowance, (Math.PI / 2) * (2 + 0.3 * 2), 1e-9)
  assert.throws(() => p.bends({ k_factor: 0.3 } as Any), {
    name: 'TypeError',
    message: "Part.bends() got an unexpected option 'k_factor'; did you mean 'kFactor'? (the options are camelCase)",
  })
  assert.throws(() => p.flatPattern({ k_factor: 0.3 } as Any), /Part\.flatPattern\(\) got an unexpected option 'k_factor'/)
  assert.throws(() => Rectangle(20, 10, { filet: 3 } as Any), { name: 'TypeError', message: /'filet'; did you mean 'fillet'\?/ })
  assert.throws(() => Box(10, 10, 10, { aling: 'min' } as Any), { name: 'TypeError', message: /'aling'; did you mean 'align'\?/ })
  assert.throws(() => Box(10, 10, 10, { colour: 'red' } as Any), { name: 'TypeError', message: /'colour' \(its options: align\)/ })
  // more arguments than the positional ones and the options
  assert.throws(() => (Rectangle as Any)(20, 10, 3), { name: 'TypeError', message: 'Rectangle() takes 2 positional arguments but 3 were given' })
  assert.throws(() => (Box as Any)(10, 10, 10, {}, 4), { name: 'TypeError', message: 'Box() takes 3 positional arguments but 4 were given' })
  // the offset of a sheet or a face takes no options (a part's and a sketch's do)
  const top = Box(10, 10, 10).faces().top().one()
  assert.throws(() => offset(top, 1, { corners: 'sharp' }), /Shell\.offset\(\) got an unexpected option 'corners' \(it takes no options\)/)
  assert.throws(() => offset(Box(10, 10, 10), 1, { corner: 'round' } as Any), /Part\.offset\(\) got an unexpected option 'corner'; did you mean 'corners'\?/)
  approx((offset(Box(10, 10, 10), 1, { corners: 'sharp' }) as Any).volume, 1728, 1e-9)
  assert.equal(offset(Rectangle(10, 10), 1, { corners: 'sharp' }).area, 144)
  // what is right goes through; null and undefined are no options; keys with _ are smlibwasm's own
  assert.equal(Box(10, 10, 10, { align: 'min' } as Any).bbox().min.x, 0)
  approx(Box(10, 10, 10, undefined).volume, 1000, 1e-9)
  approx(Rectangle(20, 10, { fillet: 3 }).area, 200 - (4 - Math.PI) * 9, 1e-9)
  // and so does an object literal of another realm (an iframe, node:vm), but not a class instance
  const foreign = (code: string): Any => runInNewContext(code)
  assert.equal(Box(10, 10, 10, foreign("({ align: ['min', 'min', 'min'] })")).bbox().min.x, 0)
  approx(Rectangle(20, 10, foreign('({ fillet: 1 })')).area, 200 - (4 - Math.PI), 1e-9)
  assert.throws(() => (Box as Any)(10, 10, 10, new Axis([0, 0, 0], [0, 0, 1])), /Box\(\) takes 3 positional arguments but 4 were given/)
})

/** The function or method `name` of the table, called with the options `options` after as many
 * arguments as it has positional parameters (all undefined: the options are checked first). */
function call(name: string, options: Record<string, unknown>): unknown {
  const [positional] = OPTIONS[name]
  const args = positional < 0 ? [options] : [...new Array(positional).fill(undefined), options]
  const isClass = (f: unknown) => typeof f === 'function' && /^class\b/.test(Function.prototype.toString.call(f))
  const dot = name.indexOf('.')
  if (dot < 0) {
    const fn = (api as Any)[name]
    assert.equal(typeof fn, 'function', `${name} is no export of the package`)
    return isClass(fn) ? new fn(...args) : fn(...args)
  }
  const [cls, method] = [name.slice(0, dot), name.slice(dot + 1)]
  const samples: Record<string, () => Any> = {
    Part: () => Box(10, 10, 10),
    Face: () => Box(10, 10, 10).faces()[0],
    Shell: () => Box(10, 10, 10).faces()[0].toShell(),
    Sketch: () => Rectangle(10, 10),
    Profile: () => new Profile(),
    Lattice: () => new Lattice(Box(10, 10, 10)),
    Edge: () => Line([0, 0], [10, 0]),
    Wire: () => Polyline([0, 0], [10, 0], [10, 10]),
    _Body: () => Box(10, 10, 10), // (named, colored: methods of every body)
  }
  assert.ok(cls in samples, `no sample of a ${cls}`)
  const obj = samples[cls]()
  assert.equal(typeof obj[method], 'function', `${name} is no method`)
  return obj[method](...args)
}

test('every function and method of the table checks its options first', () => {
  for (const name of Object.keys(OPTIONS)) {
    assert.throws(() => call(name, { notAnOption: 1 }), (e: Any) => {
      assert.ok(e instanceof TypeError && e.message.startsWith(`${name}() got an unexpected option 'notAnOption'`), `${name}: ${e}`)
      return true
    })
  }
})

test("the options' types are the table's keys, and every entry is checked", () => {
  // The table follows Python (tests/test_js_options.py); this keeps the TypeScript types, which
  // tell editors and tsc what may be given, the same.
  const config = ts.getParsedCommandLineOfConfigFile(new URL('../tsconfig.json', import.meta.url).pathname, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  })
  assert.ok(config)
  const src = new URL('../src/', import.meta.url).pathname
  const program = ts.createProgram(config.fileNames.filter((f) => f.startsWith(src)), config.options)
  const checker = program.getTypeChecker()
  const checked = new Set<string>()
  const problems: string[] = []
  // (a function that passes its options on to a part or a sketch: a sheet or a face takes none)
  const forwards = new Set(['Shell.offset'])
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(src)) continue
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText() === '_opts' && ts.isStringLiteral(node.arguments[0])) {
        const name = node.arguments[0].text
        checked.add(name)
        const type = checker.getApparentType(checker.getTypeAtLocation(node.arguments[1]))
        const keys = type.getProperties().map((p) => p.name).filter((p) => !p.startsWith('_')).sort()
        const table = [...(OPTIONS[name]?.[1] ?? [])].sort()
        if (!forwards.has(name) && keys.join() !== table.join()) problems.push(`${name}: the type has ${keys.join(', ')}; the table ${table.join(', ')}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  assert.deepEqual(problems, [])
  assert.deepEqual(Object.keys(OPTIONS).filter((name) => !checked.has(name)), [])
})
