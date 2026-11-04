# STATUS (rewrite, don't append)

**2026-11-03: M0 to M3 done: the game is playable and animated in 3D. Live at https://dragoonant.github.io/assembly-forge/. M4 (the six machines) is next, with the owner.**

## What exists
- Vite + React 19 + TypeScript + React Three Fiber, deploying `main` to GitHub Pages under `/assembly-forge/`.
- The engine, content and AI from MegaMechaTactics, now reconciled with the publisher's core rulebook (2026-10-30):
  deployment from Reserve and Bases, Engagement, objective contesting, line of sight, terrain (water, debris, interference
  field, impassable), Jump, Hover, Push and Pull with collisions, map pickups, stacking Upgrades, the status timings and the
  tie-break. `docs/rules-reconciliation.md` lists every change, its config path, its tests, and the simplifications.
  A full audit (2026-11-03) of every rulebook section and every local-pack card is recorded there too.
- Card mechanics: a resumable attack with response windows, area attacks, grants, attack cards, Push and Pull as the
  acting player's choice, unit responses that ask for their target (or can be declined), and the would-be-defeated window
  for attack and ability damage.
- Deck building: players pick nine Tactics cards on the briefing screen, starting from a suggested deck.
- The skirmish scenario on the 203-hex starter grid, with our own point-symmetric layout: one Base a side, two Garrisons a
  side, three Objectives (6, 4, 4 VP), six map pickups.
- The roster re-tuned by self-play; every team wins 42 to 58% of its mixed games.
- The playable 3D board: squad select and briefing, then the 203-hex board from the player's seat at the left edge. Every
  affordance comes from the engine's legal actions: green rings for a free Advance, amber for a Dash, cyan for deploying,
  red rings on targets, a line-of-sight line (dashed red to the blocking hex) while a weapon is armed, and terrain, cost
  and marker facts on hover. Stand-in machines in the house proportions, one silhouette per archetype, with ground rings,
  HP bars and status pips; Objectives, Garrisons, Bases and pickups on the board.
- The HUD: top bar (score, Phase and round, opponent speed, reset view, new game), the Timeline column, the action column,
  the Tactics hand, the unit card, the dice panel, a feed of what just happened, and the game-over panel. Phones get strips
  instead of columns.
- The presentation director (`src/client/presentation/`): every action's new log entries become blocking beats (a walk
  along the engine's path with a hop on level changes, a drop onto the Base on deploy, a turn and a tracer or a lunge for a
  shot) and effects (hit bursts, a wreck that topples and sinks and leaves a scorch for the round, floating damage, VP, TL
  and status labels, Phase banners, an orbit at game over). Speeds follow the opponent-speed setting; any click skips.
- Sound: cues synthesized in the browser (no paid generation), the MegaMechaTactics music bed on the setup screens, and a
  mute toggle that is remembered.
- Stand-in machines in each machine's own livery and weapon set, and a model loader (`src/client/board/Figure.tsx`) that
  swaps in `public/assets/models/<id>.glb` for any id listed in `ENABLED_MODELS`, falling back to the stand-in.
- `docs/figures.md`: the M4 brief, with the house proportions, the approved Gemini recipe, the six briefs and the pipeline.
- URL switches: `?ai=both` to spectate, `?ai=none` for hotseat, `?speed=fast|instant`, and `?team=..&foe=..&seed=..&auto=1`.

## Verified (2026-11-03)
- `npm run typecheck`: clean.
- `npm test`: 249 engine tests and 22 unit tests pass (the controller's shot-then-dice-then-commit path, the planner).
- `npm run build`: clean.
- `npm run e2e` (4 tests): squad select to deploy to a move with real clicks on the 3D board; a whole AI-vs-AI game through
  the client; and beats and effects playing at normal and fast speed. All with zero console errors. Screenshots of deploy,
  moves, close zoom, mid-game, game over, a phone layout, the Phase banner, a shot, floating labels and the deck picker
  were looked at.
- `node tools/ai-selfplay.js 96 pairs=all`: 96 games, no crashes, no forced passes; teams 58/56/44/42%.
- Mirror matches: 23 to 25 over 48 games, so no seat advantage.

## Not verified / known gaps
- No person has played a full game yet; the e2e suite and AI games are the evidence so far.
- Sound has not been heard by anyone: the cues are synthesized and only checked to run without errors.
- Animations were checked by sampled frames in headless Chromium, not watched at speed by a person.
- Mixed-team games have run about 57% to side 0 across runs with unpaired seeds; re-check with paired seeds.
- Not checked on a phone or a real GPU; only headless software GL.
- three, R3F and drei build into one chunk of about 1.3 MB (330 kB gzipped); splitting it is a later tidy-up.

## Next
M4 with the owner: concept images for the six machines from `docs/figures.md`, then Hunyuan Studio on the owner's PC, then
each GLB dropped into `public/assets/models/` and its id added to `ENABLED_MODELS`.
