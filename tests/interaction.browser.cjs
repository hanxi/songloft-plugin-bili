// Run in Docker Chrome with BILI_TEST_BASE_URL pointing to an isolated backend.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30602'
;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  const errors = []
  try {
    const auth = await (
      await fetch(base + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      })
    ).json()
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('requestfailed', (r) =>
      console.log('REQUEST FAILED', r.url(), r.failure()),
    )
    let settingsFinished = false
    let favoritesCalls = 0
    await page.setRequestInterception(true)
    page.on('request', async (request) => {
      const path = new URL(request.url()).pathname
      if (process.env.BILI_TEST_OLD_BUNDLE && path.endsWith('main.web.bundle'))
        return request.respond({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
        })
      if (path.endsWith('/api/favorites')) {
        favoritesCalls++
        await new Promise((r) => setTimeout(r, 1600))
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            folders: [{ id: 1, title: '测试收藏夹', count: 2 }],
          }),
        })
      }
      if (path.endsWith('/api/settings') && request.method() === 'GET') {
        await new Promise((r) => setTimeout(r, 1600))
        settingsFinished = true
      }
      if (path.endsWith('/api/search/videos'))
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                bvid: 'BVtest1',
                title: '雨天，和一架钢琴',
                author: '测试作者',
                duration: 272,
                cover:
                  'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png',
              },
              {
                bvid: 'BVtest2',
                title: '长标题'.repeat(30),
                author: '失败封面',
                duration: 190,
                cover: 'https://i0.hdslb.com/missing-bili-test.png',
              },
              {
                bvid: 'BVtest3',
                title: '空封面',
                author: '测试',
                duration: 180,
                cover: '',
              },
            ],
          }),
        })
      request.continue()
    })
    const root = () => document.getElementById('plugin-view').shadowRoot
    const click = async (text) => {
      await page.evaluate((text) => {
        const r = document.getElementById('plugin-view').shadowRoot
        const el = [...r.querySelectorAll('x-text')].find(
          (e) => e.textContent.trim() === text,
        )
        if (!el) throw Error('missing ' + text)
        ;(el.closest('.button') || el).click()
      }, text)
      await new Promise((r) => setTimeout(r, 100))
    }
    await page.setViewport({ width: 390, height: 800 })
    await page.goto(
      base +
        '/api/v1/jsplugin/bili/static/index.html?access_token=' +
        auth.access_token,
    )
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        ?.shadowRoot?.querySelector('.text-input'),
    )
    if (!process.env.BILI_TEST_OLD_BUNDLE)
      assert.equal(
        await page.evaluate(
          () =>
            document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.field-label').textContent,
        ),
        '搜索关键词',
      )
    await click('设置')
    await click('收藏夹')
    await click('下载')
    assert.equal(
      settingsFinished,
      false,
      'navigation must finish while settings request is pending',
    )
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector('.button-tab.selected').textContent,
      ),
      '下载',
    )
    await click('设置')
    await click('收藏夹')
    assert.equal(
      favoritesCalls,
      1,
      'duplicate pending favorites reads must be deduplicated',
    )
    await click('搜索')
    await page.evaluate(() => {
      const r = document.getElementById('plugin-view').shadowRoot
      const i = r.querySelector('.text-input').shadowRoot.querySelector('input')
      i.value = '钢琴'
      i.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    })
    await click('搜索') // first match is tab, submit explicitly below
    await page.evaluate(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.section .button-primary')
        .click(),
    )
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.video-item').length === 3,
    )
    await page
      .waitForFunction(
        () => {
          const r = document.getElementById('plugin-view').shadowRoot
          const image = r.querySelector('.cover-image')
          return image?.shadowRoot?.querySelector('img')?.naturalWidth > 0
        },
        { timeout: 20000 },
      )
      .catch(async (e) => {
        console.log(
          await page.evaluate(() =>
            [
              ...document
                .getElementById('plugin-view')
                .shadowRoot.querySelectorAll('.cover'),
            ].map((e) => ({
              html: e.outerHTML,
              shadow: e.querySelector('.cover-image')?.shadowRoot?.innerHTML,
            })),
          ),
        )
        await page.screenshot({ path: '/tmp/bili-image-debug.png' })
        throw e
      })
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.cover-image').length === 1,
    )
    await page.evaluate(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.video-main')
        .click(),
    )
    await click('设置')
    await new Promise((r) => setTimeout(r, 1800))
    await click('中')
    await click('搜索')
    assert.ok(
      await page.evaluate(() =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.selection')
          .classList.contains('is-selected'),
      ),
      'selection survives navigation',
    )
    for (const width of [320, 390, 1100])
      for (const theme of ['light', 'dark']) {
        await page.setViewport({ width, height: 800 })
        await page.evaluate(
          (theme) =>
            (document
              .getElementById('plugin-view')
              .shadowRoot.querySelector('.app').className = 'app ' + theme),
          theme,
        )
        const overflow = await page.evaluate(() =>
          [
            ...document
              .getElementById('plugin-view')
              .shadowRoot.querySelectorAll(
                '.video-row,.section,.button,.cover',
              ),
          ].some((e) => {
            const r = e.getBoundingClientRect()
            return r.left < -1 || r.right > innerWidth + 1
          }),
        )
        assert.equal(overflow, false, 'overflow at ' + width + ' ' + theme)
        await page.screenshot({
          path: `/tmp/bili-redesign-${width}-${theme}.png`,
        })
      }
    await click('设置')
    await new Promise((r) => setTimeout(r, 1800))
    assert.ok(
      await page.evaluate(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.button.selected'),
        ].some((e) => e.textContent === '中'),
      ),
      'refresh must preserve settings draft',
    )
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        passed: true,
        settingsFinished,
        favoritesCalls,
        errors,
        images: 'real CDN + failed + empty',
        screenshots: 6,
      }),
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
