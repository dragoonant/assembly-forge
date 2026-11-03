// M3 gate: the director animates what the engine logged. Spectate an AI game at normal and at fast speed, sample which
// beats play, and capture a walk and a shot mid-flight for review. Instant speed is covered by the full-game test.
import { expect, test } from '@playwright/test'

for (const speed of ['normal', 'fast'] as const) {
  test(`beats and effects play at ${speed} speed`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`./?ai=both&speed=${speed}&team=t_lance&foe=t_hammer&seed=present-${speed}&auto=1`)
    await page.waitForFunction(() => window.__game?.state() !== null)
    // the opening banner
    await expect(page.getByTestId('banner')).toBeVisible()
    await page.screenshot({ path: `e2e-out/m3-${speed}-banner.png` })

    const seen = new Set<string>()
    const shots = new Set<string>()
    const deadline = Date.now() + (speed === 'normal' ? 40_000 : 25_000)
    let effects = 0
    while (Date.now() < deadline && !(seen.has('move') && seen.has('shot') && seen.has('deploy') && effects > 0)) {
      const b = await page.evaluate(() => window.__game!.beat())
      if (b) {
        seen.add(b)
        if ((b === 'move' || b === 'shot') && !shots.has(b)) {
          shots.add(b)
          await page.screenshot({ path: `e2e-out/m3-${speed}-${b}.png` })
        }
      }
      const fx = await page.evaluate(() => window.__game!.effects())
      if (fx.bursts + fx.floats + fx.wrecks > 0) {
        if (!effects) await page.screenshot({ path: `e2e-out/m3-${speed}-effects.png` })
        effects++
      }
      await page.waitForTimeout(40)
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['deploy', 'move', 'shot']))
    expect(effects).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
}
