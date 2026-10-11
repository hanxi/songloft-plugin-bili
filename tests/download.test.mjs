import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
// 使用项目构建工具自己的 esbuild，兼容 pnpm 的独立依赖布局。
const { buildSync } = createRequire(import.meta.resolve('@songloft/plugin-builder'))('esbuild');

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = (entry) =>
  buildSync({
    absWorkingDir: root,
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    write: false,
  }).outputFiles[0].text;
const downloadCode = bundle(`
  export * from './src/downloader';
  export * from './src/download-path';
  export * from './src/store';
  export { runFavoriteWatchCheck } from './src/favorite-watcher';
`);
const routerCode =
  bundle(`import './src/main'; export { clearBatchTask } from './src/downloader';`) +
  '\nmodule.exports.request = globalThis.onHTTPRequest;';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待批次状态超时');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function fixture(t, { settings = {}, songs = {}, download, getById, router = false } = {}) {
  const calls = [];
  const hostWrites = [];
  const storage = new Map([['settings', { download_interval: 0, ...settings }]]);
  const delays = new Map();
  let timerId = 0;
  const host = {
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => storage.set(key, value),
    },
    songs: {
      getById: getById || (async (id) => songs[id] || { id, type: 'remote' }),
      download: async (id, opts) => {
        calls.push({ id, opts });
        return download ? download(id, opts) : { status: 'ok', path: `/music/${id}.mp3` };
      },
    },
    playlists: { getById: async (id) => ({ id, name: '已有歌单' }), list: async () => [] },
    plugin: { getHostUrl: async () => 'http://host', getToken: async () => 'test-token' },
    log: { error: (message) => assert.fail(message), info() {}, warn() {} },
  };
  const context = vm.createContext({
    module: { exports: {} },
    songloft: host,
    Error,
    console,
    setTimeout: (callback, ms) => {
      delays.set(++timerId, { callback, ms });
      return timerId;
    },
    clearTimeout: (id) => delays.delete(id),
    fetch: async (url, options) => {
      hostWrites.push({ url, body: JSON.parse(options.body) });
      const items = JSON.parse(options.body);
      const result = url.endsWith('/songs/remote')
        ? { songs: items.map((item, i) => ({ id: i + 1, title: item.title })) }
        : { added: items.song_ids.length };
      return { ok: true, text: async () => JSON.stringify(result) };
    },
  });
  vm.runInContext(router ? routerCode : downloadCode, context);
  const api = context.module.exports;
  t.after(() => api.clearBatchTask?.());
  const request = async (path, body, method = 'POST') => {
    const response = await api.request({
      method,
      path,
      body: JSON.stringify(body || {}),
      headers: {},
      query: {},
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
  return { api, calls, storage, delays, host, request, hostWrites };
}

test('路径按歌单、统一目录和显式目录解析，保留旧设置', async (t) => {
  const { api, storage } = fixture(t);
  assert.equal(api.resolveDownloadTemplate('', '收藏'), 'bili/收藏/{title}');
  assert.equal(api.resolveDownloadTemplate('', ''), 'bili/未分类/{title}');
  assert.equal(api.resolveDownloadTemplate('bili/{title}'), 'bili/{title}');
  assert.equal(
    api.resolveDownloadTemplate('bili/{artist}/{title}', '收藏'),
    'bili/{artist}/{title}',
  );
  assert.equal(api.resolveDownloadTemplate('', '', '我的收藏/国语'), '我的收藏/国语/{title}');
  const defaults = await api.getSettings();
  assert.equal(defaults.pause_on_error, false);
  assert.equal(defaults.path_template, 'bili/{playlist}/{title}');
  storage.set('settings', { path_template: 'old/{artist}/{title}', pause_on_error: true });
  const existing = await api.getSettings();
  assert.equal(existing.path_template, 'old/{artist}/{title}');
  assert.equal(existing.pause_on_error, true);
});

test('歌单名称安全替换，长中文名称不会破坏字符；非法路径提前拒绝', (t) => {
  const { api } = fixture(t);
  assert.equal(api.resolveDownloadTemplate('', '../AC/DC{artist}'), 'bili/__AC_DC_artist/{title}');
  const long = api.resolveDownloadTemplate('', '歌'.repeat(100)).split('/')[1];
  assert.equal(Buffer.byteLength(long), 180);
  for (const directory of ['/tmp/x', '../x', 'a/../b', 'C:\\music', 'a//b', 'a/./b']) {
    assert.throws(() => api.resolveDownloadTemplate('', '', directory));
  }
  for (const template of [
    '/{title}',
    '../{title}',
    'a//{title}',
    '{unknown}/{title}',
    '{title',
    'bili/{artist}',
  ]) {
    assert.throws(() => api.resolveDownloadTemplate(template));
  }
});

test('本地歌曲跳过，默认失败继续，最后一首失败不阻塞完成', async (t) => {
  const { api, calls } = fixture(t, {
    songs: { 1: { id: 1, type: 'local', file_path: '/music/old.mp3' } },
    download: async (id) => {
      if (id === 2 || id === 4) throw new Error('不可下载');
      return { status: 'ok' };
    },
  });
  await api.startBatchDownload([1, 2, 3, 4]);
  await until(() => api.getBatchTask()?.done);
  assert.deepEqual(
    calls.map((call) => call.id),
    [2, 3, 4],
  );
  assert.deepEqual(
    Array.from(api.getBatchTask().songs, (song) => song.status),
    ['skipped', 'failed', 'ok', 'failed'],
  );
  assert.equal(api.getBatchTask().paused, false);
});

test('全部为本地歌曲时直接跳过，不消耗下载间隔', async (t) => {
  const { api, calls, delays } = fixture(t, {
    settings: { download_interval: 30 },
    songs: { 1: { type: 'local' }, 2: { type: 'local' }, 3: { type: 'local' } },
  });
  await api.startBatchDownload([1, 2, 3]);
  await until(() => api.getBatchTask()?.done);
  assert.equal(calls.length, 0);
  assert.equal(delays.size, 0);
  assert.equal(api.getBatchTask().results.length, 3);
});

test('自动暂停可恢复，跳过不触发暂停，末首失败直接结束', async (t) => {
  const { api, calls } = fixture(t, {
    settings: { pause_on_error: true },
    songs: { 1: { type: 'local' } },
    download: async (id) => {
      if (id === 2 || id === 4) throw new Error('失败');
      return { status: 'ok' };
    },
  });
  await api.startBatchDownload([1, 2, 3, 4]);
  await until(() => api.getBatchTask()?.paused);
  assert.deepEqual(
    calls.map((call) => call.id),
    [2],
  );
  api.resumeBatch();
  await until(() => api.getBatchTask()?.done);
  assert.deepEqual(
    calls.map((call) => call.id),
    [2, 3, 4],
  );
});

test('清除暂停任务释放等待，新批次不会被旧批次污染', async (t) => {
  const { api, calls } = fixture(t, {
    settings: { pause_on_error: true },
    download: async (id) => {
      if (id === 1) throw new Error('失败');
      return { status: 'ok' };
    },
  });
  await api.startBatchDownload([1, 2]);
  await until(() => api.getBatchTask()?.paused);
  api.clearBatchTask();
  assert.equal(api.getBatchTask(), null);
  await until(() => {
    try {
      api.assertBatchAvailable();
      return true;
    } catch {
      return false;
    }
  });
  await api.startBatchDownload([3]);
  await until(() => api.getBatchTask()?.done);
  assert.deepEqual(
    calls.map((call) => call.id),
    [1, 3],
  );
  assert.equal(api.getBatchTask().results.length, 1);
});

test('清除正在下载的任务，等待单首返回且不启动旧队列后续歌曲', async (t) => {
  const inFlight = deferred();
  const { api, calls } = fixture(t, {
    download: (id) => (id === 1 ? inFlight.promise : { status: 'ok' }),
  });
  await api.startBatchDownload([1, 2]);
  await until(() => calls.length === 1);
  await assert.rejects(api.startBatchDownload([3]), /下载任务尚未结束/);
  api.pauseBatch();
  api.clearBatchTask();
  await assert.rejects(api.startBatchDownload([3]), /下载任务尚未结束/);
  inFlight.resolve({ status: 'ok' });
  await until(() => {
    try {
      api.assertBatchAvailable();
      return true;
    } catch {
      return false;
    }
  });
  await api.startBatchDownload([3]);
  await until(() => api.getBatchTask()?.done);
  assert.deepEqual(
    calls.map((call) => call.id),
    [1, 3],
  );
});

test('清除后单首尚未返回时，收藏夹监控仍避让手动下载', async (t) => {
  const inFlight = deferred();
  const { api, calls } = fixture(t, {
    settings: { watch_favorite_enabled: true, watch_favorite_id: 7 },
    download: () => inFlight.promise,
  });
  await api.startBatchDownload([1, 2]);
  await until(() => calls.length === 1);
  api.clearBatchTask();
  assert.equal(api.isBatchRunning(), true);
  const watch = await api.runFavoriteWatchCheck('manual');
  assert.equal(watch.started, false);
  assert.equal(watch.skipped, 'manual_download_active');
  inFlight.resolve({ status: 'ok' });
  await until(() => !api.isBatchRunning());
});

test('清除下载间隔和限流重试计时器，不再发出下载', async (t) => {
  for (const retry of [false, true]) {
    const { api, calls, delays } = fixture(t, {
      settings: { download_interval: 30 },
      download: async () => {
        if (retry) throw new Error('HTTP 412');
        return { status: 'ok' };
      },
    });
    await api.startBatchDownload([1, 2]);
    await until(() => delays.size === 1);
    assert.equal([...delays.values()][0].ms, retry ? 3000 : 30000);
    api.clearBatchTask();
    await until(() => {
      try {
        api.assertBatchAvailable();
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(delays.size, 0);
    assert.equal(calls.length, 1);
  }
});

test('限流仍按策略重试，返回 failed 结果也视为失败', async (t) => {
  let attempts = 0;
  const { api, delays } = fixture(t, {
    download: async () => {
      if (++attempts < 3) throw new Error('HTTP 412');
      return { status: 'failed', error: '源失效' };
    },
  });
  await api.startBatchDownload([1]);
  for (const ms of [3000, 8000]) {
    await until(() => delays.size === 1);
    const [id, timer] = [...delays][0];
    assert.equal(timer.ms, ms);
    delays.delete(id);
    timer.callback();
  }
  await until(() => api.getBatchTask()?.done);
  assert.equal(attempts, 3);
  assert.equal(api.getBatchTask().songs[0].error, '源失效');
});

test('检查之后被其他入口转为本地的歌曲也安全跳过', async (t) => {
  let reads = 0;
  const { api } = fixture(t, {
    getById: async () =>
      ++reads === 1 ? { type: 'remote' } : { type: 'local', file_path: '/music/1.mp3' },
    download: async () => {
      throw new Error('handleSongs: download: only remote songs can be downloaded, got type=local');
    },
  });
  await api.startBatchDownload([1]);
  await until(() => api.getBatchTask()?.done);
  assert.equal(api.getBatchTask().songs[0].status, 'skipped');
});

test('初始化期间预留批次；清除后不创建下载', async (t) => {
  const settings = deferred();
  const { api, host, calls } = fixture(t);
  host.storage.get = () => settings.promise;
  const starting = api.startBatchDownload([1]);
  await assert.rejects(api.startBatchDownload([2]), /下载任务尚未结束/);
  api.clearBatchTask();
  settings.resolve({ download_interval: 0 });
  await assert.rejects(starting);
  api.assertBatchAvailable();
  assert.equal(api.getBatchTask(), null);
  assert.equal(calls.length, 0);
});

test('重试沿用原模板，单首监控下载使用歌单名并跳过本地', async (t) => {
  const { api, calls } = fixture(t);
  await api.startBatchDownload([1], { pathTemplate: '旧目录/{title}', playlistName: '新歌单' });
  await until(() => api.getBatchTask()?.done);
  assert.equal(calls[0].opts.path_template, '旧目录/{title}');
  await api.downloadSingleSong(2, '监控收藏');
  assert.equal(calls[1].opts.path_template, 'bili/监控收藏/{title}');
});

test('接口按真实已有歌单名下载，跳过单独计数，非法设置返回 400', async (t) => {
  const { calls, request } = fixture(t, { router: true, songs: { 1: { type: 'local' } } });
  const imported = await request('/api/import-download', {
    playlist_id: 7,
    items: [
      { title: '歌一', author: '歌手', bvid: 'BV1' },
      { title: '歌二', bvid: 'BV2' },
    ],
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  let progress;
  // 路由层通过 HTTP 响应观察真实批次状态。
  for (let i = 0; i < 100; i++) {
    progress = await request('/api/download-batch/progress', {}, 'GET');
    if (progress.body.done) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(progress.body.done, true);
  assert.equal(progress.body.success, 1);
  assert.equal(progress.body.skipped, 1);
  assert.equal(progress.body.failed, 0);
  assert.equal(calls[0].opts.path_template, 'bili/已有歌单/{title}');
  const invalid = await request('/api/settings', { path_template: '../{title}' });
  assert.equal(invalid.status, 400);
  const ids = await request('/api/download-batch', { song_ids: [-1] });
  assert.equal(ids.status, 400);
});

test('并发导入在写入前拒绝，准备阶段也阻止直接下载', async (t) => {
  const playlist = deferred();
  const { host, request, hostWrites } = fixture(t, { router: true });
  host.playlists.getById = () => playlist.promise;
  const body = { playlist_id: 7, items: [{ bvid: 'BV1', title: '歌曲' }] };
  const first = request('/api/import-download', body);
  assert.equal((await request('/api/import-download', body)).status, 409);
  assert.equal((await request('/api/download-batch', { song_ids: [2] })).status, 409);
  assert.equal(hostWrites.length, 0);
  playlist.resolve({ id: 7, name: '目标歌单' });
  assert.equal((await first).status, 200);
  assert.equal(hostWrites.filter(({ url }) => url.endsWith('/songs/remote')).length, 1);
});

test('非法目录在导入写入前返回 400，失败后释放批次占用', async (t) => {
  const { request, hostWrites } = fixture(t, { router: true });
  const invalid = await request('/api/import-download', {
    items: [{ bvid: 'BV1', title: '歌曲' }],
    download_directory: '../outside',
  });
  assert.equal(invalid.status, 400);
  assert.equal(hostWrites.length, 0);
  assert.equal((await request('/api/download-batch', { song_ids: [1] })).status, 200);
});

test('启动参数错误返回 400 且保留上次完成记录', async (t) => {
  const { api } = fixture(t);
  await api.startBatchDownload([1]);
  await until(() => api.getBatchTask()?.done);
  const completed = api.getBatchTask();
  await assert.rejects(api.startBatchDownload([2], { pathTemplate: '../{title}' }));
  assert.equal(api.getBatchTask(), completed);
  api.assertBatchAvailable();
  for (const values of [
    [42, '', ''],
    ['', 42, ''],
    ['', '', 42],
  ]) {
    assert.throws(() => api.resolveDownloadTemplate(...values), /必须是字符串/);
  }
});

test('接口拒绝覆盖批次，暂停清除后进度为空', async (t) => {
  const inFlight = deferred();
  const { calls, request } = fixture(t, { router: true, download: () => inFlight.promise });
  assert.equal((await request('/api/download-batch', { song_ids: [1, 2] })).status, 200);
  await until(() => calls.length === 1);
  assert.equal((await request('/api/download-batch', { song_ids: [3] })).status, 409);
  await request('/api/download-batch/pause');
  assert.equal((await request('/api/download-batch/progress', {}, 'GET')).body.paused, true);
  await request('/api/download-batch/clear');
  assert.equal((await request('/api/download-batch/progress', {}, 'GET')).body.active, false);
  inFlight.resolve({ status: 'ok' });
});
