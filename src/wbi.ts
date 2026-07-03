/// <reference types="@songloft/plugin-sdk" />

// B站 WBI 签名。核心 w_rid = md5(query + mixin_key)。
// mixin_key 由 img_key + sub_key 按固定表重排取前 32 位；
// img_key/sub_key 来自 /x/web-interface/nav 的 wbi_img.{img_url,sub_url}，每日缓存。

import { UA, REFERER, API_BASE } from './consts';
import { getCookieString } from './store';

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
  56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

function getMixinKey(orig: string): string {
  return mixinKeyEncTab
    .map((n) => orig[n])
    .join('')
    .slice(0, 32);
}

function md5(s: string): string {
  return __go_crypto_md5(s);
}

export function encWbi(params: Record<string, string | number>, imgKey: string, subKey: string): string {
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const p: Record<string, string | number> = { ...params, wts };
  const query = Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  const wRid = md5(query + mixinKey);
  return `${query}&w_rid=${wRid}`;
}

interface WbiKeys {
  imgKey: string;
  subKey: string;
  ts: number;
}

function sameDay(ts: number): boolean {
  const a = new Date(ts);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

async function fetchWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: REFERER };
  const cookie = await getCookieString();
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(`${API_BASE}/x/web-interface/nav`, { headers });
  const j = JSON.parse(await resp.text());
  const imgUrl: string = j?.data?.wbi_img?.img_url || '';
  const subUrl: string = j?.data?.wbi_img?.sub_url || '';
  const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
  const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
  if (!imgKey || !subKey) throw new Error('WBI keys 获取失败');
  return { imgKey, subKey };
}

async function getWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  const cached = (await songloft.storage.get('wbi_keys')) as WbiKeys | null;
  if (cached && cached.imgKey && sameDay(cached.ts)) {
    return { imgKey: cached.imgKey, subKey: cached.subKey };
  }
  const keys = await fetchWbiKeys();
  await songloft.storage.set('wbi_keys', { ...keys, ts: Date.now() });
  return keys;
}

/** 对参数做 WBI 签名，返回完整 query string（含 wts & w_rid）。 */
export async function getWbiEncodedQuery(params: Record<string, string | number>): Promise<string> {
  const keys = await getWbiKeys();
  return encWbi(params, keys.imgKey, keys.subKey);
}
