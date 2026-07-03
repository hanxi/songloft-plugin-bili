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
    return jsonResponse({ count: result.songs.length, playlist_id: result.playlist_id });
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

// --- 生命周期 ---
globalThis.onHTTPRequest = (req) => router.handle(req);
