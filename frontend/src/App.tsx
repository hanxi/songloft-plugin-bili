import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from '@lynx-js/react'
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
import { createReadCache, coverSource } from './requests'
import { optionPage, type Option } from './options'
import { partsLabel } from './video-parts'
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
  icon,
  tabKey,
}: {
  children: ReactNode
  onTap: () => void
  disabled?: boolean
  selected?: boolean
  variant?: 'secondary' | 'primary' | 'tab' | 'link'
  icon?: ReactNode
  tabKey?: string
}) {
  return (
    <view
      data-tab={tabKey}
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
      {icon}
      <text text-maxline="2" text-overflow="ellipsis">
        {children}
      </text>
    </view>
  )
}
let fieldId = 0
type PickerRequest = {
  label: string
  value: string
  options: Option[]
  change: (value: string) => void
}

function OptionPicker({
  request,
  close,
}: {
  request: PickerRequest
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const result = optionPage(request.options, query, page)
  return (
    <view className="picker-mask" bindtap={close}>
      <view className="picker-dialog" catchtap={() => {}}>
        <view className="picker-header">
          <text className="picker-title">{request.label}</text>
          <Button onTap={close}>取消</Button>
        </view>
        <Field
          label="搜索名称"
          value={query}
          change={(value) => {
            setQuery(value)
            setPage(0)
          }}
        />
        <text className="muted">共 {result.count} 项</text>
        <scroll-view
          className="picker-list"
          scroll-y
          key={query + ':' + result.page}
        >
          {result.items.map(([value, title]) => (
            <view
              className={
                'picker-option' + (value === request.value ? ' selected' : '')
              }
              key={value}
              bindtap={() => {
                request.change(value)
                close()
              }}
            >
              <text
                className="picker-option-title"
                text-maxline="2"
                text-overflow="ellipsis"
              >
                {title}
              </text>
              <text className="picker-option-check">
                {value === request.value ? '✓' : ''}
              </text>
            </view>
          ))}
          {!result.count && <text className="muted">没有匹配项</text>}
        </scroll-view>
        <view className="picker-footer">
          <Button
            disabled={result.page === 0}
            onTap={() => setPage(result.page - 1)}
          >
            上一页
          </Button>
          <text>
            {result.page + 1} / {result.pages}
          </text>
          <Button
            disabled={result.page + 1 === result.pages}
            onTap={() => setPage(result.page + 1)}
          >
            下一页
          </Button>
        </view>
      </view>
    </view>
  )
}
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
  const initialValue = useRef(value)
  const nativeValue = useRef(value)
  const emittedValues = useRef(new Set<string>())
  const mounted = useRef(false)
  const changeRef = useRef(change)
  changeRef.current = change
  const handleInput = useCallback((e: { detail: { value: string } }) => {
    nativeValue.current = e.detail.value
    emittedValues.current.add(e.detail.value)
    changeRef.current(e.detail.value)
  }, [])
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      // Web's input does not always apply a nonempty default on re-entry.
      // Empty new fields need no imperative echo that could race typing.
      if (!value || emittedValues.current.size) return
    } else if (nativeValue.current === value) {
      emittedValues.current.clear()
      return
    }
    if (emittedValues.current.has(value)) return
    emittedValues.current.clear()
    nativeValue.current = value
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
        default-value={initialValue.current}
        placeholder={label}
        bindinput={handleInput}
      />
    </view>
  )
}
function Choice({
  label,
  value,
  options,
  change,
  compact = false,
  openPicker,
  status,
}: {
  openPicker?: (request: PickerRequest) => void
  status?: ReactNode
  compact?: boolean
  label: string
  value: string
  options: [string, string][]
  change: (v: string) => void
}) {
  return (
    <view className="field">
      <view className="field-heading">
        <text className="choice-label">{label}</text>
        {status}
      </view>
      {compact && (
        <Button onTap={() => openPicker?.({ label, value, options, change })}>
          {options.find(([v]) => v === value)?.[1] || '选择歌单'} ▾
        </Button>
      )}
      {!compact && (
        <view className="row">
          {Array.from(new Map(options).entries()).map(([v, title]) => (
            <Button
              key={v}
              selected={value === v}
              onTap={() => {
                change(v)
              }}
            >
              {title}
            </Button>
          ))}
        </view>
      )}
    </view>
  )
}
function Section({
  plain = false,
  title,
  description,
  children,
  status,
}: {
  plain?: boolean
  title: string
  description?: string
  children: ReactNode
  status?: ReactNode
}) {
  return (
    <view className={plain ? 'section section-search' : 'section'}>
      <view className="section-heading">
        <text
          className="section-title"
          text-maxline="1"
          text-overflow="ellipsis"
        >
          {title}
        </text>
        {status}
      </view>
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
const coverCache = new Map<string, string>()
const coverPending = new Map<string, Promise<string>>()
function fetchCover(url: string): Promise<string> {
  const cached = coverCache.get(url)
  if (cached) return Promise.resolve(cached)
  const existing = coverPending.get(url)
  if (existing) return existing
  const task = apiPost<{ src: string }>('/api/cover', { url })
    .then((reply) => {
      // Bound decoded image data retained across tab changes to roughly 4 MB.
      let size = [...coverCache.values()].reduce(
        (sum, src) => sum + src.length,
        0,
      )
      while (coverCache.size && size + reply.src.length > 4 * 1024 * 1024) {
        const oldest = coverCache.keys().next().value!
        size -= coverCache.get(oldest)!.length
        coverCache.delete(oldest)
      }
      coverCache.set(url, reply.src)
      return reply.src
    })
    .finally(() => coverPending.delete(url))
  coverPending.set(url, task)
  return task
}
function Cover({
  source,
  avatar = false,
}: {
  source: string
  avatar?: boolean
}) {
  const original = coverSource(source)
  const [src, setSrc] = useState(coverCache.get(original) || original)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setSrc(coverCache.get(original) || original)
    setFailed(false)
    return () => {
      generation.current++
    }
  }, [original])
  async function fallback() {
    const current = generation.current
    setFailed(true)
    if (src !== original || !original) return
    try {
      const reply = await fetchCover(original)
      if (current === generation.current) {
        setSrc(reply)
        setFailed(false)
      }
    } catch {
      /* Keep the stable placeholder. */
    }
  }
  return (
    <view className={'cover' + (avatar ? ' cover-avatar' : '')}>
      <text className="cover-placeholder">{avatar ? '✓' : '♪'}</text>
      {!!src && !failed && (
        <image
          className="cover-image"
          src={src}
          mode="aspectFill"
          binderror={() => void fallback()}
        />
      )}
    </view>
  )
}
export function App() {
  const [picker, setPicker] = useState<PickerRequest | null>(null)
  const [visible, setVisible] = useState(true)
  const [theme, setTheme] = useState(getTheme()),
    [tab, setTab] = useState('搜索')
  const [visited, setVisited] = useState<Record<string, boolean>>({
    搜索: true,
  })
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [operations, setOperations] = useState<Record<string, boolean>>({})
  const busyRef = useRef(new Set<string>()),
    reads = useRef(createReadCache()),
    loadedResources = useRef(new Set<string>()),
    accountRef = useRef<Data>({ logged_in: false }),
    [resources, setResources] = useState<
      Record<string, { loading: boolean; error: string }>
    >({}),
    settingsDirty = useRef(false),
    settingsRevision = useRef(0),
    resourceRevisions = useRef<Record<string, number>>({}),
    playlistChosen = useRef(false),
    tabRef = useRef(tab),
    alive = useRef(true),
    searchEpoch = useRef(0)
  const [mode, setMode] = useState<'url' | 'search'>('search')
  const [query, setQuery] = useState(''),
    [url, setUrl] = useState(''),
    [page, setPage] = useState(1)
  const [videos, setVideos] = useState<BiliVideo[]>([]),
    [more, setMore] = useState(false)
  const [parts, setParts] = useState<Record<string, BiliVideo[]>>({}),
    [expandedParts, setExpandedParts] = useState<Record<string, boolean>>({}),
    [selected, setSelected] = useState<Record<string, BiliVideo>>({})
  const [playlists, setPlaylists] = useState<Data[]>([]),
    [playlist, setPlaylist] = useState(''),
    [playlistName, setPlaylistName] = useState('')
  const [importAdvanced, setImportAdvanced] = useState(false)
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
  const busy = !!operations[tab]
  const message = messages[tab] || ''
  function setMessage(value: string, owner = tabRef.current) {
    if (alive.current) setMessages((old) => ({ ...old, [owner]: value }))
  }
  async function run(action: () => Promise<void>, owner = tab) {
    if (busyRef.current.has(owner)) return
    busyRef.current.add(owner)
    resourceRevisions.current[owner] =
      (resourceRevisions.current[owner] || 0) + 1
    setOperations((old) => ({ ...old, [owner]: true }))
    setMessage('处理中…', owner)
    try {
      await action()
      setMessage('操作完成', owner)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e), owner)
    } finally {
      busyRef.current.delete(owner)
      if (alive.current) setOperations((old) => ({ ...old, [owner]: false }))
    }
  }
  function applyAccount(next: Data) {
    const changed = !!accountRef.current.logged_in !== !!next.logged_in
    accountRef.current = next
    setAccount(next)
    if (changed)
      resourceRevisions.current['收藏夹'] =
        (resourceRevisions.current['收藏夹'] || 0) + 1
    if (!next.logged_in) {
      setFolders([])
      setFolder(null)
      setPreview([])
      loadedResources.current.delete('收藏夹')
      setResources((old) => ({
        ...old,
        收藏夹: { loading: false, error: '' },
      }))
    }
  }
  function read(name: string, action: () => Promise<void>) {
    return reads.current(name, async () => {
      if (!alive.current) return
      if (!loadedResources.current.has(name))
        setResources((old) => ({
          ...old,
          [name]: { loading: true, error: '' },
        }))
      try {
        await action()
      } catch (e) {
        if (
          name === '收藏夹' &&
          /未登录|not logged in|\b401\b/i.test(String(e))
        ) {
          if (alive.current) applyAccount({ logged_in: false })
          return
        }
        if (alive.current)
          setResources((old) => ({
            ...old,
            [name]: { loading: false, error: String(e) },
          }))
        return
      }
      if (alive.current) {
        loadedResources.current.add(name)
        setResources((old) => ({
          ...old,
          [name]: { loading: false, error: '' },
        }))
      }
    })
  }
  function loadResource(name: string) {
    if (name === '收藏夹' && !accountRef.current.logged_in)
      return Promise.resolve()
    return read(name, async () => {
      if (name === '歌单') {
        await loadPlaylists(true)
        return
      }
      const paths: Record<string, string> = {
        账号: '/api/login/status',
        收藏夹: '/api/favorites',
        设置: '/api/settings',
        下载: '/api/download-batch/progress',
        同步状态: '/api/favorite-watch/status',
      }
      const revision = resourceRevisions.current[name] || 0
      const r = await apiGet<Data>(paths[name])
      if (!alive.current || revision !== (resourceRevisions.current[name] || 0))
        return
      if (name === '账号') applyAccount(r)
      if (name === '收藏夹') setFolders(r.folders || [])
      if (name === '设置' && !settingsDirty.current) setSettings(r as Settings)
      if (name === '下载') setProgress(r)
      if (name === '同步状态') setWatch(r)
    })
  }
  const pageResources = (page: string) =>
    page === '设置'
      ? ['设置', '歌单', ...(account.logged_in ? ['收藏夹'] : []), '同步状态']
      : page === '搜索'
        ? ['歌单']
        : page === '收藏夹' && !account.logged_in
          ? []
          : [page]
  function resourceStatus(...names: string[]) {
    const failed = names.filter((name) => resources[name]?.error)
    const loading = names.some((name) => resources[name]?.loading)
    return (
      <view
        className={'resource-status' + (failed.length ? ' failed' : '')}
        data-resource={names.join(',')}
        bindtap={() => failed.forEach((name) => void loadResource(name))}
      >
        <text text-maxline="1" text-overflow="ellipsis">
          {failed.length ? '点击重试' : loading ? '加载中…' : ''}
        </text>
      </view>
    )
  }
  useEffect(() => {
    if (message !== '操作完成') return
    const owner = tab
    const timer = setTimeout(() => setMessage('', owner), 2500)
    return () => clearTimeout(timer)
  }, [tab, message])
  useEffect(() => {
    if (account.logged_in && (tab === '设置' || tab === '收藏夹'))
      void loadResource('收藏夹')
  }, [account.logged_in, tab])
  async function loadPlaylists(initial = false) {
    const r = await apiGet<Data>('/api/playlists')
    if (!alive.current) return
    setPlaylists(r.playlists || [])
    if (initial && !playlistChosen.current)
      setPlaylist(String(r.last_playlist || ''))
  }
  useEffect(() => {
    alive.current = true
    const off = onThemeChange(setTheme)
    void loadResource('歌单')
    void loadResource('账号')
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
      if (active && visible && (tab === '下载' || tab === '设置'))
        await loadResource(tab === '下载' ? '下载' : '同步状态')
      if (active && visible && (tab === '下载' || tab === '设置'))
        timer = setTimeout(refresh, 2000)
    }
    void refresh()
    const off = onPush((event, data) => {
      if (event === 'lifecycle') {
        const state = (
          typeof data === 'string' ? JSON.parse(data) : (data as Data)
        )?.state
        if (state === 'paused') setVisible(false)
        if (state === 'resumed') setVisible(true)
      }
      if (
        event === 'lifecycle' &&
        (typeof data === 'string' ? JSON.parse(data) : (data as Data))
          ?.state === 'resumed'
      ) {
        pageResources(tabRef.current).forEach((name) => void loadResource(name))
      }
    })
    return () => {
      active = false
      clearTimeout(timer)
      off()
    }
  }, [tab, visible])
  useEffect(() => {
    if (!qr || !visible) return
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
          applyAccount(await apiGet<Data>('/api/login/status'))
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
  }, [qr, visible])
  function changeTab(next: string) {
    if (next === tabRef.current) return
    tabRef.current = next
    setVisited((old) => (old[next] ? old : { ...old, [next]: true }))
    setTab(next)
    setQr(null)
    pageResources(next).forEach((name) => void loadResource(name))
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
      setExpandedParts({})
      setSelected(
        extract ? Object.fromEntries(items.map((v) => [key(v), v])) : {},
      )
    }
    if (r.playlist_title) {
      playlistChosen.current = true
      setPlaylist('__new__')
      setPlaylistName(r.playlist_title)
    }
  }
  function toggle(v: BiliVideo) {
    const items = !v.cid && parts[v.bvid]?.length ? parts[v.bvid] : [v]
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
    if (download && tabRef.current === '搜索') changeTab('下载')
  }
  function videoRows(items: BiliVideo[], selectable = true) {
    return items.map((v) => (
      <view key={key(v)} className="video-item">
        <view className="video-row">
          <view
            className="video-main"
            bindtap={() => selectable && !busy && toggle(v)}
          >
            {selectable && (
              <view
                className={
                  'selection' +
                  (selected[key(v)] ||
                  (parts[v.bvid]?.length &&
                    parts[v.bvid].every((p) => selected[key(p)]))
                    ? ' is-selected'
                    : '')
                }
              >
                <text>
                  {selected[key(v)] ||
                  (parts[v.bvid]?.length &&
                    parts[v.bvid].every((p) => selected[key(p)]))
                    ? '✓'
                    : ''}
                </text>
              </view>
            )}
            <Cover source={v.cover} />
            <view className="video-info">
              <text
                className="video-title"
                text-maxline="2"
                text-overflow="ellipsis"
              >
                {v.title}
              </text>
              <text
                className="muted video-meta"
                text-maxline="1"
                text-overflow="ellipsis"
              >
                {v.author} · {Math.floor(v.duration / 60)}:
                {String(v.duration % 60).padStart(2, '0')}
                {v.page && (v.part_count || parts[v.bvid]?.length || 0) > 1
                  ? ' · P' + v.page
                  : ''}
              </text>
            </view>
          </view>
          {selectable && partsLabel(v, parts[v.bvid]) && (
            <Button
              disabled={busy}
              onTap={() => {
                if (parts[v.bvid]) {
                  setExpandedParts((old) => ({
                    ...old,
                    [v.bvid]: !old[v.bvid],
                  }))
                  return
                }
                void run(async () => {
                  const epoch = searchEpoch.current
                  const r = await apiGet<Data>(
                    '/api/videos/' + encodeURIComponent(v.bvid) + '/parts',
                  )
                  if (!alive.current || epoch !== searchEpoch.current) return
                  const items: BiliVideo[] = (r.items || []).map(
                    (item: BiliVideo) => ({
                      ...item,
                      cover: item.cover || v.cover,
                      part_count: (r.items || []).length,
                    }),
                  )
                  setParts((old) => ({ ...old, [v.bvid]: items }))
                  setExpandedParts((old) => ({
                    ...old,
                    [v.bvid]: items.length > 1,
                  }))
                  setSelected((old) => {
                    const copy = { ...old }
                    if (items.length && copy[key(v)]) {
                      delete copy[key(v)]
                      for (const p of items) copy[key(p)] = p
                    }
                    return copy
                  })
                })
              }}
            >
              {partsLabel(v, parts[v.bvid], expandedParts[v.bvid])}
            </Button>
          )}
        </view>
        {parts[v.bvid] && expandedParts[v.bvid] && !v.cid && (
          <view className="parts">{videoRows(parts[v.bvid])}</view>
        )}
      </view>
    ))
  }
  function set<K extends keyof Settings>(name: K, value: Settings[K]) {
    settingsDirty.current = true
    settingsRevision.current++
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
            tabKey={t}
            selected={tab === t}
            onTap={() => changeTab(t)}
            icon={
              t === '账号' && account.logged_in ? (
                <Cover source={String(account.face || '')} avatar />
              ) : undefined
            }
          >
            {t === '账号' && account.logged_in === false ? '未登录' : t}
          </Button>
        ))}
      </view>
      <view className="page-stack">
        {tabs
          .filter((name) => visited[name])
          .map((pageTab) => (
            <view
              key={pageTab}
              className="tab-page"
              style={{ display: tab === pageTab ? 'flex' : 'none' }}
            >
              <scroll-view
                scroll-y
                className={'body' + (tab === pageTab ? ' active' : '')}
              >
                <view className="content">
                  {pageTab === '搜索' && (
                    <>
                      <Section
                        plain
                        title={mode === 'search' ? '搜索音乐' : '链接导入'}
                        description="发现喜欢的音乐，加入你的歌单。"
                      >
                        {mode === 'url' ? (
                          <view className="search-fields">
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
                          </view>
                        ) : (
                          <view className="search-fields">
                            <Field
                              label="搜索关键词"
                              value={query}
                              change={setQuery}
                            />
                            {action(
                              '搜索',
                              () => search(1),
                              !query.trim(),
                              true,
                            )}
                          </view>
                        )}
                        <Button
                          variant="link"
                          onTap={() =>
                            setMode(mode === 'search' ? 'url' : 'search')
                          }
                        >
                          {mode === 'search' ? '通过链接导入' : '返回音乐搜索'}
                        </Button>
                      </Section>
                      {!!videos.length && (
                        <text className="result-heading">搜索结果</text>
                      )}
                      <view className="results">{videoRows(videos)}</view>
                      {more && action('加载更多', () => search(page + 1))}
                      {Object.keys(selected).length > 0 && (
                        <Section
                          title={'已选 ' + Object.keys(selected).length + ' 首'}
                        >
                          <Choice
                            compact
                            openPicker={setPicker}
                            label="导入目标歌单"
                            status={resourceStatus('歌单')}
                            value={playlist}
                            options={[
                              ['', '不加入歌单'],
                              ...playlists.map(
                                (p) =>
                                  [String(p.id), p.name] as [string, string],
                              ),
                              ['__new__', '新建歌单'],
                            ]}
                            change={(v) => {
                              playlistChosen.current = true
                              setPlaylist(v)
                              void run(async () => {
                                await apiPost('/api/import-prefs', {
                                  last_playlist: v,
                                })
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
                          <Button
                            variant="link"
                            onTap={() => setImportAdvanced(!importAdvanced)}
                          >
                            {importAdvanced ? '收起更多选项' : '更多导入选项'}
                          </Button>
                          {importAdvanced && (
                            <view>
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
                            </view>
                          )}
                          <view className="row">
                            {action('仅导入', () => importItems(false))}
                            {action(
                              '导入并下载',
                              () => importItems(true),
                              false,
                              true,
                            )}
                          </view>
                        </Section>
                      )}
                      {!videos.length && (
                        <view className="empty-state">
                          <text className="empty-title">
                            从一首喜欢的歌开始
                          </text>
                          <text className="muted">
                            支持视频、分 P、合集及收藏夹链接
                          </text>
                        </view>
                      )}
                    </>
                  )}
                  {pageTab === '收藏夹' && (
                    <Section
                      title="我的收藏夹"
                      status={resourceStatus('收藏夹')}
                    >
                      {!folder && !folders.length && (
                        <>
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
                        </>
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
                          <text>
                            预览前 {preview.length} 首，整夹导入包含全部项目
                          </text>
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
                            await apiPost(
                              '/api/favorites/' + folder.id + '/import',
                              {
                                as_playlist: asPlaylist,
                                title: folder.title,
                                artist_override: artist || undefined,
                              },
                            )
                            await loadPlaylists()
                          })}
                        </>
                      ) : (
                        folders.map((f) => (
                          <view key={f.id} className="card">
                            {action(
                              f.title + '（' + f.count + ' 首）',
                              async () => {
                                const r = await apiGet<Data>(
                                  '/api/favorites/' + f.id,
                                )
                                setPreview(r.results || [])
                                setFolder(f)
                              },
                            )}
                          </view>
                        ))
                      )}
                    </Section>
                  )}
                  {pageTab === '下载' && (
                    <Section title="下载任务" status={resourceStatus('下载')}>
                      {progress.cooldown && (
                        <text className="notice">
                          {progress.cooldown.reason} · 冷却至{' '}
                          {progress.cooldown.until}
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
                                  await apiGet<Data>(
                                    '/api/download-batch/progress',
                                  ),
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
                                    song_ids: failed.map(
                                      (s: Data) => s.song_id,
                                    ),
                                    song_titles: Object.fromEntries(
                                      failed.map((s: Data) => [
                                        s.song_id,
                                        s.title,
                                      ]),
                                    ),
                                    playlist_name: progress.playlist_name,
                                    download_directory:
                                      progress.download_directory,
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
                                  {s.status === 'skipped'
                                    ? '已下载，跳过'
                                    : s.status}
                                </text>
                                {s.error && (
                                  <text className="notice">{s.error}</text>
                                )}
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
                                (downloadPage + 1) * 30 >=
                                (progress.songs || []).length
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
                  {pageTab === '账号' && (
                    <Section
                      title="B 站账号"
                      status={resourceStatus('账号')}
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
                          applyAccount({ logged_in: false })
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
                            applyAccount(r)
                            setCookie('')
                          })}
                        </>
                      )}
                    </Section>
                  )}
                  {pageTab === '设置' && !settings && (
                    <Section title="音质与下载" status={resourceStatus('设置')}>
                      <text className="muted">等待加载设置</text>
                    </Section>
                  )}
                  {pageTab === '设置' && settings && (
                    <>
                      <Section
                        title="音质与下载"
                        status={resourceStatus('设置')}
                      >
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
                            set(
                              'transcode_format',
                              v as Settings['transcode_format'],
                            )
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
                        status={resourceStatus('同步状态')}
                        description="首次启用仅建立基线，之后处理新加入的收藏。"
                      >
                        <Toggle
                          label="自动监控"
                          value={settings.watch_favorite_enabled}
                          change={(v) => set('watch_favorite_enabled', v)}
                        />
                        {account.logged_in ? (
                          <Choice
                            compact
                            openPicker={setPicker}
                            label="监控收藏夹"
                            status={resourceStatus('收藏夹')}
                            value={String(settings.watch_favorite_id)}
                            options={[
                              [
                                String(settings.watch_favorite_id),
                                settings.watch_favorite_title || '未选择',
                              ],
                              ...folders.map(
                                (f) =>
                                  [String(f.id), f.title] as [string, string],
                              ),
                            ]}
                            change={(v) => {
                              set('watch_favorite_id', Number(v))
                              set(
                                'watch_favorite_title',
                                folders.find((f) => f.id === Number(v))
                                  ?.title || '',
                              )
                            }}
                          />
                        ) : (
                          <view className="login-guide">
                            <text className="muted">
                              登录 B 站后可选择监控收藏夹，其他设置可正常使用。
                            </text>
                            <Button
                              variant="link"
                              onTap={() => changeTab('账号')}
                            >
                              前往登录
                            </Button>
                          </view>
                        )}
                        <Choice
                          compact
                          openPicker={setPicker}
                          label="监控目标歌单"
                          status={resourceStatus('歌单')}
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
                              playlists.find((p) => p.id === Number(v))?.name ||
                                '',
                            )
                          }}
                        />
                        <Field
                          label="检查间隔（1–1440 分钟）"
                          value={String(settings.watch_interval_minutes)}
                          change={(v) =>
                            set('watch_interval_minutes', Number(v))
                          }
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
                          {watch.cooldown
                            ? '冷却至 ' + watch.cooldown.until
                            : ''}
                          {watch.last_error || ''}
                        </text>
                        <view className="row">
                          {action('立即检查', async () => {
                            await apiPost('/api/favorite-watch/check', {})
                          })}
                          {action('重试失败项目', async () => {
                            await apiPost(
                              '/api/favorite-watch/retry-failed',
                              {},
                            )
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
                              await apiPost(
                                '/api/favorite-watch/rebaseline',
                                {},
                              )
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
                          const revision = settingsRevision.current
                          await apiPost('/api/settings', settings)
                          if (revision !== settingsRevision.current) return
                          settingsDirty.current = false
                          await loadResource('设置')
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
                        <Field
                          label="音源测试关键词"
                          value={query}
                          change={setQuery}
                        />
                      </Section>
                    </>
                  )}
                  <view className="bottom-space" />
                </view>
              </scroll-view>
            </view>
          ))}
      </view>
      {!!message && (
        <view className="action-toast">
          <text
            className="action-toast-text"
            text-maxline="2"
            text-overflow="ellipsis"
          >
            {message}
          </text>
          <view className="action-toast-close" bindtap={() => setMessage('')}>
            <text>×</text>
          </view>
        </view>
      )}
      {picker && (
        <OptionPicker request={picker} close={() => setPicker(null)} />
      )}
    </view>
  )
}
