import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const code = ts.transpileModule(
  fs.readFileSync(
    new URL('../frontend/src/video-parts.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText
const ctx = vm.createContext({ exports: {} })
vm.runInContext(code, ctx)
const { partsLabel } = ctx.exports
test('a missing cid does not establish that a video has multiple parts', () => {
  assert.equal(partsLabel({ bvid: 'single', part_count: 1 }), '')
  assert.equal(partsLabel({ bvid: 'unknown' }), '详情')
  assert.equal(partsLabel({ bvid: 'multiple', part_count: 3 }), '分 P')
})
test('resolved page counts override search hints and single videos do not expand', () => {
  assert.equal(partsLabel({ part_count: 5 }, [{}]), '')
  assert.equal(partsLabel({}, []), '')
  assert.equal(partsLabel({}, [{}, {}]), '分 P')
  assert.equal(partsLabel({}, [{}, {}], true), '收起')
  assert.equal(partsLabel({ cid: 1, part_count: 2 }), '')
})
