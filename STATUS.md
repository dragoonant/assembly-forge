# STATUS (rewrite, don't append)

**2026-11-03: M0 scaffold done and live at https://dragoonant.github.io/assembly-forge/. M1 started.**

## What exists
- Vite + React 19 + TypeScript + React Three Fiber project, deploying `main` to GitHub Pages under `/assembly-forge/`.
- The MegaMechaTactics engine, content and AI, copied unchanged except the game title (`src/content/names.js`). The TypeScript
  client reaches them through one typed boundary, `src/client/engine.ts`.
- A 3D board drawn from engine state: one instanced hex prism per cell (height from elevation, colour from terrain) and a stand-in
  capsule with a side-colour ring per unit. It still shows the old 11 by 7 skirmish board; the 203-hex starter grid arrives in M1.
- The camera from Three Kingdoms Tactics (pan, twist, pinch, wheel zoom to cursor, Q / E, R to reset, 8 px tap rule), fitted to
  the hex board by `src/client/board/CameraRig.tsx`.

- M1, first step: the rules config follows the 2026-10-30 rulebook for Phases (two), the Tactics draw, and the defensive lockout
  (off). `State.createBoard` has a `shortRows` option that builds the 203-hex starter grid; no scenario uses it yet.

## Verified (2026-11-03)
- `npm run typecheck`: clean.
- `npm test`: 168 engine tests and 18 unit tests (13 ported camera tests, 5 hex layout tests) pass.
- `npm run build`: clean.
- `npm run e2e`: the smoke test passes in headless Chromium (zero console errors, 77 hexes and 6 units, the canvas draws, zoom and
  reset work). Screenshots `e2e-out/m0-overview.png` and `e2e-out/m0-close.png` were looked at.
- The Pages deploy succeeded, and the live page loads in headless Chromium with zero console errors and draws the board.

## Not verified / known gaps
- Nothing is playable yet: no HUD, no selection, no moves. That is M2.
- The rules are still the pre-retail reconstruction. PLAN.md §6 lists every change M1 makes.
- Not checked on a phone or a real GPU; only headless software GL.
- The `three` chunk is bundled with `@react-three` (about 920 kB, 246 kB gzipped); splitting it is a later tidy-up.

## Next
M1 continues with the engine rewrites in PLAN.md §4: deployment from Reserve and Bases first (it changes every game's opening and
the scenario), then engagement, objective control, line of sight and terrain.
