// Renders every enabled machine's portraits from its 3D model: a bust for the squad-select grid and a full figure for
// the unit card's art, on transparent backgrounds, into public/assets/portraits/<id>-bust.webp and <id>-full.webp.
//
//   node tools/render-portraits.mjs [ids...]        (needs `npm run dev` running on PORT, default 5173, and Python with Pillow)
//
// It drives the figure viewer's portrait mode (src/client/board/FigureViewer.tsx) in Chromium with the real GPU.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 5173)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'public/assets/portraits')
const figure = readFileSync(join(ROOT, 'src/client/board/Figure.tsx'), 'utf8')
const enabled = JSON.parse(figure.match(/ENABLED_MODELS[^=]*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'))
const ids = process.argv.slice(2).length ? process.argv.slice(2) : enabled

// framing, viewport, the clip and moment to hold, and the turn
const SHOTS = [
  { name: 'bust', w: 512, h: 512, clip: 'idle', t: 0.4, yaw: 24 },
  { name: 'full', w: 640, h: 800, clip: 'shoot', t: 0.45, yaw: 30 },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] })
for (const id of ids) {
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 })
    await page.goto(`http://localhost:${PORT}/assembly-forge/?viewer=${id}&portrait=${s.name}&clip=${s.clip}&t=${s.t}&yaw=${s.yaw}`)
    await page.waitForFunction(() => window.__figureReady === true && window.__portraitFramed === true, null, { timeout: 60_000 })
    await page.waitForTimeout(300)
    const png = join(OUT, `${id}-${s.name}.png`)
    await page.screenshot({ path: png, omitBackground: true })
    // WebP with alpha, through Pillow
    execFileSync('python', ['-I', '-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], quality=86, method=6)', png, join(OUT, `${id}-${s.name}.webp`)])
    rmSync(png)
    await page.close()
    console.log(id, s.name)
  }
}
await browser.close()
