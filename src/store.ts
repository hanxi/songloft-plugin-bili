/// <reference types="@songloft/plugin-sdk" />

// Cookie 与设置的持久化（songloft.storage）。
// Cookie 以 map 形式存储，序列化为 "k=v; k2=v2" 请求头。

export interface Settings {
  audio_quality: 'high' | 'medium' | 'low';
  enable_dolby: boolean;
  enable_hires: boolean;
  path_template: string;
  embed_metadata: boolean;
  download_interval: number;
}

const DEFAULTS: Settings = {
  audio_quality: 'high',
  enable_dolby: false,
  enable_hires: false,
  path_template: 'bili/{artist}/{title}',
  embed_metadata: true,
  download_interval: 2,
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

export function parseCookieString(s: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const part of s.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) m[k] = v;
  }
  return m;
}

export async function getCookieMap(): Promise<Record<string, string>> {
  return ((await songloft.storage.get('cookie')) as Record<string, string> | null) || {};
}

export async function getCookieString(): Promise<string> {
  const m = await getCookieMap();
  return Object.keys(m)
    .map((k) => `${k}=${m[k]}`)
    .join('; ');
}

/** 合并式写入（用于登录/追加 buvid），保留已有键 */
export async function mergeCookies(updates: Record<string, string>): Promise<void> {
  const m = await getCookieMap();
  Object.assign(m, updates);
  await songloft.storage.set('cookie', m);
}

/** 覆盖式写入（用于手动粘贴 Cookie） */
export async function setCookieFromString(s: string): Promise<void> {
  await songloft.storage.set('cookie', parseCookieString(s));
}

export async function clearCookie(): Promise<void> {
  await songloft.storage.delete('cookie');
}
