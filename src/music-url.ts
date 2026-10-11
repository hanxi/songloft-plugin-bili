/// <reference types="@songloft/plugin-sdk" />

// 按需播放：source_data(bvid[,cid]) → playurl 真实音频 URL。
// 返回 { url, headers }，headers 携带 Referer，经主程序 header 通道在代理拉取时应用（否则 403）。

import { jsonResponse, type RouteHandler } from '@songloft/plugin-sdk';
import { biliGet } from './client';
import { getSettings, type Settings } from './store';
import { playbackHeaders } from './consts';
import { BiliApiError, safeBiliMessage } from './request-control';

export type BiliSourceData = {
  bvid?: string;
  cid?: number;
  aid?: number;
  page?: number;
};

interface DashAudio {
  id: number;
  baseUrl: string;
}

function pickAudio(audios: DashAudio[], quality: Settings['audio_quality']): DashAudio {
  const sorted = [...audios].sort((a, b) => b.id - a.id); // 高→低
  if (quality === 'high') return sorted[0];
  if (quality === 'low') return sorted[sorted.length - 1];
  // medium: 取 <=30280(192K) 的最高，否则最低
  const mid = sorted.find((a) => a.id <= 30280);
  return mid || sorted[sorted.length - 1];
}

async function resolveCid(bvid: string): Promise<number> {
  const j = await biliGet('/x/player/pagelist', { bvid });
  const cid = j.data?.[0]?.cid;
  if (!cid) throw new Error('无法获取 cid');
  return cid;
}

export async function resolveBiliAudioUrl(sourceData: BiliSourceData): Promise<{ url: string; headers: Record<string, string> }> {
  const sd = sourceData;
  if (!sd.bvid) throw new Error('source_data 缺少 bvid');

  const cid = sd.cid || (await resolveCid(sd.bvid));
  const settings = await getSettings();

  const j = await biliGet(
    '/x/player/wbi/playurl',
    { bvid: sd.bvid, cid, fnval: 4048, fnver: 0, fourk: 1 },
    { wbi: true },
  );

  const dash = j.data?.dash;
  let url = '';
  if (dash?.audio?.length) {
    let chosen = pickAudio(dash.audio as DashAudio[], settings.audio_quality);
    if (settings.enable_hires && dash.flac?.audio?.baseUrl) {
      chosen = dash.flac.audio as DashAudio;
    } else if (settings.enable_dolby && dash.dolby?.audio?.length) {
      chosen = dash.dolby.audio[0] as DashAudio;
    }
    url = chosen?.baseUrl || '';
  } else if (j.data?.durl?.[0]?.url) {
    url = j.data.durl[0].url; // 老视频无 dash，整段 mp4
  }

  if (!url) throw new Error('未取到音频地址');
  return { url, headers: playbackHeaders() };
}

export function biliErrorResponse(error: BiliApiError) {
  return jsonResponse(
    {
      error: error.kind,
      detail: error.message,
      http_status: error.httpStatus,
      bili_code: error.upstreamCode,
      cooldown_until: error.cooldownUntil,
    },
    error.kind === 'risk_control' ? 429 : error.kind === 'source_not_available' ? 404 : 502,
  );
}

// SDK 的通用 handler 会丢弃 resolveUrl 异常；在这里保留上游错误供下载器分类。
export const musicUrlHandler: RouteHandler = async (req) => {
  let body: any;
  try {
    body = JSON.parse(String(req.body || '{}'));
  } catch {
    return jsonResponse({ error: 'invalid json body' }, 400);
  }
  const sourceData = body?.source_data;
  if (
    !sourceData ||
    typeof sourceData.bvid !== 'string' ||
    !sourceData.bvid.trim() ||
    (sourceData.cid !== undefined && (!Number.isInteger(sourceData.cid) || sourceData.cid < 0))
  ) {
    return jsonResponse(
      { error: 'source_data requires bvid and an optional nonnegative integer cid' },
      400,
    );
  }
  try {
    return jsonResponse(await resolveBiliAudioUrl(sourceData));
  } catch (error) {
    if (error instanceof BiliApiError) return biliErrorResponse(error);
    return jsonResponse(
      {
        error: 'source_not_available',
        detail: safeBiliMessage((error as Error)?.message || error),
      },
      404,
    );
  }
};
