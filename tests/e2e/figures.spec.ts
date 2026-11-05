import { expect, test } from '@playwright/test'

// Each rigged machine, frozen at the telling moment of each clip, through the figure viewer (the same Figure component
// the board uses). The screenshots land in e2e-out/ for review: a scene change is not done until they have been looked at.
const RIGGED = ['u01', 'u02', 'u03', 'u04', 'u05', 'u06']
// [clip, seconds, yaw]: yaw 30 is the front three-quarter view, 90 the machine's left side
const MOMENTS: [string, number, number?][] = [
  ['idle', 0],
  ['walk', 0.05],
  ['walk', 0.45],
  ['jump', 0.55],
  ['fly', 0.1],
  ['melee', 0.3],
  ['melee', 0.48],
  ['shoot', 0.33],
  ['shoot', 0.33, 90],
  ['melee', 0.48, 90],
  ['hit', 0.12],
  ['destroyed', 1.2],
]

for (const id of RIGGED) {
  test(`${id} plays its clips`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    for (const [clip, t, yaw = 30] of MOMENTS) {
      await page.goto(`./?viewer=${id}&clip=${clip}&t=${t}&yaw=${yaw}`)
      await page.waitForFunction(() => (window as unknown as { __figureReady?: boolean }).__figureReady === true)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `e2e-out/fig-${id}-${clip}-${t}${yaw === 30 ? '' : '-y' + yaw}.png` })
    }
    expect(errors).toEqual([])
  })
}
