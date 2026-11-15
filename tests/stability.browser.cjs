// Docker Chrome; real plugin bundle + isolated host, with delayed read fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30602'
;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    let favorites = 0,
      polls = 0
    await page.setViewport({ width: 390, height: 700 })
    await page.setRequestInterception(true)
    page.on('request', async (request) => {
      const path = new URL(request.url()).pathname
      if (process.env.BILI_TEST_OLD_BUNDLE && path.endsWith('main.web.bundle'))
        return request.respond({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
        })
      const respond = (body, status = 200) =>
        request.respond({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      if (path.endsWith('/api/login/status'))
        return respond({ logged_in: process.env.BILI_TEST_EXPIRED === '1' })
      if (path.endsWith('/api/favorites')) {
        favorites++
        return respond({ error: '未登录' }, 401)
      }
      if (path.endsWith('/api/favorite-watch/status')) {
        const count = ++polls
        await new Promise((r) => setTimeout(r, 500))
        if (count % 3 === 0)
          return respond({ error: 'simulated network failure' }, 500)
        return respond({ enabled: false, running: false })
      }
      return request.continue()
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
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          ?.shadowRoot?.querySelectorAll('.button-tab').length === 5,
    )
    const click = async (label) => {
      await page.evaluate((label) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const el = [...root.querySelectorAll('.button-tab')].find(
          (e) => (e.getAttribute('data-tab') || e.textContent) === label,
        )
        el.click()
      }, label)
      await page.waitForFunction(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.body.active')
            ?.getBoundingClientRect().height > 100,
      )
      await new Promise((r) => setTimeout(r, 100))
    }
    await click('设置')
    await page.waitForFunction(() =>
      [
        ...document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.body.active .section-title'),
      ].some((e) => e.textContent === '音质与下载'),
    )
    const positions = await page.evaluate(async () => {
      const samples = []
      for (let i = 0; i < 180; i++) {
        const root = document.getElementById('plugin-view').shadowRoot
        samples.push({
          title: root
            .querySelector('.body.active .section-title')
            .getBoundingClientRect().top,
          body: root.querySelector('.body.active').getBoundingClientRect().top,
          tab: root.querySelector('.tabs').getBoundingClientRect().height,
        })
        await new Promise((r) => setTimeout(r, 50))
      }
      return samples
    })
    const pageHandle = await page.evaluateHandle(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.body.active'),
    )
    await page.evaluate((el) => {
      el.scrollTop = 240
    }, pageHandle)
    await new Promise((r) => setTimeout(r, 100))
    const previousScroll = await page.evaluate((el) => el.scrollTop, pageHandle)
    await click('搜索')
    await click('收藏夹')
    await click('设置')
    assert.equal(
      await page.evaluate(
        (el) =>
          el ===
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.body.active'),
        pageHandle,
      ),
      true,
      'tab page must retain its DOM node',
    )
    assert.ok(previousScroll > 100, 'settings should actually scroll')
    assert.ok(
      Math.abs(
        (await page.evaluate((el) => el.scrollTop, pageHandle)) -
          previousScroll,
      ) <= 1,
      'tab page must retain its scroll offset',
    )
    assert.equal(
      await page.evaluate(
        () =>
          [
            ...document
              .getElementById('plugin-view')
              .shadowRoot.querySelectorAll('.body'),
          ].filter((el) => el.getBoundingClientRect().height > 0).length,
      ),
      1,
      'only the active scroll page may occupy space',
    )
    const visible = await page.evaluate(() => {
      const root = document.getElementById('plugin-view').shadowRoot
      return [
        ...root.querySelectorAll('.action-toast x-text, .body.active x-text'),
      ]
        .map((e) => e.textContent)
        .join('\n')
    })
    const variation = Object.fromEntries(
      ['title', 'body', 'tab'].map((key) => [
        key,
        Math.max(...positions.map((p) => p[key])) -
          Math.min(...positions.map((p) => p[key])),
      ]),
    )
    const report = {
      retainedPage: true,
      retainedScroll: previousScroll,
      favorites,
      polls,
      variation,
      errors,
      unexpectedAuthError: /未登录|Error:|error|err\b|401/i.test(visible),
    }
    console.log(JSON.stringify(report))
    await page.evaluate((el) => {
      el.scrollTop = 0
    }, pageHandle)
    await page.screenshot({ path: '/tmp/bili-stability-settings.png' })
    assert.equal(
      favorites,
      process.env.BILI_TEST_EXPIRED === '1' ? 1 : 0,
      'anonymous settings/favorites must not fetch protected folders repeatedly',
    )
    assert.ok(
      polls >= 3,
      'sample at least three polling responses including a failure',
    )
    assert.ok(
      Object.values(variation).every((n) => n <= 1),
      'background reads must not shift settings or tab geometry',
    )
    assert.equal(
      report.unexpectedAuthError,
      false,
      'normal logged-out state must not render raw errors',
    )
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
