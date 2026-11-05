# STATUS (rewrite, don't append)

**2026-11-04: M0 to M3 done; M4 has its models. The six machines are generated, rigged and animated, the board objects
are models, and the deck is textured. Live at https://dragoonant.github.io/assembly-forge/ (the M4 work deploys when it is
pushed). The owner reviews the set next.**

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
- The HUD (reworked 2026-11-04 from the owner's phone screenshot): top bar (score, Phase and round, opponent speed, reset
  view, new game); the Timeline as a vertical column at every size; the log and the unit card as panels that minimize to
  one line (remembered per browser; the unit card starts minimized on narrow screens); and an action bar of small buttons
  along the bottom (weapons, Commands, actions, then the Tactics hand). A tap opens a button's description above the bar
  with its Use or Play button; a weapon or Attack card arms on the tap. The bar folds to one line too. The dice panel and
  the game-over panel are unchanged.
- The presentation director (`src/client/presentation/`): every action's new log entries become blocking beats (a walk
  along the engine's path with a hop on level changes, a drop onto the Base on deploy, a turn and a tracer or a lunge for a
  shot) and effects (hit bursts, a wreck that topples and sinks and leaves a scorch for the round, floating damage, VP, TL
  and status labels, Phase banners, an orbit at game over). Speeds follow the opponent-speed setting; any click skips.
- Sound: cues synthesized in the browser, the MegaMechaTactics music bed on the setup screens, and in battle three
  original 90-second battle themes made locally with MusicGen (`tools/make-music-local.py`, the AudioStudio audiocraft
  venv): a rock-and-brass theme, a darker metal-and-orchestra theme and a synth space-war theme, played in turn and round
  again. The take of each was picked by CLAP match to its prompt. A mute toggle that is remembered.
- The six machines as generated, rigged models (`public/assets/models/u01.glb` to `u06.glb`, about 1.7 MB each): model-kit
  proportions, a 17-bone skeleton with stiff armour weighting, and eight clips (idle, walk, jump, fly, melee, shoot, hit,
  destroyed) that the board picks from the current beat. Stand-ins remain as the fallback.
- Board objects as models (`public/assets/models/props/`): the objective pylon, garrison pillbox, base pad, supply crate,
  energy cell and two wrecks on blocked hexes, each keeping its side-colour ring, flag or light.
- The battlefield: one piece of land with a hex grid painted on it, ground textures mapped by world position so they run
  across hexes (grass and earth, rubble with loose rocks, a shallow river, scorched earth under the wrecks), raised hexes
  as rock plateaus with cliff sides, and grass carrying on past the board into fog.
- The figure viewer, `?viewer=u02&clip=walk&t=0.4&yaw=30`, which the e2e suite uses to screenshot every clip.
- `docs/figures.md`: the M4 brief and the whole pipeline (concepts, re-pose, Hunyuan, `tools/rig/` for rigging, props and
  packing).
- Touch: a long press never selects text or opens a callout (tabletop-kb rule 24), and units are picked by their hex only;
  figures take no taps, so a machine never hides the hex behind it (rule 25).
- Deploying: a machine flies in fast from a random direction behind its Base, heading on toward the enemy Base.
- URL switches: `?slowmo=N` stretches every animation N times for review; `?ai=both` to spectate, `?ai=none` for hotseat, `?speed=fast|instant`, and `?team=..&foe=..&seed=..&auto=1`.

## Verified (2026-11-04)
- `npm run typecheck`: clean.
- `npm test`: 249 engine tests and 22 unit tests pass (the controller's shot-then-dice-then-commit path, the planner).
- `npm run build`: clean.
- `npm run e2e` (13 tests, including the HUD on a phone in landscape with every panel folded and no text selection, a tap
  on the hex behind a machine, and the deploy flight in slow motion): squad select to deploy to a move with real clicks on the 3D board; a whole AI-vs-AI game
  through the client; beats and effects playing at normal and fast speed; and every clip of all six machines in the figure
  viewer (screenshots looked at). All with zero console errors. Screenshots of deploy,
  moves, close zoom, mid-game, game over, a phone layout, the Phase banner, a shot, floating labels and the deck picker
  were looked at.
- `node tools/ai-selfplay.js 96 pairs=all`: 96 games, no crashes, no forced passes; teams 58/56/44/42%.
- Mirror matches: 23 to 25 over 48 games, so no seat advantage.

## Not verified / known gaps
- No person has played a full game yet; the e2e suite and AI games are the evidence so far.
- Sound has not been heard by anyone: the cues are synthesized and only checked to run without errors, and the battle
  themes were chosen by score, not by ear. MusicGen's weights are under a non-commercial licence.
- Animations were checked by sampled frames in headless Chromium, not watched at speed by a person.
- The rigs are fused single meshes from Hunyuan: big swings stretch the armour at the joint (worst in u05's claw wind-up),
  and the surfaces are softer and more faceted than the concept art.
- The models and textures come from Hunyuan3D and FLUX.1 dev, both under non-commercial licences.
- The models add about 17 MB to the first load of a game.
- Mixed-team games have run about 57% to side 0 across runs with unpaired seeds; re-check with paired seeds.
- Not checked on a phone or a real GPU; only headless software GL.
- three, R3F and drei build into one chunk of about 1.3 MB (330 kB gzipped); splitting it is a later tidy-up.

## Next
The owner reviews the machines, props and deck; then fixes from that review, and M5 (card art from the finished models).
