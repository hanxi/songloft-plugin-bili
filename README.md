# 哔哩音乐

Songloft JS 插件 — 登录 [哔哩哔哩](https://www.bilibili.com/) 后搜索、导入歌曲，浏览并导入你的收藏夹歌单，支持按需播放与下载到本地。

接口纯 `fetch` 实现（WBI 签名、playurl、收藏夹等），不依赖任何外部二进制。

## 功能

- **登录**：二维码扫码登录 + 手动 Cookie 粘贴，两种方式任选
- **搜索导入**：搜索 B 站视频/音乐，勾选后导入为在线歌曲（可选建歌单）
- **收藏夹**：浏览你的收藏夹并一键整夹导入
- **按需播放**：导入为在线歌曲，播放时实时解析音频地址并缓存
- **下载到本地**：可选将歌曲下载为本地文件，离线可用
- **自动去重**：相同视频不会重复导入

## 播放为什么需要主程序支持

B 站音频 CDN 要求请求携带 `Referer` 头，否则返回 403。本插件通过 `/api/music/url` 返回 `{ url, headers }`，由 Songloft 主程序在代理/下载音频时应用这些头。因此需要 **支持自定义请求头通道的 Songloft 版本**（`@songloft/plugin-sdk` ≥ 2.9.0 对应的宿主）。

## 安装

在 Songloft 插件管理页面安装，或手动下载 [Releases](../../releases) 中的 `.jsplugin.zip` 文件。

### 插件源地址

```
https://raw.githubusercontent.com/hanxi/songloft-plugin-bili/main/registry.json
```

在 Songloft 设置 → JS 插件 → 插件源中添加上述地址即可自动获取更新。

## 使用

1. 打开插件页 → 「账号」标签，扫码或粘贴 Cookie 登录
2. 「搜索」标签搜索关键词，勾选歌曲后选择「仅导入」或「导入并下载」
3. 「收藏夹」标签浏览收藏夹，点击进入后可「整夹导入」（可建为同名歌单）
4. 导入后的歌曲可直接播放；「下载」标签查看下载进度

### 获取 Cookie（手动登录）

在浏览器登录 bilibili.com 后，打开开发者工具 → Application → Cookies，复制 `SESSDATA`（收藏夹还需 `DedeUserID`）等，粘贴到「账号 → Cookie 登录」。

## 音质

在「设置」中选择音质（最高 / 中 / 最低）。游客/普通登录可用码率有限，`192K` 需登录、杜比全景声与 Hi-Res 无损需大会员。

## 开发

```bash
pnpm install
pnpm run dev         # watch + 自动上传到本地 Songloft
pnpm run build       # 生成 dist/bili.jsplugin.zip
pnpm run validate    # 校验 plugin.json hashes
```

## 权限

| 权限 | 用途 |
|------|------|
| `storage` | 持久化登录 Cookie 与插件设置 |
| `playlists.read` | 加载导入目标歌单列表 |
| `songs.write` | 导入歌曲、调用 `songs.download` 下载到本地 |

## License

Apache-2.0 © 2026 Songloft Team
