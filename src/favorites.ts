/// <reference types="@songloft/plugin-sdk" />

// B站收藏夹：列表 + 内容 + 整夹导入。
//   /x/v3/fav/folder/created/list-all?up_mid=  收藏夹列表
//   /x/v3/fav/resource/list?media_id=&pn=&ps=  收藏夹内容（分页）

import { jsonResponse } from '@songloft/plugin-sdk';
import type { RouteHandler } from '@songloft/plugin-sdk';
import { biliGet } from './client';
import { durationToSeconds, normPic, type BiliVideo } from './search';
import { importSongs } from './importer';

async function getLoginMid(): Promise<number> {
  const j = await biliGet('/x/web-interface/nav', {}, { allowNonZero: true });
  if (!j.data?.isLogin || !j.data?.mid) throw new Error('未登录');
  return j.data.mid;
}

// GET /api/favorites → { folders: [{id,title,count}] }
export const foldersHandler: RouteHandler = async () => {
  try {
    const mid = await getLoginMid();
    const j = await biliGet('/x/v3/fav/folder/created/list-all', { up_mid: mid });
    const folders = (j.data?.list || []).map((f: any) => ({
      id: f.id,
      title: f.title,
      count: f.media_count,
    }));
    return jsonResponse({ folders });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, e.message === '未登录' ? 401 : 500);
  }
};

/** 拉取收藏夹条目。all=true 时翻页拉全部（上限 50 页）。 */
export async function fetchFolderItems(mediaId: number, all: boolean, page = 1): Promise<BiliVideo[]> {
  const items: BiliVideo[] = [];
  let pn = page;
  const ps = 20;
  for (;;) {
    const j = await biliGet('/x/v3/fav/resource/list', {
      media_id: mediaId,
      pn,
      ps,
      platform: 'web',
    });
    const medias = (j.data?.medias || []) as any[];
    for (const m of medias) {
      if (!m.bvid) continue;
      items.push({
        bvid: m.bvid,
        aid: m.id,
        title: m.title || '',
        author: m.upper?.name || '',
        cover: normPic(m.cover || ''),
        duration: durationToSeconds(m.duration || 0),
        url: `https://www.bilibili.com/video/${m.bvid}`,
      });
    }
    if (!all || !j.data?.has_more || medias.length === 0) break;
    pn++;
    if (pn > 50) break;
  }
  return items;
}

// GET /api/favorites/:id → { results: BiliVideo[] }（仅首页预览）
export const folderContentHandler: RouteHandler = async (_req, params) => {
  try {
    const mediaId = parseInt(params.id, 10);
    if (isNaN(mediaId)) return jsonResponse({ error: 'invalid id' }, 400);
    const results = await fetchFolderItems(mediaId, false, 1);
    return jsonResponse({ results });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};

// POST /api/favorites/:id/import  body { title?, as_playlist? } → 整夹导入
export const folderImportHandler: RouteHandler = async (req, params) => {
  try {
    const mediaId = parseInt(params.id, 10);
    if (isNaN(mediaId)) return jsonResponse({ error: 'invalid id' }, 400);
    const body = JSON.parse(String(req.body) || '{}');
    const items = await fetchFolderItems(mediaId, true, 1);
    if (items.length === 0) return jsonResponse({ count: 0 });
    const playlistName = body.as_playlist ? String(body.title || `B站收藏夹`) : undefined;
    const result = await importSongs(items, playlistName);
    return jsonResponse({ count: result.songs.length, playlist_id: result.playlist_id });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};
