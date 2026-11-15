import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import fs from 'node:fs'
import vm from 'node:vm'
const code = ts.transpileModule(
  fs.readFileSync(new URL('../src/cover.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText
function setup() {
  const calls = []
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require: () => ({
      jsonResponse: (data, statusCode = 200) => ({
        statusCode,
        body: JSON.stringify(data),
      }),
    }),
    Uint8Array,
    encodeURIComponent,
    JSON,
    Error,
    fetch: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        headers: {
          get: (name) => (name === 'content-type' ? 'image/png' : '3'),
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }
    },
    songloft: {
      plugin: {
        getHostUrl: async () => 'http://host',
        getToken: async () => 'test-token',
      },
    },
  })
  vm.runInContext(code, context)
  return { ...context.exports, calls }
}
test('cover fallback uses the authenticated host proxy and returns image bytes', async () => {
  const api = setup()
  const response = await api.coverHandler({
    body: JSON.stringify({ url: 'https://i0.hdslb.com/bfs/archive/test.png' }),
  })
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).src, 'data:image/png;base64,AQID')
  assert.ok(api.calls[0].url.startsWith('http://host/api/v1/proxy?url='))
  assert.equal(api.calls[0].options.headers.Authorization, 'Bearer test-token')
})
test('cover fallback rejects arbitrary hosts and schemes before any request', async () => {
  for (const url of [
    'http://i0.hdslb.com/bfs/a.png',
    'https://i0.hdslb.com.evil/bfs/a.png',
    'https://127.0.0.1/bfs/a.png',
    'https://i0.hdslb.com@evil/bfs/a.png',
  ]) {
    const api = setup()
    const response = await api.coverHandler({ body: JSON.stringify({ url }) })
    assert.equal(response.statusCode, 400)
    assert.equal(api.calls.length, 0)
  }
})
test('base64 preserves partial triples', () => {
  const { encodeImage } = setup()
  for (let count = 0; count < 8; count++) {
    const bytes = Uint8Array.from({ length: count }, (_, i) => i * 31)
    assert.equal(encodeImage(bytes), Buffer.from(bytes).toString('base64'))
  }
})
