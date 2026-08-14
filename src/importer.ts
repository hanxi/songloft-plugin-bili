/// <reference types="@songloft/plugin-sdk" />

// 把 B站视频作为在线歌曲导入（POST /api/v1/songs/remote），可选建歌单并加歌。
// 支持艺术家覆盖与标题智能解析。

import { callHostAPI } from './utils/http';
import { dedupKeyForVideo, sourceDataForVideo, type BiliVideo } from './search';
import { parseArtistFromTitle } from './artist-parser';

interface ImportedSong {
  id: number;
  title: string;
}

interface ImportResult {
  songs: ImportedSong[];
  playlist_id?: number;
  total: number;
  failed: number;
}

function resolveArtistAndTitle(
  item: BiliVideo,
  artistOverride?: string,
): { artist: string; title: string } {
  if (artistOverride) {
    return { artist: artistOverride, title: item.title };
  }
  const parsed = parseArtistFromTitle(item.title);
  if (parsed) {
    return { artist: parsed.artist, title: parsed.title };
  }
  return { artist: item.author, title: item.title };
}

export async function importSongs(
  items: BiliVideo[],
  playlistName?: string,
  playlistId?: number,
  artistOverride?: string,
): Promise<ImportResult> {
  if (items.length === 0) throw new Error('没有可导入的项目');

  const allSongs: ImportedSong[] = [];
  const batchSize = 50;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const body = batch.map((item) => {
      const { artist, title } = resolveArtistAndTitle(item, artistOverride);
      return {
        title,
        artist,
        album: '',
        cover_url: item.cover,
        duration: item.duration,
        plugin_entry_path: 'bili',
        source_data: JSON.stringify(sourceDataForVideo(item)),
        dedup_key: dedupKeyForVideo(item),
      };
    });
    const resp = await callHostAPI<{ songs: ImportedSong[]; count: number }>(
      'POST',
      '/api/v1/songs/remote',
      body,
    );
    allSongs.push(...resp.songs);
  }

  let finalPlaylistId = playlistId;
  if (playlistName && !finalPlaylistId && allSongs.length > 0) {
    const resp = await callHostAPI<{ id: number }>('POST', '/api/v1/playlists', {
      name: playlistName,
      type: 'normal',
    });
    finalPlaylistId = resp.id;
  }

  if (finalPlaylistId && allSongs.length > 0) {
    const songIds = allSongs.map((s) => s.id);
    for (let i = 0; i < songIds.length; i += batchSize) {
      const batch = songIds.slice(i, i + batchSize);
      await callHostAPI('POST', `/api/v1/playlists/${finalPlaylistId}/songs`, { song_ids: batch });
    }
  }

  return {
    songs: allSongs,
    playlist_id: finalPlaylistId,
    total: items.length,
    failed: items.length - allSongs.length,
  };
}
