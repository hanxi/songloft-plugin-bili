// Run inside the repository's Docker Chromium environment against an isolated backend.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30602'
const output = process.env.BILI_TEST_OUTPUT || '/tmp/bili-layout'

;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
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
    if (process.env.BILI_TEST_OLD_BUNDLE) {
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        if (request.url().includes('main.web.bundle')) {
          return request.respond({
            status: 200,
            contentType: 'application/javascript',
            body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
          })
        }
        return request.continue()
      })
    }
    await page.setViewport({ width: 320, height: 700 })
    await page.goto(
      base +
        '/api/v1/jsplugin/bili/static/index.html?access_token=' +
        auth.access_token,
    )
    await page.waitForFunction(() => {
      const root = document.getElementById('plugin-view')?.shadowRoot
      return (
        root?.textContent.includes('搜索') &&
        !root.textContent.includes('处理中')
      )
    })
    const click = async (label) => {
      const rect = await page.evaluate((label) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const text = [...root.querySelectorAll('x-text')].find(
          (e) => e.textContent.trim() === label,
        )
        if (!text) throw new Error('Missing control: ' + label)
        const el = text.closest('.button') || text
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, label)
      await page.mouse.click(rect.x, rect.y)
      await new Promise((resolve) => setTimeout(resolve, 150))
      await page.waitForFunction(
        () =>
          !document
            .getElementById('plugin-view')
            .shadowRoot.textContent.includes('处理中'),
      )
    }
    const geometry = async () =>
      page.evaluate(() => {
        const root = document.getElementById('plugin-view').shadowRoot
        const tabs = [...root.querySelector('.tabs').children].map((el) => {
          const r = el.getBoundingClientRect()
          return { text: el.textContent, x: r.x, y: r.y, width: r.width }
        })
        const overflow = [
          ...root.querySelectorAll(
            '.section, .field, .button, .text-input, .toggle-row',
          ),
        ]
          .map((el) => ({
            text: el.textContent.slice(0, 50),
            rect: (
              el.shadowRoot?.querySelector('input') || el
            ).getBoundingClientRect(),
          }))
          .filter(
            ({ rect: r }) =>
              r.width > 0 && (r.x < -1 || r.right > innerWidth + 1),
          )
          .map(({ text, rect: r }) => ({ text, x: r.x, width: r.width }))
        return { tabs, overflow }
      })
    const sizes = []
    for (const width of [320, 390, 1100]) {
      await page.setViewport({ width, height: 700 })
      for (const theme of ['light', 'dark']) {
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
        for (const tab of ['搜索', '收藏夹', '下载', '账号', '设置']) {
          await click(tab)
          if (tab === '设置')
            await page.waitForFunction(() =>
              document
                .getElementById('plugin-view')
                .shadowRoot.textContent.includes('保存设置'),
            )
          const result = await geometry()
          assert.equal(result.tabs.length, 5)
          assert.ok(
            result.tabs.every((t) => Math.abs(t.y - result.tabs[0].y) <= 1),
            'Navigation wraps at ' + width + ': ' + JSON.stringify(result.tabs),
          )
          assert.deepEqual(result.overflow, [], `${tab} overflows at ${width}`)
          const inputs = await page.evaluate(() =>
            [
              ...document
                .getElementById('plugin-view')
                .shadowRoot.querySelectorAll('.text-input'),
            ].map(
              (el) =>
                (
                  el.shadowRoot?.querySelector('input') || el
                ).getBoundingClientRect().height,
            ),
          )
          assert.ok(
            inputs.every((height) => height >= 40),
            `${tab} inputs must have usable height at ${width}: ${JSON.stringify(inputs)}`,
          )
          if (tab === '搜索' || tab === '账号')
            assert.ok(inputs.length > 0, 'Form fields must exist')
          const selected = await page.evaluate(
            () =>
              document
                .getElementById('plugin-view')
                .shadowRoot.querySelectorAll('.button-tab.selected').length,
          )
          assert.equal(
            selected,
            1,
            'Exactly one navigation tab must be selected',
          )
          await page.screenshot({
            path: `${output}-${width}-${theme}-${tab}.png`,
          })
        }
        sizes.push({ width, theme, tabs: 5, overflow: false })
      }
    }
    await page.setViewport({ width: 320, height: 480 })
    await click('中')
    await click('保存设置')
    const saved = await (
      await fetch(base + '/api/v1/jsplugin/bili/api/settings', {
        headers: { Authorization: 'Bearer ' + auth.access_token },
      })
    ).json()
    assert.equal(
      saved.audio_quality,
      'medium',
      'Settings must persist after scrolling in a short viewport',
    )
    await click('搜索')
    const atTop = await page.evaluate(() => {
      const root = document.getElementById('plugin-view').shadowRoot
      return (
        root.querySelector('.content').getBoundingClientRect().top >=
        root.querySelector('.body').getBoundingClientRect().top - 1
      )
    })
    assert.ok(atTop, 'Changing tabs must reset the scroll position')
    const importCount = await page.evaluate(
      () =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.section-title'),
        ].filter((e) => e.textContent === '导入选中的歌曲').length,
    )
    assert.equal(
      importCount,
      0,
      'Import controls should appear after selecting songs',
    )
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        passed: true,
        sizes,
        savedQuality: saved.audio_quality,
        errors,
      }),
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
