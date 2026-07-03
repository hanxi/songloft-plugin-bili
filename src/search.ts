/// <reference types="@songloft/plugin-sdk" />

// 搜索：UI 搜索(/api/search/videos) + 音源匹配(/api/search, createSearchHandler)。
// 均调 /x/web-interface/wbi/search/type（需 WBI 签名）。

import { jsonResponse, createSearchHandler } from '@songloft/plugin-sdk';
import type { HTTPRequest, RouteHandler, SearchResultItem } from '@songloft/plugin-sdk';
import { biliGet } from './client';
import { ensureBuvid } from './auth';
import { resolveBiliAudioUrl, type BiliSourceData } from './music-url';

export interface BiliVideo {
  bvid: string;
  aid: number;
  cid?: number;
  page?: number;
  title: string;
  author: string;
  cover: string;
  duration: number;
  url?: string;
  part_count?: number;
}

function cleanTitle(t: string): string {
  return (t || '').replace(/<[^>]+>/g, '');
}

/** 时长 "MM:SS" / "HH:MM:SS" → 秒；数字直接返回 */
export function durationToSeconds(d: string | number): number {
  if (typeof d === 'number') return d;
  if (!d) return 0;
  const parts = d.split(':').map((x) => parseInt(x, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function normPic(pic: string): string {
  if (!pic) return '';
  if (pic.startsWith('http')) return pic;
  if (pic.startsWith('//')) return 'https:' + pic;
  return pic;
}

function parseBody(req: HTTPRequest): any {
  if (!req.body) return {};
  try {
    const str = typeof req.body === 'string'
      ? req.body
      : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array));
    return JSON.parse(str);
  } catch {
    return {};
  }
}

export function sourceDataForVideo(v: BiliVideo): BiliSourceData {
  const data: BiliSourceData = { bvid: v.bvid, aid: v.aid || undefined };
  if (v.cid) data.cid = v.cid;
  if (v.page) data.page = v.page;
  return data;
}

export function dedupKeyForVideo(v: BiliVideo): string {
  if (v.cid) return `bili:${v.bvid}:cid:${v.cid}`;
  if (v.page) return `bili:${v.bvid}:p${v.page}`;
  return `bili:${v.bvid}`;
}

export async function searchVideos(keyword: string, page = 1): Promise<BiliVideo[]> {
  await ensureBuvid();
  const j = await biliGet(
    '/x/web-interface/wbi/search/type',
    { search_type: 'video', keyword, page },
    { wbi: true },
  );
  const list = (j.data?.result || []) as any[];
  return list
    .filter((x) => x.bvid)
    .map((x) => ({
      bvid: x.bvid,
      aid: x.aid,
      title: cleanTitle(x.title),
      author: x.author || '',
      cover: normPic(x.pic || ''),
      duration: durationToSeconds(x.duration),
      url: `https://www.bilibili.com/video/${x.bvid}`,
      part_count: Number(x.part_count || x.pages || x.page_count || 0) || undefined,
    }));
}

// POST /api/search/videos  body { keyword, page } → { results: BiliVideo[] }
export const searchVideosHandler: RouteHandler = async (req) => {
  const body = JSON.parse(String(req.body) || '{}');
  const keyword = String(body.keyword || '').trim();
  const page = typeof body.page === 'number' ? body.page : 1;
  if (!keyword) return jsonResponse({ error: 'keyword required' }, 400);
  try {
    const results = await searchVideos(keyword, page);
    return jsonResponse({ results });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};

// POST /api/search  音源匹配（主程序 fan-out）
export const searchHandler = createSearchHandler({
  search: async (keyword, page) => {
    const vids = await searchVideos(keyword, page || 1);
    return vids.map<SearchResultItem>((v) => ({
      title: v.title,
      artist: v.author,
      album: '',
      duration: v.duration,
      cover_url: v.cover,
      source_data: sourceDataForVideo(v),
    }));
  },
});

// POST /api/search/topone  body { keyword, hint?, quality? }
// 返回 miot/ytdlp/subsonic 兼容的 topone 响应。
export const toponeHandler: RouteHandler = async (req) => {
  const body = parseBody(req);
  const keyword = String(body.keyword || '').trim();
  const hint: { title?: string; artist?: string; duration?: number } | undefined = body.hint;

  if (!keyword) return jsonResponse({ code: 400, msg: '缺少 keyword', data: null }, 400);

  let results: BiliVideo[];
  try {
    results = await searchVideos(keyword, 1);
  } catch (e: any) {
    songloft.log.warn(`[search/topone] B站搜索失败: ${e.message || String(e)}`);
    return jsonResponse({ code: 404, msg: 'search failed', data: null });
  }

  const candidates = results
    .map((item) => ({ item, score: scoreCandidate(item, hint) }))
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return jsonResponse({ code: 404, msg: 'song not found', data: null });
  }

  let lastError = '';
  for (const { item } of candidates) {
    try {
      const withPage = await ensureFirstPage(item);
      const sourceData = sourceDataForVideo(withPage);
      const resolved = await resolveBiliAudioUrl(sourceData);

      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          title: withPage.title,
          artist: withPage.author,
          album: '',
          duration: withPage.duration,
          cover_url: withPage.cover,
          url: resolved.url,
          plugin_entry_path: 'bili',
          source_data: sourceData,
          dedup_key: dedupKeyForVideo(withPage),
        },
      });
    } catch (e: any) {
      lastError = e.message || String(e);
    }
  }

  songloft.log.warn(`[search/topone] 所有候选 URL 获取均失败，最后错误: ${lastError}`);
  return jsonResponse({ code: 404, msg: 'song not found', data: null });
};

function scoreCandidate(item: BiliVideo, hint?: { title?: string; artist?: string; duration?: number }): number {
  if (!hint) return 1;

  let score = 0;
  const title = item.title || '';
  const artist = item.author || '';

  if (hint.title) {
    if (title === hint.title) score += 0.5;
    else if (title.includes(hint.title) || hint.title.includes(title)) score += 0.3;
  }
  if (hint.artist) {
    if (artist === hint.artist) score += 0.3;
    else if (artist.includes(hint.artist) || hint.artist.includes(artist)) score += 0.15;
  }
  if (hint.duration && item.duration) {
    const diff = Math.abs(hint.duration - item.duration);
    if (diff <= 3) score += 0.15;
    else if (diff <= 10) score += 0.08;
  }

  return score;
}

async function ensureFirstPage(item: BiliVideo): Promise<BiliVideo> {
  if (item.cid) return item;

  const j = await biliGet('/x/player/pagelist', { bvid: item.bvid });
  const page = j.data?.[0];
  if (!page?.cid) return item;

  return {
    ...item,
    cid: Number(page.cid),
    page: Number(page.page || 1),
    duration: durationToSeconds(page.duration || item.duration || 0),
  };
}
