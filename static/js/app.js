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
      if (tab === 'settings') loadSettings();
      if (tab === 'account') refreshStatus();
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
  const selected = new Map(); // bvid -> item

  function updateImportBar() {
    $('import-bar').style.display = selected.size > 0 ? 'flex' : 'none';
  }

  function renderVideoItem(container, v) {
    const div = document.createElement('div');
    div.className = 'item';
    const checked = selected.has(v.bvid) ? 'checked' : '';
    div.innerHTML =
      '<input type="checkbox" ' +
      checked +
      ' />' +
      '<img class="cover" src="' +
      proxyImg(v.cover) +
      '" />' +
      '<div class="meta"><div class="title"></div><div class="sub"></div></div>';
    div.querySelector('.title').textContent = v.title;
    div.querySelector('.sub').textContent = v.author + ' · ' + fmtDuration(v.duration);
    const cb = div.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) selected.set(v.bvid, v);
      else selected.delete(v.bvid);
      updateImportBar();
    });
    container.appendChild(div);
  }

  async function doSearch(reset) {
    if (reset) {
      searchPage = 1;
      $('search-results').innerHTML = '';
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

  // 初始化
  refreshStatus();
})();
