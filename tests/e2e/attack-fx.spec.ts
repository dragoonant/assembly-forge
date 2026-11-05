// The attack effects, one kind at a time, frozen at telling moments for review, and a destroyed machine flying off. The
// review hooks (presentation/review.ts) play the effects between machines already on the board without touching the
// engine; a huge ?slowmo nearly stops the clock, and `seek` holds each beat where the screenshot wants it. A real attack
// through the controller (dice first, then the shot) is covered by the presentation spec and the controller unit test.
import { expect, test, type Page } from '@playwright/test'

// [kind, who fires it (definition id), moments to capture as [beat fraction, camera on, zoom], extra options]
type Moment = [number, 'attacker' | 'target' | 'pair', number]
const SHOTS: [string, string, Moment[], { area?: boolean; miss?: boolean }?][] = [
  ['beam', 'u03', [[0.32, 'attacker', 0.85], [0.6, 'pair', 0.45], [0.6, 'target', 0.85]]],
  ['ballistic', 'u01', [[0.36, 'attacker', 0.85], [0.47, 'pair', 0.45], [0.44, 'target', 0.85]]],
  ['missile', 'u02', [[0.3, 'attacker', 0.7], [0.5, 'pair', 0.45], [0.62, 'target', 0.8]]],
  ['melee', 'u02', [[0.4, 'target', 0.75], [0.44, 'target', 0.75], [0.49, 'target', 0.75]]],
  ['blast', 'u01', [[0.4, 'pair', 0.5], [0.55, 'target', 0.7]], { area: true }],
  ['mortar', 'u06', [[0.22, 'attacker', 0.8], [0.5, 'pair', 0.25], [0.82, 'target', 0.75]]],
  ['ballistic', 'u05', [[0.44, 'target', 0.85]], { miss: true }],
]

async function setUp(page: Page, errors: string[], squads = 'team=t_lance&foe=t_anvil'): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`./?${squads}&seed=e2e-fx&auto=1&ai=none&speed=instant&slowmo=400`)
  await page.waitForFunction(() => window.__game?.state() !== null)
  // hotseat at instant speed: deploy everyone and walk them towards the middle
  for (let i = 0; i < 300; i++) {
    const done = await page.evaluate(() => {
      const g = window.__game!.state()!
      const on = Object.values(g.units).filter((u) => u.alive && u.hex)
      const moved = (window as unknown as { __moves?: number }).__moves ?? 0
      return on.length >= 6 && moved > 10
    })
    if (done) break
    await page.waitForFunction(() => !window.__game!.busy())
    await page.evaluate(() => {
      const legal = window.__game!.legal()
      const w = window as unknown as { __moves?: number }
      const step = legal
        .filter((a) => a.type === 'advance' || a.type === 'dash')
        .sort((a, b) => Math.abs(a.to!.q + a.to!.r / 2) - Math.abs(b.to!.q + b.to!.r / 2))[0]
      const pick = legal.find((a) => a.type === 'deploy') ?? step ?? legal.find((a) => a.type === 'end_activation') ?? legal.find((a) => a.type !== 'attack') ?? legal[0]!
      if (pick === step) w.__moves = (w.__moves ?? 0) + 1
      window.__game!.take(pick)
    })
  }
  await page.waitForFunction(() => !window.__game!.busy())
  await page.evaluate(() => window.__game!.setSpeed('normal'))
  // the board only, so no panel hides the effect
  await page.addStyleTag({ content: '.app > :not(:has(canvas)) { visibility: hidden !important; }' })
}

// the second wave's machines, so their own rigs' muzzles are seen too
const NEW_SHOTS: typeof SHOTS = [
  ['beam', 'u07', [[0.6, 'pair', 0.45]]],
  ['blast', 'u14', [[0.4, 'attacker', 0.6], [0.55, 'target', 0.7]], { area: true }],
  ['mortar', 'u15', [[0.22, 'attacker', 0.8]]],
  ['missile', 'u15', [[0.3, 'attacker', 0.7]]],
  ['ballistic', 'u13', [[0.36, 'attacker', 0.85]]],
  ['melee', 'u11', [[0.44, 'target', 0.75]]],
]

async function playShots(page: Page, shots: typeof SHOTS): Promise<void> {
  for (const [kind, who, moments, opts] of shots) {
    await page.evaluate(([k, w, o]) => {
      void window.__game!.fx.shot(k as never, { ...(o as object), attacker: w } as never)
      window.__game!.fx.seek(0)
    }, [kind, who, opts ?? {}] as const)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__game!.beat())).toBe('shot')
    for (const [t, on, zoom] of moments) {
      await page.evaluate(([oo, zz]) => window.__game!.fx.focus(oo as never, zz as number), [on, zoom] as const)
      await page.waitForTimeout(900)
      await page.evaluate((tt) => window.__game!.fx.seek(tt), t)
      // the figure cross-fades into its pose in real time
      await page.waitForTimeout(400)
      await page.screenshot({ path: `e2e-out/fx-${kind}${opts?.miss ? '-miss' : ''}-${who}-${Math.round(t * 100)}-${on}.png` })
    }
    await page.evaluate(() => window.__game!.fx.skip())
    await page.waitForFunction(() => window.__game!.beat() === null)
  }
}

test('each kind of attack has its own effect', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  await setUp(page, errors)
  await playShots(page, SHOTS)
  expect(errors).toEqual([])
})

test('the second wave of machines fire their effects from their own rigs', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  await setUp(page, errors, 'squad=u14,u15,u13&foe=u07,u11,u09')
  await playShots(page, NEW_SHOTS)
  expect(errors).toEqual([])
})

test('a destroyed machine lifts off and flies out of view', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  await setUp(page, errors)
  await page.evaluate(() => window.__game!.fx.wreck())
  await page.waitForTimeout(300)
  expect((await page.evaluate(() => window.__game!.effects())).wrecks).toBe(1)
  // close on the hex for the blow-out and lift-off, then pulled back to watch it go
  for (const [k, zoom] of [[0.04, 0.75], [0.12, 0.75], [0.22, 0.6], [0.35, 0.4], [0.55, 0.25], [0.8, 0.25]] as const) {
    await page.evaluate((z) => window.__game!.fx.focus('target' as never, z), zoom)
    await page.waitForTimeout(900)
    await page.evaluate((kk) => window.__game!.fx.seekWreck(kk), k)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `e2e-out/fx-wreck-${Math.round(k * 100)}.png` })
  }
  expect(errors).toEqual([])
})
