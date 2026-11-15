import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const code = ts.transpileModule(
  fs.readFileSync(
    new URL('../frontend/src/requests.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText
const context = vm.createContext({ exports: {}, Promise, Map })
vm.runInContext(code, context)
const { createReadCache, coverSource } = context.exports
test('pending reads deduplicate per resource while other resources remain independent', async () => {
  const read = createReadCache()
  let release
  let count = 0
  const a = read('settings', () => {
    count++
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const duplicate = read('settings', () => assert.fail('duplicate request'))
  assert.equal(a, duplicate)
  await read('account', async () => {
    count++
  })
  assert.equal(count, 2)
  release()
  await a
  await read('settings', async () => {
    count++
  })
  assert.equal(count, 3)
})
test('failed reads release the pending slot for retry', async () => {
  const read = createReadCache()
  await assert.rejects(
    read('favorites', async () => {
      throw Error('offline')
    }),
  )
  let retried = false
  await read('favorites', async () => {
    retried = true
  })
  assert.ok(retried)
})
test('covers normalize HTTPS and reject non-network sources', () => {
  assert.equal(
    coverSource('//i0.hdslb.com/test.jpg'),
    'https://i0.hdslb.com/test.jpg',
  )
  assert.equal(
    coverSource('http://i0.hdslb.com/test.jpg'),
    'https://i0.hdslb.com/test.jpg',
  )
  for (const value of ['', 'javascript:bad', '/relative'])
    assert.equal(coverSource(value), '')
})
