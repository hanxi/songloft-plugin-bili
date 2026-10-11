/// <reference types="@songloft/plugin-sdk" />

import { jsonResponse, createRouter } from '@songloft/plugin-sdk';
import {
  qrcodeHandler,
  pollHandler,
  cookieLoginHandler,
  statusHandler,
  logoutHandler,
} from './auth';
import { searchVideosHandler, searchHandler, toponeHandler } from './search';
import { foldersHandler, folderContentHandler, folderImportHandler } from './favorites';
import { importSongs } from './importer';
import {
  startBatchDownload,
  getBatchTask,
  clearBatchTask,
  pauseBatch,
  resumeBatch,
  startPreparedBatchDownload,
  BatchBusyError,
} from './downloader';
import { resolveDownloadTemplate, DownloadPathError } from './download-path';
import { musicUrlHandler } from './music-url';
import { getSettings, saveSettings } from './store';
import {
  getFavoriteWatchStatus,
  rebuildFavoriteWatchBaseline,
  reconfigureFavoriteWatcher,
  retryFailedFavoriteWatchItems,
  runFavoriteWatchCheck,
  startFavoriteWatcher,
} from './favorite-watcher';
import { extractFromURL, extractVideoParts } from './extractor';
import type { BiliVideo } from './search';

const router = createRouter();

function downloadError(error: unknown) {
  const status =
    error instanceof BatchBusyError ? 409 : error instanceof DownloadPathError ? 400 : 500;
  return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, status);
}

// --- 登录 ---
router.get('/api/login/status', statusHandler);
router.get('/api/login/qrcode', qrcodeHandler);
router.get('/api/login/poll', pollHandler);
router.post('/api/login/cookie', cookieLoginHandler);
router.post('/api/logout', logoutHandler);

// --- 搜索 ---
router.post('/api/search/videos', searchVideosHandler); // UI 搜索
router.post('/api/search', searchHandler); // 音源匹配
router.post('/api/search/topone', toponeHandler);

// --- URL 提取 ---
router.post('/api/extract', async (req) => {
  const { url } = JSON.parse(String(req.body)) as { url: string };
  if (!url) return jsonResponse({ error: 'url is required' }, 400);
  try {
    return jsonResponse(await extractFromURL(url));
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

router.get('/api/videos/:bvid/parts', async (_req, params) => {
  try {
    return jsonResponse(await extractVideoParts(params.bvid));
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

// --- 收藏夹 ---
router.get('/api/favorites', foldersHandler);
router.get('/api/favorites/:id', folderContentHandler);
router.post('/api/favorites/:id/import', folderImportHandler);

// --- 导入 ---
router.post('/api/import', async (req) => {
  const { items, playlist_name, playlist_id, artist_override } = JSON.parse(String(req.body)) as {
    items: BiliVideo[];
    playlist_name?: string;
    playlist_id?: number;
    artist_override?: string;
  };
  if (!items || items.length === 0) return jsonResponse({ error: 'items is required' }, 400);
  try {
    const result = await importSongs(items, playlist_name, playlist_id, artist_override);
    return jsonResponse({
      count: result.songs.length,
      total: result.total,
      failed: result.failed,
      playlist_id: result.playlist_id,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

router.post('/api/import-download', async (req) => {
  const { items, playlist_name, playlist_id, artist_override, download_directory } = JSON.parse(
    String(req.body),
  ) as {
    items: BiliVideo[];
    playlist_name?: string;
    playlist_id?: number;
    artist_override?: string;
    download_directory?: string;
  };
  if (!items || items.length === 0) return jsonResponse({ error: 'items is required' }, 400);
  try {
    const result = await startPreparedBatchDownload(async () => {
      const playlistName = playlist_id
        ? (await songloft.playlists.getById(playlist_id))?.name || ''
        : playlist_name || '';
      // 路径错误在导入写入之前返回。
      const settings = await getSettings();
      const template = resolveDownloadTemplate(
        settings.path_template,
        playlistName,
        download_directory,
      );
      const imported = await importSongs(items, playlist_name, playlist_id, artist_override);
      return {
        result: imported,
        songIds: imported.songs.map((s) => s.id),
        options: {
          playlistName,
          songTitles: new Map(imported.songs.map((s) => [s.id, s.title])),
          downloadDirectory: download_directory,
          pathTemplate: template,
        },
      };
    });
    return jsonResponse({
      count: result.songs.length,
      total: result.total,
      failed: result.failed,
      playlist_id: result.playlist_id,
      download_started: true,
    });
  } catch (e: any) {
    return downloadError(e);
  }
});

// --- 批量下载 ---
router.post('/api/download-batch', async (req) => {
  const { song_ids, playlist_name, song_titles, download_directory, path_template } = JSON.parse(
    String(req.body),
  ) as {
    song_ids: number[];
    playlist_name?: string;
    song_titles?: Record<number, string>;
    download_directory?: string;
    path_template?: string;
  };
  if (
    !Array.isArray(song_ids) ||
    song_ids.length === 0 ||
    song_ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    return jsonResponse({ error: 'song_ids must contain positive integer IDs' }, 400);
  }
  const titlesMap = song_titles
    ? new Map(Object.entries(song_titles).map(([k, v]) => [Number(k), v]))
    : undefined;
  try {
    await startBatchDownload(song_ids, {
      playlistName: playlist_name,
      songTitles: titlesMap,
      downloadDirectory: download_directory,
      pathTemplate: path_template,
    });
    return jsonResponse({ started: true, total: song_ids.length });
  } catch (error) {
    return downloadError(error);
  }
});

router.get('/api/download-batch/progress', async () => {
  const task = getBatchTask();
  if (!task) return jsonResponse({ active: false });
  const success = task.results.filter(
    (r) => r.status !== 'failed' && r.status !== 'skipped',
  ).length;
  const skipped = task.results.filter((r) => r.status === 'skipped').length;
  const failed = task.results.filter((r) => r.status === 'failed').length;
  return jsonResponse({
    active: true,
    current: task.current,
    total: task.total,
    done: task.done,
    paused: task.paused,
    success,
    skipped,
    failed,
    results: task.results,
    songs: task.songs,
    playlist_name: task.playlist_name,
    download_directory: task.download_directory,
    path_template: task.path_template,
  });
});

router.post('/api/download-batch/pause', async () => {
  pauseBatch();
  return jsonResponse({ ok: true });
});

router.post('/api/download-batch/resume', async () => {
  resumeBatch();
  return jsonResponse({ ok: true });
});

router.post('/api/download-batch/clear', async () => {
  clearBatchTask();
  return jsonResponse({ ok: true });
});

// --- 按需播放 ---
router.post('/api/music/url', musicUrlHandler);

// --- 设置 ---
router.get('/api/settings', async () => jsonResponse(await getSettings()));
router.post('/api/settings', async (req) => {
  const previous = await getSettings();
  const body = JSON.parse(String(req.body));
  if (body.path_template !== undefined) {
    try {
      if (typeof body.path_template !== 'string')
        throw new DownloadPathError('下载路径模板必须是字符串');
      resolveDownloadTemplate(body.path_template);
    } catch (error) {
      return downloadError(error);
    }
  }
  const interval = Number(body.watch_interval_minutes);
  body.watch_interval_minutes =
    Number.isInteger(interval) && interval >= 1 && interval <= 1440 ? interval : 10;
  const folderId = Number(body.watch_favorite_id);
  if (body.watch_favorite_enabled === true && (!Number.isInteger(folderId) || folderId <= 0)) {
    return jsonResponse({ error: '请选择要监控的收藏夹' }, 400);
  }
  const updated = await saveSettings(body);
  await reconfigureFavoriteWatcher(previous, updated);
  return jsonResponse(updated);
});

router.get('/api/favorite-watch/status', async () => jsonResponse(await getFavoriteWatchStatus()));
router.post('/api/favorite-watch/check', async () => {
  const status = await getFavoriteWatchStatus();
  if (status.running) return jsonResponse({ started: false, skipped: 'already_running' });
  void runFavoriteWatchCheck('manual');
  return jsonResponse({ started: true });
});
router.post('/api/favorite-watch/rebaseline', async () => {
  try {
    const result = await rebuildFavoriteWatchBaseline();
    return jsonResponse({ count: result.count });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 400);
  }
});
router.post('/api/favorite-watch/retry-failed', async () => {
  return jsonResponse(await retryFailedFavoriteWatchItems());
});

// --- 歌单 ---
const LAST_PLAYLIST_KEY = 'bili_last_playlist';

router.get('/api/playlists', async () => {
  // 导入普通歌曲，排除电台歌单
  const all = await songloft.playlists.list();
  const playlists = all.filter((p: any) => p.type !== 'radio');
  const lastPlaylist = (await songloft.storage.get(LAST_PLAYLIST_KEY)) ?? '';
  return jsonResponse({ playlists, last_playlist: lastPlaylist });
});

router.post('/api/import-prefs', async (req) => {
  const { last_playlist } = JSON.parse(String(req.body)) as { last_playlist?: string };
  await songloft.storage.set(LAST_PLAYLIST_KEY, last_playlist ?? '');
  return jsonResponse({ ok: true });
});

// --- 向 miot 注册为「外部搜索源候选」（可选增强） ---
// 延迟 + 重试调用，避免与 miot 同时启动时对方尚未就绪的竞态；
// miot 未安装 / host 不支持 comm 时静默跳过，绝不阻塞自身功能。
function registerSearchProviderToMiot(): void {
  let attempts = 0;
  const tryRegister = async () => {
    attempts++;
    try {
      if (!songloft.comm || typeof songloft.comm.call !== 'function') return; // 旧 host 无 comm
      await songloft.comm.call('miot', 'register-search-provider', {
        name: '哔哩音乐',
        searchPath: '/api/search/topone',
      });
      songloft.log.info('[search] 已向 miot 注册搜索源候选');
    } catch (e) {
      if (attempts < 5) {
        setTimeout(tryRegister, 3000);
      } else {
        songloft.log.info('[search] miot 未安装/未就绪，放弃注册: ' + String(e));
      }
    }
  };
  setTimeout(tryRegister, 2000);
}

// --- 生命周期 ---
globalThis.onInit = async () => {
  registerSearchProviderToMiot();
  await startFavoriteWatcher();
};
globalThis.onHTTPRequest = (req) => router.handle(req);
