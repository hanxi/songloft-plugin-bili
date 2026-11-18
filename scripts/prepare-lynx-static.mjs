import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../frontend/dist/web/main.web.bundle', import.meta.url))
const version = createHash('sha256').update(bundle).digest('hex').slice(0, 16)
const fallback = readFileSync(new URL('../frontend/lynx-fallback.html', import.meta.url), 'utf8')

// The builder overlays the plugin's static directory before hashing the ZIP.
writeFileSync(new URL('../static/index.html', import.meta.url), fallback.replace('__BILI_WEB_BUNDLE_VERSION__', version))
