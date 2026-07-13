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
import { startBatchDownload, getBatchTask, clearBatchTask } from './downloader';
import { musicUrlHandler } from './music-url';
import { getSettings, saveSettings } from './store';
import { extractFromURL, extractVideoParts } from './extractor';
import type { BiliVideo } from './search';

const router = createRouter();

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
  const { items, playlist_name, playlist_id } = JSON.parse(String(req.body)) as {
    items: BiliVideo[];
    playlist_name?: string;
    playlist_id?: number;
  };
  if (!items || items.length === 0) return jsonResponse({ error: 'items is required' }, 400);
  try {
    const result = await importSongs(items, playlist_name, playlist_id);
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
  const { items, playlist_name, playlist_id } = JSON.parse(String(req.body)) as {
    items: BiliVideo[];
    playlist_name?: string;
    playlist_id?: number;
  };
  if (!items || items.length === 0) return jsonResponse({ error: 'items is required' }, 400);
  try {
    const result = await importSongs(items, playlist_name, playlist_id);
    await startBatchDownload(result.songs.map((s) => s.id));
    return jsonResponse({
      count: result.songs.length,
      total: result.total,
      failed: result.failed,
      playlist_id: result.playlist_id,
      download_started: true,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

// --- 批量下载 ---
router.post('/api/download-batch', async (req) => {
  const { song_ids } = JSON.parse(String(req.body)) as { song_ids: number[] };
  if (!song_ids || song_ids.length === 0) return jsonResponse({ error: 'song_ids is required' }, 400);
  await startBatchDownload(song_ids);
  return jsonResponse({ started: true, total: song_ids.length });
});

router.get('/api/download-batch/progress', async () => {
  const task = getBatchTask();
  if (!task) return jsonResponse({ active: false });
  const success = task.results.filter((r) => r.status !== 'failed').length;
  const failed = task.results.filter((r) => r.status === 'failed').length;
  return jsonResponse({
    active: true,
    current: task.current,
    total: task.total,
    done: task.done,
    success,
    failed,
  });
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
  const body = JSON.parse(String(req.body));
  return jsonResponse(await saveSettings(body));
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
};
globalThis.onHTTPRequest = (req) => router.handle(req);
