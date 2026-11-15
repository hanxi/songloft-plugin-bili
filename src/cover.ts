/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse } from '@songloft/plugin-sdk';
import type { RouteHandler } from '@songloft/plugin-sdk';

export function encodeImage(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    result +=
      alphabet[(n >>> 18) & 63] +
      alphabet[(n >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return result;
}

// JSON bridge cannot transport an image response directly. Keep the fallback
// limited to Bili cover URLs; the host proxy retains its own network checks.
export const coverHandler: RouteHandler = async (req) => {
  const body = JSON.parse(String(req.body) || '{}');
  const url = String(body.url || '');
  if (
    !/^https:\/\/[a-z0-9-]+\.hdslb\.com\/bfs\/[a-z0-9_./@!%-]+(?:\?[a-z0-9_=&%-]*)?$/i.test(
      url,
    )
  )
    return jsonResponse({ error: 'Invalid Bili cover URL' }, 400);
  try {
    const host = await songloft.plugin.getHostUrl();
    const token = await songloft.plugin.getToken();
    const response = await fetch(
      host + '/api/v1/proxy?url=' + encodeURIComponent(url),
      {
        headers: { Authorization: 'Bearer ' + token },
      },
    );
    const mime = (response.headers.get('content-type') || '').split(';')[0];
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(mime))
      throw Error('Cover unavailable');
    if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024)
      throw Error('Cover too large');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw Error('Cover too large');
    return jsonResponse({
      src: 'data:' + mime + ';base64,' + encodeImage(bytes),
    });
  } catch {
    return jsonResponse({ error: 'Cover unavailable' }, 502);
  }
};
