/* 哔哩哔哩音乐插件前端 */
(function () {
  'use strict';

  const API = window.SongloftPlugin || {
    apiGet: (p) => fetch(p).then((r) => r.json()),
    apiPost: (p, b) =>
      fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json()),
    getAuthToken: () => '',
  };

  const $ = (id) => document.getElementById(id);
  const toastEl = $('toast');
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // 反代 BASE_PATH 子路径部署下，硬编码的绝对路径（以 "/" 开头）会绕过 BASE_PATH
  // 直接打到域名根——这类绝对路径不受 <base href> 影响（WebF 下 <base href> 本身
  // 也完全不生效，见 docs/webf/upstream-issues.md #2，不能依赖它）。从当前页面路径里
  // 找出插件路由段之前的部分即为 BASE_PATH 前缀（songloft-org/songloft#407）。
  function hostPathPrefix() {
    const match = window.location.pathname.match(/^(.*)\/api\/v1\/jsplugin\/[^/]+/);
    return match ? match[1] : '';
  }

  function proxyImg(url) {
    if (!url) return '';
    const token = API.getAuthToken ? API.getAuthToken() : '';
    return token
      ? hostPathPrefix() + '/api/v1/proxy?url=' + encodeURIComponent(url) + '&access_token=' + encodeURIComponent(token)
      : url;
  }

  function fmtDuration(sec) {
    sec = Math.floor(sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---- Tabs ----
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      $('tab-' + tab).classList.add('active');
      if (tab === 'fav') loadFolders();
      if (tab === 'download') refreshDownload();
      if (tab === 'settings') {
        loadSettings();
        refreshStatus();
      }
    });
  });

  // ================= 账号 =================
  let qrTimer = 0;

  async function refreshStatus() {
    let s;
    try {
      s = await API.apiGet('/api/login/status');
    } catch (e) {
      return;
    }
    const loggedIn = s && s.logged_in;
    $('account-logged-in').style.display = loggedIn ? 'block' : 'none';
    $('account-logged-out').style.display = loggedIn ? 'none' : 'block';
    $('fav-login-hint').style.display = loggedIn ? 'none' : 'block';
    if (loggedIn) {
      $('account-name').textContent = s.uname || '已登录';
      $('account-vip').textContent = s.vip ? '大会员' : '';
      $('account-face').src = proxyImg(s.face);
    }
  }

  $('qr-start').addEventListener('click', async () => {
    const box = $('qr-box');
    box.style.display = 'block';
    box.innerHTML = '';
    $('qr-status').textContent = '正在生成…';
    let res;
    try {
      res = await API.apiGet('/api/login/qrcode');
    } catch (e) {
      $('qr-status').textContent = '生成失败';
      return;
    }
    if (res.error) {
      $('qr-status').textContent = '生成失败：' + res.error;
      return;
    }
    new QRCode(box, { text: res.url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    $('qr-status').textContent = '请用哔哩哔哩 App 扫码';
    startPoll(res.qrcode_key);
  });

  function startPoll(key) {
    clearInterval(qrTimer);
    qrTimer = setInterval(async () => {
      let r;
      try {
        r = await API.apiGet('/api/login/poll?key=' + encodeURIComponent(key));
      } catch (e) {
        return;
      }
      if (r.status === 0) {
        clearInterval(qrTimer);
        $('qr-status').textContent = '登录成功！';
        toast('登录成功');
        await refreshStatus();
      } else if (r.status === 86038) {
        clearInterval(qrTimer);
        $('qr-status').textContent = '二维码已过期，请重新生成';
      } else if (r.status === 86090) {
        $('qr-status').textContent = '已扫码，请在手机上确认';
      } else if (r.status === 86101) {
        $('qr-status').textContent = '请用哔哩哔哩 App 扫码';
      }
    }, 2000);
  }

  $('cookie-login').addEventListener('click', async () => {
    const cookie = $('cookie-input').value.trim();
    if (!cookie) {
      toast('请粘贴 Cookie');
      return;
    }
    let r;
    try {
      r = await API.apiPost('/api/login/cookie', { cookie });
    } catch (e) {
      toast('登录失败');
      return;
    }
    if (r.logged_in) {
      toast('登录成功：' + (r.uname || ''));
      await refreshStatus();
    } else {
      toast('登录失败：' + (r.error || 'Cookie 无效'));
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    await API.apiPost('/api/logout', {});
    toast('已退出');
    await refreshStatus();
  });

  // ================= 搜索 =================
  let searchKeyword = '';
  let searchPage = 1;
  const selected = new Map(); // bvid[:cid] -> item

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $('mode-url').classList.toggle('hidden', mode !== 'url');
      $('mode-search').classList.toggle('hidden', mode !== 'search');
    });
  });

  function itemKey(v) {
    return v.cid ? v.bvid + ':cid:' + v.cid : v.bvid;
  }

  function setSelectedItem(item, checked) {
    const key = itemKey(item);
    if (checked) selected.set(key, item);
    else selected.delete(key);
  }

  function shouldShowPartsButton(v) {
    if (v.cid) return false;
    if (v.part_count && v.part_count > 1) return true;
    return /(合集|歌单|连播|全集|系列|精选|分P|P\d+|全(?:\d+|[一二三四五六七八九十百千万]+)?首)/i.test(v.title || '');
  }

  function updateImportBar() {
    const active = selected.size > 0;
    $('import-bar').style.display = active ? 'flex' : 'none';
    document.querySelector('.app').classList.toggle('import-active', active);
  }

  function renderVideoItem(container, v, checkedByDefault) {
    const wrapper = document.createElement('div');
    wrapper.className = 'result-node';
    const row = document.createElement('div');
    row.className = 'item search-parent';
    const key = itemKey(v);
    if (checkedByDefault) setSelectedItem(v, true);
    const checked = selected.has(key) ? 'checked' : '';
    const hasPartsButton = shouldShowPartsButton(v);
    row.innerHTML =
      '<input type="checkbox" class="parent-check" ' +
      checked +
      ' />' +
      '<img class="cover" src="' +
      proxyImg(v.cover) +
      '" />' +
      '<div class="meta"><div class="title"></div><div class="sub"></div></div>' +
      (hasPartsButton
        ? '<button class="btn part-toggle" type="button"><span class="material-symbols-outlined">account_tree</span><span>分P</span></button>'
        : '');
    row.querySelector('.title').textContent = v.title;
    row.querySelector('.sub').textContent =
      v.author + (v.page ? ' · P' + v.page : '') + ' · ' + fmtDuration(v.duration);
    const cb = row.querySelector('.parent-check');
    cb.addEventListener('change', () => {
      const partList = wrapper.querySelector('.part-list');
      if (partList) {
        setSelectedItem(v, false);
        partList.querySelectorAll('.part-check').forEach((partCheck) => {
          partCheck.checked = cb.checked;
          setSelectedItem(partCheck._item, cb.checked);
        });
        cb.indeterminate = false;
      } else {
        setSelectedItem(v, cb.checked);
      }
      updateImportBar();
    });

    const partBtn = row.querySelector('.part-toggle');
    if (partBtn) {
      partBtn.addEventListener('click', () => toggleParts(wrapper, v, partBtn));
    }

    wrapper.appendChild(row);
    container.appendChild(wrapper);
  }

  async function toggleParts(wrapper, video, btn) {
    const existing = wrapper.querySelector('.part-list');
    if (existing) {
      const hidden = existing.classList.toggle('hidden');
      btn.classList.toggle('active', !hidden);
      btn.querySelector('span:last-child').textContent = hidden ? '分P' : '收起';
      return;
    }

    btn.disabled = true;
    btn.querySelector('span:last-child').textContent = '加载';
    try {
      const resp = await API.apiGet('/api/videos/' + encodeURIComponent(video.bvid) + '/parts');
      if (resp.error) throw new Error(resp.error);
      const parts = (resp.items || []).filter((p) => p.cid);
      if (parts.length <= 1) {
        toast('这个视频没有可展开的分P');
        btn.style.display = 'none';
        return;
      }

      const list = document.createElement('div');
      list.className = 'part-list';
      const parentWasSelected = selected.has(itemKey(video));
      if (parentWasSelected) setSelectedItem(video, false);

      parts.forEach((part) => renderPartItem(list, wrapper, part, parentWasSelected));
      wrapper.appendChild(list);
      btn.classList.add('active');
      btn.querySelector('span:last-child').textContent = '收起';
      syncParentFromParts(wrapper);
      updateImportBar();
    } catch (e) {
      toast('分P加载失败：' + (e.message || '未知错误'));
      btn.querySelector('span:last-child').textContent = '分P';
    } finally {
      btn.disabled = false;
    }
  }

  function renderPartItem(container, wrapper, part, checkedByDefault) {
    const div = document.createElement('div');
    div.className = 'part-item';
    const checked = checkedByDefault || selected.has(itemKey(part));
    if (checked) setSelectedItem(part, true);
    div.innerHTML =
      '<input type="checkbox" class="part-check" ' +
      (checked ? 'checked' : '') +
      ' />' +
      '<span class="part-index"></span>' +
      '<div class="part-meta"><div class="part-title"></div><div class="part-sub"></div></div>';
    div.querySelector('.part-index').textContent = 'P' + (part.page || '');
    div.querySelector('.part-title').textContent = part.title || '未命名分P';
    div.querySelector('.part-sub').textContent = fmtDuration(part.duration);

    const cb = div.querySelector('.part-check');
    cb._item = part;
    cb.addEventListener('change', () => {
      setSelectedItem(part, cb.checked);
      syncParentFromParts(wrapper);
      updateImportBar();
    });
    container.appendChild(div);
  }

  function syncParentFromParts(wrapper) {
    const parent = wrapper.querySelector('.parent-check');
    const checks = Array.from(wrapper.querySelectorAll('.part-check'));
    if (!parent || checks.length === 0) return;
    const checkedCount = checks.filter((cb) => cb.checked).length;
    parent.checked = checkedCount === checks.length;
    parent.indeterminate = checkedCount > 0 && checkedCount < checks.length;
  }

  async function doSearch(reset) {
    if (reset) {
      searchPage = 1;
      $('search-results').innerHTML = '';
      selected.clear();
      updateImportBar();
    }
    let r;
    try {
      r = await API.apiPost('/api/search/videos', { keyword: searchKeyword, page: searchPage });
    } catch (e) {
      toast('搜索失败');
      return;
    }
    if (r.error) {
      toast('搜索失败：' + r.error);
      return;
    }
    const results = r.results || [];
    const box = $('search-results');
    results.forEach((v) => renderVideoItem(box, v));
    $('search-more').style.display = results.length >= 20 ? 'block' : 'none';
    if (reset && results.length === 0) toast('无结果');
  }

  function renderExtractResult(resp) {
    const items = resp.items || [];
    const status = $('url-extract-status');
    const box = $('search-results');

    box.innerHTML = '';
    selected.clear();
    $('search-more').style.display = 'none';
    // 提取到合集/收藏夹标题时，默认切到「新建歌单」并预填标题
    if (resp.playlist_title) {
      playlistSelect.value = NEW_PLAYLIST;
      syncPlaylistNameVisibility();
      playlistNameInput.value = resp.playlist_title;
    }

    items.forEach((v) => renderVideoItem(box, v, true));
    updateImportBar();

    status.style.display = 'block';
    status.textContent = items.length
      ? '已提取 ' + items.length + ' 首，已默认全选'
      : '未提取到可导入歌曲';
    if (items.length === 0) toast('未提取到可导入歌曲');
  }

  $('url-extract-btn').addEventListener('click', async () => {
    const url = $('url-input').value.trim();
    const status = $('url-extract-status');
    const btn = $('url-extract-btn');
    if (!url) {
      toast('请输入 URL');
      return;
    }

    btn.disabled = true;
    status.style.display = 'block';
    status.textContent = '提取中…';
    try {
      const r = await API.apiPost('/api/extract', { url });
      if (r.error) throw new Error(r.error);
      renderExtractResult(r);
    } catch (e) {
      status.textContent = '提取失败：' + (e.message || '未知错误');
      toast('提取失败');
    } finally {
      btn.disabled = false;
    }
  });

  $('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('url-extract-btn').click();
  });

  $('search-btn').addEventListener('click', () => {
    const kw = $('search-input').value.trim();
    if (!kw) return;
    searchKeyword = kw;
    doSearch(true);
  });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('search-btn').click();
  });
  $('search-more-btn').addEventListener('click', () => {
    searchPage++;
    doSearch(false);
  });

  // ---- 歌单选择 ----
  const NEW_PLAYLIST = '__new__';
  const playlistSelect = $('import-playlist-select');
  const playlistNameInput = $('import-playlist');

  function syncPlaylistNameVisibility() {
    const isNew = playlistSelect.value === NEW_PLAYLIST;
    playlistNameInput.style.display = isNew ? '' : 'none';
    if (!isNew) playlistNameInput.value = '';
  }

  playlistSelect.addEventListener('change', () => {
    syncPlaylistNameVisibility();
    API.apiPost('/api/import-prefs', { last_playlist: playlistSelect.value }).catch(() => {});
  });

  async function loadPlaylists() {
    let data;
    try {
      data = await API.apiGet('/api/playlists');
    } catch (e) {
      return;
    }
    const keep = playlistSelect.value; // 刷新时尽量保留当前选择
    playlistSelect.innerHTML = '';
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = '不加入歌单';
    playlistSelect.appendChild(optNone);
    (data.playlists || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name + '（' + (p.song_count || 0) + ' 首）';
      playlistSelect.appendChild(opt);
    });
    const optNew = document.createElement('option');
    optNew.value = NEW_PLAYLIST;
    optNew.textContent = '＋ 新建歌单';
    playlistSelect.appendChild(optNew);

    const want = keep || (data.last_playlist != null ? String(data.last_playlist) : '');
    if (want && Array.from(playlistSelect.options).some((o) => o.value === want)) {
      playlistSelect.value = want;
    }
    syncPlaylistNameVisibility();
  }

  // 导入
  async function importSelected(withDownload) {
    const items = Array.from(selected.values());
    if (items.length === 0) return;
    const sel = playlistSelect.value;
    const body = { items };
    if (sel === NEW_PLAYLIST) {
      const name = playlistNameInput.value.trim();
      if (!name) {
        toast('请输入新歌单名');
        return;
      }
      body.playlist_name = name;
    } else if (sel) {
      body.playlist_id = parseInt(sel, 10);
    }
    const artistOverride = $('import-artist').value.trim();
    if (artistOverride) body.artist_override = artistOverride;
    const path = withDownload ? '/api/import-download' : '/api/import';
    let r;
    try {
      r = await API.apiPost(path, body);
    } catch (e) {
      toast('导入失败');
      return;
    }
    if (r.error) {
      toast('导入失败：' + r.error);
      return;
    }
    const total = r.total != null ? r.total : r.count;
    let msg = '已导入 ' + r.count + '/' + total + ' 首';
    if (r.failed) msg += '（' + r.failed + ' 首失败）';
    if (withDownload) msg += '，开始下载';
    toast(msg);
    selected.clear();
    updateImportBar();
    document.querySelectorAll('#search-results input[type=checkbox]').forEach((c) => (c.checked = false));
    // 刚新建的歌单：切到该歌单方便后续追加；同时刷新列表与数量
    if (r.playlist_id) {
      await loadPlaylists();
      if (Array.from(playlistSelect.options).some((o) => o.value === String(r.playlist_id))) {
        playlistSelect.value = String(r.playlist_id);
        syncPlaylistNameVisibility();
      }
    } else {
      loadPlaylists();
    }
    if (withDownload) {
      document.querySelector('.tab-btn[data-tab=download]').click();
      startDownloadPolling();
    }
  }
  $('import-only').addEventListener('click', () => importSelected(false));
  $('import-download').addEventListener('click', () => importSelected(true));

  // ================= 收藏夹 =================
  let currentFolder = null;

  async function loadFolders() {
    $('fav-content-wrap').style.display = 'none';
    const box = $('fav-folders');
    box.style.display = 'block';
    box.innerHTML = '<div class="hint">加载中…</div>';
    let r;
    try {
      r = await API.apiGet('/api/favorites');
    } catch (e) {
      box.innerHTML = '<div class="hint">加载失败</div>';
      return;
    }
    if (r.error) {
      box.innerHTML = '<div class="hint">' + r.error + '</div>';
      return;
    }
    box.innerHTML = '';
    (r.folders || []).forEach((f) => {
      const div = document.createElement('div');
      div.className = 'folder';
      div.innerHTML = '<span class="fname"></span><span class="fcount">' + f.count + ' 首</span>';
      div.querySelector('.fname').textContent = f.title;
      div.addEventListener('click', () => openFolder(f));
      box.appendChild(div);
    });
    if (!r.folders || r.folders.length === 0) box.innerHTML = '<div class="hint">没有收藏夹</div>';
  }

  async function openFolder(folder) {
    currentFolder = folder;
    $('fav-folders').style.display = 'none';
    $('fav-content-wrap').style.display = 'block';
    $('fav-title').textContent = folder.title + '（' + folder.count + '）';
    const box = $('fav-content');
    box.innerHTML = '<div class="hint">加载中…</div>';
    let r;
    try {
      r = await API.apiGet('/api/favorites/' + folder.id);
    } catch (e) {
      box.innerHTML = '<div class="hint">加载失败</div>';
      return;
    }
    box.innerHTML = '';
    (r.results || []).forEach((v) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<img class="cover" src="' +
        proxyImg(v.cover) +
        '" /><div class="meta"><div class="title"></div><div class="sub"></div></div>';
      div.querySelector('.title').textContent = v.title;
      div.querySelector('.sub').textContent = v.author + ' · ' + fmtDuration(v.duration);
      box.appendChild(div);
    });
    if (folder.count > (r.results || []).length) {
      const more = document.createElement('div');
      more.className = 'muted center';
      more.textContent = '仅预览前 ' + (r.results || []).length + ' 首，「整夹导入」将导入全部';
      box.appendChild(more);
    }
  }

  $('fav-back').addEventListener('click', () => {
    $('fav-content-wrap').style.display = 'none';
    $('fav-folders').style.display = 'block';
  });

  $('fav-import').addEventListener('click', async () => {
    if (!currentFolder) return;
    const asPlaylist = $('fav-as-playlist').checked;
    const artistOverride = $('fav-artist').value.trim();
    toast('正在导入整个收藏夹…');
    let r;
    const reqBody = {
      as_playlist: asPlaylist,
      title: currentFolder.title,
    };
    if (artistOverride) reqBody.artist_override = artistOverride;
    try {
      r = await API.apiPost('/api/favorites/' + currentFolder.id + '/import', reqBody);
    } catch (e) {
      toast('导入失败');
      return;
    }
    if (r.error) {
      toast('导入失败：' + r.error);
      return;
    }
    toast('已导入 ' + r.count + ' 首');
  });

  // ================= 下载 =================
  let downloadTimer = 0;
  let lastProgress = null;
  let dlPage = 0;
  const DL_PAGE_SIZE = 30;

  const STATUS_ICON = {
    pending: 'schedule',
    downloading: 'autorenew',
    ok: 'check_circle',
    failed: 'error',
  };

  function startDownloadPolling() {
    stopDownloadPolling();
    $('download-progress').style.display = 'block';
    $('download-empty').style.display = 'none';
    downloadTimer = setInterval(pollDownloadProgress, 2000);
    pollDownloadProgress();
  }

  function stopDownloadPolling() {
    if (downloadTimer) {
      clearInterval(downloadTimer);
      downloadTimer = 0;
    }
  }

  async function pollDownloadProgress() {
    let r;
    try {
      r = await API.apiGet('/api/download-batch/progress');
    } catch (e) {
      return;
    }
    if (!r.active) {
      stopDownloadPolling();
      $('download-progress').style.display = 'none';
      $('download-empty').style.display = 'block';
      lastProgress = null;
      return;
    }
    lastProgress = r;
    renderDownloadProgress(r);
    if (r.done) {
      stopDownloadPolling();
      toast('下载完成：成功 ' + r.success + '，失败 ' + r.failed);
    }
  }

  function renderDownloadProgress(r) {
    $('download-progress').style.display = 'block';
    $('download-empty').style.display = 'none';

    var pct = r.total > 0 ? Math.round((r.current / r.total) * 100) : 0;
    $('dl-bar').style.width = pct + '%';
    $('dl-current').textContent = r.current;
    $('dl-total').textContent = r.total;
    $('dl-success').textContent = r.success || 0;
    $('dl-failed').textContent = r.failed || 0;

    // 状态徽标
    var badge = $('dl-status-badge');
    badge.classList.remove('badge--paused', 'badge--done', 'badge--failed');
    if (r.done) {
      badge.textContent = r.failed > 0 ? '已完成（部分失败）' : '已完成';
      badge.classList.add(r.failed > 0 ? 'badge--failed' : 'badge--done');
    } else if (r.paused) {
      badge.textContent = '已暂停';
      badge.classList.add('badge--paused');
    } else {
      badge.textContent = '进行中';
    }

    // 按钮状态
    if (r.done) {
      $('dl-pause').style.display = 'none';
      $('dl-resume').style.display = 'none';
      $('dl-clear').style.display = '';
      $('dl-retry').style.display = r.failed > 0 ? '' : 'none';
    } else {
      $('dl-clear').style.display = 'none';
      $('dl-retry').style.display = 'none';
      $('dl-pause').style.display = r.paused ? 'none' : '';
      $('dl-resume').style.display = r.paused ? '' : 'none';
    }

    renderDownloadSongList(r.songs || []);
  }

  function renderDownloadSongList(songs) {
    var totalPages = Math.max(1, Math.ceil(songs.length / DL_PAGE_SIZE));
    if (dlPage >= totalPages) dlPage = totalPages - 1;
    if (dlPage < 0) dlPage = 0;

    var start = dlPage * DL_PAGE_SIZE;
    var end = Math.min(start + DL_PAGE_SIZE, songs.length);
    var pageSongs = songs.slice(start, end);

    var list = $('dl-song-list');
    list.innerHTML = '';

    pageSongs.forEach(function (song) {
      var div = document.createElement('div');
      div.className = 'dl-song-item';
      var icon = STATUS_ICON[song.status] || 'schedule';
      var iconEl = document.createElement('span');
      iconEl.className = 'dl-song-icon status-' + song.status;
      iconEl.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';

      var info = document.createElement('div');
      info.className = 'dl-song-info';
      var title = document.createElement('div');
      title.className = 'dl-song-title';
      title.textContent = song.title || '歌曲 #' + song.song_id;
      info.appendChild(title);

      if (song.status === 'failed' && song.error) {
        var err = document.createElement('div');
        err.className = 'dl-song-error';
        err.textContent = song.error;
        info.appendChild(err);
      }

      div.appendChild(iconEl);
      div.appendChild(info);
      list.appendChild(div);
    });

    // 分页
    var pag = $('dl-pagination');
    pag.style.display = songs.length > DL_PAGE_SIZE ? 'flex' : 'none';
    $('dl-page-info').textContent = (dlPage + 1) + ' / ' + totalPages;
    $('dl-prev').disabled = dlPage === 0;
    $('dl-next').disabled = dlPage >= totalPages - 1;
  }

  async function refreshDownload() {
    let r;
    try {
      r = await API.apiGet('/api/download-batch/progress');
    } catch (e) {
      return;
    }
    if (r.active) {
      lastProgress = r;
      renderDownloadProgress(r);
      if (!r.done && !downloadTimer) startDownloadPolling();
    } else {
      $('download-empty').style.display = 'block';
      $('download-progress').style.display = 'none';
    }
  }

  $('dl-pause').addEventListener('click', async () => {
    try {
      await API.apiPost('/api/download-batch/pause', {});
      $('dl-pause').style.display = 'none';
      $('dl-resume').style.display = '';
    } catch (e) {
      toast('暂停失败');
    }
  });

  $('dl-resume').addEventListener('click', async () => {
    try {
      await API.apiPost('/api/download-batch/resume', {});
      $('dl-resume').style.display = 'none';
      $('dl-pause').style.display = '';
    } catch (e) {
      toast('恢复失败');
    }
  });

  $('dl-retry').addEventListener('click', async () => {
    if (!lastProgress || !lastProgress.songs) return;
    var failedSongs = lastProgress.songs.filter(function (s) { return s.status === 'failed'; });
    if (failedSongs.length === 0) { toast('没有失败的歌曲'); return; }
    var songIds = failedSongs.map(function (s) { return s.song_id; });
    var songTitles = {};
    failedSongs.forEach(function (s) { songTitles[s.song_id] = s.title; });
    try {
      await API.apiPost('/api/download-batch', {
        song_ids: songIds,
        playlist_name: lastProgress.playlist_name || undefined,
        song_titles: songTitles,
      });
      dlPage = 0;
      startDownloadPolling();
    } catch (e) {
      toast('重试失败');
    }
  });

  $('dl-clear').addEventListener('click', async () => {
    await API.apiPost('/api/download-batch/clear', {});
    $('download-progress').style.display = 'none';
    $('download-empty').style.display = 'block';
    lastProgress = null;
    dlPage = 0;
    stopDownloadPolling();
  });

  $('dl-prev').addEventListener('click', () => {
    dlPage--;
    if (lastProgress) renderDownloadSongList(lastProgress.songs || []);
  });

  $('dl-next').addEventListener('click', () => {
    dlPage++;
    if (lastProgress) renderDownloadSongList(lastProgress.songs || []);
  });

  // ================= 设置 =================
  async function loadSettings() {
    let s;
    try {
      s = await API.apiGet('/api/settings');
    } catch (e) {
      return;
    }
    $('set-quality').value = s.audio_quality || 'high';
    $('set-dolby').checked = !!s.enable_dolby;
    $('set-hires').checked = !!s.enable_hires;
    $('set-template').value = s.path_template || 'bili/{artist}/{title}';
    $('set-embed').checked = s.embed_metadata !== false;
    $('set-format').value = s.transcode_format || '';
    $('set-bitrate').value = String(s.transcode_bitrate != null ? s.transcode_bitrate : 0);
    $('set-interval').value = s.download_interval != null ? s.download_interval : 2;
    $('set-pause-on-error').checked = s.pause_on_error !== false;
    syncBitrateEnabled();
  }

  // 未选择转码格式时禁用码率下拉
  function syncBitrateEnabled() {
    $('set-bitrate').disabled = !$('set-format').value;
  }

  let saveTimer = 0;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const body = {
        audio_quality: $('set-quality').value,
        enable_dolby: $('set-dolby').checked,
        enable_hires: $('set-hires').checked,
        path_template: $('set-template').value.trim() || 'bili/{artist}/{title}',
        embed_metadata: $('set-embed').checked,
        transcode_format: $('set-format').value,
        transcode_bitrate: parseInt($('set-bitrate').value, 10) || 0,
        download_interval: parseInt($('set-interval').value, 10) || 0,
        pause_on_error: $('set-pause-on-error').checked,
      };
      try {
        await API.apiPost('/api/settings', body);
        toast('设置已保存');
      } catch (e) {
        /* ignore */
      }
    }, 500);
  }
  ['set-quality', 'set-dolby', 'set-hires', 'set-template', 'set-embed', 'set-format', 'set-bitrate', 'set-interval', 'set-pause-on-error'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });
  $('set-format').addEventListener('change', syncBitrateEnabled);

  $('search-test-btn').addEventListener('click', async () => {
    const keyword = $('search-test-input').value.trim();
    const result = $('search-test-result');
    const btn = $('search-test-btn');

    result.style.display = 'block';
    if (!keyword) {
      result.style.color = 'var(--md-error, #b3261e)';
      result.textContent = '请输入搜索关键字';
      return;
    }

    btn.disabled = true;
    result.style.color = 'var(--md-on-surface-variant, #666)';
    result.textContent = '搜索中…';

    try {
      const resp = await API.apiPost('/api/search/topone', { keyword, quality: '320k' });
      if (resp.code === 0 && resp.data) {
        const d = resp.data;
        result.style.color = 'var(--md-primary, #fb7299)';
        result.textContent =
          '搜索成功\n\n' +
          '标题: ' + (d.title || '-') + '\n' +
          '歌手: ' + (d.artist || '-') + '\n' +
          '时长: ' + fmtDuration(d.duration) + '\n' +
          'URL: ' + (d.url || '-');
      } else {
        result.style.color = 'var(--md-error, #b3261e)';
        result.textContent = '未找到结果\n\n' + JSON.stringify(resp, null, 2);
      }
    } catch (e) {
      result.style.color = 'var(--md-error, #b3261e)';
      result.textContent = '请求失败：' + (e.message || '未知错误');
    } finally {
      btn.disabled = false;
    }
  });

  // 初始化
  refreshStatus();
  loadPlaylists();
})();
