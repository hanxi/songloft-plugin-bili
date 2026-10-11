/// <reference types="@songloft/plugin-sdk" />

import { getSettings } from './store';
import { resolveDownloadTemplate } from './download-path';
import {
  assertBiliAvailable,
  beginBiliCooldown,
  getBiliCooldown,
  isBiliRiskError,
  safeBiliMessage,
} from './request-control';

interface BatchResult {
  song_id: number;
  status: string;
  path?: string;
  error?: string;
}

export interface BatchSongInfo {
  song_id: number;
  title: string;
  status: 'pending' | 'downloading' | 'ok' | 'skipped' | 'failed';
  error?: string;
}

interface BatchTask {
  results: BatchResult[];
  songs: BatchSongInfo[];
  current: number;
  total: number;
  done: boolean;
  paused: boolean;
  pause_reason: '' | 'user' | 'error' | 'risk_control';
  playlist_name: string;
  download_directory: string;
  path_template: string;
}

interface RunningBatchTask extends BatchTask {
  cancelled: boolean;
  resumeResolve: (() => void) | null;
  delayResolve: (() => void) | null;
}

let batchTask: RunningBatchTask | null = null;
// 清除队列后，仍等待已发出的单首下载返回，防止新批次与它重复下载。
let runningTask: RunningBatchTask | null = null;
let preparingBatch = false;

export class BatchBusyError extends Error {
  constructor() {
    super('下载任务尚未结束，请先暂停并清除；已发出的单首下载需要等待完成');
  }
}

class BatchCancelledError extends Error {
  constructor() {
    super('下载任务已清除');
  }
}

export function assertBatchAvailable(): void {
  if (isBatchRunning()) throw new BatchBusyError();
}

export function isBatchRunning(): boolean {
  return preparingBatch || runningTask !== null;
}

export function getBatchTask(): BatchTask | null {
  return batchTask;
}

export function clearBatchTask(): void {
  if (!batchTask) return;
  const task = batchTask;
  batchTask = null;
  task.cancelled = true;
  task.paused = false;
  task.resumeResolve?.();
  task.delayResolve?.();
}

export function pauseBatch(): void {
  if (batchTask && !batchTask.done) {
    batchTask.paused = true;
    if (batchTask.pause_reason !== 'risk_control') batchTask.pause_reason = 'user';
  }
}

export async function resumeBatch(): Promise<void> {
  const task = batchTask;
  await assertBiliAvailable();
  if (!task || task !== batchTask || task.done) return;
  task.paused = false;
  task.pause_reason = '';
  task.resumeResolve?.();
}

function checkCancelled(task?: RunningBatchTask): void {
  if (task?.cancelled) throw new BatchCancelledError();
}

async function waitForResume(task: RunningBatchTask): Promise<void> {
  while (task.paused && !task.cancelled) {
    await new Promise<void>((resolve) => {
      task.resumeResolve = resolve;
    });
    task.resumeResolve = null;
  }
  checkCancelled(task);
}

async function waitForDelay(ms: number, task?: RunningBatchTask): Promise<void> {
  checkCancelled(task);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (task) task.delayResolve = null;
      resolve();
    }, ms);
    if (task)
      task.delayResolve = () => {
        clearTimeout(timer);
        task.delayResolve = null;
        resolve();
      };
  });
  checkCancelled(task);
}

// 瞬时超时保留短间隔重试；风控立即进入共享冷却，不重试。
const TRANSIENT_ERROR_RE =
  /call timeout|scheduler:\s*call timeout|queue full|backpressure|\btimeout\b/i;
const RETRY_DELAYS_MS = [1000, 3000];

function isTransientError(msg: string): boolean {
  return TRANSIENT_ERROR_RE.test(msg);
}

async function downloadWithRetry(
  songId: number,
  opts: { path_template: string; embed_metadata: boolean; format?: string; quality?: string },
  task?: RunningBatchTask,
): Promise<{ result: { status: string; path?: string; error?: string }; attempts: number }> {
  const song = await songloft.songs.getById(songId);
  checkCancelled(task);
  if (!song) throw new Error(`歌曲 #${songId} 不存在`);
  if (song.type === 'local') {
    return { result: { status: 'skipped', path: song.file_path }, attempts: 0 };
  }
  const maxAttempts = RETRY_DELAYS_MS.length;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (task) await waitForResume(task);
    await assertBiliAvailable();
    checkCancelled(task);
    try {
      const result = await songloft.songs.download(songId, opts);
      checkCancelled(task);
      if (result.status === 'failed') throw new Error(result.error || '下载失败');
      return { result, attempts: attempt + 1 };
    } catch (e: any) {
      checkCancelled(task);
      const msg = e?.message || String(e);
      // 检查和下载之间可能被其他下载入口转为 local，再确认后按跳过处理。
      if (/only remote songs can be downloaded, got type=local/.test(msg)) {
        const existing = await songloft.songs.getById(songId);
        checkCancelled(task);
        if (existing?.type === 'local') {
          return { result: { status: 'skipped', path: existing.file_path }, attempts: attempt + 1 };
        }
      }
      if (isBiliRiskError(e)) {
        // music/url 已写入冷却时不再次延长；兼容旧宿主直接传回的 HTTP 412。
        if (!(await getBiliCooldown())) await beginBiliCooldown(msg);
        throw e;
      }
      const transient = isTransientError(msg);
      if (attempt >= RETRY_DELAYS_MS.length || !transient) throw e;
      await waitForDelay(RETRY_DELAYS_MS[attempt], task);
    }
  }
  throw new Error('下载重试次数已耗尽');
}

export async function downloadSingleSong(
  songId: number,
  playlistName = '',
): Promise<{ result: { status: string; path?: string; error?: string }; attempts: number }> {
  const settings = await getSettings();
  return downloadWithRetry(songId, {
    path_template: resolveDownloadTemplate(settings.path_template, playlistName),
    embed_metadata: settings.embed_metadata,
    format: settings.transcode_format || undefined,
    quality:
      settings.transcode_format && settings.transcode_bitrate
        ? String(settings.transcode_bitrate)
        : undefined,
  });
}

export interface StartBatchOptions {
  songTitles?: Map<number, string>;
  playlistName?: string;
  downloadDirectory?: string;
  // 重试沿用原批次已经解析过的模板，不受之后修改设置影响。
  pathTemplate?: string;
}

export async function startBatchDownload(
  songIds: number[],
  options?: StartBatchOptions,
): Promise<void> {
  assertBatchAvailable();
  return startBatch(songIds, options);
}

// 导入、歌单查询等准备阶段也占用批次，拒绝并发请求时不会先产生写入副作用。
export async function startPreparedBatchDownload<T>(
  prepare: () => Promise<{ songIds: number[]; options?: StartBatchOptions; result: T }>,
): Promise<T> {
  assertBatchAvailable();
  preparingBatch = true;
  try {
    await assertBiliAvailable();
    const prepared = await prepare();
    await startBatch(prepared.songIds, prepared.options);
    return prepared.result;
  } finally {
    preparingBatch = false;
  }
}

async function startBatch(songIds: number[], options?: StartBatchOptions): Promise<void> {
  const previousTask = batchTask;
  const task: RunningBatchTask = {
    results: [],
    songs: songIds.map((id) => ({
      song_id: id,
      title: options?.songTitles?.get(id) || `歌曲 #${id}`,
      status: 'pending',
    })),
    current: 0,
    total: songIds.length,
    done: false,
    paused: false,
    pause_reason: '',
    playlist_name: options?.playlistName || '',
    download_directory: options?.downloadDirectory || '',
    path_template: '',
    cancelled: false,
    resumeResolve: null,
    delayResolve: null,
  };
  // 在首次 await 前预留批次，避免两个请求同时通过可用性检查。
  batchTask = runningTask = task;
  try {
    await assertBiliAvailable();
    const settings = await getSettings();
    checkCancelled(task);
    task.path_template = resolveDownloadTemplate(
      options?.pathTemplate ?? settings.path_template,
      task.playlist_name,
      task.download_directory,
    );
    void (async () => {
      try {
        for (let i = 0; i < songIds.length; i++) {
          // 监控/播放等其他入口触发风控时，保留尚未执行的队列。
          if (await getBiliCooldown()) {
            task.paused = true;
            task.pause_reason = 'risk_control';
          }
          await waitForResume(task);
          task.current = i + 1;
          task.songs[i].status = 'downloading';
          try {
            const { result } = await downloadWithRetry(
              songIds[i],
              {
                path_template: task.path_template,
                embed_metadata: settings.embed_metadata,
                format: settings.transcode_format || undefined,
                quality:
                  settings.transcode_format && settings.transcode_bitrate
                    ? String(settings.transcode_bitrate)
                    : undefined,
              },
              task,
            );
            checkCancelled(task);
            task.results.push({ song_id: songIds[i], status: result.status, path: result.path });
            task.songs[i].status = result.status === 'skipped' ? 'skipped' : 'ok';
          } catch (e: any) {
            checkCancelled(task);
            const msg = safeBiliMessage(e?.message || String(e));
            task.results.push({ song_id: songIds[i], status: 'failed', error: msg });
            task.songs[i].status = 'failed';
            task.songs[i].error = msg;
            // 最后一首失败也已处理完整个队列，无需再等待恢复。
            const cooling = await getBiliCooldown();
            if ((cooling || settings.pause_on_error) && i < songIds.length - 1) {
              task.paused = true;
              task.pause_reason = cooling ? 'risk_control' : 'error';
              await waitForResume(task);
            }
          }
          if (
            i < songIds.length - 1 &&
            task.songs[i].status !== 'skipped' &&
            settings.download_interval > 0
          ) {
            await waitForDelay(settings.download_interval * 1000, task);
          }
        }
        task.done = true;
        task.paused = false;
        task.pause_reason = '';
      } catch (e) {
        if (!(e instanceof BatchCancelledError)) {
          songloft.log.error('批量下载异常: ' + String(e));
          task.done = true;
          task.paused = false;
        }
      } finally {
        if (runningTask === task) runningTask = null;
      }
    })();
  } catch (e) {
    if (batchTask === task) batchTask = previousTask;
    if (runningTask === task) runningTask = null;
    throw e;
  }
}
