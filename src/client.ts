/// <reference types="@songloft/plugin-sdk" />

// B站 API 统一 fetch 封装：默认头 + Cookie 注入 + WBI 可选签名 + {code,message,data} 解析。

import { UA, REFERER, API_BASE } from './consts';
import { getCookieString } from './store';
import { getWbiEncodedQuery } from './wbi';
import { assertBiliAvailable, biliRequestJSON } from './request-control';

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
  await assertBiliAvailable();
  const base = opts.base || API_BASE;
  let qs = '';
  if (opts.wbi) qs = await getWbiEncodedQuery(params);
  else qs = plainQuery(params);
  const url = base + path + (qs ? `?${qs}` : '');

  return biliRequestJSON(url, await biliHeaders(), opts.allowNonZero);
}
