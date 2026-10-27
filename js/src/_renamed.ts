// Options that were renamed, and positional parameters that became options: the old call still
// works for a release, with a warning (_renamed.py, Python's DeprecationWarning; the warnings go
// where setWarningHandler says). The declarations show the new form only, as Python's signatures
// do. tools/gen_js_options.py lists Python's old forms in test/_python_api.json, and
// test/options.test.ts calls each of them here.

import { _warn } from './kernel.ts'

// biome-ignore lint: an old option's value, whatever it was
type Any = any

/**
 * `options` with the old names of renamed options replaced by the new ones, with a warning:
 * `_renamed('Edge.continuity', options, '0.6.0', { angleTol: 'angleTolerance' })` (Python's
 * `@renamed`). An old option whose values changed too maps to `[new name, converter]`; an old
 * value of null or undefined is dropped. Both names given is a TypeError.
 */
export function _renamed<T>(
  name: string,
  options: T,
  since: string,
  names: Record<string, string | readonly [string, (value: Any) => unknown]>,
): T {
  if (options == null || typeof options !== 'object') return options
  let out: Record<string, unknown> | null = null
  for (const [old, renamed] of Object.entries(names)) {
    if (!Object.prototype.hasOwnProperty.call(options, old)) continue
    const [key, convert] = typeof renamed === 'string' ? [renamed, null] : renamed
    out ??= { ...(options as Record<string, unknown>) }
    const value = out[old]
    delete out[old]
    if (key in out) throw new TypeError(`${name}: ${old} is ${key} since smlibwasm ${since}; pass ${key} alone`)
    _warn(`${name}: ${old} is ${key} since smlibwasm ${since}; ${old} will be removed`)
    if (value != null) out[key] = convert ? convert(value) : value
  }
  return (out ?? options) as T
}

/**
 * The options of a call whose option `option` was its positional parameter up to `since`:
 * `edges(true)` is taken for `edges({ seams: true })`, with a warning (Python's `@keyword_only`).
 * An options object, null and undefined pass as they are.
 */
export function _keywordOnly<T>(name: string, options: T, since: string, option: string): T {
  if (options == null || (typeof options === 'object' && !Array.isArray(options))) return options
  const method = name.slice(name.indexOf('.') + 1)
  _warn(`${name}: pass ${option} as an option, ${method}({ ${option}: ${JSON.stringify(options)} }), since smlibwasm ${since}; ` +
    `a positional ${option} will be refused`)
  return { [option]: options } as T
}
