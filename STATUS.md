# STATUS (rewrite, don't append)

**2026-11-03: M0 and M1 done. Live at https://dragoonant.github.io/assembly-forge/. M2 (playable 3D board) next.**

## What exists
- Vite + React 19 + TypeScript + React Three Fiber, deploying `main` to GitHub Pages under `/assembly-forge/`.
- The engine, content and AI from MegaMechaTactics, now reconciled with the publisher's core rulebook (2026-10-30):
  deployment from Reserve and Bases, Engagement, objective contesting, line of sight, terrain (water, debris, interference
  field, impassable), Jump, Hover, Push and Pull with collisions, map pickups, stacking Upgrades, the status timings and the
  tie-break. `docs/rules-reconciliation.md` lists every change, its config path, its tests, and the five simplifications.
- The skirmish scenario on the 203-hex starter grid, with our own point-symmetric layout: one Base a side, two Garrisons a
  side, three Objectives (6, 4, 4 VP), six map pickups.
- The roster re-tuned by self-play; every team now wins 47 to 53% of its mixed games.
- A 3D view of the board from engine state (instanced hex prisms, Bases, stand-in units) under the camera ported from Three
  Kingdoms Tactics. Not playable yet.

## Verified (2026-11-03)
- `npm run typecheck`: clean.
- `npm test`: 198 engine tests and 18 unit tests pass.
- `npm run build`: clean. `npm run e2e`: the smoke test passes with zero console errors.
- `node tools/ai-selfplay.js 96 pairs=all`: 96 games, no crashes, no forced passes; teams 47/50/53/50%.
- Mirror matches: 23 to 25 over 48 games, so no seat advantage.

## Not verified / known gaps
- Not playable by a person yet: no HUD, selection or moves (M2).
- Mixed-team games have run about 57% to side 0 across runs with unpaired seeds; re-check with paired seeds.
- Not checked on a phone or a real GPU; only headless software GL.
- The `three` chunk is bundled with `@react-three` (about 920 kB, 246 kB gzipped).

## Next
M2 per PLAN.md §4: the playable 3D board and the rebuilt HUD.
