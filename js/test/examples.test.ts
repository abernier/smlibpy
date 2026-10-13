// tests/test_examples.py: every example builds valid parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import type { Part } from '../src/index.ts'

const names = readdirSync(new URL('../examples/', import.meta.url))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.slice(0, -3))
  .sort()

for (const name of names) {
  test(`the ${name} example builds valid parts`, async () => {
    const mod = await import(`../examples/${name}.ts`)
    const result = mod.model()
    const parts: Part[] = Array.isArray(result) ? [...result] : [result]
    assert.ok(parts.length)
    for (const p of parts) {
      assert.ok(p.isValid(), `${name}: ${p} is not a valid solid`)
      assert.ok(p.volume > 0)
    }
  })
}
