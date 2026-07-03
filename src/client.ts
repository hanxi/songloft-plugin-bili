/// <reference types="@songloft/plugin-sdk" />

// B站 API 统一 fetch 封装：默认头 + Cookie 注入 + WBI 可选签名 + {code,message,data} 解析。

import { UA, REFERER, API_BASE } from './consts';
import { getCookieString } from './store';
import { getWbiEncodedQuery } from './wbi';

export interface BiliResp {
  code: number;
  message?: string;
  data?: any;
}

async function biliHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Referer: REFERER,
    Origin: 'https://www.bilibili.com',
  };
  const cookie = await getCookieString();
  if (cookie) h.Cookie = cookie;
  return h;
}

function plainQuery(params: Record<string, string | number>): string {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

export async function biliGet(
  path: string,
  params: Record<string, string | number> = {},
  opts: { wbi?: boolean; base?: string; allowNonZero?: boolean } = {},
): Promise<BiliResp> {
  const base = opts.base || API_BASE;
  let qs = '';
  if (opts.wbi) qs = await getWbiEncodedQuery(params);
  else qs = plainQuery(params);
  const url = base + path + (qs ? `?${qs}` : '');

  const resp = await fetch(url, { headers: await biliHeaders() });
  const text = await resp.text();
  let j: BiliResp;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`B站返回非 JSON (HTTP ${resp.status}): ${text.slice(0, 150)}`);
  }
  if (j.code !== 0 && !opts.allowNonZero) {
    throw new Error(`B站接口错误 ${j.code}: ${j.message || 'unknown'}`);
  }
  return j;
}
