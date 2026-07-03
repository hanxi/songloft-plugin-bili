/// <reference types="@songloft/plugin-sdk" />

import { biliGet } from './client';
import { durationToSeconds, normPic, type BiliVideo } from './search';

export interface ExtractResult {
  items: BiliVideo[];
  playlist_title: string;
  platform: string;
}

interface VideoRef {
  bvid?: string;
  aid?: number;
}

interface SpaceListRef {
  mid: number;
  id: number;
  type?: string;
}

const MAX_PAGES = 50;

export async function extractFromURL(rawUrl: string): Promise<ExtractResult> {
  const url = rawUrl.trim();
  if (!url) throw new Error('url is required');

  const mediaId = extractMediaListId(url);
  if (mediaId) return extractMediaList(mediaId);

  const spaceList = parseSpaceListURL(url);
  if (spaceList) return extractSpaceList(spaceList);

  const videoRef = parseVideoRef(url);
  if (videoRef) return extractVideo(videoRef);

  throw new Error('不支持的 B站 URL，当前支持视频/分P、收藏夹/播单、空间合集/列表链接');
}

export async function extractVideoParts(bvid: string): Promise<ExtractResult> {
  const id = bvid.trim();
  if (!/^BV[0-9A-Za-z]+$/i.test(id)) throw new Error('invalid bvid');
  return extractVideo({ bvid: id });
}

async function extractVideo(ref: VideoRef): Promise<ExtractResult> {
  const params = ref.bvid ? { bvid: ref.bvid } : { aid: ref.aid || 0 };
  const j = await biliGet('/x/web-interface/view', params);
  const data = j.data || {};
  const items = mapArchivePages(data);

  if (items.length === 0) {
    throw new Error('未提取到可导入的视频分P');
  }

  return {
    items,
    playlist_title: data.title || items[0]?.title || '',
    platform: 'bili',
  };
}

async function extractMediaList(mediaId: number): Promise<ExtractResult> {
  const items: BiliVideo[] = [];
  let title = '';
  let pn = 1;
  const ps = 20;

  for (;;) {
    const j = await biliGet('/x/v3/fav/resource/list', {
      media_id: mediaId,
      pn,
      ps,
      platform: 'web',
    });

    if (!title) title = j.data?.info?.title || j.data?.info?.name || '';
    const medias = (j.data?.medias || []) as any[];
    items.push(...medias.map(mapMediaItem).filter((x): x is BiliVideo => !!x));

    if (!j.data?.has_more || medias.length === 0 || pn >= MAX_PAGES) break;
    pn++;
  }

  return {
    items,
    playlist_title: title || `B站歌单 ${mediaId}`,
    platform: 'bili',
  };
}

async function extractSpaceList(ref: SpaceListRef): Promise<ExtractResult> {
  if (ref.type === 'season') return extractSeasonList(ref);
  if (ref.type === 'series') return extractSeriesList(ref);

  try {
    return await extractSeriesList(ref);
  } catch (seriesErr: any) {
    try {
      return await extractSeasonList(ref);
    } catch {
      throw seriesErr;
    }
  }
}

async function extractSeriesList(ref: SpaceListRef): Promise<ExtractResult> {
  const items: BiliVideo[] = [];
  let pn = 1;
  const ps = 30;

  for (;;) {
    const j = await biliGet('/x/series/archives', {
      mid: ref.mid,
      series_id: ref.id,
      only_normal: 'true',
      sort: 'desc',
      pn,
      ps,
    });
    const archives = (j.data?.archives || []) as any[];
    items.push(...archives.map(mapArchiveItem).filter((x): x is BiliVideo => !!x));

    const total = Number(j.data?.page?.total || 0);
    if (archives.length === 0 || pn >= MAX_PAGES || (total > 0 && pn * ps >= total)) break;
    pn++;
  }

  if (items.length === 0) throw new Error('未提取到空间列表视频');
  return {
    items,
    playlist_title: `B站列表 ${ref.id}`,
    platform: 'bili',
  };
}

async function extractSeasonList(ref: SpaceListRef): Promise<ExtractResult> {
  const items: BiliVideo[] = [];
  let title = '';
  let pageNum = 1;
  const pageSize = 30;

  for (;;) {
    const j = await biliGet('/x/polymer/web-space/seasons_archives_list', {
      mid: ref.mid,
      season_id: ref.id,
      sort_reverse: 'false',
      page_num: pageNum,
      page_size: pageSize,
    });

    if (!title) title = j.data?.meta?.name || j.data?.season?.title || '';
    const archives = (j.data?.archives || []) as any[];
    items.push(...archives.map(mapArchiveItem).filter((x): x is BiliVideo => !!x));

    const total = Number(j.data?.page?.total || 0);
    if (archives.length === 0 || pageNum >= MAX_PAGES || (total > 0 && pageNum * pageSize >= total)) break;
    pageNum++;
  }

  if (items.length === 0) throw new Error('未提取到空间合集视频');
  return {
    items,
    playlist_title: title || `B站合集 ${ref.id}`,
    platform: 'bili',
  };
}

function mapArchivePages(data: any): BiliVideo[] {
  const pages = Array.isArray(data.pages) && data.pages.length > 0
    ? data.pages
    : (data.cid ? [{ cid: data.cid, page: 1, part: data.title, duration: data.duration }] : []);
  const total = pages.length;
  const bvid = String(data.bvid || '');
  const aid = Number(data.aid || 0);
  const author = data.owner?.name || data.author || '';
  const cover = normPic(data.pic || data.cover || '');

  return pages
    .filter((p: any) => p?.cid && bvid)
    .map((p: any) => {
      const page = Number(p.page || 1);
      return {
        bvid,
        aid,
        cid: Number(p.cid),
        page,
        title: total > 1 ? (p.part || `${data.title || bvid} P${page}`) : (data.title || p.part || bvid),
        author,
        cover,
        duration: durationToSeconds(p.duration || data.duration || 0),
        url: `https://www.bilibili.com/video/${bvid}` + (total > 1 ? `?p=${page}` : ''),
      };
    });
}

function mapArchiveItem(x: any): BiliVideo | null {
  const bvid = String(x.bvid || '');
  if (!bvid) return null;
  return {
    bvid,
    aid: Number(x.aid || 0),
    title: x.title || '',
    author: x.owner?.name || x.author || x.author_name || '',
    cover: normPic(x.pic || x.cover || ''),
    duration: durationToSeconds(x.duration || 0),
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

function mapMediaItem(x: any): BiliVideo | null {
  const bvid = String(x.bvid || '');
  if (!bvid) return null;
  return {
    bvid,
    aid: Number(x.id || x.aid || 0),
    title: x.title || '',
    author: x.upper?.name || x.author || '',
    cover: normPic(x.cover || x.pic || ''),
    duration: durationToSeconds(x.duration || 0),
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

function parseVideoRef(url: string): VideoRef | null {
  const bv = url.match(/BV[0-9A-Za-z]+/i)?.[0];
  if (bv) return { bvid: bv };

  const av = url.match(/(?:\/video\/|^|[?&])av(\d+)/i)?.[1] || getQueryParam(url, 'aid');
  if (av) return { aid: Number(av) };

  return null;
}

function extractMediaListId(url: string): number | null {
  const fromPath = url.match(/(?:medialist\/play\/|list\/)(?:ml)?(\d+)/i)?.[1]
    || url.match(/\bml(\d+)\b/i)?.[1];
  const raw = fromPath || getQueryParam(url, 'fid') || getQueryParam(url, 'media_id') || getQueryParam(url, 'mlid');
  const id = raw ? Number(raw) : 0;
  return id > 0 ? id : null;
}

function parseSpaceListURL(url: string): SpaceListRef | null {
  if (!/space\.bilibili\.com/i.test(url)) return null;

  const mid = Number(url.match(/space\.bilibili\.com\/(\d+)/i)?.[1] || 0);
  if (!mid) return null;

  const listId = Number(url.match(/\/lists\/(\d+)/i)?.[1] || getQueryParam(url, 'sid') || 0);
  if (!listId) return null;

  return {
    mid,
    id: listId,
    type: getQueryParam(url, 'type') || undefined,
  };
}

function getQueryParam(rawUrl: string, key: string): string {
  const match = rawUrl.match(new RegExp(`[?&]${key}=([^&#]+)`, 'i'));
  return match ? decodeURIComponent(match[1]) : '';
}
