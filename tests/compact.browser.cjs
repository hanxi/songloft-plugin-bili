// Docker Chromium, isolated backend, real pointer/keyboard input.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30604'
;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage(),
      errors = [],
      partCalls = {}
    let releaseAccount,
      settingsReads = 0,
      cookieCalls = 0,
      signedIn = false
    const accountGate = new Promise((resolve) => {
      releaseAccount = resolve
    })
    const video = (title, part_count) => ({
      bvid: title,
      aid: 1,
      title,
      author: '演奏者',
      duration: 180,
      cover: '',
      ...(part_count === undefined ? {} : { part_count }),
    })
    const face = 'https://i0.hdslb.com/bfs/face/compact-test.png'
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setViewport({ width: 320, height: 700 })
    await page.setRequestInterception(true)
    page.on('request', async (r) => {
      const path = new URL(r.url()).pathname
      const reply = (body, status = 200) =>
        r.respond({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      if (process.env.BILI_TEST_OLD_BUNDLE && path.endsWith('main.web.bundle'))
        return r.respond({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
        })
      if (r.url() === face)
        return r.respond({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yWb8AAAAASUVORK5CYII=',
            'base64',
          ),
        })
      if (path.endsWith('/api/login/status')) {
        await accountGate
        return reply(
          signedIn
            ? { logged_in: true, uname: '测试账号', face }
            : { logged_in: false },
        )
      }
      if (path.endsWith('/api/login/cookie')) {
        if (++cookieCalls === 1) return reply({ error: 'Cookie 测试失败' }, 500)
        signedIn = true
        return reply({ logged_in: true, uname: '测试账号', face })
      }
      if (path.endsWith('/api/logout')) {
        signedIn = false
        return reply({ ok: true })
      }
      if (
        path.endsWith('/api/settings') &&
        r.method() === 'GET' &&
        ++settingsReads === 1
      )
        return reply({ error: 'settings unavailable' }, 500)
      if (path.endsWith('/api/favorite-watch/status'))
        return reply({ enabled: false, running: false })
      if (path.endsWith('/api/search/videos'))
        return reply({
          results: [
            video('single-known', 1),
            video('multi-known', 2),
            video('single-unknown'),
            video('multi-unknown'),
          ],
        })
      if (path.endsWith('/parts')) {
        const id = path.split('/').at(-2)
        partCalls[id] = (partCalls[id] || 0) + 1
        const count = id === 'single-unknown' ? 1 : 2
        return reply({
          items: Array.from({ length: count }, (_, i) => ({
            ...video(id + ' part ' + (i + 1)),
            bvid: id,
            cid: i + 1,
            page: i + 1,
          })),
        })
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
    await page.waitForSelector('pierce/.tabs')
    const geometry = () =>
      page.evaluate(() => {
        const root = document.getElementById('plugin-view').shadowRoot
        const nav = root.querySelector('.tabs').getBoundingClientRect(),
          body = root.querySelector('.body.active').getBoundingClientRect()
        return {
          navHeight: nav.height,
          gap: body.top - nav.bottom,
          bodyTop: body.top,
          slot: !!root.querySelector('.status-slot'),
        }
      })
    const before = await geometry()
    assert.equal(before.slot, false, 'remove the reserved global status row')
    assert.equal(before.gap, 0, 'content must follow navigation directly')
    releaseAccount()
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('[data-tab="账号"]').textContent ===
        '未登录',
    )
    assert.deepEqual(
      await geometry(),
      before,
      'login read must not move content',
    )
    const click = async (selector, title) => {
      const rect = await page.evaluate(
        ({ selector, title }) => {
          const root = document.getElementById('plugin-view').shadowRoot
          const el = [...root.querySelectorAll(selector)].find(
            (e) => title === undefined || e.textContent.trim() === title,
          )
          if (!el) throw Error('Missing ' + selector + ' ' + title)
          el.scrollIntoView({ block: 'nearest' })
          const r = el.getBoundingClientRect()
          return {
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            width: r.width,
            height: r.height,
          }
        },
        { selector, title },
      )
      assert(rect.width > 0 && rect.height > 0)
      await page.mouse.click(rect.x, rect.y)
      await new Promise((r) => setTimeout(r, 150))
    }
    const tab = (name) => click('.button-tab[data-tab="' + name + '"]')
    const input = async (label, value) => {
      const h = await page.evaluateHandle((label) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const field = [...root.querySelectorAll('.body.active .field')].find(
          (e) => e.querySelector('.field-label')?.textContent === label,
        )
        return field.querySelector('x-input').shadowRoot.querySelector('input')
      }, label)
      await h.asElement().click()
      await page.keyboard.type(value, { delay: 40 })
      await h.dispose()
    }
    await tab('设置')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.body.active [data-resource="设置"]')
          .textContent === '点击重试',
    )
    assert.equal(
      await page.evaluate(
        () =>
          !!document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.action-toast'),
      ),
      false,
      'read errors stay local, without repeated toasts',
    )
    await click('.body.active [data-resource="设置"]')
    await page.waitForSelector('pierce/.body.active .toggle-row')
    assert.equal(settingsReads, 2, 'local retry must recover the settings read')
    await tab('账号')
    await input('粘贴 Cookie', 'test-cookie')
    const accountGeometry = await geometry()
    await click('.body.active .button', 'Cookie 登录')
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.action-toast')
        ?.textContent.includes('Cookie 测试失败'),
    )
    assert.deepEqual(
      await geometry(),
      accountGeometry,
      'action errors must not shift the form',
    )
    await click('.action-toast-close')
    assert.equal(
      await page.evaluate(
        () =>
          !!document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.action-toast'),
      ),
      false,
    )
    await click('.body.active .button', 'Cookie 登录')
    await page.waitForSelector('pierce/.cover-avatar .cover-image')
    await page.waitForFunction(
      () =>
        !document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.action-toast'),
      { timeout: 5000 },
    )
    for (const width of [320, 390, 1100]) {
      await page.setViewport({ width, height: 700 })
      assert.equal((await geometry()).navHeight, before.navHeight)
      assert.equal((await geometry()).gap, 0)
      const avatar = await page.evaluate(() => {
        const root = document.getElementById('plugin-view').shadowRoot
        const el = root.querySelector('.cover-avatar'),
          r = el.getBoundingClientRect()
        const image = el
          .querySelector('x-image')
          .shadowRoot.querySelector('img')
        return {
          width: r.width,
          height: r.height,
          loaded: image.naturalWidth > 0,
        }
      })
      assert.deepEqual(avatar, { width: 16, height: 16, loaded: true })
    }
    await page.setViewport({ width: 320, height: 700 })
    await tab('搜索')
    await page.screenshot({ path: '/tmp/bili-compact-initial.png' })
    await tab('账号')
    await page.screenshot({ path: '/tmp/bili-compact-account.png' })
    await click('.body.active .button', '退出登录')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('[data-tab="账号"]').textContent ===
        '未登录',
    )
    await tab('搜索')
    await input('搜索关键词', 'piano')
    await click('.body.active .search-fields .button-primary')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.body.active .results .video-item')
          .length === 4,
    )
    assert.deepEqual(
      partCalls,
      {},
      'search must not request per-video details eagerly',
    )
    const itemState = (title) =>
      page.evaluate((title) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const item = [
          ...root.querySelectorAll('.body.active .video-item'),
        ].find((e) => e.querySelector('.video-title')?.textContent === title)
        return {
          button: item.querySelector('.video-row .button')?.textContent || '',
          children: item.querySelectorAll('.parts .video-item').length,
          meta: item.querySelector('.video-meta').textContent,
          selected: !!item.querySelector('.selection.is-selected'),
        }
      }, title)
    const itemClick = async (title, selector) => {
      if (
        await page.evaluate(
          () =>
            !!document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.action-toast'),
        )
      ) {
        await click('.action-toast-close')
      }
      const r = await page.evaluate(
        ({ title, selector }) => {
          const root = document.getElementById('plugin-view').shadowRoot
          const item = [
            ...root.querySelectorAll('.body.active .video-item'),
          ].find((e) => e.querySelector('.video-title')?.textContent === title)
          const el = item.querySelector(selector)
          el.scrollIntoView({ block: 'nearest' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        },
        { title, selector },
      )
      await page.mouse.click(r.x, r.y)
      await new Promise((r) => setTimeout(r, 250))
    }
    assert.equal((await itemState('single-known')).button, '')
    assert.equal((await itemState('multi-known')).button, '分 P')
    assert.equal((await itemState('single-unknown')).button, '详情')
    await itemClick('single-unknown', '.video-main')
    await itemClick('single-unknown', '.video-row .button')
    const single = await itemState('single-unknown')
    assert.equal(single.button, '')
    assert.equal(single.children, 0)
    assert(!single.meta.includes('P1'))
    assert(single.selected)
    await itemClick('single-unknown', '.video-main')
    assert.equal((await itemState('single-unknown')).selected, false)
    await itemClick('multi-known', '.video-row .button')
    await itemClick('multi-known part 1', '.video-main')
    assert((await itemState('multi-known part 1')).selected)
    assert.equal(
      (await itemState('multi-known part 2')).selected,
      false,
      'selecting one part must not select all parts',
    )
    await itemClick('multi-unknown', '.video-row .button')
    assert.equal((await itemState('multi-unknown')).children, 2)
    await itemClick('multi-unknown', '.video-row .button')
    assert.equal((await itemState('multi-unknown')).children, 0)
    await itemClick('multi-unknown', '.video-row .button')
    assert.equal((await itemState('multi-unknown')).children, 2)
    assert.deepEqual(partCalls, {
      'single-unknown': 1,
      'multi-known': 1,
      'multi-unknown': 1,
    })
    await page.evaluate(() => {
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.body.active').scrollTop = 0
    })
    await page.screenshot({ path: '/tmp/bili-compact-search.png' })
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        passed: true,
        gap: before.gap,
        navHeight: before.navHeight,
        settingsReads,
        cookieCalls,
        partCalls,
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
