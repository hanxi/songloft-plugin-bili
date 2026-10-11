import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const { buildSync } = createRequire(import.meta.resolve('@songloft/plugin-builder'))('esbuild');
const code =
  buildSync({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    stdin: {
      contents: `
      import './src/main';
      export * from './src/request-control';
      export * from './src/downloader';
      export * from './src/client';
      export * from './src/favorite-watcher';
      export * from './src/store';
    `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    write: false,
  }).outputFiles[0].text + '\nmodule.exports.request = globalThis.onHTTPRequest;';

const START = Date.parse('2026-10-12T00:00:00Z');
const COOLDOWN = 30 * 60_000;
const audio = {
  code: 0,
  data: { dash: { audio: [{ id: 30280, baseUrl: 'https://cdn/audio.m4a' }] } },
};

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待状态超时');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function fixture(t, { storage = new Map(), fetchResponse, download, songs } = {}) {
  let now = START;
  let timerId = 0;
  const timers = new Map();
  const fetches = [];
  const downloads = [];
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const host = {
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => storage.set(key, value),
    },
    songs: {
      getById: async (id) => songs?.[id] || { id, type: 'remote' },
      download: async (id, opts) => {
        downloads.push({ id, opts });
        if (download) return download(id, api);
        const result = await request('/api/music/url', {
          source_data: { bvid: `BV${id}`, cid: id },
        });
        if (result.status !== 200) {
          throw new Error(
            `handleSongs: download: acquire audio: plugin bili music/url returned ${result.status}: ${JSON.stringify(result.body)}`,
          );
        }
        return { status: 'ok', path: `/music/${id}.mp3` };
      },
    },
    playlists: { list: async () => [], getById: async () => null },
    plugin: { getHostUrl: async () => 'http://host', getToken: async () => 'test-token' },
    log: { info() {}, warn() {}, error: (message) => assert.fail(message) },
  };
  const context = vm.createContext({
    module: { exports: {} },
    songloft: host,
    Error,
    Date: Clock,
    __go_crypto_md5: (value) => createHash('md5').update(value).digest('hex'),
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay, at: now + delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, options) => {
      fetches.push({ url, options, at: now });
      if (url.startsWith('http://host')) {
        const items = JSON.parse(options.body);
        return response({ songs: items.map((item, i) => ({ id: i + 1, title: item.title })) });
      }
      return fetchResponse ? fetchResponse(url, options) : response(audio);
    },
  });
  vm.runInContext(code, context);
  const api = context.module.exports;
  const request = async (path, body = {}, method = 'POST') => {
    const result = await api.request({
      method,
      path,
      body: JSON.stringify(body),
      headers: {},
      query: {},
    });
    return { status: result.statusCode, body: JSON.parse(result.body) };
  };
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  t.after(() => {
    api.clearBatchTask();
    api.stopFavoriteWatcher();
  });
  return { api, request, storage, fetches, downloads, timers, advance, host };
}

function cacheWbi(storage) {
  storage.set('wbi_keys', { imgKey: 'a'.repeat(32), subKey: 'b'.repeat(32), ts: START });
}

test('HTTP 风控、非 JSON 风控页、业务风控码和 Retry-After 被正确透传', async (t) => {
  const cases = [
    { status: 412, body: '<html>SESSDATA=secret</html>', until: START + COOLDOWN },
    {
      status: 429,
      body: { code: -1, message: 'too many requests' },
      headers: { 'Retry-After': '3600' },
      until: START + 3600_000,
    },
    {
      status: 429,
      body: 'not json',
      headers: { 'Retry-After': new Date(START + 7200_000).toUTCString() },
      until: START + 7200_000,
    },
    { status: 200, body: { code: -412, message: '请求被拦截' }, until: START + COOLDOWN },
    { status: 200, body: { code: -999, message: '访问过于频繁' }, until: START + COOLDOWN },
  ];
  for (const item of cases) {
    await t.test(`${item.status} / ${item.body?.code ?? 'HTML'}`, async (t) => {
      const { request, storage, api, fetches } = fixture(t, {
        fetchResponse: () => response(item.body, item.status, item.headers),
      });
      cacheWbi(storage);
      const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
      assert.equal(result.status, 429);
      assert.equal(result.body.error, 'risk_control');
      assert.equal(result.body.http_status, item.status);
      assert.equal(result.body.bili_code, item.body?.code);
      assert.equal(result.body.cooldown_until, item.until);
      assert.equal((await api.getBiliCooldown()).until, item.until);
      assert.doesNotMatch(JSON.stringify(result.body), /secret|<html>/);
      await assert.rejects(api.biliGet('/x/player/pagelist'), /risk_control/);
      assert.equal(fetches.length, 1);
    });
  }
});

test('普通不可用、HTTP 403、异常响应与参数错误均不误判风控', async (t) => {
  for (const item of [
    { body: { code: -404, message: '视频不存在' }, status: 200, expected: 404 },
    { body: { code: -404, message: '视频不存在' }, status: 404, expected: 404 },
    { body: { code: -403, message: 'forbidden' }, status: 403, expected: 502 },
    { body: '<html>unknown failure</html>', status: 200, expected: 502 },
    { body: null, status: 200, expected: 502 },
    { body: { code: 0, data: {} }, status: 200, expected: 404 },
  ]) {
    const { request, api, storage } = fixture(t, {
      fetchResponse: () => response(item.body, item.status),
    });
    cacheWbi(storage);
    const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
    assert.equal(result.status, item.expected);
    assert.equal(await api.getBiliCooldown(), null);
    if (item.body?.message) assert.match(result.body.detail, new RegExp(item.body.message));
  }
  const { request, fetches } = fixture(t);
  for (const source_data of [null, {}, { bvid: 1 }, { bvid: 'BV1', cid: -1 }]) {
    assert.equal((await request('/api/music/url', { source_data })).status, 400);
  }
  assert.equal(fetches.length, 0);
});

test('音频成功解析保留 URL 和播放 headers，上游摘要删除 URL 与凭证', async (t) => {
  const { request, storage } = fixture(t);
  cacheWbi(storage);
  const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.url, 'https://cdn/audio.m4a');
  assert.equal(result.body.headers.Referer, 'https://www.bilibili.com/');

  const other = fixture(t, {
    fetchResponse: () =>
      response({
        code: -404,
        message: '详情 https://example/?token=secret Cookie: "SESSDATA=credential; other=secret"',
      }),
  });
  cacheWbi(other.storage);
  const failure = await other.request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.doesNotMatch(JSON.stringify(failure.body), /secret|credential;|SESSDATA=|example/);
});

test('业务请求串行且至少间隔一秒，普通失败不会阻断后续请求', async (t) => {
  let calls = 0;
  const { api, fetches, timers, advance } = fixture(t, {
    fetchResponse: () =>
      ++calls === 1 ? response({ code: -404, message: '不存在' }) : response({ code: 0 }),
  });
  await assert.rejects(api.biliGet('/one'), /-404/);
  const second = api.biliGet('/two');
  await until(() => timers.size === 1);
  advance(999);
  assert.equal(fetches.length, 1);
  advance(1);
  await second;
  assert.equal(fetches[1].at - fetches[0].at, 1000);
});

test('并发排队的请求在前一响应风控后被阻止，不继续发到上游', async (t) => {
  let finish;
  const { api, fetches } = fixture(t, {
    fetchResponse: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const first = api.biliGet('/one');
  const firstRejected = assert.rejects(first, /risk_control/);
  const second = api.biliGet('/two');
  const secondRejected = assert.rejects(second, /risk_control/);
  await until(() => fetches.length === 1);
  finish(response('risk control', 412));
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(fetches.length, 1);
});

test('冷却持久化：新环境阻止 pagelist/WBI/游客指纹，扫码登录仍可使用', async (t) => {
  const first = fixture(t);
  await first.api.beginBiliCooldown('HTTP 412');
  const restarted = fixture(t, {
    storage: first.storage,
    fetchResponse: () =>
      response({ code: 0, data: { url: 'https://passport/login', qrcode_key: 'key' } }),
  });
  const blocked = await restarted.request('/api/music/url', { source_data: { bvid: 'BV1' } });
  assert.equal(blocked.status, 429);
  await restarted.request('/api/login/cookie', { cookie: 'SESSDATA=test' });
  assert.equal(restarted.fetches.length, 0);
  assert.equal((await restarted.request('/api/login/qrcode', {}, 'GET')).status, 200);
  assert.equal(restarted.fetches.length, 1);
  assert.match(restarted.fetches[0].url, /passport\.bilibili\.com/);
  restarted.advance(COOLDOWN);
  assert.equal(await restarted.api.getBiliCooldown(), null);
});

test('未缓存 WBI 的 nav 风控也返回真实错误，allowNonZero 不跳过风控', async (t) => {
  const { request, fetches } = fixture(t, {
    fetchResponse: () => response({ code: -412, message: '请求被拦截' }),
  });
  const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.equal(result.status, 429);
  assert.equal(result.body.bili_code, -412);
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /web-interface\/nav/);
});

test('手动队列风控后强制暂停，不重试；冷却结束可恢复，清除不能绕过冷却', async (t) => {
  let blocked = true;
  const { api, request, storage, downloads, fetches, advance } = fixture(t, {
    fetchResponse: () => (blocked ? response('risk control', 412) : response(audio)),
  });
  storage.set('settings', { download_interval: 0, pause_on_error: false });
  cacheWbi(storage);
  await api.startBatchDownload([1, 2]);
  await until(() => api.getBatchTask()?.paused);
  assert.equal(downloads.length, 1);
  assert.equal(fetches.length, 1);
  assert.equal(api.getBatchTask().pause_reason, 'risk_control');
  assert.equal(api.getBatchTask().songs[1].status, 'pending');
  assert.equal((await request('/api/download-batch/resume')).status, 429);
  assert.equal(api.getBatchTask().paused, true);
  const progress = await request('/api/download-batch/progress', {}, 'GET');
  assert.equal(progress.body.cooldown.until, START + COOLDOWN);
  blocked = false;
  advance(COOLDOWN);
  assert.equal((await request('/api/download-batch/resume')).status, 200);
  await until(() => api.getBatchTask()?.done);
  assert.deepEqual(
    downloads.map(({ id }) => id),
    [1, 2],
  );
  assert.equal(api.getBatchTask().songs[0].status, 'failed');
  assert.equal(api.getBatchTask().songs[1].status, 'ok');

  await api.beginBiliCooldown('HTTP 429');
  api.clearBatchTask();
  await assert.rejects(api.startBatchDownload([3]), /risk_control/);
  const empty = await request('/api/download-batch/progress', {}, 'GET');
  assert.equal(empty.body.active, false);
  assert.ok(empty.body.cooldown);
  const imported = await request('/api/import-download', { items: [{ bvid: 'BV3', title: '三' }] });
  assert.equal(imported.status, 429);
  assert.equal(fetches.length, 2);
});

test('末首风控直接完成，旧 Bridge 的 HTTP 429 也不短间隔重试', async (t) => {
  const { api, storage, downloads, timers } = fixture(t, {
    download: async () => {
      throw new Error('HTTP 429');
    },
  });
  storage.set('settings', { download_interval: 0 });
  await api.startBatchDownload([1]);
  await until(() => api.getBatchTask()?.done);
  assert.equal(api.getBatchTask().paused, false);
  assert.equal(downloads.length, 1);
  assert.equal(timers.size, 0);
  assert.ok(await api.getBiliCooldown());
});

test('收藏夹监控遇到风控停止本轮，待处理项目不消耗重试次数', async (t) => {
  const { api, storage, fetches, timers, advance } = fixture(t, {
    fetchResponse: (url) =>
      url.includes('/fav/resource/list')
        ? response({
            code: 0,
            data: {
              has_more: false,
              medias: [
                { bvid: 'BV1', id: 1, title: '一' },
                { bvid: 'BV2', id: 2, title: '二' },
              ],
            },
          })
        : response('risk control', 412),
  });
  storage.set('settings', {
    watch_favorite_enabled: true,
    watch_favorite_id: 7,
    download_interval: 0,
    watch_interval_minutes: 1,
  });
  storage.set('favorite_watch_state_v1', {
    version: 1,
    folder_id: 7,
    folder_title: '收藏',
    initialized_at: new Date(START).toISOString(),
    items: {},
  });
  const checking = api.runFavoriteWatchCheck('manual');
  await until(() => timers.size === 1);
  advance(1000);
  await checking;
  const state = storage.get('favorite_watch_state_v1');
  const items = Object.values(state.items);
  assert.equal(items[0].status, 'failed');
  assert.equal(items[0].attempts, 1);
  assert.equal(items[1].status, 'pending');
  assert.equal(items[1].attempts, 0);
  assert.equal(state.skipped_reason, 'risk_control');
  assert.equal(fetches.length, 2);
  assert.ok([...timers.values()].every(({ at }) => at >= START + 1000 + COOLDOWN));
  const skipped = await api.runFavoriteWatchCheck('manual');
  assert.equal(skipped.skipped, 'risk_control');
  await api.retryFailedFavoriteWatchItems();
  await until(() => !storage.get('favorite_watch_state_v1').items[items[0].key].attempts);
  assert.equal(fetches.length, 2);
});

test('新用户默认十秒间隔，保留已有设置；冷却合并不缩短截止时间', async (t) => {
  const { api, storage } = fixture(t);
  assert.equal((await api.getSettings()).download_interval, 10);
  storage.set('settings', { download_interval: 2 });
  assert.equal((await api.getSettings()).download_interval, 2);
  await Promise.all([
    api.beginBiliCooldown('long', START + 7200_000),
    api.beginBiliCooldown('short'),
  ]);
  assert.equal((await api.getBiliCooldown()).until, START + 7200_000);
});

test('旧宿主普通对象响应头仍可读取 Retry-After 并进入冷却', async (t) => {
  const { request, storage } = fixture(t, {
    fetchResponse: () => ({
      status: 429,
      ok: false,
      headers: { 'rEtRy-AfTeR': '3600' },
      text: async () => 'not json',
    }),
  });
  cacheWbi(storage);
  const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.equal(result.status, 429);
  assert.equal(result.body.cooldown_until, START + 3600_000);
});

test('超长 Retry-After 不产生无限值，不丢失持久化冷却', async (t) => {
  const { request, storage, api } = fixture(t, {
    fetchResponse: () => response('not json', 429, { 'Retry-After': '1e300' }),
  });
  cacheWbi(storage);
  const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.equal(result.status, 429);
  assert.ok(Number.isFinite(result.body.cooldown_until));
  assert.ok(Number.isFinite(new Date(result.body.cooldown_until).getTime()));
  const persisted = JSON.parse(JSON.stringify(storage.get('bili_api_cooldown_v1')));
  storage.set('bili_api_cooldown_v1', persisted);
  assert.ok(await api.getBiliCooldown());
});

test('异步恢复旧队列不能在清除后恢复新队列', async (t) => {
  const { api, host, storage, downloads, timers } = fixture(t, {
    download: async () => ({ status: 'ok' }),
  });
  storage.set('settings', { download_interval: 30 });
  await api.startBatchDownload([1, 2]);
  await until(() => timers.size === 1);
  api.pauseBatch();
  let release;
  const get = host.storage.get;
  host.storage.get = (key) =>
    key === 'bili_api_cooldown_v1'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : get(key);
  const resuming = api.resumeBatch();
  api.clearBatchTask();
  host.storage.get = get;
  await until(() => !api.isBatchRunning());
  const starting = api.startBatchDownload([3, 4]);
  api.pauseBatch();
  await starting;
  release(null);
  await resuming;
  assert.equal(api.getBatchTask().paused, true);
  assert.deepEqual(
    downloads.map(({ id }) => id),
    [1],
  );
});

test('冷却状态写入失败时仍阻止本次运行的后续请求', async (t) => {
  const { api, host, request, storage, fetches } = fixture(t, {
    fetchResponse: () => response('blocked', 412),
  });
  cacheWbi(storage);
  const set = host.storage.set;
  host.storage.set = (key, value) => {
    if (key === 'bili_api_cooldown_v1') throw new Error('no space left');
    return set(key, value);
  };
  const result = await request('/api/music/url', { source_data: { bvid: 'BV1', cid: 1 } });
  assert.equal(result.status, 429);
  await assert.rejects(api.biliGet('/another'), /risk_control/);
  const get = host.storage.get;
  host.storage.get = (key) => {
    if (key === 'bili_api_cooldown_v1') throw new Error('permission denied');
    return get(key);
  };
  await assert.rejects(api.biliGet('/read-error'), /risk_control/);
  assert.equal(fetches.length, 1);
});
