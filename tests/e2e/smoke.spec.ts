// M0 gate: the page boots with zero console errors, draws the engine's board and units in WebGL, and the camera responds.
import { expect, test } from '@playwright/test'

test('boots, draws the board, and the camera moves', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto('./')
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.locator('h1')).toHaveText('Assembly Forge')
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.camera() !== null)

  const counts = await page.evaluate(() => ({ cells: window.__game!.cells, units: window.__game!.units }))
  expect(counts.cells).toBe(77) // the 11 x 7 skirmish board, until M1 brings the 203-hex starter grid
  expect(counts.units).toBe(6)

  // let the overview settle, then check the canvas actually drew something other than the clear colour
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'e2e-out/m0-overview.png' })
  const lit = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    const g = document.createElement('canvas')
    g.width = 64
    g.height = 64
    const x = g.getContext('2d')!
    x.drawImage(c, 0, 0, 64, 64)
    const d = x.getImageData(0, 0, 64, 64).data
    const seen = new Set<string>()
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]! >> 4},${d[i + 1]! >> 4},${d[i + 2]! >> 4}`)
    return seen.size
  })
  expect(lit).toBeGreaterThan(8)

  const before = await page.evaluate(() => window.__game!.camera())
  await page.evaluate(() => window.__game!.setView({ zoom: 0.8, az: 0.6 }))
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => window.__game!.camera())
  expect(after!.dist).toBeLessThan(before!.dist)
  await page.screenshot({ path: 'e2e-out/m0-close.png' })

  await page.getByTestId('reset-view').click()
  await page.waitForTimeout(900)
  const reset = await page.evaluate(() => window.__game!.camera())
  expect(reset!.zoom).toBeCloseTo(0, 1)

  expect(errors).toEqual([])
})
