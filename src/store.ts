/// <reference types="@songloft/plugin-sdk" />

// Cookie 与设置的持久化（songloft.storage）。
// Cookie 以 map 形式存储，序列化为 "k=v; k2=v2" 请求头。
//
// 名值对的解析/序列化用 SDK 的 parseCookieHeader / stringifyCookieHeader
// （songloft-org/songloft#401）。注意这里处理的是**请求**头 Cookie，
// 与 auth.ts 里解析**响应**头 Set-Cookie 的 parseSetCookie 语义不同，别混用。

import { parseCookieHeader, stringifyCookieHeader } from '@songloft/plugin-sdk';

export interface Settings {
  audio_quality: 'high' | 'medium' | 'low';
  enable_dolby: boolean;
  enable_hires: boolean;
  path_template: string;
  embed_metadata: boolean;
  download_interval: number;
  // 下载转码：''=原始(不转码，B站源通常为 .mov 无法刮削歌词)；mp3/m4a=转成标准音频容器
  transcode_format: '' | 'mp3' | 'm4a';
  // 转码码率：0=默认最高质量；128/192/320=指定 CBR。transcode_format 为 '' 时忽略
  transcode_bitrate: 0 | 128 | 192 | 320;
}

const DEFAULTS: Settings = {
  audio_quality: 'high',
  enable_dolby: false,
  enable_hires: false,
  path_template: 'bili/{artist}/{title}',
  embed_metadata: true,
  download_interval: 2,
  transcode_format: '',
  transcode_bitrate: 0,
};

export async function getSettings(): Promise<Settings> {
  const stored = (await songloft.storage.get('settings')) as Partial<Settings> | null;
  return { ...DEFAULTS, ...(stored || {}) };
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const updated = { ...(await getSettings()), ...partial };
  await songloft.storage.set('settings', updated);
  return updated;
}

// ---- Cookie ----

export async function getCookieMap(): Promise<Record<string, string>> {
  return ((await songloft.storage.get('cookie')) as Record<string, string> | null) || {};
}

export async function getCookieString(): Promise<string> {
  return stringifyCookieHeader(await getCookieMap());
}

/** 合并式写入（用于登录/追加 buvid），保留已有键 */
export async function mergeCookies(updates: Record<string, string>): Promise<void> {
  const m = await getCookieMap();
  Object.assign(m, updates);
  await songloft.storage.set('cookie', m);
}

/** 覆盖式写入（用于手动粘贴 Cookie） */
export async function setCookieFromString(s: string): Promise<void> {
  await songloft.storage.set('cookie', parseCookieHeader(s));
}

export async function clearCookie(): Promise<void> {
  await songloft.storage.delete('cookie');
}
