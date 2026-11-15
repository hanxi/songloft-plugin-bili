import type { BiliVideo } from '../../src/search'

/** Missing cid means unresolved video, not proof of multiple parts. */
export function partsLabel(
  video: BiliVideo,
  loaded?: BiliVideo[],
  expanded = false,
): string {
  if (video.cid) return ''
  const count = loaded ? loaded.length : video.part_count
  if (count === undefined) return '详情'
  if (count <= 1) return ''
  return expanded ? '收起' : '分 P'
}
