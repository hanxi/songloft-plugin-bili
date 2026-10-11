export const DEFAULT_DOWNLOAD_TEMPLATE = 'bili/{playlist}/{title}';

export class DownloadPathError extends Error {}

// 歌单名称作为字面量传给宿主，不能带入路径分隔符或模板占位符。
function directoryName(value: string): string {
  const safe = value
    .trim()
    .replace(/[/\\:*?"<>|{}\u0000-\u001f\u007f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[ ._-]+$/g, '');
  let result = '';
  let bytes = 0;
  for (const char of safe) {
    const code = char.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > 180) break;
    result += char;
  }
  return result || '未分类';
}

export function resolveDownloadTemplate(
  template: string,
  playlistName = '',
  downloadDirectory = '',
): string {
  if (
    typeof template !== 'string' ||
    typeof playlistName !== 'string' ||
    typeof downloadDirectory !== 'string'
  ) {
    throw new DownloadPathError('下载路径模板、歌单名称和保存目录必须是字符串');
  }
  if (downloadDirectory.trim()) {
    const directory = downloadDirectory.trim();
    if (/^[\/\\]/.test(directory) || /^[a-z]:/i.test(directory) || directory.includes('..')) {
      throw new DownloadPathError('保存目录必须是音乐库下的相对路径，不能包含 ..');
    }
    const parts = directory.split('/');
    if (parts.some((part) => !part.trim() || part.trim() === '.')) {
      throw new DownloadPathError('保存目录不能包含空目录或 .');
    }
    return parts.map(directoryName).join('/') + '/{title}';
  }
  const resolved = (template.trim() || DEFAULT_DOWNLOAD_TEMPLATE).replace(/\{playlist\}/g, () =>
    directoryName(playlistName),
  );
  if (resolved.startsWith('/') || resolved.includes('..') || resolved.includes('//')) {
    throw new DownloadPathError('下载路径模板必须是音乐库下的相对路径，不能包含 .. 或连续 /');
  }
  if (!resolved.includes('{title}')) throw new DownloadPathError('下载路径模板必须包含 {title}');
  const literals = resolved.replace(/\{(title|artist|album|year|genre)\}/g, '');
  if (/[{}]/.test(literals)) throw new DownloadPathError('下载路径模板包含未知或未闭合的占位符');
  return resolved;
}
