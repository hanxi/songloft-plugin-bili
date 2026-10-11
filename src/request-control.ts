/// <reference types="@songloft/plugin-sdk" />

// 业务 API、WBI 和下载入口共用冷却状态；登录二维码使用独立的 passport 接口。
const COOLDOWN_KEY = 'bili_api_cooldown_v1';
const COOLDOWN_MS = 30 * 60_000;
const REQUEST_INTERVAL_MS = 1000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface BiliCooldown {
  until: number;
  reason: string;
}

// 磁盘写入失败时仍保护当前运行；重启后的恢复依赖成功持久化。
let memoryCooldown: BiliCooldown | null = null;

export type BiliErrorKind = 'risk_control' | 'source_not_available' | 'upstream_error';

export function safeBiliMessage(value: unknown): string {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(
      /(?:SESSDATA|bili_jct|DedeUserID(?:__ckMd5)?|Authorization|Cookie)\s*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi,
      '[credential redacted]',
    )
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 300);
}

export class BiliApiError extends Error {
  constructor(
    public kind: BiliErrorKind,
    detail: string,
    public httpStatus?: number,
    public upstreamCode?: number,
    public cooldownUntil?: number,
  ) {
    super(`${kind}: ${safeBiliMessage(detail)}`);
  }
}

export async function getBiliCooldown(): Promise<BiliCooldown | null> {
  if (memoryCooldown && memoryCooldown.until <= Date.now()) memoryCooldown = null;
  let state: BiliCooldown | null;
  try {
    state = (await songloft.storage.get(COOLDOWN_KEY)) as BiliCooldown | null;
  } catch (error) {
    if (memoryCooldown) return { ...memoryCooldown };
    throw error;
  }
  if (
    state &&
    Number.isFinite(state.until) &&
    state.until > Date.now() &&
    state.until >= (memoryCooldown?.until || 0)
  ) {
    memoryCooldown = { until: state.until, reason: safeBiliMessage(state.reason) };
  }
  return memoryCooldown ? { ...memoryCooldown } : null;
}

export async function assertBiliAvailable(): Promise<void> {
  const state = await getBiliCooldown();
  if (state)
    throw new BiliApiError('risk_control', state.reason, undefined, undefined, state.until);
}

// 同一个环境内的并发风控响应也不能用较短的冷却覆盖较长的 Retry-After。
let cooldownWrite: Promise<unknown> = Promise.resolve();
export async function beginBiliCooldown(reason: string, retryAt = 0): Promise<BiliCooldown> {
  const operation = cooldownWrite.then(async () => {
    const existing = await getBiliCooldown();
    const state = {
      until: Math.max(Date.now() + COOLDOWN_MS, retryAt, existing?.until || 0),
      reason: safeBiliMessage(reason),
    };
    memoryCooldown = state;
    try {
      await songloft.storage.set(COOLDOWN_KEY, state);
    } catch (error) {
      songloft.log.warn(
        `风控冷却状态保存失败，当前运行仍保持冷却: ${safeBiliMessage((error as Error)?.message || error)}`,
      );
    }
    return state;
  });
  cooldownWrite = operation.catch(() => {});
  return operation;
}

export function isBiliRiskError(error: unknown): boolean {
  if (error instanceof BiliApiError) return error.kind === 'risk_control';
  // 宿主 Bridge 把响应变成 Error 字符串，匹配机器错误标识和明确的旧版限流信息。
  const message = String((error as Error)?.message || error);
  return /\brisk[\s_]*control\b|\bHTTP\s+(?:412|429)\b|B站接口错误\s+-412\b|访问过于频繁|请求被拦截|风控/i.test(
    message,
  );
}

function retryAfterTime(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(MAX_DATE_MS, Date.now() + seconds * 1000);
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function retryAfterHeader(response: Response): string | null {
  if (typeof response.headers?.get === 'function') return response.headers.get('Retry-After');
  // 旧宿主 fetch 的 headers 是普通对象，字段大小写由上游决定。
  const headers = (response.headers || {}) as unknown as Record<string, string>;
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'retry-after') return headers[name];
  }
  return null;
}

export interface BiliJSON {
  code: number;
  message?: string;
  data?: any;
}

let requestTail: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;

// 串行到响应分类完成，保证前一请求触发风控后，排队请求不会再发到上游。
export async function biliRequestJSON(
  url: string,
  headers: Record<string, string>,
  allowNonZero = false,
): Promise<BiliJSON> {
  const operation = requestTail.then(async () => {
    await assertBiliAvailable();
    const delay = nextRequestAt - Date.now();
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    await assertBiliAvailable();
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw new BiliApiError('upstream_error', safeBiliMessage((error as Error)?.message || error));
    }
    let body: BiliJSON | undefined;
    try {
      const parsed = JSON.parse(await response.text());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch {
      // 非 JSON 的风控页仍按 HTTP 状态分类，不把 HTML 或凭证写入错误响应。
    }
    const code = typeof body?.code === 'number' ? body.code : undefined;
    const detail = `B站 HTTP ${response.status}${code === undefined ? '' : `，接口错误 ${code}`}${body?.message ? `: ${safeBiliMessage(body.message)}` : ''}`;
    if (
      response.status === 412 ||
      response.status === 429 ||
      code === -412 ||
      isBiliRiskError(body?.message || '')
    ) {
      const state = await beginBiliCooldown(detail, retryAfterTime(retryAfterHeader(response)));
      throw new BiliApiError('risk_control', detail, response.status, code, state.until);
    }
    if (response.status === 404) {
      throw new BiliApiError('source_not_available', detail, response.status, code);
    }
    if (!response.ok || !body || code === undefined) {
      throw new BiliApiError(
        'upstream_error',
        `${detail}${body ? '' : '，返回非 JSON'}`,
        response.status,
        code,
      );
    }
    if (code !== 0 && !allowNonZero) {
      throw new BiliApiError('source_not_available', detail, response.status, code);
    }
    return body;
  });
  requestTail = operation.catch(() => {});
  return operation;
}
