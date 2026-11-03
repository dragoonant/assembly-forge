# STATUS (rewrite, don't append)

**2026-11-03: M0, M1 and M2 done: the game is playable in 3D. Live at https://dragoonant.github.io/assembly-forge/. M3 (animation) next.**

## What exists
- Vite + React 19 + TypeScript + React Three Fiber, deploying `main` to GitHub Pages under `/assembly-forge/`.
- The engine, content and AI from MegaMechaTactics, now reconciled with the publisher's core rulebook (2026-10-30):
  deployment from Reserve and Bases, Engagement, objective contesting, line of sight, terrain (water, debris, interference
  field, impassable), Jump, Hover, Push and Pull with collisions, map pickups, stacking Upgrades, the status timings and the
  tie-break. `docs/rules-reconciliation.md` lists every change, its config path, its tests, and the five simplifications.
- The skirmish scenario on the 203-hex starter grid, with our own point-symmetric layout: one Base a side, two Garrisons a
  side, three Objectives (6, 4, 4 VP), six map pickups.
- The roster re-tuned by self-play; every team now wins 47 to 53% of its mixed games.
- The playable 3D board: squad select and briefing, then the 203-hex board from the player's seat at the left edge. Every
  affordance comes from the engine's legal actions: green rings for a free Advance, amber for a Dash, cyan for deploying,
  red rings on targets, a line-of-sight line (dashed red to the blocking hex) while a weapon is armed, and terrain, cost
  and marker facts on hover. Stand-in machines in the house proportions, one silhouette per archetype, with ground rings,
  HP bars and status pips; Objectives, Garrisons, Bases and pickups on the board.
- The HUD: top bar (score, Phase and round, opponent speed, reset view, new game), the Timeline column, the action column,
  the Tactics hand, the unit card, the dice panel, a feed of what just happened, and the game-over panel. Phones get strips
  instead of columns.
- URL switches: `?ai=both` to spectate, `?ai=none` for hotseat, `?speed=fast|instant`, and `?team=..&foe=..&seed=..&auto=1`.

## Verified (2026-11-03)
- `npm run typecheck`: clean.
- `npm test`: 199 engine tests and 19 unit tests pass (including the controller's attack-behind-the-dice path).
- `npm run build`: clean.
- `npm run e2e`: squad select to deploy to a move with real clicks on the 3D board, and a whole AI-vs-AI game through the
  client, both with zero console errors. Screenshots of deploy, moves, close zoom, mid-game, game over and a phone layout
  were looked at.
- `node tools/ai-selfplay.js 96 pairs=all`: 96 games, no crashes, no forced passes; teams 47/50/53/50%.
- Mirror matches: 23 to 25 over 48 games, so no seat advantage.

## Not verified / known gaps
- No person has played a full game yet; the e2e suite and AI games are the evidence so far.
- State changes snap: no walking, firing or destruction animation until M3.
- Mixed-team games have run about 57% to side 0 across runs with unpaired seeds; re-check with paired seeds.
- Not checked on a phone or a real GPU; only headless software GL.
- The `three` chunk is bundled with `@react-three` (about 920 kB, 246 kB gzipped).

## Next
M3 per PLAN.md §4: the presentation director (moves, attacks, destruction and phase banners animated from the engine log)
and audio cues.
