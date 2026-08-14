/// <reference types="@songloft/plugin-sdk" />

// 从 B站音乐视频标题中提取真实艺术家名，减少歌词搜索时因 UP主名不匹配的问题。

export interface ParsedTitle {
  artist: string;
  title: string;
}

const DECORATIONS = /[\s]*(?:\[.*?\]|（.*?）|\(.*?\)|【(?:高音质|无损|4K|MV|官方|完整版|纯享|翻唱|cover|自制|搬运).*?】|《|》)[\s]*/gi;
const BRACKET_ARTIST = /^【([^】]{1,20})】\s*(.+)$/;
const SEPARATOR = /\s[-–—]\s/;

function stripDecorations(s: string): string {
  return s.replace(DECORATIONS, ' ').trim();
}

function isLikelyArtistName(s: string): boolean {
  const cleaned = stripDecorations(s);
  return cleaned.length > 0 && cleaned.length <= 30;
}

export function parseArtistFromTitle(rawTitle: string): ParsedTitle | null {
  if (!rawTitle) return null;
  const title = rawTitle.trim();

  // 规则 1：【artist】title
  const bracketMatch = title.match(BRACKET_ARTIST);
  if (bracketMatch) {
    const artist = bracketMatch[1].trim();
    const rest = bracketMatch[2].trim();
    if (artist && rest && isLikelyArtistName(artist)) {
      return { artist, title: rest };
    }
  }

  // 规则 2/3：以 " - " 类分隔符切割
  const sepMatch = title.match(SEPARATOR);
  if (sepMatch && sepMatch.index != null) {
    const left = title.slice(0, sepMatch.index).trim();
    const right = title.slice(sepMatch.index + sepMatch[0].length).trim();
    if (!left || !right) return null;

    // 只有恰好一个分隔符时才解析
    const remaining = title.slice(sepMatch.index + sepMatch[0].length);
    if (SEPARATOR.test(remaining)) return null;

    const leftClean = stripDecorations(left);
    const rightClean = stripDecorations(right);

    // 短的一侧更可能是艺术家名
    if (leftClean.length <= rightClean.length && isLikelyArtistName(leftClean)) {
      return { artist: leftClean, title: right };
    }
    if (rightClean.length < leftClean.length && isLikelyArtistName(rightClean)) {
      return { artist: rightClean, title: left };
    }
    // 两侧等长或都偏长时，默认左侧为 artist（最常见格式）
    if (isLikelyArtistName(leftClean)) {
      return { artist: leftClean, title: right };
    }
  }

  return null;
}
