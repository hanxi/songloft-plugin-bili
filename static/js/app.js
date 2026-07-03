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

  function proxyImg(url) {
    if (!url) return '';
    const token = API.getAuthToken ? API.getAuthToken() : '';
    return token
      ? '/api/v1/proxy?url=' + encodeURIComponent(url) + '&access_token=' + encodeURIComponent(token)
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
      $('import-playlist').value = '';
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
    $('import-playlist').value = resp.playlist_title || '';

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

  // 导入
  async function importSelected(withDownload) {
    const items = Array.from(selected.values());
    if (items.length === 0) return;
    const playlistName = $('import-playlist').value.trim() || undefined;
    const path = withDownload ? '/api/import-download' : '/api/import';
    let r;
    try {
      r = await API.apiPost(path, { items, playlist_name: playlistName });
    } catch (e) {
      toast('导入失败');
      return;
    }
    if (r.error) {
      toast('导入失败：' + r.error);
      return;
    }
    toast('已导入 ' + r.count + ' 首' + (withDownload ? '，开始下载' : ''));
    selected.clear();
    updateImportBar();
    document.querySelectorAll('#search-results input[type=checkbox]').forEach((c) => (c.checked = false));
    if (withDownload) {
      document.querySelector('.tab-btn[data-tab=download]').click();
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
    toast('正在导入整个收藏夹…');
    let r;
    try {
      r = await API.apiPost('/api/favorites/' + currentFolder.id + '/import', {
        as_playlist: asPlaylist,
        title: currentFolder.title,
      });
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

  async function refreshDownload() {
    let r;
    try {
      r = await API.apiGet('/api/download-batch/progress');
    } catch (e) {
      return;
    }
    if (!r.active) {
      $('download-empty').style.display = 'block';
      $('download-progress').style.display = 'none';
      clearInterval(downloadTimer);
      return;
    }
    $('download-empty').style.display = 'none';
    $('download-progress').style.display = 'block';
    $('dl-current').textContent = r.current;
    $('dl-total').textContent = r.total;
    $('dl-success').textContent = r.success;
    $('dl-failed').textContent = r.failed;
    $('dl-bar').style.width = r.total ? Math.round((r.current / r.total) * 100) + '%' : '0%';

    if (r.done) {
      clearInterval(downloadTimer);
      toast('下载完成');
    } else if (!downloadTimer) {
      downloadTimer = setInterval(refreshDownload, 1500);
    }
  }

  $('dl-clear').addEventListener('click', async () => {
    await API.apiPost('/api/download-batch/clear', {});
    refreshDownload();
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
    $('set-interval').value = s.download_interval != null ? s.download_interval : 2;
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
        download_interval: parseInt($('set-interval').value, 10) || 0,
      };
      try {
        await API.apiPost('/api/settings', body);
        toast('设置已保存');
      } catch (e) {
        /* ignore */
      }
    }, 500);
  }
  ['set-quality', 'set-dolby', 'set-hires', 'set-template', 'set-embed', 'set-interval'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });

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
})();
