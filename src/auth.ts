/// <reference types="@songloft/plugin-sdk" />

// B站登录：二维码登录 + 手动 Cookie 粘贴。
// 二维码流程：generate 申请 → 前端渲染二维码 → poll 轮询扫码状态 →
//   成功后从 poll 响应的 data.url 查询参数(优先)或 Set-Cookie 提取 SESSDATA 等，存入 storage。

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { RouteHandler } from '@songloft/plugin-sdk';
import { UA, REFERER, API_BASE, PASSPORT_BASE } from './consts';
import { biliGet } from './client';
import { getCookieMap, getCookieString, mergeCookies, setCookieFromString, clearCookie } from './store';

const LOGIN_COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

/** 匿名获取 buvid3/buvid4（游客指纹），提升搜索接口稳定性；已存在则跳过 */
export async function ensureBuvid(): Promise<void> {
  const m = await getCookieMap();
  if (m.buvid3) return;
  try {
    const resp = await fetch(`${API_BASE}/x/frontend/finger/spi`, {
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const j = JSON.parse(await resp.text());
    if (j.code === 0 && j.data) {
      const upd: Record<string, string> = {};
      if (j.data.b_3) upd.buvid3 = j.data.b_3;
      if (j.data.b_4) upd.buvid4 = j.data.b_4;
      if (Object.keys(upd).length) await mergeCookies(upd);
    }
  } catch {
    // best-effort
  }
}

function cookiesFromUrl(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return out;
  for (const part of url.slice(qIdx + 1).split('&')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = decodeURIComponent(part.slice(0, i));
    const v = decodeURIComponent(part.slice(i + 1));
    if (LOGIN_COOKIE_NAMES.includes(k)) out[k] = v;
  }
  return out;
}

function cookiesFromSetCookie(resp: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const h = (resp.headers as unknown as Record<string, string>) || {};
  let raw = '';
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === 'set-cookie') {
      raw = h[k];
      break;
    }
  }
  if (!raw) return out;
  for (const name of LOGIN_COOKIE_NAMES) {
    const mm = raw.match(new RegExp(name + '=([^;,]+)'));
    if (mm) out[name] = mm[1];
  }
  return out;
}

// GET /api/login/qrcode → { url, qrcode_key }
export const qrcodeHandler: RouteHandler = async () => {
  const resp = await fetch(`${PASSPORT_BASE}/x/passport-login/web/qrcode/generate`, {
    headers: { 'User-Agent': UA, Referer: REFERER },
  });
  const j = JSON.parse(await resp.text());
  if (j.code !== 0) return jsonResponse({ error: j.message || '申请二维码失败' }, 500);
  return jsonResponse({ url: j.data.url, qrcode_key: j.data.qrcode_key });
};

// GET /api/login/poll?key=xxx → { status, message }
// status: 0 成功 / 86101 待扫码 / 86090 已扫码待确认 / 86038 已过期
export const pollHandler: RouteHandler = async (req) => {
  const q = parseQuery(req.query);
  const key = q.key || q.qrcode_key;
  if (!key) return jsonResponse({ error: 'missing key' }, 400);

  const resp = await fetch(
    `${PASSPORT_BASE}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`,
    { headers: { 'User-Agent': UA, Referer: REFERER } },
  );
  const j = JSON.parse(await resp.text());
  const status = j.data?.code;

  if (status === 0) {
    const cookies = cookiesFromUrl(j.data.url || '');
    Object.assign(cookies, cookiesFromSetCookie(resp));
    if (cookies.SESSDATA) {
      await mergeCookies(cookies);
      await ensureBuvid();
      return jsonResponse({ status: 0, message: '登录成功' });
    }
    return jsonResponse({ status: -1, message: '登录成功但未取到凭证' });
  }
  return jsonResponse({ status, message: j.data?.message || '' });
};

// POST /api/login/cookie  body { cookie }
export const cookieLoginHandler: RouteHandler = async (req) => {
  const body = JSON.parse(String(req.body) || '{}');
  const cookie = String(body.cookie || '').trim();
  if (!cookie) return jsonResponse({ error: 'cookie required' }, 400);
  await setCookieFromString(cookie);
  await ensureBuvid();
  try {
    const j = await biliGet('/x/web-interface/nav', {}, { allowNonZero: true });
    return jsonResponse({ logged_in: !!j.data?.isLogin, uname: j.data?.uname || '' });
  } catch (e: any) {
    return jsonResponse({ logged_in: false, error: e.message });
  }
};

// GET /api/login/status
export const statusHandler: RouteHandler = async () => {
  const cookie = await getCookieString();
  if (!cookie) return jsonResponse({ logged_in: false });
  try {
    const j = await biliGet('/x/web-interface/nav', {}, { allowNonZero: true });
    const d = j.data || {};
    return jsonResponse({
      logged_in: !!d.isLogin,
      uname: d.uname || '',
      mid: d.mid || 0,
      face: d.face || '',
      vip: d.vipStatus || 0,
    });
  } catch (e: any) {
    return jsonResponse({ logged_in: false, error: e.message });
  }
};

// POST /api/logout
export const logoutHandler: RouteHandler = async () => {
  await clearCookie();
  return jsonResponse({ ok: true });
};
