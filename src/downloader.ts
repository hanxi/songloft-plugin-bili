/// <reference types="@songloft/plugin-sdk" />

import { getSettings } from './store';

interface BatchResult {
  song_id: number;
  status: string;
  path?: string;
  error?: string;
}

export interface BatchSongInfo {
  song_id: number;
  title: string;
  status: 'pending' | 'downloading' | 'ok' | 'failed';
  error?: string;
}

interface BatchTask {
  results: BatchResult[];
  songs: BatchSongInfo[];
  current: number;
  total: number;
  done: boolean;
  paused: boolean;
  playlist_name: string;
}

let batchTask: BatchTask | null = null;
let paused = false;
let resumeResolve: (() => void) | null = null;

export function getBatchTask(): BatchTask | null {
  if (batchTask) {
    batchTask.paused = paused;
  }
  return batchTask;
}

export function clearBatchTask(): void {
  batchTask = null;
  paused = false;
  resumeResolve = null;
}

export function pauseBatch(): void {
  paused = true;
  if (batchTask) batchTask.paused = true;
}

export function resumeBatch(): void {
  paused = false;
  if (batchTask) batchTask.paused = false;
  if (resumeResolve) {
    resumeResolve();
    resumeResolve = null;
  }
}

function waitForResume(): Promise<void> {
  if (!paused) return Promise.resolve();
  return new Promise<void>((resolve) => {
    resumeResolve = resolve;
  });
}

// B站限流 / 风控：412、-412 或通用超时
const TRANSIENT_ERROR_RE = /call timeout|scheduler:\s*call timeout|queue full|backpressure|\btimeout\b/i;
const BILI_RATE_LIMIT_RE = /412|risk\s*control|频率|风控|请求被拦截|访问过于频繁/i;

const RETRY_DELAYS_MS = [1000, 3000];
const RATE_LIMIT_RETRY_DELAYS_MS = [3000, 8000];

function isTransientError(msg: string): boolean {
  return TRANSIENT_ERROR_RE.test(msg);
}

function isRateLimitError(msg: string): boolean {
  return BILI_RATE_LIMIT_RE.test(msg);
}

async function downloadWithRetry(
  songId: number,
  opts: { path_template: string; embed_metadata: boolean; format?: string; quality?: string },
): Promise<{ result: any; attempts: number }> {
  let lastErr: any;
  const maxAttempts = Math.max(RETRY_DELAYS_MS.length, RATE_LIMIT_RETRY_DELAYS_MS.length);
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const result = await songloft.songs.download(songId, opts);
      return { result, attempts: attempt + 1 };
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message || String(e);
      const rateLimit = isRateLimitError(msg);
      const transient = isTransientError(msg);
      const delays = rateLimit ? RATE_LIMIT_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
      if (attempt >= delays.length || !(rateLimit || transient)) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastErr;
}

export interface StartBatchOptions {
  songTitles?: Map<number, string>;
  playlistName?: string;
}

export async function startBatchDownload(songIds: number[], options?: StartBatchOptions): Promise<void> {
  const settings = await getSettings();
  const template = settings.path_template;
  const embedMetadata = settings.embed_metadata;
  const interval = settings.download_interval;
  const transcodeFormat = settings.transcode_format;
  const transcodeBitrate = settings.transcode_bitrate;
  const pauseOnError = settings.pause_on_error;
  const playlistName = options?.playlistName || '';
  const songTitles = options?.songTitles;

  const songs: BatchSongInfo[] = songIds.map((id) => ({
    song_id: id,
    title: songTitles?.get(id) || `歌曲 #${id}`,
    status: 'pending' as const,
  }));

  paused = false;
  resumeResolve = null;
  batchTask = { results: [], songs, current: 0, total: songIds.length, done: false, paused: false, playlist_name: playlistName };

  (async () => {
    for (let i = 0; i < songIds.length; i++) {
      if (!batchTask) break;

      if (paused) {
        await waitForResume();
      }
      if (!batchTask) break;

      batchTask.current = i + 1;
      batchTask.songs[i].status = 'downloading';

      try {
        const { result } = await downloadWithRetry(songIds[i], {
          path_template: template,
          embed_metadata: embedMetadata,
          format: transcodeFormat || undefined,
          quality: transcodeFormat && transcodeBitrate ? String(transcodeBitrate) : undefined,
        });
        batchTask.results.push({ song_id: songIds[i], status: result.status, path: result.path });
        batchTask.songs[i].status = 'ok';
      } catch (e: any) {
        const msg = e?.message || String(e);
        batchTask.results.push({ song_id: songIds[i], status: 'failed', error: msg });
        batchTask.songs[i].status = 'failed';
        batchTask.songs[i].error = msg;

        if (pauseOnError) {
          paused = true;
          batchTask.paused = true;
          await waitForResume();
          if (!batchTask) break;
        }
      }
      if (i < songIds.length - 1 && interval > 0) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      }
    }
    if (batchTask) batchTask.done = true;
  })();
}
