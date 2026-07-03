/// <reference types="@songloft/plugin-sdk" />

// 调用 Songloft 宿主 REST API（带插件 JWT）。用于导入歌曲、建歌单等。

export async function callHostAPI<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const hostUrl = await songloft.plugin.getHostUrl();
  if (!hostUrl) throw new Error('Host URL not available');
  const token = await songloft.plugin.getToken();
  if (!token) throw new Error('Plugin token not available');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(body);
  }

  const resp = await fetch(hostUrl + path, { method, headers, body: bodyStr });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Host API error ${resp.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
