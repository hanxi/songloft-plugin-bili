import { useEffect, useRef, useState, type ReactNode } from '@lynx-js/react'
import {
  apiGet,
  apiPost,
  getTheme,
  onThemeChange,
  onPush,
} from '@songloft/lynx-plugin-sdk'
import qrcode from 'qrcode-generator'
import type { Settings } from '../../src/store'
import type { BiliVideo } from '../../src/search'
import './style.css'

type Data = Record<string, any>
const tabs = ['搜索', '收藏夹', '下载', '账号', '设置']
const key = (v: BiliVideo) => v.bvid + (v.cid ? ':cid:' + v.cid : '')
function Button({
  children,
  onTap,
  disabled = false,
  selected = false,
  variant = 'secondary',
}: {
  children: ReactNode
  onTap: () => void
  disabled?: boolean
  selected?: boolean
  variant?: 'secondary' | 'primary' | 'tab'
}) {
  return (
    <view
      className={
        'button button-' +
        variant +
        (selected ? ' selected' : '') +
        (disabled ? ' disabled' : '')
      }
      bindtap={() => {
        if (!disabled) onTap()
      }}
    >
      <text>{children}</text>
    </view>
  )
}
let fieldId = 0
function Field({
  label,
  value,
  change,
  secret = false,
}: {
  label: string
  value: string
  change: (v: string) => void
  secret?: boolean
}) {
  const id = useRef('bili-field-' + ++fieldId)
  useEffect(() => {
    lynx
      .createSelectorQuery()
      .select('#' + id.current)
      .invoke({ method: 'setValue', params: { value } })
      .exec()
  }, [value])
  return (
    <view className="field">
      <text className="field-label">{label}</text>
      <input
        className="text-input"
        id={id.current}
        maxlength={16384}
        type={secret ? 'password' : 'text'}
        default-value={value}
        placeholder={label}
        bindinput={(e) => change(e.detail.value)}
      />
    </view>
  )
}
function Choice({
  label,
  value,
  options,
  change,
}: {
  label: string
  value: string
  options: [string, string][]
  change: (v: string) => void
}) {
  return (
    <view className="field">
      <text>{label}</text>
      <view className="row">
        {Array.from(new Map(options).entries()).map(([v, title]) => (
          <Button key={v} selected={value === v} onTap={() => change(v)}>
            {title}
          </Button>
        ))}
      </view>
    </view>
  )
}
function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <view className="section">
      <text className="section-title">{title}</text>
      {description && (
        <text className="muted section-description">{description}</text>
      )}
      {children}
    </view>
  )
}
function Toggle({
  label,
  value,
  change,
}: {
  label: string
  value: boolean
  change: (value: boolean) => void
}) {
  return (
    <view className="toggle-row" bindtap={() => change(!value)}>
      <text className="toggle-label">{label}</text>
      <view className={'toggle-track' + (value ? ' selected' : '')}>
        <view className="toggle-thumb" />
      </view>
      <text className="toggle-state">{value ? '开启' : '关闭'}</text>
    </view>
  )
}
function QR({ url }: { url: string }) {
  const code = qrcode(0, 'M')
  code.addData(url)
  code.make()
  const size = code.getModuleCount()
  return (
    <view className="qr">
      {Array.from({ length: size }, (_, y) => (
        <view
          key={y}
          style={{ display: 'flex', flexDirection: 'row', height: '4px' }}
        >
          {Array.from({ length: size }, (_, x) => (
            <view
              key={x}
              style={{
                width: '4px',
                height: '4px',
                backgroundColor: code.isDark(y, x) ? '#000' : '#fff',
              }}
            />
          ))}
        </view>
      ))}
    </view>
  )
}
export function App() {
  const [theme, setTheme] = useState(getTheme()),
    [tab, setTab] = useState('搜索')
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const busyRef = useRef(false),
    alive = useRef(true),
    searchEpoch = useRef(0)
  const [mode, setMode] = useState<'url' | 'search'>('url')
  const [query, setQuery] = useState(''),
    [url, setUrl] = useState(''),
    [page, setPage] = useState(1)
  const [videos, setVideos] = useState<BiliVideo[]>([]),
    [more, setMore] = useState(false)
  const [parts, setParts] = useState<Record<string, BiliVideo[]>>({}),
    [selected, setSelected] = useState<Record<string, BiliVideo>>({})
  const [playlists, setPlaylists] = useState<Data[]>([]),
    [playlist, setPlaylist] = useState(''),
    [playlistName, setPlaylistName] = useState('')
  const [artist, setArtist] = useState(''),
    [directory, setDirectory] = useState('')
  const [folders, setFolders] = useState<Data[]>([]),
    [folder, setFolder] = useState<Data | null>(null),
    [preview, setPreview] = useState<BiliVideo[]>([]),
    [asPlaylist, setAsPlaylist] = useState(true)
  const [account, setAccount] = useState<Data>({}),
    [cookie, setCookie] = useState(''),
    [qr, setQr] = useState<Data | null>(null),
    [qrText, setQrText] = useState('')
  const [progress, setProgress] = useState<Data>({}),
    [downloadPage, setDownloadPage] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null),
    [watch, setWatch] = useState<Data>({}),
    [confirmBaseline, setConfirmBaseline] = useState(false)
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('处理中…')
    try {
      await action()
      if (alive.current) setMessage('操作完成')
    } catch (e) {
      if (alive.current) setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function loadPlaylists(initial = false) {
    const r = await apiGet<Data>('/api/playlists')
    if (!alive.current) return
    setPlaylists(r.playlists || [])
    if (initial) setPlaylist(String(r.last_playlist || ''))
  }
  useEffect(() => {
    alive.current = true
    const off = onThemeChange(setTheme)
    void run(async () => {
      await loadPlaylists(true)
      const r = await apiGet<Data>('/api/login/status')
      if (alive.current) setAccount(r)
    })
    return () => {
      alive.current = false
      searchEpoch.current++
      off()
    }
  }, [])
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        if (tab === '下载') {
          const r = await apiGet<Data>('/api/download-batch/progress')
          if (active) setProgress(r)
        }
        if (tab === '设置') {
          const r = await apiGet<Data>('/api/favorite-watch/status')
          if (active) setWatch(r)
        }
      } catch (e) {
        if (active) setMessage(String(e))
      }
      if (active && (tab === '下载' || tab === '设置'))
        timer = setTimeout(refresh, 2000)
    }
    void refresh()
    const off = onPush((event, data) => {
      if (
        event === 'lifecycle' &&
        (typeof data === 'string' ? JSON.parse(data) : (data as Data))
          ?.state === 'resumed'
      ) {
        setMessage('已恢复，正在刷新状态')
      }
    })
    return () => {
      active = false
      clearTimeout(timer)
      off()
    }
  }, [tab])
  useEffect(() => {
    if (!qr) return
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const r = await apiGet<Data>(
          '/api/login/poll?key=' + encodeURIComponent(qr!.qrcode_key),
        )
        if (!active) return
        if (r.status === 0) {
          setQr(null)
          setQrText('登录成功')
          setAccount(await apiGet<Data>('/api/login/status'))
          return
        }
        if (r.status === 86038) {
          setQr(null)
          setQrText('二维码已过期，请重新生成')
          return
        }
        setQrText(
          r.status === 86090 ? '已扫码，请在手机确认' : '请用哔哩哔哩 App 扫码',
        )
      } catch (e) {
        if (active) setQrText(String(e))
      }
      if (active) timer = setTimeout(poll, 2000)
    }
    timer = setTimeout(poll, 2000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [qr])
  async function changeTab(next: string) {
    setTab(next)
    setQr(null)
    await run(async () => {
      if (next === '设置') {
        setSettings(await apiGet<Settings>('/api/settings'))
        await loadPlaylists()
      }
      if (next === '收藏夹' || next === '设置') {
        const r = await apiGet<Data>('/api/favorites')
        setFolders(r.folders || [])
      }
      if (next === '账号') setAccount(await apiGet<Data>('/api/login/status'))
    })
  }
  async function search(nextPage: number, extract = false) {
    const epoch = ++searchEpoch.current
    const r = extract
      ? await apiPost<Data>('/api/extract', { url })
      : await apiPost<Data>('/api/search/videos', {
          keyword: query,
          page: nextPage,
        })
    if (epoch !== searchEpoch.current || !alive.current) return
    const items: BiliVideo[] = r.items || r.results || []
    setVideos((old) => (nextPage === 1 ? items : [...old, ...items]))
    setPage(nextPage)
    setMore(!extract && items.length >= 20)
    if (nextPage === 1) {
      setParts({})
      setSelected(
        extract ? Object.fromEntries(items.map((v) => [key(v), v])) : {},
      )
    }
    if (r.playlist_title) {
      setPlaylist('__new__')
      setPlaylistName(r.playlist_title)
    }
  }
  function toggle(v: BiliVideo) {
    const items = parts[v.bvid] || [v]
    setSelected((old) => {
      const copy = { ...old },
        all = items.every((item) => copy[key(item)])
      for (const item of items) {
        if (all) delete copy[key(item)]
        else copy[key(item)] = item
      }
      return copy
    })
  }
  async function importItems(download: boolean) {
    if (!Object.keys(selected).length) throw new Error('请先选择歌曲')
    if (playlist === '__new__' && !playlistName.trim())
      throw new Error('请输入新歌单名')
    const r = await apiPost<Data>(
      download ? '/api/import-download' : '/api/import',
      {
        items: Object.values(selected),
        playlist_id:
          playlist && playlist !== '__new__' ? Number(playlist) : undefined,
        playlist_name: playlist === '__new__' ? playlistName : undefined,
        artist_override: artist || undefined,
        download_directory: download ? directory || undefined : undefined,
      },
    )
    setSelected({})
    await loadPlaylists()
    if (r.playlist_id) setPlaylist(String(r.playlist_id))
    if (download) setTab('下载')
  }
  function videoRows(items: BiliVideo[], selectable = true) {
    return items.map((v) => (
      <view key={key(v)} className="card">
        <view bindtap={() => selectable && toggle(v)}>
          <text>
            {selectable
              ? selected[key(v)] ||
                (parts[v.bvid]?.length &&
                  parts[v.bvid].every((p) => selected[key(p)]))
                ? '☑ '
                : '☐ '
              : ''}
            {v.title}
          </text>
          <text className="muted">
            {v.author} · {Math.floor(v.duration / 60)}:
            {String(v.duration % 60).padStart(2, '0')}
            {v.page ? ' · P' + v.page : ''}
          </text>
        </view>
        {selectable && !v.cid && (
          <Button
            disabled={busy}
            onTap={() =>
              void run(async () => {
                const r = await apiGet<Data>(
                  '/api/videos/' + encodeURIComponent(v.bvid) + '/parts',
                )
                const items: BiliVideo[] = r.items || []
                setParts((old) => ({ ...old, [v.bvid]: items }))
                setSelected((old) => {
                  const copy = { ...old }
                  if (copy[key(v)]) {
                    delete copy[key(v)]
                    for (const p of items) copy[key(p)] = p
                  }
                  return copy
                })
              })
            }
          >
            分 P
          </Button>
        )}
        {parts[v.bvid] && !v.cid && videoRows(parts[v.bvid])}
      </view>
    ))
  }
  function set<K extends keyof Settings>(name: K, value: Settings[K]) {
    setSettings((old) => (old ? { ...old, [name]: value } : old))
  }
  const action = (
    label: string,
    fn: () => Promise<void>,
    disabled = false,
    primary = false,
  ) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      disabled={busy || disabled}
      onTap={() => void run(fn)}
    >
      {label}
    </Button>
  )
  return (
    <view className={'app ' + theme}>
      <view className="tabs">
        {tabs.map((t) => (
          <Button
            key={t}
            variant="tab"
            selected={tab === t}
            disabled={busy}
            onTap={() => void changeTab(t)}
          >
            {t}
          </Button>
        ))}
      </view>
      {message && message !== '操作完成' && (
        <text className="notice">{message}</text>
      )}
      <scroll-view key={tab} scroll-y className="body">
        <view className="content">
          {tab === '搜索' && (
            <>
              <Section
                title="导入歌曲"
                description="粘贴 B 站链接，或搜索想听的音乐。"
              >
                <view className="row mode-tabs">
                  <Button
                    selected={mode === 'url'}
                    onTap={() => setMode('url')}
                  >
                    链接导入
                  </Button>
                  <Button
                    selected={mode === 'search'}
                    onTap={() => setMode('search')}
                  >
                    搜索音乐
                  </Button>
                </view>
                {mode === 'url' ? (
                  <>
                    <Field
                      label="视频 / 合集 / 收藏夹链接"
                      value={url}
                      change={setUrl}
                    />
                    {action(
                      '提取歌曲',
                      () => search(1, true),
                      !url.trim(),
                      true,
                    )}
                  </>
                ) : (
                  <>
                    <Field label="搜索关键词" value={query} change={setQuery} />
                    {action('搜索', () => search(1), !query.trim(), true)}
                  </>
                )}
              </Section>
              {videoRows(videos)}
              {more && action('加载更多', () => search(page + 1))}
              {Object.keys(selected).length > 0 && (
                <Section title="导入选中的歌曲">
                  <Choice
                    label="导入目标歌单"
                    value={playlist}
                    options={[
                      ['', '不加入歌单'],
                      ...playlists.map(
                        (p) => [String(p.id), p.name] as [string, string],
                      ),
                      ['__new__', '新建歌单'],
                    ]}
                    change={(v) => {
                      setPlaylist(v)
                      void run(async () => {
                        await apiPost('/api/import-prefs', { last_playlist: v })
                      })
                    }}
                  />
                  {playlist === '__new__' && (
                    <Field
                      label="新歌单名"
                      value={playlistName}
                      change={setPlaylistName}
                    />
                  )}
                  <Field
                    label="艺术家覆盖（可选）"
                    value={artist}
                    change={setArtist}
                  />
                  <Field
                    label="下载保存目录（可选）"
                    value={directory}
                    change={setDirectory}
                  />
                  <text>已选择 {Object.keys(selected).length} 首</text>
                  <view className="row">
                    {action('仅导入', () => importItems(false))}
                    {action('导入并下载', () => importItems(true), false, true)}
                  </view>
                </Section>
              )}
              {!videos.length && (
                <view className="empty-state">
                  <text className="empty-title">从一首喜欢的歌开始</text>
                  <text className="muted">
                    支持视频、分 P、合集及收藏夹链接
                  </text>
                </view>
              )}
            </>
          )}
          {tab === '收藏夹' && (
            <>
              {!folder && !folders.length && (
                <Section title="我的收藏夹">
                  <text className="muted">
                    {account.logged_in
                      ? '暂无收藏夹'
                      : '登录 B 站账号后查看并导入收藏夹。'}
                  </text>
                  {!account.logged_in && (
                    <Button onTap={() => void changeTab('账号')}>
                      前往登录
                    </Button>
                  )}
                </Section>
              )}
              {folder ? (
                <>
                  {action('返回收藏夹', async () => {
                    setFolder(null)
                  })}
                  <text>
                    {folder.title}（{folder.count} 首）
                  </text>
                  {videoRows(preview, false)}
                  <text>预览前 {preview.length} 首，整夹导入包含全部项目</text>
                  <Choice
                    label="创建同名歌单"
                    value={String(asPlaylist)}
                    options={[
                      ['true', '是'],
                      ['false', '否'],
                    ]}
                    change={(v) => setAsPlaylist(v === 'true')}
                  />
                  <Field
                    label="艺术家覆盖（可选）"
                    value={artist}
                    change={setArtist}
                  />
                  {action('整夹导入', async () => {
                    await apiPost('/api/favorites/' + folder.id + '/import', {
                      as_playlist: asPlaylist,
                      title: folder.title,
                      artist_override: artist || undefined,
                    })
                    await loadPlaylists()
                  })}
                </>
              ) : (
                folders.map((f) => (
                  <view key={f.id} className="card">
                    {action(f.title + '（' + f.count + ' 首）', async () => {
                      const r = await apiGet<Data>('/api/favorites/' + f.id)
                      setPreview(r.results || [])
                      setFolder(f)
                    })}
                  </view>
                ))
              )}
            </>
          )}
          {tab === '下载' && (
            <Section title="下载任务">
              {progress.cooldown && (
                <text className="notice">
                  {progress.cooldown.reason} · 冷却至 {progress.cooldown.until}
                </text>
              )}
              <text>
                {!progress.active
                  ? '暂无下载任务'
                  : progress.done
                    ? '已完成'
                    : progress.paused
                      ? '已暂停'
                      : '下载中'}
              </text>
              {progress.active && (
                <>
                  <text>
                    {progress.current}/{progress.total} · 成功{' '}
                    {progress.success} · 跳过 {progress.skipped} · 失败{' '}
                    {progress.failed}
                  </text>
                  <view className="row">
                    {!progress.done &&
                      action(
                        progress.paused ? '恢复' : '暂停',
                        async () => {
                          await apiPost(
                            '/api/download-batch/' +
                              (progress.paused ? 'resume' : 'pause'),
                            {},
                          )
                        },
                        progress.paused && !!progress.cooldown,
                      )}
                    {(progress.paused || progress.done) &&
                      action('清除任务 / 记录', async () => {
                        await apiPost('/api/download-batch/clear', {})
                        setProgress(
                          await apiGet<Data>('/api/download-batch/progress'),
                        )
                      })}
                    {progress.done &&
                      progress.failed > 0 &&
                      action(
                        '重试失败',
                        async () => {
                          const failed = progress.songs.filter(
                            (s: Data) => s.status === 'failed',
                          )
                          await apiPost('/api/download-batch', {
                            song_ids: failed.map((s: Data) => s.song_id),
                            song_titles: Object.fromEntries(
                              failed.map((s: Data) => [s.song_id, s.title]),
                            ),
                            playlist_name: progress.playlist_name,
                            download_directory: progress.download_directory,
                            path_template: progress.path_template,
                          })
                          setDownloadPage(0)
                        },
                        !!progress.cooldown,
                      )}
                  </view>
                  {(progress.songs || [])
                    .slice(downloadPage * 30, (downloadPage + 1) * 30)
                    .map((s: Data) => (
                      <view key={s.song_id} className="card">
                        <text>
                          {s.title} ·{' '}
                          {s.status === 'skipped' ? '已下载，跳过' : s.status}
                        </text>
                        {s.error && <text className="notice">{s.error}</text>}
                      </view>
                    ))}
                  <view className="row">
                    <Button
                      disabled={downloadPage === 0}
                      onTap={() => setDownloadPage((p) => p - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      disabled={
                        (downloadPage + 1) * 30 >= (progress.songs || []).length
                      }
                      onTap={() => setDownloadPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </view>
                </>
              )}
            </Section>
          )}
          {tab === '账号' && (
            <Section
              title="B 站账号"
              description="扫码登录或粘贴 Cookie，登录信息保存在服务端。"
            >
              <text>
                {account.logged_in
                  ? account.uname + (account.vip ? ' · 大会员' : '')
                  : '未登录'}
              </text>
              {account.logged_in ? (
                action('退出登录', async () => {
                  await apiPost('/api/logout', {})
                  setAccount({})
                })
              ) : (
                <>
                  {action('生成登录二维码', async () => {
                    setQr(await apiGet<Data>('/api/login/qrcode'))
                    setQrText('请扫码登录')
                  })}
                  {qr && <QR url={qr.url} />}
                  <text>{qrText}</text>
                  <Field
                    label="粘贴 Cookie"
                    value={cookie}
                    change={setCookie}
                    secret
                  />
                  {action('Cookie 登录', async () => {
                    const r = await apiPost<Data>('/api/login/cookie', {
                      cookie,
                    })
                    if (!r.logged_in) throw new Error('Cookie 无效')
                    setAccount(r)
                    setCookie('')
                  })}
                </>
              )}
            </Section>
          )}
          {tab === '设置' && settings && (
            <>
              <Section title="音质与下载">
                <Choice
                  label="音质"
                  value={settings.audio_quality}
                  options={[
                    ['high', '最高'],
                    ['medium', '中'],
                    ['low', '最低'],
                  ]}
                  change={(v) =>
                    set('audio_quality', v as Settings['audio_quality'])
                  }
                />
                {(
                  [
                    ['enable_dolby', '杜比'],
                    ['enable_hires', 'Hi-Res'],
                    ['embed_metadata', '嵌入元数据'],
                    ['pause_on_error', '下载出错时暂停'],
                  ] as const
                ).map(([k, label]) => (
                  <Toggle
                    key={k}
                    label={label}
                    value={settings[k]}
                    change={(v) => set(k, v)}
                  />
                ))}
              </Section>
              <Section title="保存与转码">
                <Choice
                  label="下载目录组织"
                  value={settings.path_template}
                  options={[
                    ['bili/{playlist}/{title}', '按歌单'],
                    ['bili/{title}', '统一目录'],
                    ['bili/{artist}/{title}', '按艺术家'],
                  ]}
                  change={(v) => set('path_template', v)}
                />
                <Field
                  label="自定义路径模板"
                  value={settings.path_template}
                  change={(v) => set('path_template', v)}
                />
                <Choice
                  label="转码格式"
                  value={settings.transcode_format}
                  options={[
                    ['', '原始'],
                    ['mp3', 'MP3'],
                    ['m4a', 'M4A'],
                  ]}
                  change={(v) =>
                    set('transcode_format', v as Settings['transcode_format'])
                  }
                />
                {!!settings.transcode_format && (
                  <Choice
                    label="码率"
                    value={String(settings.transcode_bitrate)}
                    options={['0', '128', '192', '320'].map((v) => [
                      v,
                      v === '0' ? '默认' : v,
                    ])}
                    change={(v) =>
                      set(
                        'transcode_bitrate',
                        Number(v) as Settings['transcode_bitrate'],
                      )
                    }
                  />
                )}
                <Field
                  label="下载间隔（秒）"
                  value={String(settings.download_interval)}
                  change={(v) => set('download_interval', Number(v))}
                />
              </Section>
              <Section
                title="收藏夹自动监控"
                description="首次启用仅建立基线，之后处理新加入的收藏。"
              >
                <Toggle
                  label="自动监控"
                  value={settings.watch_favorite_enabled}
                  change={(v) => set('watch_favorite_enabled', v)}
                />
                <Choice
                  label="监控收藏夹"
                  value={String(settings.watch_favorite_id)}
                  options={[
                    [
                      String(settings.watch_favorite_id),
                      settings.watch_favorite_title || '未选择',
                    ],
                    ...folders.map(
                      (f) => [String(f.id), f.title] as [string, string],
                    ),
                  ]}
                  change={(v) => {
                    set('watch_favorite_id', Number(v))
                    set(
                      'watch_favorite_title',
                      folders.find((f) => f.id === Number(v))?.title || '',
                    )
                  }}
                />
                <Choice
                  label="监控目标歌单"
                  value={String(settings.watch_playlist_id)}
                  options={[
                    [
                      String(settings.watch_playlist_id),
                      settings.watch_playlist_title || '不加入歌单',
                    ],
                    ['0', '不加入歌单'],
                    ...playlists.map(
                      (p) => [String(p.id), p.name] as [string, string],
                    ),
                  ]}
                  change={(v) => {
                    set('watch_playlist_id', Number(v))
                    set(
                      'watch_playlist_title',
                      playlists.find((p) => p.id === Number(v))?.name || '',
                    )
                  }}
                />
                <Field
                  label="检查间隔（1–1440 分钟）"
                  value={String(settings.watch_interval_minutes)}
                  change={(v) => set('watch_interval_minutes', Number(v))}
                />
                <text>
                  监控：{watch.enabled ? '开启' : '关闭'} ·{' '}
                  {watch.running ? '检查中' : '空闲'}
                </text>
                <text>
                  收藏夹：{watch.folder_title || '-'} · 目标歌单：
                  {watch.playlist_title || '不加入歌单'}
                </text>
                <text>
                  上次：{watch.last_check_at || '-'} · 下次：
                  {watch.next_check_at || '-'}
                </text>
                <text>
                  待处理 {watch.counts?.pending || 0} · 已下载{' '}
                  {watch.counts?.downloaded || 0} · 失败{' '}
                  {watch.counts?.failed || 0} · 停止重试{' '}
                  {watch.counts?.retry_exhausted || 0}
                </text>
                <text>
                  {watch.cooldown ? '冷却至 ' + watch.cooldown.until : ''}
                  {watch.last_error || ''}
                </text>
                <view className="row">
                  {action('立即检查', async () => {
                    await apiPost('/api/favorite-watch/check', {})
                  })}
                  {action('重试失败项目', async () => {
                    await apiPost('/api/favorite-watch/retry-failed', {})
                  })}
                </view>
                <Button onTap={() => setConfirmBaseline((v) => !v)}>
                  重建基线
                </Button>
                {confirmBaseline && (
                  <>
                    <text>
                      当前已有项目将视为基线，之后只处理新收藏。确认继续？
                    </text>
                    {action('确认重建', async () => {
                      await apiPost('/api/favorite-watch/rebaseline', {})
                      setConfirmBaseline(false)
                    })}
                  </>
                )}
              </Section>
              {action(
                '保存设置',
                async () => {
                  if (
                    settings.watch_favorite_enabled &&
                    settings.watch_favorite_id <= 0
                  )
                    throw new Error('请选择收藏夹')
                  if (
                    !Number.isFinite(settings.download_interval) ||
                    settings.download_interval < 0 ||
                    settings.watch_interval_minutes < 1 ||
                    settings.watch_interval_minutes > 1440
                  )
                    throw new Error('请填写有效间隔')
                  await apiPost('/api/settings', settings)
                  setSettings(await apiGet<Settings>('/api/settings'))
                },
                false,
                true,
              )}
              <Section title="音源测试">
                {action('测试音源搜索', async () => {
                  setWatch(
                    await apiPost<Data>('/api/search/topone', {
                      keyword: query,
                      quality: '320k',
                    }),
                  )
                })}
                <Field label="音源测试关键词" value={query} change={setQuery} />
              </Section>
            </>
          )}
          <view className="bottom-space" />
        </view>
      </scroll-view>
    </view>
  )
}
