// Real plugin HTML fallback in Docker Chromium; business data is controlled.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30606'
// Isolate viewport/theme cases instead of accumulating all renderer state in
// one long-lived worker. Run this entry point directly for the whole matrix.
if (!process.env.BILI_TEST_WIDTH && !process.env.BILI_TEST_THEME) {
  const { spawnSync } = require('node:child_process')
  const matrix = []
  for (const width of [320, 390, 1100])
    for (const theme of ['light', 'dark']) {
      const child = spawnSync(process.execPath, [__filename], {
        env: {
          ...process.env,
          BILI_TEST_WIDTH: String(width),
          BILI_TEST_THEME: theme,
          BILI_TEST_AUX: width === 320 && theme === 'light' ? '1' : '0',
        },
        encoding: 'utf8',
      })
      if (child.status !== 0) {
        process.stdout.write(child.stdout || '')
        process.stderr.write(
          child.stderr || String(child.error || 'worker failed'),
        )
        process.exit(child.status || 1)
      }
      const result = JSON.parse(
        child.stdout
          .trim()
          .split('\n')
          .findLast((line) => line.startsWith('{')),
      )
      matrix.push({ width, theme, ...result })
    }
  const cases = matrix.reduce((count, result) => count + result.cases, 0)
  assert.equal(cases, 65)
  console.log(JSON.stringify({ passed: true, cases, matrix }))
  process.exit(0)
}
;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage(),
      errors = [],
      reports = [],
      calls = []
    let signedIn = true,
      downloadState = 'running'
    const video = (i) => ({
      bvid: 'BVspacing' + i,
      aid: i + 1,
      title: '歌曲 ' + i + ' 长标题'.repeat(4),
      author: '演奏者',
      cover: '',
      duration: 180,
      part_count: i === 0 ? 2 : 1,
    })
    const progress = () => ({
      active: downloadState !== 'empty',
      done: downloadState === 'done',
      paused: downloadState === 'paused',
      current: 2,
      total: 31,
      success: 1,
      skipped: 0,
      failed: 1,
      songs: Array.from({ length: 31 }, (_, i) => ({
        song_id: i + 1,
        title: '下载歌曲 ' + i + ' 很长的名称'.repeat(4),
        status: i === 0 ? 'failed' : 'pending',
      })),
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setViewport({ width: 320, height: 700 })
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      const reply = (data) =>
        r.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      if (process.env.BILI_TEST_OLD_BUNDLE && path.endsWith('main.web.bundle'))
        return r.respond({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
        })
      if (path.endsWith('/api/login/status'))
        return reply({ logged_in: signedIn, uname: '测试账号' })
      if (path.endsWith('/api/logout')) {
        signedIn = false
        return reply({ ok: true })
      }
      if (path.endsWith('/api/login/cookie')) {
        signedIn = true
        return reply({ logged_in: true, uname: '测试账号' })
      }
      if (path.endsWith('/api/login/qrcode'))
        return reply({
          url: 'https://example.com/spacing-login',
          qrcode_key: 'test',
        })
      if (path.endsWith('/api/login/poll')) return reply({ status: 86101 })
      if (path.endsWith('/api/playlists'))
        return reply({
          playlists: Array.from({ length: 80 }, (_, i) => ({
            id: i + 1,
            name: '歌单 ' + i + ' 长名称'.repeat(5),
          })),
        })
      if (path.endsWith('/api/search/videos'))
        return reply({
          results: Array.from({ length: 20 }, (_, i) => video(i)),
        })
      if (path.endsWith('/parts'))
        return reply({
          items: [
            { ...video(0), cid: 1, page: 1, title: '分 P 一' },
            { ...video(0), cid: 2, page: 2, title: '分 P 二' },
          ],
        })
      if (path.endsWith('/api/favorites'))
        return reply({
          folders: [
            { id: 1, title: '收藏夹一', count: 1 },
            { id: 2, title: '长收藏夹名称'.repeat(8), count: 2 },
          ],
        })
      if (path.endsWith('/api/favorites/1'))
        return reply({ results: [video(1)] })
      if (path.endsWith('/api/favorite-watch/status'))
        return reply({ enabled: false, running: false })
      if (path.endsWith('/api/download-batch/progress'))
        return reply(progress())
      if (path.endsWith('/api/download-batch/pause')) {
        calls.push('pause')
        downloadState = 'paused'
        return reply({ ok: true })
      }
      if (path.endsWith('/api/download-batch/resume')) {
        calls.push('resume')
        downloadState = 'running'
        return reply({ ok: true })
      }
      if (path.endsWith('/api/download-batch/clear')) {
        calls.push('clear')
        downloadState = 'empty'
        return reply({ ok: true })
      }
      return r.continue()
    })
    const auth = await (
      await fetch(base + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      })
    ).json()
    await page.goto(
      base +
        '/api/v1/jsplugin/bili/static/index.html?access_token=' +
        auth.access_token,
    )
    const wait = (selector) =>
      page.waitForFunction(
        (selector) =>
          !!document
            .getElementById('plugin-view')
            ?.shadowRoot?.querySelector(selector),
        {},
        selector,
      )
    await wait('.search-fields')
    const click = async (selector, label) => {
      // A transient operation toast is explicitly dismissed before further taps.
      if (
        selector !== '.action-toast-close' &&
        (await page.evaluate(
          () =>
            !!document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.action-toast'),
        ))
      )
        await click('.action-toast-close')
      const handle = await page.evaluateHandle(
        ({ selector, label }) => {
          const root = document.getElementById('plugin-view').shadowRoot
          const el = [...root.querySelectorAll(selector)].find(
            (e) => label === undefined || e.textContent.trim() === label,
          )
          if (!el) throw Error('Missing ' + selector + ' ' + label)
          el.scrollIntoView({ block: 'center' })
          return el
        },
        { selector, label },
      )
      await handle.asElement().click({ delay: 50 })
      await handle.dispose()
      await new Promise((r) => setTimeout(r, 160))
    }
    const tab = async (name) => {
      await click('.button-tab[data-tab="' + name + '"]')
      await page
        .waitForFunction(
          (name) =>
            document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.button-tab.selected')
              ?.getAttribute('data-tab') === name,
          { timeout: 3000 },
          name,
        )
        .catch(async (e) => {
          console.log(
            'TAB FAILURE',
            name,
            await page.evaluate(() => ({
              y: scrollY,
              selected: document
                .getElementById('plugin-view')
                .shadowRoot.querySelector('.button-tab.selected')?.textContent,
            })),
          )
          await page.screenshot({ path: '/tmp/bili-spacing-failed.png' })
          throw e
        })
    }
    const waitButton = (label) =>
      page.waitForFunction(
        (label) =>
          [
            ...document
              .getElementById('plugin-view')
              .shadowRoot.querySelectorAll('.body.active .button'),
          ].some((e) => e.textContent.trim() === label),
        { timeout: 10000 },
        label,
      )
    const tap = async (label) => {
      await waitButton(label)
      await click('.body.active .button', label)
    }
    const input = async (label, value) => {
      const h = await page.evaluateHandle((label) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const field = [...root.querySelectorAll('.body.active .field')].find(
          (e) => e.querySelector('.field-label')?.textContent === label,
        )
        return field.querySelector('x-input').shadowRoot.querySelector('input')
      }, label)
      await h.asElement().click()
      await page.keyboard.type(value, { delay: 20 })
      await h.dispose()
    }
    const audit = async (name) => {
      const result = await page.evaluate(() => {
        const root = document.getElementById('plugin-view').shadowRoot
        const visible = (el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        const brect = (el) => {
          const r = el.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          }
        }
        const buttons = [
          ...root.querySelectorAll(
            '.tabs .button,.body.active .button,.picker-dialog .button',
          ),
        ].filter(visible)
        const unowned = buttons
          .filter(
            (b) =>
              !b.closest(
                '.tabs,.actions,.search-fields,.choices,.choice-current,.video-row,.picker-header,.picker-footer',
              ),
          )
          .map((b) => b.textContent)
        const overflow = buttons
          .filter((b) => {
            const r = brect(b)
            return r.x < 15.5 || r.right > innerWidth - 15.5
          })
          .map((b) => ({ text: b.textContent, ...brect(b) }))
        const groups = [
          ...root.querySelectorAll(
            '.body.active .actions,.body.active .choices',
          ),
        ].filter(visible)
        const gaps = []
        for (const group of groups) {
          const bs = [...group.querySelectorAll('.button')]
            .filter(visible)
            .map(brect)
          for (let i = 0; i < bs.length; i++)
            for (let j = i + 1; j < bs.length; j++) {
              const a = bs[i],
                b = bs[j]
              if (Math.abs(a.y - b.y) < 1) gaps.push(b.x - a.right)
              else if (b.y >= a.bottom) gaps.push(b.y - a.bottom)
            }
        }
        const parentInsets = buttons
          .filter((b) => b.closest('.actions'))
          .map((b) => {
            const parent = b.closest('.confirmation,.card,.section')
            if (!parent) return null
            const p = brect(parent),
              r = brect(b),
              min = parent.classList.contains('section-search')
                ? 0
                : parent.classList.contains('confirmation')
                  ? 12
                  : 16
            return {
              text: b.textContent,
              left: r.x - p.x,
              right: p.right - r.right,
              bottom: p.bottom - r.bottom,
              min,
            }
          })
          .filter(Boolean)
        return {
          buttons: buttons.length,
          groups: groups.length,
          unowned,
          overflow,
          gaps,
          parentInsets,
        }
      })
      assert.deepEqual(result.unowned, [], name + ' ungrouped buttons')
      assert.deepEqual(result.overflow, [], name + ' horizontal overflow')
      assert(
        result.gaps.every((g) => g >= 7.5),
        name + ' button/wrapped-row gaps ' + JSON.stringify(result.gaps),
      )
      assert(
        result.parentInsets.every(
          (p) =>
            p.left >= p.min - 0.5 &&
            p.right >= p.min - 0.5 &&
            p.bottom >= p.min - 0.5,
        ),
        name + ' container insets ' + JSON.stringify(result.parentInsets),
      )
      reports.push({
        name,
        buttons: result.buttons,
        groups: result.groups,
        minGap: result.gaps.length ? Math.min(...result.gaps) : null,
      })
      fs.writeFileSync(
        '/tmp/bili-spacing-progress.json',
        JSON.stringify({ case: name, completed: reports.length }),
      )
    }
    const boundary = async (kind) =>
      page.evaluate((kind) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const button = (label) =>
          [...root.querySelectorAll('.body.active .button')].find(
            (e) => e.textContent.trim() === label,
          )
        if (kind === 'more') {
          const next = [...root.querySelectorAll('.body.active .section')].find(
            (e) =>
              e.querySelector('.section-title')?.textContent.startsWith('已选'),
          )
          return (
            next.getBoundingClientRect().top -
            button('加载更多').getBoundingClientRect().bottom
          )
        }
        if (kind === 'save') {
          const next = [...root.querySelectorAll('.body.active .section')].find(
            (e) =>
              e.querySelector('.section-title')?.textContent === '音源测试',
          )
          return (
            next.getBoundingClientRect().top -
            button('保存设置').getBoundingClientRect().bottom
          )
        }
        const first = root.querySelector('.body.active .card'),
          group = root.querySelector('.body.active .actions')
        return (
          first.getBoundingClientRect().top -
          group.getBoundingClientRect().bottom
        )
      }, kind)
    await input('搜索关键词', 'piano')
    await click('.body.active .search-fields .button-primary')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.body.active .video-item').length ===
        20,
    )
    await click('.body.active .video-main')
    const moreGap = await boundary('more')
    assert(
      moreGap >= 15.5,
      'load-more must leave 16px below it; actual ' + moreGap,
    )
    await page.evaluate(() =>
      [
        ...document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.body.active .button'),
      ]
        .find((e) => e.textContent === '加载更多')
        .scrollIntoView({ block: 'center' }),
    )
    await page.screenshot({ path: '/tmp/bili-spacing-more.png' })
    await tap('更多导入选项')
    await tap('分 P')
    await wait('.parts')
    const widths = process.env.BILI_TEST_WIDTH
      ? [Number(process.env.BILI_TEST_WIDTH)]
      : [320, 390, 1100]
    const themes = process.env.BILI_TEST_THEME
      ? [process.env.BILI_TEST_THEME]
      : ['light', 'dark']
    for (const width of widths)
      for (const theme of themes) {
        await page.setViewport({ width, height: width === 320 ? 480 : 700 })
        await page.evaluate(
          (theme) => window.postMessage({ type: 'songloft-theme', theme }, '*'),
          theme,
        )
        await page.waitForFunction(
          (theme) =>
            document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.app.' + theme),
          {},
          theme,
        )
        await page.waitForFunction(
          () =>
            Math.abs(
              document
                .getElementById('plugin-view')
                .shadowRoot.querySelector('.tabs')
                .getBoundingClientRect().width - innerWidth,
            ) < 1,
        )
        await new Promise((r) => setTimeout(r, 300))
        await tab('搜索')
        await audit(width + ' ' + theme + ' search/import/parts')
        assert((await boundary('more')) >= 15.5)
        await tab('收藏夹')
        await audit(width + ' ' + theme + ' favorites')
        await tap('收藏夹一（1 首）')
        await waitButton('返回收藏夹')
        await audit(width + ' ' + theme + ' favorite preview/import')
        await tap('返回收藏夹')
        await waitButton('收藏夹一（1 首）')
        for (const state of ['running', 'paused', 'done']) {
          downloadState = state
          await tab('搜索')
          await tab('下载')
          await waitButton(
            state === 'running'
              ? '暂停'
              : state === 'paused'
                ? '恢复'
                : '重试失败',
          )
          await wait('.body.active .card')
          await audit(width + ' ' + theme + ' download ' + state)
          assert(
            (await boundary('download')) >= 11.5,
            'download controls need 12px before task cards',
          )
          if (width === 320 && theme === 'light' && state === 'running') {
            await page.evaluate(() => {
              document
                .getElementById('plugin-view')
                .shadowRoot.querySelector('.body.active').scrollTop = 0
            })
            await page.screenshot({ path: '/tmp/bili-spacing-downloads.png' })
          }
        }
        await tab('设置')
        await wait('.body.active .toggle-row').catch(async (e) => {
          console.log(
            'SETTINGS FAILURE',
            await page.evaluate(
              () =>
                document
                  .getElementById('plugin-view')
                  .shadowRoot.querySelector('.body.active')?.textContent,
            ),
          )
          await page.screenshot({ path: '/tmp/bili-spacing-failed.png' })
          throw e
        })
        await audit(width + ' ' + theme + ' settings')
        assert(
          (await boundary('save')) >= 15.5,
          'save needs 16px before next section',
        )
        await tap('重建基线')
        await audit(width + ' ' + theme + ' baseline confirmation')
        await tap('重建基线')
        await click('.body.active .field .button', '不加入歌单 ▾')
        await wait('.picker-dialog')
        await audit(width + ' ' + theme + ' picker')
        const insets = await page.evaluate(() => {
          const root = document.getElementById('plugin-view').shadowRoot,
            dialog = root
              .querySelector('.picker-dialog')
              .getBoundingClientRect()
          return [
            ...root.querySelectorAll(
              '.picker-header .button,.picker-footer .button',
            ),
          ].map((b) => {
            const r = b.getBoundingClientRect()
            return {
              left: r.x - dialog.x,
              right: dialog.right - r.right,
              bottom: dialog.bottom - r.bottom,
            }
          })
        })
        assert(
          insets.every(
            (r) => r.left >= 15.5 && r.right >= 15.5 && r.bottom >= 15.5,
          ),
          'picker button padding',
        )
        await click('.picker-header .button')
        await page.waitForFunction(
          () =>
            !document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.picker-dialog'),
        )
        await new Promise((r) => setTimeout(r, 200))
        if (width === 320 && theme === 'light') {
          await tap('保存设置')
          await page.waitForFunction(() =>
            document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.action-toast')
              ?.textContent.includes('操作完成'),
          )
          await click('.action-toast-close')
          await page.screenshot({ path: '/tmp/bili-spacing-settings.png' })
        }
        await tab('账号')
        await audit(width + ' ' + theme + ' signed in')
      }
    if (process.env.BILI_TEST_AUX !== '0') {
      await page.setViewport({ width: 320, height: 480 })
      await page.waitForFunction(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.tabs')
            .getBoundingClientRect().width === 320,
      )
      await new Promise((r) => setTimeout(r, 300))
      downloadState = 'running'
      await tab('下载')
      await tap('暂停')
      await page.waitForFunction(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .button'),
        ].some((b) => b.textContent === '恢复'),
      )
      await tap('恢复')
      await page.waitForFunction(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .button'),
        ].some((b) => b.textContent === '暂停'),
      )
      await tap('暂停')
      await page.waitForFunction(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .button'),
        ].some((b) => b.textContent === '清除任务 / 记录'),
      )
      await tap('清除任务 / 记录')
      await audit('empty downloads')
      await tab('账号')
      await tap('退出登录')
      await audit('anonymous account')
      await tab('收藏夹')
      await audit('anonymous favorites')
      await tap('前往登录')
      await page.waitForFunction(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.button-tab.selected')
            .getAttribute('data-tab') === '账号',
      )
      await tab('设置')
      await audit('anonymous monitor login guide')
      await tab('账号')
      // QR rendering is checked independently of subsequent navigation pressure.
      await tap('生成登录二维码')
      await wait('.qr')
      await audit('QR login')
      assert.deepEqual(calls, ['pause', 'resume', 'pause', 'clear'])
    }
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        passed: true,
        moreGap,
        cases: reports.length,
        calls,
        reports,
        errors,
      }),
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
