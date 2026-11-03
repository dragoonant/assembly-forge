// M2 gates. (1) A person can get from squad select to their first moves using real clicks on the 3D board. (2) A whole
// AI-vs-AI game runs through the real client with zero page errors. Screenshots land in e2e-out/ for review.
import { expect, test, type Page } from '@playwright/test'

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

async function clickHex(page: Page, q: number, r: number): Promise<void> {
  const p = await page.evaluate(([qq, rr]) => window.__game!.hexToScreen(qq!, rr!), [q, r])
  expect(p, `hex ${q},${r} projects onto the screen`).not.toBeNull()
  await page.mouse.click(p!.x, p!.y)
}

test('setup, deploy and move with real clicks on the board', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('./')
  await expect(page.getByTestId('select')).toBeVisible()
  await page.getByTestId('team-t_lance').click()
  await page.getByTestId('confirm').click()
  await expect(page.getByTestId('brief')).toBeVisible()
  await page.getByTestId('deploy').click()
  await page.waitForFunction(() => window.__game?.state() !== null && window.__game!.camera() !== null)
  const cells = await page.evaluate(() => Object.keys(window.__game!.state()!.board.hexes).length)
  expect(cells).toBe(203)

  // wait for the player's first activation: a deploy onto the Base
  await page.waitForFunction(() => !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'e2e-out/m2-deploy.png' })
  const dep = await page.evaluate(() => window.__game!.legal().find((a) => a.type === 'deploy')!.to!)
  await clickHex(page, dep.q, dep.r)
  await page.waitForFunction(() => window.__game!.legal().every((a) => a.type === 'advance' || a.type === 'dash'))
  const uid = await page.evaluate(() => window.__game!.state()!.activation!.uid)
  const onBoard = await page.evaluate((u) => window.__game!.state()!.units[u]!.hex, uid)
  expect(onBoard).toEqual(dep)

  // move off the Base by clicking a glowing Advance hex, the furthest one forward
  const to = await page.evaluate(() => {
    const adv = window.__game!.legal().filter((a) => a.type === 'advance')
    adv.sort((a, b) => b.to!.q - a.to!.q)
    return adv[0]!.to!
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e-out/m2-moves.png' })
  await clickHex(page, to.q, to.r)
  await page.waitForFunction((u) => {
    const h = window.__game!.state()!.units[u]!.hex
    return Boolean(h) && window.__game!.legal().some((a) => a.type === 'energize')
  }, uid)
  const moved = await page.evaluate((u) => window.__game!.state()!.units[u]!.hex, uid)
  expect(moved).toEqual(to)

  // the action panel offers the rest of the turn; end it with Energize then End turn
  await page.getByTestId('act-energize').click()
  await page.getByTestId('act-end_activation').click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'e2e-out/m2-after-turn.png' })

  // camera: zoom in, then reset back to the overview
  const before = await page.evaluate(() => window.__game!.camera())
  await page.evaluate(() => window.__game!.setView({ zoom: 0.85 }))
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'e2e-out/m2-close.png' })
  const after = await page.evaluate(() => window.__game!.camera())
  expect(after!.dist).toBeLessThan(before!.dist)
  await page.getByTestId('reset-view').click()
  await page.waitForTimeout(1200)
  const reset = await page.evaluate(() => window.__game!.camera())
  expect(reset!.zoom).toBeCloseTo(0, 1)

  expect(errors).toEqual([])
})

test('a whole AI-vs-AI game plays through the client', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('./?ai=both&speed=instant&team=t_hammer&foe=t_spear&seed=e2e-full&auto=1')
  await page.waitForFunction(() => window.__game?.state() !== null)
  // a mid-game look, for review
  await page.waitForFunction(() => window.__game!.state()!.round >= 4 || window.__game!.over(), null, { timeout: 60_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e-out/m2-midgame.png' })
  await page.waitForFunction(() => window.__game!.over(), null, { timeout: 180_000 })
  await expect(page.getByTestId('game-over')).toBeVisible()
  await page.screenshot({ path: 'e2e-out/m2-gameover.png' })
  const vp = await page.evaluate(() => window.__game!.state()!.players.map((p) => p.vp))
  expect(vp[0]! + vp[1]!).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
