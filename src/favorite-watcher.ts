/// <reference types="@songloft/plugin-sdk" />

import { downloadSingleSong, getBatchTask } from './downloader';
import { fetchFolderItems } from './favorites';
import { addSongsToPlaylist, importSongs } from './importer';
import { dedupKeyForVideo, ensureFirstPage, type BiliVideo } from './search';
import { getSettings, type Settings } from './store';

const WATCH_STATE_KEY = 'favorite_watch_state_v1';
const WATCH_MAX_ATTEMPTS = 5;
const STARTUP_DELAY_MS = 10_000;
const WATCH_RETRY_DELAYS_MS = [
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];

export type FavoriteWatchItemStatus =
  | 'baseline'
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'failed';

export interface FavoriteWatchItemState {
  key: string;
  bvid: string;
  aid?: number;
  title: string;
  status: FavoriteWatchItemStatus;
  song_id?: number;
  downloaded_path?: string;
  attempts: number;
  first_seen_at: string;
  updated_at: string;
  last_error?: string;
  next_retry_at?: number | null;
  retry_exhausted?: boolean;
}

export interface FavoriteWatchState {
  version: 1;
  folder_id: number;
  folder_title: string;
  initialized_at: string;
  last_check_at?: string;
  last_scan_success_at?: string;
  last_error?: string;
  skipped_reason?: string;
  items: Record<string, FavoriteWatchItemState>;
}

let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchRunning = false;
let nextCheckAt = 0;

async function loadWatchState(): Promise<FavoriteWatchState | null> {
  return ((await songloft.storage.get(WATCH_STATE_KEY)) as FavoriteWatchState | null) || null;
}

async function saveWatchState(state: FavoriteWatchState): Promise<void> {
  await songloft.storage.set(WATCH_STATE_KEY, state);
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeError(error: unknown): string {
  return String((error as any)?.message || error || 'unknown error')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(/(?:SESSDATA|bili_jct|DedeUserID|Authorization|Cookie)\s*[:=]\s*[^\s;,]+/gi, '[credential redacted]')
    .slice(0, 500);
}

function log(message: string): void {
  songloft.log.info(`[favorite-watch] ${message}`);
}

function createWatchItem(item: BiliVideo, status: FavoriteWatchItemStatus): FavoriteWatchItemState {
  const now = nowIso();
  return {
    key: dedupKeyForVideo(item),
    bvid: item.bvid,
    aid: item.aid,
    title: item.title,
    status,
    attempts: 0,
    first_seen_at: now,
    updated_at: now,
    retry_exhausted: false,
  };
}

export async function rebuildFavoriteWatchBaseline(): Promise<{ count: number; state: FavoriteWatchState }> {
  const settings = await getSettings();
  if (!settings.watch_favorite_enabled || settings.watch_favorite_id <= 0) {
    throw new Error('收藏夹自动监控未启用或未选择收藏夹');
  }

  const items = await fetchFolderItems(settings.watch_favorite_id, true, 1);
  const state: FavoriteWatchState = {
    version: 1,
    folder_id: settings.watch_favorite_id,
    folder_title: settings.watch_favorite_title || '',
    initialized_at: nowIso(),
    last_check_at: nowIso(),
    last_scan_success_at: nowIso(),
    items: {},
  };
  for (const item of items) {
    const entry = createWatchItem(item, 'baseline');
    entry.retry_exhausted = false;
    state.items[entry.key] = entry;
  }
  await saveWatchState(state);
  log(`baseline created folder=${state.folder_id} count=${items.length}`);
  return { count: items.length, state };
}

async function failItem(entry: FavoriteWatchItemState, error: unknown, state: FavoriteWatchState): Promise<void> {
  const message = safeError(error);
  entry.status = 'failed';
  entry.last_error = message;
  entry.updated_at = nowIso();
  if (entry.attempts < WATCH_MAX_ATTEMPTS) {
    entry.next_retry_at = Date.now() + WATCH_RETRY_DELAYS_MS[entry.attempts - 1];
    entry.retry_exhausted = false;
  } else {
    entry.next_retry_at = null;
    entry.retry_exhausted = true;
  }
  await saveWatchState(state);
  log(`item failed bvid=${entry.bvid} attempts=${entry.attempts} error=${message}`);
}

async function processWatchItem(item: BiliVideo, state: FavoriteWatchState): Promise<void> {
  const key = dedupKeyForVideo(item);
  const entry = state.items[key] || (state.items[key] = createWatchItem(item, 'pending'));
  entry.attempts += 1;
  entry.status = 'downloading';
  entry.updated_at = nowIso();
  entry.retry_exhausted = false;
  entry.next_retry_at = null;
  await saveWatchState(state);

  try {
    const resolvedItem = await ensureFirstPage(item);
    if (resolvedItem.cid) {
      log(`resolved first page bvid=${resolvedItem.bvid} cid=${resolvedItem.cid} page=${resolvedItem.page || 1} duration=${resolvedItem.duration}`);
    }
    const imported = await importSongs([resolvedItem]);
    if (!imported.songs.length) throw new Error('import returned no song');
    const songId = imported.songs[0].id;
    entry.song_id = songId;
    entry.updated_at = nowIso();
    await saveWatchState(state);

    const settings = await getSettings();
    if (settings.watch_playlist_id > 0) {
      try {
        await addSongsToPlaylist(settings.watch_playlist_id, [songId]);
        log(`added to playlist playlist=${settings.watch_playlist_id} bvid=${entry.bvid} songId=${songId}`);
      } catch (error) {
        log(`playlist add failed playlist=${settings.watch_playlist_id} bvid=${entry.bvid} error=${safeError(error)}`);
      }
    }

    const { result } = await downloadSingleSong(songId);
    if (result?.status === 'failed') throw new Error(result.error || 'download returned failed');
    entry.status = 'downloaded';
    entry.downloaded_path = result?.path;
    entry.last_error = '';
    entry.next_retry_at = null;
    entry.retry_exhausted = false;
    entry.updated_at = nowIso();
    await saveWatchState(state);
    log(`downloaded bvid=${entry.bvid} songId=${songId}`);
  } catch (error) {
    const message = safeError(error);
    if (/only remote songs can be downloaded/i.test(message)) {
      entry.status = 'downloaded';
      entry.last_error = '';
      entry.next_retry_at = null;
      entry.retry_exhausted = false;
      entry.updated_at = nowIso();
      await saveWatchState(state);
      log(`downloaded bvid=${entry.bvid} songId=${entry.song_id || 0} (already local)`);
      return;
    }
    await failItem(entry, message, state);
  }
}

export async function runFavoriteWatchCheck(
  reason: 'scheduled' | 'manual' | 'retry',
): Promise<{ started: boolean; skipped?: string; baseline?: boolean; new?: number; retry?: number }> {
  if (watchRunning) return { started: false, skipped: 'already_running' };
  watchRunning = true;
  try {
    const settings = await getSettings();
    if (!settings.watch_favorite_enabled) return { started: false, skipped: 'disabled' };
    if (settings.watch_favorite_id <= 0) return { started: false, skipped: 'folder_not_configured' };
    log(`check start reason=${reason} folder=${settings.watch_favorite_id}`);

    const batchTask = getBatchTask();
    if (batchTask && !batchTask.done) {
      const state = await loadWatchState();
      if (state) {
        state.skipped_reason = 'manual_download_active';
        state.last_check_at = nowIso();
        await saveWatchState(state);
      }
      log('skipped manual batch active');
      return { started: false, skipped: 'manual_download_active' };
    }

    let state = await loadWatchState();
    if (!state || state.folder_id !== settings.watch_favorite_id) {
      await rebuildFavoriteWatchBaseline();
      return { started: true, baseline: true, new: 0, retry: 0 };
    }

    let currentItems: BiliVideo[];
    try {
      currentItems = await fetchFolderItems(settings.watch_favorite_id, true, 1);
    } catch (error) {
      state.last_check_at = nowIso();
      state.last_error = safeError(error);
      await saveWatchState(state);
      log(`scan failed error=${state.last_error}`);
      return { started: true };
    }

    const currentByKey = new Map<string, BiliVideo>();
    for (const item of currentItems) currentByKey.set(dedupKeyForVideo(item), item);
    let recoveredInterruptedItems = false;
    for (const entry of Object.values(state.items)) {
      if (entry.status === 'downloading') {
        entry.status = 'pending';
        entry.updated_at = nowIso();
        recoveredInterruptedItems = true;
      }
    }
    if (recoveredInterruptedItems) await saveWatchState(state);
    const newItems: BiliVideo[] = [];
    for (const [key, item] of currentByKey) {
      if (state.items[key]) continue;
      const entry = createWatchItem(item, 'pending');
      state.items[key] = entry;
      newItems.push(item);
    }
    if (newItems.length) await saveWatchState(state);

    const pendingItems: BiliVideo[] = [];
    const retryItems: BiliVideo[] = [];
    const now = Date.now();
    for (const [key, entry] of Object.entries(state.items)) {
      if (entry.status === 'pending' && currentByKey.has(key) && !newItems.some((item) => dedupKeyForVideo(item) === key)) {
        pendingItems.push(currentByKey.get(key)!);
        continue;
      }
      if (
        entry.status === 'failed' && entry.retry_exhausted !== true && entry.attempts < WATCH_MAX_ATTEMPTS &&
        (entry.next_retry_at || 0) <= now && currentByKey.has(key) && !newItems.some((item) => dedupKeyForVideo(item) === key)
      ) {
        retryItems.push(currentByKey.get(key)!);
      }
    }

    state.last_check_at = nowIso();
    state.last_scan_success_at = state.last_check_at;
    state.last_error = '';
    state.skipped_reason = '';
    await saveWatchState(state);
    log(`found new=${newItems.length} retry=${pendingItems.length + retryItems.length}`);

    const queue = [...newItems, ...pendingItems, ...retryItems];
    const interval = Math.max(0, settings.download_interval * 1000);
    for (let i = 0; i < queue.length; i++) {
      await processWatchItem(queue[i], state);
      if (i < queue.length - 1 && interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return { started: true, new: newItems.length, retry: pendingItems.length + retryItems.length };
  } catch (error) {
    const message = safeError(error);
    log(`check failed error=${message}`);
    try {
      const state = await loadWatchState();
      if (state) {
        state.last_check_at = nowIso();
        state.last_error = message;
        await saveWatchState(state);
      }
    } catch {
      // Keep the watcher available for its next scheduled attempt.
    }
    return { started: false, skipped: 'check_failed' };
  } finally {
    watchRunning = false;
    const settings = await getSettings().catch(() => null);
    if (settings?.watch_favorite_enabled) scheduleNextCheck(settings);
  }
}

function scheduleNextCheck(settings: Settings, delay = Math.min(1440, Math.max(1, settings.watch_interval_minutes)) * 60_000): void {
  if (watchTimer) clearTimeout(watchTimer);
  nextCheckAt = Date.now() + delay;
  log(`next check scheduled at=${new Date(nextCheckAt).toISOString()}`);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    nextCheckAt = 0;
    void runFavoriteWatchCheck('scheduled');
  }, delay);
}

export function stopFavoriteWatcher(): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  nextCheckAt = 0;
}

export async function startFavoriteWatcher(): Promise<void> {
  stopFavoriteWatcher();
  const settings = await getSettings();
  if (!settings.watch_favorite_enabled) return;
  log('started');
  scheduleNextCheck(settings, STARTUP_DELAY_MS);
}

export async function reconfigureFavoriteWatcher(previous: Settings, next: Settings): Promise<void> {
  if (!next.watch_favorite_enabled) {
    if (previous.watch_favorite_enabled) stopFavoriteWatcher();
    return;
  }
  const enabledNow = !previous.watch_favorite_enabled && next.watch_favorite_enabled;
  const folderChanged = previous.watch_favorite_id !== next.watch_favorite_id;
  const intervalChanged = previous.watch_interval_minutes !== next.watch_interval_minutes;
  if (enabledNow || folderChanged) {
    stopFavoriteWatcher();
    await rebuildFavoriteWatchBaseline();
    scheduleNextCheck(next);
  } else if (intervalChanged) {
    stopFavoriteWatcher();
    scheduleNextCheck(next);
  }
}

export async function getFavoriteWatchStatus(): Promise<Record<string, unknown>> {
  const settings = await getSettings();
  const state = await loadWatchState();
  const items = Object.values(state?.items || {});
  const counts = {
    baseline: items.filter((item) => item.status === 'baseline').length,
    pending: items.filter((item) => item.status === 'pending').length,
    downloading: items.filter((item) => item.status === 'downloading').length,
    downloaded: items.filter((item) => item.status === 'downloaded').length,
    failed: items.filter((item) => item.status === 'failed').length,
    retry_exhausted: items.filter((item) => item.retry_exhausted === true).length,
  };
  const recentItems = items
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 50)
    .map(({ key, bvid, aid, title, status, song_id, downloaded_path, attempts, first_seen_at, updated_at, last_error, next_retry_at, retry_exhausted }) => ({
      key, bvid, aid, title, status, song_id, downloaded_path, attempts, first_seen_at, updated_at, last_error, next_retry_at, retry_exhausted,
    }));
  return {
    enabled: settings.watch_favorite_enabled,
    folder_id: settings.watch_favorite_id,
    folder_title: settings.watch_favorite_title || state?.folder_title || '',
    interval_minutes: settings.watch_interval_minutes,
    playlist_id: settings.watch_playlist_id,
    playlist_title: settings.watch_playlist_id > 0 ? settings.watch_playlist_title || '' : '',
    running: watchRunning,
    next_check_at: nextCheckAt,
    last_check_at: state?.last_check_at || '',
    last_scan_success_at: state?.last_scan_success_at || '',
    last_error: state?.last_error || '',
    skipped_reason: state?.skipped_reason || '',
    counts,
    recent_items: recentItems,
  };
}

export async function retryFailedFavoriteWatchItems(): Promise<{ count: number }> {
  const state = await loadWatchState();
  if (!state) return { count: 0 };
  const now = nowIso();
  let count = 0;
  for (const entry of Object.values(state.items)) {
    if (entry.status !== 'failed') continue;
    entry.attempts = 0;
    entry.retry_exhausted = false;
    entry.next_retry_at = 0;
    entry.status = 'pending';
    entry.last_error = '';
    entry.updated_at = now;
    count++;
  }
  await saveWatchState(state);
  void runFavoriteWatchCheck('retry');
  return { count };
}
