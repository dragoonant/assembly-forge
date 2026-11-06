# STATUS (rewrite, don't append)

**2026-11-05: every released unit is in. Fifteen machines (u01 to u15) with their Tactics cards, Remote Weapon drones and
the mechanics they need; a fighting-game squad select over the whole pool with a CPU difficulty; our own unit and Tactics
card faces with art rendered from the models. Live at https://dragoonant.github.io/assembly-forge/. The owner reviews the
new set next.**

## What exists
- Vite + React 19 + TypeScript + React Three Fiber, deploying `main` to GitHub Pages under `/assembly-forge/`.
- The engine, content and AI from MegaMechaTactics, now reconciled with the publisher's core rulebook (2026-10-30):
  deployment from Reserve and Bases, Engagement, objective contesting, line of sight, terrain (water, debris, interference
  field, impassable), Jump, Hover, Push and Pull with collisions, map pickups, stacking Upgrades, the status timings and the
  tie-break. `docs/rules-reconciliation.md` lists every change, its config path, its tests, and the simplifications.
  A full audit (2026-11-03) of every rulebook section and every local-pack card is recorded there too.
- The second wave (2026-11-05): nine more machines, u07 to u15, on the published numbers and mechanics of the nine units
  released after the starter set, with our own names; 27 more Tactics cards (t15 to t41); Remote Weapon Systems as board
  pieces; Challenge; unit Response abilities in attack windows; rerolls and set criticals; extra targets; two new area
  patterns; Upgrades chosen, moved, taken and destroyed; Timeline delays; out-of-turn attacks. Squads are any three units
  from the fifteen (a unit once unless Mass Produced); the AI picks its squad at random, easy or hard from a
  unit-versus-unit matchup table (`src/ai/squad.js`, `src/ai/matchups.json`, written by `tools/ai-matchups.js`). The
  client's new squad-select screen is being written against `Squads` in `src/client/engine.ts`, and the models for u07
  to u15 are being made. Self-play over 3,600 random-squad games: no crashes, no forced passes; the utility walker (u08)
  wins about a quarter of its games and the duelist (u12) about two thirds, the rest 44 to 59%.
- AI changes (2026-11-05), measured on our layout and on the publisher's example setup (below): a move is credited
  with a Rescue it opens up as well as a shot (before, a side rescued about one of seven Garrisons a game and walked
  past its own); Energize is valued by the Energy Command it pays for this activation; handing an Upgrade over is
  scored by how much better the receiver uses it (it was scored as wasted); and the danger check counts half of an
  enemy's attack from where it could Advance to (`TUNING.threatReach`), so a melee machine three hexes off is no
  longer harmless. Garrisons rescued per game on the example setup went from 1.1 to 2.7 a side.
- `tools/ai-matchups.js` takes `layout=<name>` (a layout file in the git-ignored local pack folder) and
  `tune=key:value`. The publisher's example setup from the play guide (seven Garrisons a side, four Objectives, a
  two-level central hill) is transcribed there for self-play only; it is not in the repository.
- Card mechanics: a resumable attack with response windows, area attacks, grants, attack cards, Push and Pull as the
  acting player's choice, unit responses that ask for their target (or can be declined), and the would-be-defeated window
  for attack and ability damage.
- Deck building: players pick nine Tactics cards on the briefing screen, starting from a suggested deck.
- The skirmish scenario on the 203-hex starter grid, with our own point-symmetric layout: one Base a side, two Garrisons a
  side, three Objectives (6, 4, 4 VP), six map pickups.
- The roster re-tuned by self-play; every team wins 42 to 58% of its mixed games.
- Squad select (2026-11-05, `src/client/hud/SquadSelect.tsx`): a fighting-game character select over the whole pool.
  Every machine is a portrait tile; hover (or a first tap) focuses one and shows its full card beside the grid, and a
  second tap adds it. Three slots a side under a VS banner; any three machines, each once unless mass-produced (the
  rulebook's only squad rule). Lock in, and the CPU picks at the chosen difficulty (`src/ai/squad.js`, from a
  unit-versus-unit matchup table of 3,600 AI games, `src/ai/matchups.json`): Random, Easy (it fields machines the
  player's squad counters well) or Hard (it counter-picks). The difficulty is remembered. `?squad=u01,u02,u03&foe=...`
  sets both squads; the old `?team=t_lance` names still work.
- Watch CPU vs CPU (2026-11-05): a button on the squad select. The CPU plays the player's squad (or one it picks at
  random when the squad is not full) against its own pick at the chosen difficulty; the briefing skips the deck picker,
  the top bar shows "Watching" and the speed buttons (also on a phone), and Take over hands side 0 back to the player
  from its next decision. A new game goes back to playing.
- Card faces (`src/client/hud/Cards.tsx`), our own frame: a unit card has the machine's render over a glow in its side
  colour, name and role, hexagonal HP, VP and Timeline badges, both weapons as rows of numbers with their critical
  effects, abilities with colour-coded timing chips and Energy cost, and its traits; full size on the select screen,
  compact in the briefing. Tactics cards are plates tinted by timing, with the unit or trait they need. Portraits are
  renders of the finished models (`?viewer=<id>&portrait=bust|full`, `tools/render-portraits.mjs`).
- The playable 3D board: the briefing, then the 203-hex board from the player's seat at the left edge. Every
  affordance comes from the engine's legal actions: green rings for a free Advance, amber for a Dash, cyan for deploying,
  red rings on targets, a line-of-sight line (dashed red to the blocking hex) while a weapon is armed, and terrain, cost
  and marker facts on hover. Stand-in machines in the house proportions, one silhouette per archetype, with ground rings,
  HP bars and status pips; Objectives, Garrisons, Bases and pickups on the board.
- The HUD (reworked 2026-11-04 from the owner's phone screenshot): top bar (score, Phase and round, opponent speed, reset
  view, new game); the Timeline as a vertical column at every size; the log and the unit card as panels that minimize to
  one line (remembered per browser; the unit card starts minimized on narrow screens); and an action bar of small buttons
  along the bottom (weapons, Commands, actions, then the Tactics hand). A tap opens a button's description above the bar,
  and a second tap on the same button confirms it (owner, 2026-11-04: no confirm button in the description). A weapon or
  Attack card arms on the first tap; a tap on an enemy attacks, or a second tap does when there is one target. A
  targeted Command or card rings its targets in cyan, and a tap on one plays it. On a touch screen the bar sits 28px up,
  clear of the iPad and iPhone home bar. The bar folds to one line too. The dice panel and
  the game-over panel are unchanged.
- The presentation director (`src/client/presentation/`): every action's new log entries become blocking beats (a walk
  along the engine's path with a hop on level changes, a drop onto the Base on deploy, and for an attack the dice first,
  then the shot) and effects (hit bursts, a wreck flying off that leaves a scorch for the round, floating damage, VP, TL
  and status labels, Phase banners, an orbit at game over). An attack (owner, 2026-11-04) rolls its dice panel first, then
  plays its attack animation, and the hit bursts and damage numbers land as the shot does; response windows and card
  pauses happen before the attack finishes, so they come before the dice. Speeds follow the opponent-speed setting
  (instant shows no dice and no animation); any click skips.
- Attack effects (`src/client/board/AttackFx.tsx`), one kind per weapon from `src/client/presentation/weaponFx.ts`
  (`WEAPON_FX`, a `Record<wid, FxKind>`, with a fallback from the stats: range 1 melee, ignoring line of sight mortar, an
  area pattern blast, otherwise beam from range 4 and ballistic below). Timings live in `presentation/fxTiming.ts`, and the
  attacker's shoot or melee clip is driven by the beat, so the aim holds while it fires and each round kicks the arm.
  - Beam: motes drawn into a growing glow at the muzzle, then a flickering beam (white core, blue shell, wide halo, glows
    along its length for bloom), a big flash and a fountain of sparks at the target, smoke as it shuts off.
  - Ballistic: five rounds, each with a muzzle flash, a hot tracer streak, and a flash, sparks and dust where it lands.
  - Missile: four missiles from pods on the back and shoulders, alternating sides, arcing up and in on smoke trails, each
    exploding on the target.
  - Melee: thrusters and a dash in to just short of the target, a blade arc swept from the weapon side, a white flash,
    sparks, a shock ring and dust at the impact, and back.
  - Blast (area): a charge and discharge, a wave racing out, then every hex in the pattern lit and exploding in turn by
    distance. An area attack of another kind also lights its hexes when it lands.
  - Mortar: a heavy launch from the shoulder tube, the shell lobbed high on a thin smoke trail, a big explosion, a shock
    ring and debris.
  - On a miss the rounds go wide into the ground beside the target; a struck machine rocks back as the hit lands.
  Muzzles come from the rigged bones (the aiming hand per `tools/rig/rigs.json`, the forearm-to-hand line for the
  barrel), shoulder mounts and pods from the head bone with offsets, and stand-ins from fixed offsets. Everything is drawn
  by one layer into two instanced billboard fields (additive glow, smoke) and a few pooled meshes, built once; there is
  no post-processing.
- Destroyed machines fly off: a flash, a shower of sparks and smoke off the hex, a shudder up, then the machine boosts up
  and out of view behind its own side (the same cone a deploying machine flies in from), tumbling, thrusters lit, a fire
  in its chest and a smoke trail behind it. The scorch mark stays for the round.
- Sound: cues synthesized in the browser, the MegaMechaTactics music bed on the setup screens, and in battle three
  original 90-second battle themes made locally with MusicGen (`tools/make-music-local.py`, the AudioStudio audiocraft
  venv): a rock-and-brass theme, a darker metal-and-orchestra theme and a synth space-war theme, played in turn and round
  again. The take of each was picked by CLAP match to its prompt. A mute toggle that is remembered.
- The released units beyond the starter set (2026-11-05): nine more machines, u07 to u15, each this project's own design
  with its card's numbers and mechanics, and 27 Tactics cards (t15 to t41). New mechanics, all tested in
  `tests/engine/wave-suite.js`: Remote Weapon drones (deployed, repositioned, attacked, returned to supply), Challenge,
  setting a die to a critical, rerolling misses, extra dice, Upgrade choices and transfers, Timeline pushes, card draws,
  out-of-turn and counter attacks, repeated attacks, "also hits each enemy adjacent", and two more area patterns.
  `docs/rules-reconciliation.md` "Added for the second wave" lists them and the judgement calls. The board shows the
  drones as hovering models with side rings; targeted Commands and cards ring their targets or hexes in cyan; choices
  (an Upgrade, a drone's move) are asked on the board or the action bar.
- A pattern weapon shows every hex it will hit while aimed: hover a target (mouse) or tap it once (touch); a second tap
  fires.
- Model normals are smoothed on load (`smoothNormals.ts`), which removes the faceted look up close.
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
- Models are preloaded at startup and never drawn as stand-ins while loading; Deploy waits for them (rule 26).
- Mouse: wheel zooms, right drag rotates, middle drag pans, left picks; the left drag also pans until a middle press shows a
  three-button mouse (rule 27). The battle themes crossfade into each other.
- URL switches: `?slowmo=N` stretches every animation (and the wreck's flight) N times for review; `?ai=both` to spectate, `?ai=none` for hotseat, `?speed=fast|instant`, and `?team=..&foe=..&seed=..&auto=1`.

## Verified (2026-11-05)
- `npm run typecheck`: clean. `npm test`: 294 engine tests and 30 unit tests pass (the dice-then-shot-then-commit
  path, the planner's dice beat, every weapon of all fifteen machines mapped to an effect). `npm run build`: clean.
- `npm run e2e`: 30 tests, including every attack effect kind and a wreck flying off frozen mid-flight
  (`e2e-out/fx-*.png`, the second wave's beam, cone blast, mortar, missiles, rifle and kick among them), the character select (pick three with two taps each, lock in, the CPU's squad
  revealed) on desktop and on a phone in landscape, a pattern weapon's preview and two-tap fire, a drone placed by its
  Command, and every clip of all fifteen machines in the figure viewer. Screenshots looked at.
- `node tools/ai-matchups.js 3600` with the new AI: no crashes or forced passes, seats 1832 to 1768. Win rates by unit
  42 to 60% except the utility walker (u08, 27%); the duelist (u12) came down from 66% to 60%. On the publisher's
  example setup: 43 to 61%, u08 29% (from 21%), u12 53% (from 65%). The cards' numbers are untouched.

### Earlier (2026-11-04)
- `npm run e2e` (14 tests, including the mouse map, including the HUD on a phone in landscape with every panel folded and no text selection, a tap
  on the hex behind a machine, and the deploy flight in slow motion): squad select to deploy to a move with real clicks on the 3D board; a whole AI-vs-AI game
  through the client; beats and effects playing at normal and fast speed; and every clip of all six machines in the figure
  viewer (screenshots looked at). All with zero console errors. Screenshots of deploy,
  moves, close zoom, mid-game, game over, a phone layout, the Phase banner, a shot, floating labels and the deck picker
  were looked at.
- `node tools/ai-selfplay.js 96 pairs=all`: 96 games, no crashes, no forced passes; teams 58/56/44/42%.
- Mirror matches: 23 to 25 over 48 games, so no seat advantage.

## Not verified / known gaps
- The attack effects and the fly-off were checked as frozen frames in headless software GL, not watched at speed, and
  not on a phone or iPad GPU. Glow is additive billboards, not real bloom, so it reads softer than a post-processed glow.
- The melee slash is drawn over the machines (no depth test) so it is never hidden; the muzzles of shoulder mounts and
  pods are offsets from the head bone, not bones of their own.
- No person has played a full game yet; the e2e suite and AI games are the evidence so far.
- Sound has not been heard by anyone: the cues are synthesized and only checked to run without errors, and the battle
  themes were chosen by score, not by ear. MusicGen's weights are under a non-commercial licence.
- Animations were checked by sampled frames in headless Chromium, not watched at speed by a person.
- The rigs are fused single meshes from Hunyuan: big swings stretch the armour at the joint (worst in u05's claw wind-up),
  and the surfaces are softer and more faceted than the concept art.
- The models and textures come from Hunyuan3D and FLUX.1 dev, both under non-commercial licences.
- The fifteen machines are about 26 MB; the app preloads only the board objects at startup and each match's six
  machines while the briefing is up (Deploy waits for them).
- The new machines' rigs share the fused-mesh stretch (u13's rifle to foot when aiming, u10's forearm to hip in the
  swing, u09's launcher to foot in the jump).
- u08 is still well behind (27 to 29%). It is a strength-3, 8 HP melee machine and is destroyed about twice a game,
  handing over 5 VP each time; the AI fixes doubled its Rescues but not that. The owner decided (2026-11-05) that it
  stays on its published numbers: no house balance changes.
- Mixed-team games have run about 57% to side 0 across runs with unpaired seeds; re-check with paired seeds.
- Not checked on a phone or a real GPU; only headless software GL.
- three, R3F and drei build into one chunk of about 1.3 MB (330 kB gzipped); splitting it is a later tidy-up.

## Next
The owner reviews the new machines, squad select, cards and attack effects, and watches a CPU vs CPU game.
