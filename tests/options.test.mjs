import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const code = ts.transpileModule(
  fs.readFileSync(
    new URL('../frontend/src/options.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText
const ctx = vm.createContext({ exports: {}, Map, Math })
vm.runInContext(code, ctx)
const { optionPage } = ctx.exports
const options = Array.from({ length: 1000 }, (_, i) => [String(i), '歌单' + i])
test('large option lists paginate instead of rendering all entries', () => {
  const a = optionPage(options, '', 0)
  assert.equal(a.items.length, 20)
  assert.equal(a.pages, 50)
  const last = optionPage(options, '', 100)
  assert.equal(last.page, 49)
  assert.equal(last.items[19][0], '999')
})
test('search covers the whole list and empty results remain usable', () => {
  const a = optionPage(options, '歌单999', 0)
  assert.equal(a.items.length, 1)
  assert.equal(a.items[0][0], '999')
  const empty = optionPage(options, 'absent', 9)
  assert.equal(empty.items.length, 0)
  assert.equal(empty.page, 0)
  assert.equal(empty.pages, 1)
})
test('duplicate saved selections deduplicate and search ignores case', () => {
  const a = optionPage(
    [
      ['a', 'Old'],
      ['a', 'New Title'],
    ],
    'NEW',
    0,
  )
  assert.equal(a.items.length, 1)
  assert.equal(a.items[0][1], 'New Title')
})
