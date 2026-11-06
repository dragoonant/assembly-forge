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
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'e2e-out/select-open.png' })
  // character select: a first tap focuses a machine, a second adds it; three, then lock in and the CPU picks
  for (const d of ['u03', 'u02', 'u01']) {
    await page.getByTestId('pick-' + d).click()
    await page.getByTestId('pick-' + d).click()
  }
  await expect(page.getByTestId('my-slots').locator('.ss-slot.full')).toHaveCount(3)
  await page.getByTestId('lock-in').click()
  await expect(page.getByTestId('cpu-slots').locator('.ss-slot.full')).toHaveCount(3)
  await page.screenshot({ path: 'e2e-out/select-locked.png' })
  await page.getByTestId('confirm').click()
  await expect(page.getByTestId('brief')).toBeVisible()
  // the deck picker starts on the suggested nine; dropping one blocks Deploy until a ninth is picked again
  await expect(page.getByTestId('deck-count')).toHaveText('9 / 9')
  await page.locator('.forge-card.tactics.on').first().click()
  await expect(page.getByTestId('deck-count')).toHaveText('8 / 9')
  await expect(page.getByTestId('deploy')).toBeDisabled()
  await page.locator('.forge-card.tactics:not(.on)').last().click()
  await expect(page.getByTestId('deploy')).toBeEnabled()
  await page.screenshot({ path: 'e2e-out/brief-deck.png', fullPage: true })
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
  // the machine flies in from behind its Base: catch it in the air
  await page.waitForTimeout(150)
  await page.screenshot({ path: 'e2e-out/m2-deploy-fly-1.png' })
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e-out/m2-deploy-fly-2.png' })
  // on the Base: moves off it, plus Commands and non-attack cards, but no Primary that would leave it there
  await page.waitForFunction(() => {
    const l = window.__game!.legal()
    return l.some((a) => a.type === 'advance') && l.every((a) => ['advance', 'dash', 'move', 'command', 'tactics'].includes(a.type))
  })
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

  // the action bar offers the rest of the turn: a tap opens a button's description, a second tap on it confirms
  await page.getByTestId('act-energize').click()
  await expect(page.getByTestId('act-pop')).toBeVisible()
  await expect(page.getByTestId('act-confirm-hint')).toBeVisible()
  await expect(page.getByTestId('act-pop').locator('button.setup-go')).toHaveCount(0)
  await page.screenshot({ path: 'e2e-out/m2-bar-pop.png' })
  const energyBefore = await page.evaluate((u) => window.__game!.state()!.units[u]!.energy, uid)
  await page.getByTestId('act-energize').click()
  await page.waitForFunction(() => !window.__game!.busy() && !window.__game!.legal().some((a) => a.type === 'energize'))
  expect(await page.evaluate((u) => window.__game!.state()!.units[u]!.energy, uid)).toBeGreaterThan(energyBefore)
  await page.getByTestId('act-end_activation').click()
  await page.getByTestId('act-end_activation').click()
  await page.waitForFunction((u) => window.__game!.state()!.activation?.uid !== u, uid)
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

test('watch CPU vs CPU from the select screen, then take over', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('./?speed=fast&seed=e2e-watch')
  await page.getByTestId('watch-bots').click()
  await expect(page.getByTestId('brief')).toBeVisible()
  await expect(page.getByTestId('deploy')).toHaveText('Watch', { timeout: 30_000 })
  await page.getByTestId('deploy').click()
  await expect(page.getByTestId('watching')).toBeVisible()
  // nobody touches anything: both sides play
  await page.waitForFunction(() => {
    const g = window.__game!.state()!
    return Object.values(g.units).filter((u) => u.side === 0 && u.hex).length > 0 && Object.values(g.units).filter((u) => u.side === 1 && u.hex).length > 0
  }, null, { timeout: 90_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'e2e-out/watch-bots.png' })
  await page.getByTestId('take-over').click()
  await expect(page.getByTestId('watching')).toHaveCount(0)
  // the next time side 0 decides, it waits for the player
  await page.waitForFunction(() => {
    const g = window.__game!.state()!
    return !window.__game!.busy() && g.activation !== null && g.units[g.activation.uid]!.side === 0
  }, null, { timeout: 120_000 })
  const before = await page.evaluate(() => window.__game!.state()!.log.length)
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => window.__game!.state()!.log.length)).toBe(before)
  expect(errors).toEqual([])
})

test('the HUD fits a phone in landscape, and every panel folds', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('./?team=t_lance&foe=t_hammer&seed=e2e-phone&auto=1')
  await page.waitForFunction(() => window.__game?.state() !== null && !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'e2e-out/phone-open.png' })
  // the Timeline is a column, not a strip across the board
  const track = await page.getByTestId('track').boundingBox()
  expect(track!.width).toBeLessThan(120)
  // every panel minimizes to its header line
  for (const id of ['track', 'feed', 'actions']) await page.getByTestId(id + '-fold').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e-out/phone-folded.png' })
  const bar = await page.getByTestId('actions').boundingBox()
  expect(bar!.height).toBeLessThan(44)
  for (const id of ['track', 'feed', 'actions']) await page.getByTestId(id + '-fold').click()
  // a long press or a triple click must never select the HUD's text
  expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe('none')
  await page.getByTestId('feed').click({ clickCount: 3 })
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
})

test.describe('touch tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  test('the action bar sits clear of the home bar', async ({ page }) => {
    await page.goto('./?team=t_lance&foe=t_hammer&seed=e2e-tablet&auto=1')
    await page.waitForFunction(() => window.__game?.state() !== null && !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await page.waitForTimeout(600)
    const bar = await page.getByTestId('actions').boundingBox()
    expect(768 - (bar!.y + bar!.height)).toBeGreaterThanOrEqual(26)
    await page.screenshot({ path: 'e2e-out/tablet-bar.png' })
  })
})

test('a pattern weapon shows every hex it will hit, and a second tap fires it', async ({ page }) => {
  // hotseat with the shoulder-cannon gunner: let the AI play both sides until the gunner can fire its pattern
  await page.goto('./?squad=u14,u15,u01&foe=u05,u04,u06&ai=none&auto=1&speed=instant&seed=e2e-pattern')
  await page.waitForFunction(() => window.__game?.state() !== null && window.__game!.camera() !== null)
  const found = await page.evaluate(async () => {
    const g = window.__game!
    for (let i = 0; i < 400; i++) {
      while (g.busy()) await new Promise((r) => setTimeout(r, 20))
      const s = g.state()!
      if (g.over()) return false
      const shot = g.legal().find((a) => a.type === 'attack' && a.areaHexes && s.units[a.uid]!.side === 0)
      if (shot && !s.pending) return true
      const a = g.aiChoose()
      if (!a) return false
      g.take(a)
      await new Promise((r) => setTimeout(r, 10))
    }
    return false
  })
  expect(found).toBe(true)
  await page.waitForTimeout(400)
  const shot = await page.evaluate(() => window.__game!.legal().find((a) => a.type === 'attack' && a.areaHexes)!)
  await page.getByTestId('weapon-' + shot.wid).click()
  const t = shot.targets![0]!
  const at = await page.evaluate((ref) => {
    const s = window.__game!.state()!
    const h = ref.kind === 'unit' ? s.units[ref.id]!.hex! : s.garrisons[ref.id]!.hex
    return { ...window.__game!.hexToScreen(h.q, h.r)!, h }
  }, t)
  const before = await page.evaluate(() => window.__game!.state()!.log.length)
  // the first tap previews the pattern and fires nothing
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'e2e-out/pattern-preview.png' })
  expect(await page.evaluate(() => window.__game!.state()!.log.length)).toBe(before)
  // the second tap on the same hex fires
  await page.mouse.click(at.x, at.y)
  await page.waitForFunction((n) => window.__game!.state()!.log.slice(n).some((e) => e.t === 'attack'), before, { timeout: 30_000 })
})

test('a remote weapon command rings its hexes, and a tap places the drone', async ({ page }) => {
  await page.goto('./?squad=u10,u13,u14&foe=u05,u04,u06&auto=1&speed=instant&seed=e2e-drone')
  await page.waitForFunction(() => window.__game?.state() !== null && !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
  // deploy whoever is first; the guardian (u10) carries the drone command once it is on the board
  const ok = await page.evaluate(async () => {
    const g = window.__game!
    for (let i = 0; i < 200; i++) {
      while (g.busy()) await new Promise((r) => setTimeout(r, 20))
      if (g.legal().some((a) => a.type === 'command' && a.aid === 'u10d')) return true
      const a = g.legal().find((x) => x.type === 'deploy') ?? g.aiChoose()
      if (!a) return false
      g.take(a)
      await new Promise((r) => setTimeout(r, 10))
    }
    return false
  })
  expect(ok).toBe(true)
  await page.waitForTimeout(400)
  await page.getByTestId('cmd-u10d').click()
  await expect(page.getByTestId('act-pop')).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e-out/drone-picks.png' })
  // a ringed hex in the clear middle of the screen, away from the panels and the action bar's description
  const { to, p } = await page.evaluate(() => {
    const g = window.__game!
    const opts = g.legal().filter((a) => a.type === 'command' && a.aid === 'u10d').map((a) => ({ to: a.to!, p: g.hexToScreen(a.to!.q, a.to!.r)! }))
    const clear = opts.filter((o) => o.p.x > 160 && o.p.x < innerWidth - 320 && o.p.y > 120 && o.p.y < innerHeight - 260)
    return (clear[0] ?? opts[0])!
  })
  await page.mouse.click(p.x, p.y)
  await page.waitForFunction(() => {
    const s = window.__game!.state() as unknown as { remotes: Record<string, { hex: unknown }> }
    return Object.values(s.remotes).some((r) => r.hex)
  })
  await page.waitForTimeout(800)
  await page.evaluate((h) => window.__game!.setView({ zoom: 0.8, focus: h } as never), to).catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'e2e-out/drone-placed.png' })
})

test('the character select fits a phone in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('./')
  await expect(page.getByTestId('select')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'e2e-out/select-phone.png' })
  const lock = await page.getByTestId('lock-in').boundingBox()
  expect(lock!.y + lock!.height).toBeLessThanOrEqual(390)
})

test('a deploying machine flies in from behind its Base', async ({ page }) => {
  // slowmo stretches the beat 15 times, so the flight can be caught at three points
  await page.goto('./?team=t_lance&foe=t_hammer&seed=e2e-fly&auto=1&slowmo=15')
  await page.waitForFunction(() => window.__game?.state() !== null && !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
  await page.evaluate(() => window.__game!.take(window.__game!.legal().find((a) => a.type === 'deploy')!))
  for (const i of [1, 2, 3]) {
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `e2e-out/deploy-flight-${i}.png` })
  }
})

test('a tap on the hex behind a machine reaches that hex', async ({ page }) => {
  await page.goto('./?team=t_lance&foe=t_hammer&seed=e2e-pick&auto=1&speed=instant')
  await page.waitForFunction(() => window.__game?.state() !== null && !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'deploy'), null, { timeout: 30_000 })
  await page.evaluate(() => window.__game!.take(window.__game!.legal().find((a) => a.type === 'deploy')!))
  await page.waitForFunction(() => !window.__game!.busy() && window.__game!.legal().some((a) => a.type === 'advance'))
  await page.waitForTimeout(500)
  // the Advance hex that sits on screen just above the machine, where its figure is drawn over the tile
  const pick = await page.evaluate(() => {
    const g = window.__game!
    const uid = g.state()!.activation!.uid
    const at = g.state()!.units[uid]!.hex!
    const me = g.hexToScreen(at.q, at.r)!
    const options = g.legal().filter((a) => a.type === 'advance').map((a) => ({ to: a.to!, p: g.hexToScreen(a.to!.q, a.to!.r)! }))
    const behind = options.filter((o) => o.p.y < me.y - 10).sort((a, b) => Math.abs(a.p.x - me.x) + (me.y - a.p.y) - (Math.abs(b.p.x - me.x) + (me.y - b.p.y)))[0]!
    return { uid, to: behind.to, x: behind.p.x, y: behind.p.y }
  })
  await page.mouse.click(pick.x, pick.y)
  await page.waitForFunction(([u, q, r]) => {
    const h = window.__game!.state()!.units[u as string]!.hex
    return Boolean(h) && h!.q === q && h!.r === r
  }, [pick.uid, pick.to.q, pick.to.r] as const)
  await page.screenshot({ path: 'e2e-out/pick-behind.png' })
})

test('mouse: middle drag pans, right drag rotates, and the left button only picks once a middle button is seen', async ({ page }) => {
  await page.goto('./?team=t_lance&foe=t_hammer&seed=e2e-mouse&auto=1&speed=instant')
  await page.waitForFunction(() => window.__game?.state() !== null && window.__game!.camera() !== null)
  await page.waitForTimeout(800)
  const cam = () => page.evaluate(() => window.__game!.camera()!)
  const drag = async (button: 'left' | 'middle' | 'right', dx: number, dy: number) => {
    await page.mouse.move(640, 360)
    await page.mouse.down({ button })
    for (let i = 1; i <= 8; i++) await page.mouse.move(640 + (dx * i) / 8, 360 + (dy * i) / 8)
    await page.mouse.up({ button })
    await page.waitForTimeout(500)
  }
  // a two-button mouse until shown otherwise: the left drag pans
  let a = await cam()
  await drag('left', 120, 0)
  let b = await cam()
  expect(Math.hypot(b.tx - a.tx, b.tz - a.tz)).toBeGreaterThan(0.2)
  // the middle drag pans, and marks the mouse as three-button
  a = b
  await drag('middle', -120, 0)
  b = await cam()
  expect(Math.hypot(b.tx - a.tx, b.tz - a.tz)).toBeGreaterThan(0.2)
  // now the left drag leaves the camera where it is
  a = b
  await drag('left', 120, 60)
  b = await cam()
  expect(Math.hypot(b.tx - a.tx, b.tz - a.tz)).toBeLessThan(0.01)
  // the right drag rotates
  a = b
  await drag('right', 150, 0)
  b = await cam()
  expect(Math.abs(b.az - a.az)).toBeGreaterThan(0.2)
})
