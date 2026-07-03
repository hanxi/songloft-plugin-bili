/// <reference types="@songloft/plugin-sdk" />

// 搜索：UI 搜索(/api/search/videos) + 音源匹配(/api/search, createSearchHandler)。
// 均调 /x/web-interface/wbi/search/type（需 WBI 签名）。

import { jsonResponse, createSearchHandler } from '@songloft/plugin-sdk';
import type { RouteHandler, SearchResultItem } from '@songloft/plugin-sdk';
import { biliGet } from './client';
import { ensureBuvid } from './auth';

export interface BiliVideo {
  bvid: string;
  aid: number;
  title: string;
  author: string;
  cover: string;
  duration: number;
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

function normPic(pic: string): string {
  if (!pic) return '';
  if (pic.startsWith('http')) return pic;
  if (pic.startsWith('//')) return 'https:' + pic;
  return pic;
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
      source_data: { bvid: v.bvid, aid: v.aid },
    }));
  },
});
