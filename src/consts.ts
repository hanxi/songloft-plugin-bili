/// <reference types="@songloft/plugin-sdk" />

// 桌面浏览器 UA（B站 playurl / 搜索均以此通过风控）
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const REFERER = 'https://www.bilibili.com/';
export const API_BASE = 'https://api.bilibili.com';
export const PASSPORT_BASE = 'https://passport.bilibili.com';

// 播放/下载 B站音频 CDN 时必须携带的头（否则 403）。
// 由 music-url handler 返回给主程序，经后端 header 通道在代理拉取时应用。
export function playbackHeaders(): Record<string, string> {
  return { Referer: REFERER, 'User-Agent': UA };
}
