const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  puppeteer = require(process.env.BROWSER_PUPPETEER || 'puppeteer')
const base = process.env.BILI_TEST_BASE_URL || 'http://127.0.0.1:30602'
;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage(),
      errors = []
    let partCalls = 0
    let readyReads = 0
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('BROWSER', message.text())
    })
    await page.setViewport({ width: 320, height: 700 })
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (process.env.BILI_TEST_OLD_BUNDLE && path.endsWith('main.web.bundle'))
        return r.respond({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(process.env.BILI_TEST_OLD_BUNDLE),
        })
      const reply = (data) =>
        r.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      if (path.endsWith('/api/login/status')) {
        readyReads++
        return reply({ logged_in: true, uname: 'test' })
      }
      if (path.endsWith('/api/favorites'))
        return reply({ folders: [{ id: 1, title: '测试收藏夹' }] })
      if (path.endsWith('/api/playlists')) {
        readyReads++
        return reply({
          playlists: Array.from({ length: 1000 }, (_, i) => ({
            id: i + 1,
            name: '歌单' + (i + 1),
          })),
        })
      }
      if (path.endsWith('/api/search/videos'))
        return reply({
          results: [
            {
              bvid: 'BVtest',
              aid: 1,
              title: '超长标题LongUnbrokenMusicTitle'.repeat(30),
              author: '演奏者'.repeat(10),
              duration: 180,
              part_count: 2,
              cover: '',
            },
          ],
        })
      if (path.endsWith('/parts')) {
        partCalls++
        return reply({
          items: [
            {
              bvid: 'BVtest',
              aid: 1,
              cid: 1,
              page: 1,
              title: '第一部分',
              author: 'test',
              duration: 60,
              cover: '',
            },
            {
              bvid: 'BVtest',
              aid: 1,
              cid: 2,
              page: 2,
              title: '第二部分',
              author: 'test',
              duration: 120,
              cover: '',
            },
          ],
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
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        ?.shadowRoot?.querySelector('.body.active .text-input'),
    )
    const readyDeadline = Date.now() + 10000
    while (readyReads < 2) {
      if (Date.now() > readyDeadline)
        throw Error('Initial reads did not finish: ' + readyReads)
      await new Promise((r) => setTimeout(r, 20))
    }
    await page.waitForFunction(
      () =>
        !document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.body.active .resource-status')
          ?.textContent.trim(),
    )
    const tap = async (label) => {
      const rect = await page.evaluate((label) => {
        const root = document.getElementById('plugin-view').shadowRoot
        const text = [
          ...root.querySelectorAll(
            '.tabs x-text,.body.active x-text,.picker-dialog x-text',
          ),
        ].find((e) => e.textContent.trim() === label)
        if (!text) throw Error('missing ' + label)
        const target =
          text.closest('.button') || text.closest('.picker-option') || text
        target.scrollIntoView({ block: 'nearest' })
        const bounds = target.getBoundingClientRect()
        return {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          width: bounds.width,
          height: bounds.height,
        }
      }, label)
      assert.ok(rect.width > 0 && rect.height > 0, label + ' must be visible')
      await page.mouse.click(rect.x, rect.y)
      await new Promise((r) => setTimeout(r, 150))
    }
    const type = async (selector, value) => {
      const input = await page.evaluateHandle(
        (selector) =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelector(selector)
            .shadowRoot.querySelector('input'),
        selector,
      )
      await input.asElement().click()
      await page.keyboard.type(value, { delay: 60 })
      assert.equal(
        await input.asElement().evaluate((el) => el.value),
        value,
        'actual keyboard input must reach the visible field',
      )
    }
    await type('.body.active .text-input', 'piano')
    await page.waitForFunction(
      () =>
        !document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.body.active .button-primary')
          .classList.contains('disabled'),
    )
    await page.evaluate(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.body.active .button-primary')
        .click(),
    )
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.video-title'),
    )
    const title = await page.evaluate(() => {
      const root = document.getElementById('plugin-view').shadowRoot
      const t = root.querySelector('.video-title'),
        r = t.getBoundingClientRect(),
        button = root
          .querySelector('.video-row .button')
          .getBoundingClientRect()
      return {
        height: r.height,
        width: r.width,
        right: r.right,
        buttonLeft: button.left,
      }
    })
    assert.ok(
      title.width > 0 && title.height <= 43 && title.right <= title.buttonLeft,
      'title must clamp without overlapping parts button',
    )
    await page.screenshot({ path: '/tmp/bili-followup-search.png' })
    await tap('通过链接导入')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.body.active .text-input')
          .shadowRoot.querySelector('input').value === '',
    )
    await tap('返回音乐搜索')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelector('.body.active .text-input')
          .shadowRoot.querySelector('input').value === 'piano',
    )
    await tap('分 P')
    await page.waitForFunction(
      () =>
        document
          .getElementById('plugin-view')
          .shadowRoot.querySelectorAll('.parts .video-item').length === 2,
    )
    await tap('收起')
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.parts .video-item').length,
      ),
      0,
    )
    await tap('分 P')
    assert.equal(partCalls, 1, 'reopening uses cached parts')
    await tap('设置')
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.textContent.includes('监控目标歌单'),
    )
    const open = async () =>
      page.evaluate(() => {
        const fields = [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .field'),
        ]
        fields
          .find(
            (e) => e.querySelector('x-text')?.textContent === '监控目标歌单',
          )
          .querySelector('.button')
          .click()
      })
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.picker-option').length,
      ),
      0,
    )
    await open()
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.picker-dialog'),
    )
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.picker-option').length,
      ),
      20,
    )
    await page.screenshot({ path: '/tmp/bili-followup-picker.png' })
    await type('.picker-dialog .text-input', '999')
    await page
      .waitForFunction(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.picker-option').length === 1,
      )
      .catch(async (e) => {
        console.log(
          await page.evaluate(() => {
            const r = document.getElementById('plugin-view').shadowRoot
            return {
              dialog: !!r.querySelector('.picker-dialog'),
              input: r
                .querySelector('.picker-dialog .text-input')
                ?.shadowRoot.querySelector('input')?.value,
              text: r.querySelector('.picker-dialog')?.textContent,
            }
          }),
        )
        await page.screenshot({ path: '/tmp/bili-picker-debug.png' })
        throw e
      })
    await tap('歌单999')
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.picker-dialog').length,
      ),
      0,
    )
    assert.ok(
      await page.evaluate(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .field'),
        ]
          .find(
            (e) => e.querySelector('x-text')?.textContent === '监控目标歌单',
          )
          .textContent.includes('歌单999'),
      ),
    )
    await open()
    await page.waitForFunction(() =>
      document
        .getElementById('plugin-view')
        .shadowRoot.querySelector('.picker-dialog'),
    )
    await tap('取消')
    assert.ok(
      await page.evaluate(() =>
        [
          ...document
            .getElementById('plugin-view')
            .shadowRoot.querySelectorAll('.body.active .field'),
        ]
          .find(
            (e) => e.querySelector('x-text')?.textContent === '监控目标歌单',
          )
          .textContent.includes('歌单999'),
      ),
    )
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        passed: true,
        title,
        partCalls,
        playlists: 1000,
        renderedOptions: 20,
        errors,
      }),
    )
    await page.screenshot({ path: '/tmp/bili-followup-settings.png' })
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
