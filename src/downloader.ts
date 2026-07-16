/// <reference types="@songloft/plugin-sdk" />

// 批量下载到本地库（songloft.songs.download 回调本插件 music-url，
// 后端下载时带上 music-url 返回的 Referer headers）。后台任务 + 前端轮询进度。

import { getSettings } from './store';

interface BatchResult {
  song_id: number;
  status: string;
  path?: string;
  error?: string;
}

interface BatchTask {
  results: BatchResult[];
  current: number;
  total: number;
  done: boolean;
}

let batchTask: BatchTask | null = null;

export function getBatchTask(): BatchTask | null {
  return batchTask;
}

export function clearBatchTask(): void {
  batchTask = null;
}

export async function startBatchDownload(songIds: number[]): Promise<void> {
  const settings = await getSettings();
  const template = settings.path_template;
  const embedMetadata = settings.embed_metadata;
  const interval = settings.download_interval;
  const transcodeFormat = settings.transcode_format;
  const transcodeBitrate = settings.transcode_bitrate;

  batchTask = { results: [], current: 0, total: songIds.length, done: false };

  (async () => {
    for (let i = 0; i < songIds.length; i++) {
      if (!batchTask) break;
      batchTask.current = i + 1;
      try {
        const result = await songloft.songs.download(songIds[i], {
          path_template: template,
          embed_metadata: embedMetadata,
          // 转码格式非空时才带上 format/quality（宿主侧空则不转码，保留源格式）
          format: transcodeFormat || undefined,
          quality: transcodeFormat && transcodeBitrate ? String(transcodeBitrate) : undefined,
        });
        batchTask.results.push({ song_id: songIds[i], status: result.status, path: result.path });
      } catch (e: any) {
        batchTask.results.push({ song_id: songIds[i], status: 'failed', error: e.message });
      }
      if (i < songIds.length - 1 && interval > 0) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      }
    }
    if (batchTask) batchTask.done = true;
  })();
}
