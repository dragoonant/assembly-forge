# Assembly Forge: MegaMechaTactics in 3D

**Status: approved direction, 2026-11-03.** Nothing below is built. The owner
settled D1, D2 and D5 to D10, and the card portraits, on 2026-11-03.
M0 (scaffold), M1 (rules), M2 (playable board) and M3 (presentation) are built; M4 waits on the owner. See STATUS.md.

Assembly Forge is the 3D successor to MegaMechaTactics. It keeps that game's
rules engine, roster, Tactics deck and AI, replaces the SVG hex map with a 3D
board and 3D machines, and brings the rules up to the game that reached retail
in October 2026.

Unofficial and non-commercial, by evilgouki. The MegaMechaTactics `NOTICE.md`
carries over unchanged in spirit: mechanics only, invented names, no published
art, text, card frame or fiction, nothing fetched at run time. The public name
stays clear of the source game's trademark.

---

## 1. Where we start

MegaMechaTactics (`../MegaMechaTactics`, 13 commits, 165 tests green on
2026-11-03) is in better shape for this than its age suggests:

- **The engine is pure.** `apply(state, action)` returns a new state, the
  seeded generator lives in the state, and nothing in `src/engine/` or
  `src/ai/` touches the DOM. It runs headless under Node today
  (`node tests/run.js`). It moves across as-is.
- **The UI already reads nothing but `legalActions`.** Which hexes glow and
  which enemies can be clicked are the engine's own action list, filtered. A
  3D board is the same filter with a different painter.
- **Every move action already carries its path** (`actions.js`, `path`), which
  is what a figure needs to walk. The log entry for a move records only `from`
  and `to`; adding the path is one line in `apply.js`.
- **The log is already an event stream.** `state.log` holds typed entries
  (`advance`, `attack` with every die face, `timeline`, `status`,
  `garrison_rescued`, `phase_end`, `game_over`), some with a `sound` tag. A
  presentation director plays the entries appended since the last state and
  never has to infer what happened by diffing units.
- **Every open rule is a named config value** in `rules.js`, listed in
  `docs/open-rules.md` as a checklist written for exactly this moment.

What does not carry over:

- `src/ui/app.js` (1,292 lines of SVG and DOM) is replaced, not ported. The
  Timeline track, action buttons, hand, unit cards and dice panel are rebuilt
  as HUD components; the board rendering goes.
- The 2D figure art direction. The existing tokens and portraits were prompted
  in a style the owner has since rejected for figures (see §5).

## 2. Decisions

### D1. New repository, engine copied — decided 2026-11-03

Build Assembly Forge in this folder as its own repository, with `src/engine/`,
`src/content/`, `src/ai/` and `tests/` copied from MegaMechaTactics on day one.
MegaMechaTactics stays as the finished 2D game and the record of what the
rules did before reconciliation.

Why not in place: the 2D UI, the PowerShell dev server, the SVG asset pipeline
and the no-build constraint are all things the 3D build replaces. One tree
would carry a dead half in every commit.

Why copy rather than share a package: the engine changes in M1 (rules) and M3
(log entries for presentation). Sharing one engine between two games is worth
solving only once the 2D game needs the new rules.

### D2. Stack: Vite + TypeScript + React Three Fiber — decided 2026-11-03

The same stack as Three Kingdoms Tactics and Murder Squad: Vite, React 19,
three 0.186, `@react-three/fiber`, `@react-three/drei`, zustand, Vitest,
Playwright, GitHub Actions to GitHub Pages.

What that buys from the siblings:

| Reused | From | How |
| --- | --- | --- |
| Camera model: orbit target, azimuth, log zoom, pitch easing with zoom, floor clearance, tap-vs-drag by 8 px | `three-kingdoms-tactics/src/client/board/cameraModel.ts`, `mapController.ts` | Pure maths with no three, React or DOM. Copies across with its unit tests; needs a hex `floorAt`. |
| Board canvas, picking, ground-ring decals (actable pulse, selected ring, targetable ring, painted flat on the ground) | `BoardCanvas.tsx`, `Figure.tsx` | Pattern and components, re-targeted from squares to hexes. |
| Presentation director: engine events drive animations at full, quick or instant speed; any click skips | `src/client/presentation/director.ts` | Pattern. |
| Phone quality tiers and the `?perf=hud` meter | cut-ins D32, D33 | Pattern. Our scene is far lighter. |
| GLB loading with a procedural fallback, scaled to a known height | `glbModels.ts`, Hunyuan `stage_finalize.py` | Pipeline contract: `public/assets/models/<slug>.glb`. |
| Headless screenshot tools and e2e gates | `tools/shoot-*.mjs`, `tests/e2e` | Pattern. This is how an agent verifies a 3D scene. |

The engine stays plain JavaScript with its JSDoc types; Vite and Vitest run it
unchanged. Only the client is TypeScript.

**The alternative** is vanilla ES modules with a vendored `three.module.js`,
keeping the no-build rule and the existing DOM HUD. It is a smaller first step
but gives up the sibling components, Playwright and the Pages build.

### D3. Hex orientation and scale

Pointy-top, matching `hex.js`. One hex is **1 world unit across the flats**. A
machine stands about **1.1 units tall**, so the sibling camera constants
(closest distance 2.8 tiles, chest height 0.75) hold without retuning.
Elevation is **0.35 units per level**: a visible step at the overview that
does not hide a machine on the lower hex at close zoom. If the retail board
uses a different hex count or shape, the scenario file changes, not the
renderer.

### D4. What stays in the DOM

The Timeline track, action buttons, Tactics hand, unit cards, dice panel and
phase banner are HUD over the canvas, never drawn in three. The dice panel
keeps its rule: the engine has already rolled, and the panel animates toward
faces that exist.

### D5. Presentation concept: hangar deck — decided 2026-11-03

The siblings each have one idea every surface comes from, plus a gate: side by
side, the new game must not be mistakable for any of them. Two candidates:

- **Hangar deck (chosen).** The board is a steel-grate deck in a hangar
  at night under work lamps. Elevation is stacked cargo and gantries, water is
  a flooded bay, blocked hexes are wrecked hulls. The Timeline is a departure
  board on the hangar wall. Amber on gunmetal. Machines read full-size, which
  suits the serious figure style.
- **Range table.** A physical terrain table in a briefing room: cast-resin
  hexes, model buildings, a projector washing it in cool light; the machines
  are painted miniatures on it. The Timeline is a magnetic planning board.
  Cool white on dark felt.

### D6. Board size: match retail — decided 2026-11-03

The board uses the retail hex size and map dimensions, so the game lines up
with the physical set.

**The starter map's grid, measured 2026-11-03** from the publisher's play
guide (the setup illustration, `images/about/playguide/img_03.png`, 629 by
622 px) by tracing the white board outline pixel by pixel:

| Property | Value |
| --- | --- |
| Orientation | Pointy-top hexes in horizontal rows, as drawn with the Timeline track along the top edge. The players sit at the left and right edges, so each faces a flat side. |
| Rows | **15**, alternating long and short, starting and ending on a long row |
| Long rows | 8 rows of **14** hexes, flush with both side edges |
| Short rows | 7 rows of **13** hexes, inset half a hex at each side |
| Total | **203 hexes** |
| Proportions | 14 hex-widths wide by about 13.3 tall, so nearly square |

That is a 14-column "odd-r" offset grid with the last hex of every short row
removed. `State.createBoard` builds a full rectangle today, so M1 adds a
`shortRows` option rather than listing 7 hexes to delete.

A second count agrees. The publisher's printable copy of the starter map
(its "enrich gameplay" downloads, A4 and Letter) shows the same 203 hexes
turned 90 degrees, as flat-top columns alternating 14 and 13. Both print
sizes tile to the same **855 by 740 mm** sheet, which implies 1:1 scale. On
that sheet:

| Property | Value |
| --- | --- |
| Hex size | About **48.3 mm across the flats**, 55.7 mm point to point |
| Hex field | About 644 by 679 mm; the Timeline track is printed beside it |
| Format | One folded paper sheet with separate paper terrain |

These are measured from the PDF, not stated anywhere. In world units, one hex
across the flats stays 1 unit (D3), so the board is about 14 by 13.3 units.

Only the grid comes from the illustration. The terrain, Bases, Garrisons and
Objectives on it are the publisher's scenario layout and stay out of this
project, which places its own. The renderer is the same either way; the scenario file
changes. Hex count and map size come from the rulebook, never from a scan or
photo of a published map. The terrain layout on it stays our own, so no
published map layout is copied.

### D7. Hosting: public repository, GitHub Pages — decided 2026-11-03

The repository is public on GitHub, and every push to `main` deploys to
GitHub Pages under `/assembly-forge/`, like the sibling games.

### D8. Title: Assembly Forge — decided 2026-11-03

Players see "Assembly Forge" on the title screen and in the page title. The
string lives in `src/content/names.js` like every other display name.

### D9. Squads: 3v3 only for the first slice — decided 2026-11-03

The slice plays the starter format: three machines a side from the existing
six, on the 203-hex starter grid. Five-a-side waits for more machines and a
larger map.

### D10. Rule scope: core rules first — decided 2026-11-03

The slice implements every rule the six machines and the starter map use.
Carriers, remote weapon tokens, Reinforcements, carried Objectives, Challenge,
Swap, Reposition and Setup abilities wait until content needs them. They stay
listed under "Rules to add" in §6 so nothing is lost.

## 3. Layout

```
assembly-forge/
  index.html  PLAN.md  STATUS.md  NOTICE.md  CLAUDE.md
  package.json  vite.config.ts  tsconfig.json  playwright.config.ts
  src/
    engine/        copied from MegaMechaTactics, plain JS
    content/       copied: names, units, tactics, teams, scenarios, abilitytext
    ai/            copied
    client/
      main.tsx
      store/       zustand: game state, pending animations, settings
      board/       BoardCanvas, HexGrid, Terrain, Markers, Machine, CameraRig,
                   cameraModel.ts and mapController.ts (ported), picking
      figures/     procedural stand-in rigs; GLB loader with fallback
      presentation/ director: log entries to animations, speed, skip
      hud/         Track, Actions, Hand, UnitCard, Dice, Banners, Setup
      audio/       cues from log sound tags; one music bed
      theme.css
  public/
    assets/models/<slug>.glb   six machines from the Hunyuan pipeline
    assets/textures/           deck, water, terrain
    audio/                     carried over
  tests/
    engine/        the existing suites
    client/        cameraModel, director, picking maths
    e2e/           boots, plays an AI game, screenshots the board
  tools/
    sim, ai-selfplay, ai-headtohead (ported)
    shoot-board.mjs, shoot-figures.mjs   headless screenshots for review
    figures/       prompts and the per-machine briefs
  docs/
    rules-reconciliation.md   M1 output
    open-rules.md             carried over; shrinks to zero in M1
    presentation.md           the D5 concept, palette, type, surfaces
    figures.md                proportions, materials, per-machine briefs
```

## 4. Milestones

Each ends with typecheck, unit tests, e2e and build green, and a STATUS.md
rewrite. The order front-loads what is painful to change later: the engine's
event stream and the board's coordinate mapping come before any art.

### M0. Scaffold (one session)

Vite + React + TypeScript project. Copy `src/engine`, `src/content`, `src/ai`,
`tests/` and `assets/audio`. Run the existing harness from `npm test` (all 165
must pass). NOTICE, CLAUDE.md, `.claude/launch.json` for `npm run dev`, and a
Pages deploy workflow. A blank canvas with a lit ground plane and the ported
camera rig with its unit tests.

Gate: 165 engine tests green here; the page loads with zero console errors in
headless Chromium.

### M1. Rules reconciliation (two to three sessions; can run beside early M2)

§6 is already checked against the current rulebook, the 2026-10-30 issue. Work in
this order:

1. **Config changes**: Phases, objective VP, Tactics draw, the defensive
   lockout off.
2. **Engine rewrites**: deployment from Reserve and Bases, with the
   blocked-Base fallback; engagement (same elevation, penalty on moves started
   Engaged, attack restriction); objective contesting and persistent control;
   LoS blocking by elevation; water, debris and the new terrain kinds; Upgrade
   pickup on ending a move or deploying; `slow` and `disarm` timing; partial
   resolution of effects; the Primary keyword on Tactics cards.
3. **New mechanics**: collisions, Jump, Hover, the four attack Response
   windows, Timeline back-moves and 0-cost actions. Each lands with tests,
   even where no current unit uses it, so later content can.

For each row: change the value or code, add or update its test, and move the
row to a confirmed table in `docs/rules-reconciliation.md`. The skirmish
scenario replaces its six starting positions with one Base per side and sets
objective VP per §6.

Then re-run AI self-play and re-tune `evaluate.js` if the scoring economy
moved. The old plan's own warning was that the AI's weights are tuned to a
guessed VP economy.

The engine changes M3 needs land here too, since they touch the same files:
the move log entry gains `path`, and every entry the director animates gets a
stable documented shape.

Gate: `open-rules.md` has no open rows; self-play between the four preset
teams stays within 40 to 60 percent.

### M2. The 3D board, playable (two sessions)

- Hex grid as one instanced mesh of hex prisms, height from elevation, with a
  thin edge line.
- Terrain: open; rough with scattered debris instances; water as a recessed
  plane with a slow normal-map scroll; blocked as a wreck or container stack;
  elevation as stacked prisms.
- Markers: objectives as a lit disc in the controlling side's colour;
  garrisons as a small structure with a side flag.
- Machines as procedural stand-in rigs in the §5 proportions, one silhouette
  per archetype, side colour on the shoulders, a ground ring decal under each.
- Picking by raycast against hex prisms and machine hit-capsules; the 8 px tap
  rule; click empty ground to cancel.
- Highlights from `legalActions` only: reachable hexes lit, movement cost on
  hover, targetable enemies ringed, and a line-of-sight line from attacker to
  target with the blocking hex marked.
- The HUD rebuilt with the same strings from `names.js`: Timeline track,
  actions, hand, unit card, dice, team select and briefing.
- Hotseat and AI games play end to end. State changes snap; no animation yet.

Gate: an e2e test plays a full AI-vs-AI game through the real client with zero
page errors; overview and close-zoom screenshots reviewed.

### M3. Presentation director (one to two sessions)

The director consumes the log entries each `apply` appends and queues
animations. The store does not show the new state until the queue drains,
which generalises the 2D game's rule for dice. Speeds are full, quick and
instant; any click skips to the end of the current entry.

| Log entry | Animation |
| --- | --- |
| `advance`, `dash` | Walk along `path`, turn through corners, step up and down elevation, settle. About 1.5 hexes a second. |
| `attack` | Turn to the target; muzzle flash or melee lunge by weapon range; tracer; the dice panel; hit flash and HP bar drop; status pip pops. |
| `timeline` | The HUD token slides; a cost chip rises from the machine. |
| `status` | Procedural billboard pip over the machine, recolourable per side. |
| garrison rescued or destroyed | The structure lifts off or folds. |
| unit destroyed | Stagger, fall, fade; a scorch decal stays for the round. |
| `round`, `phase`, `phase_end` | Banner across the top; the VP tally animates. |
| `game_over` | Camera orbits the winner's survivors; result panel. |

Audio: cues keyed by log entry type, synthesized in the browser for now
(MegaMechaTactics shipped no recorded cues and generating them spends the
owner's audio credits), plus the one existing music bed, at the existing mix
levels.

Gate: a scripted sequence (move, attack, kill, phase end) captured headless at
all three speeds and reviewed; the e2e game still completes at instant speed.

### M4. The six machines (one session on the owner's PC, plus review)

Per machine, in Hunyuan Studio (`../3D Model Generation`, port 7860). The GPU
work runs only on that PC, one job at a time.

1. Concept image: front three-quarter, full figure, plain background, from the
   brief in `docs/figures.md`. Gemini in the owner's Chrome with the
   figure-style reference attached, as `FIGURE-STYLE.md` prescribes, or Flux
   Studio locally. Measure the proportions before any 3D work.
2. Cutout, then Hunyuan3D 2.1 shape (Standard preset, 10k faces), then 2.0
   paint (1024 texture).
3. Finalize: scale to 1.1 units, no display base (the ground ring does its
   job), matte materials, written to `public/assets/models/<slug>.glb`.
4. Review by in-game screenshot at overview and close zoom. One re-roll per
   machine before changing the prompt.

The loader falls back to the M2 rig per machine, so a half-finished set still
plays. Budget: under 1.5 MB per GLB and 12 MB for all six.

Gate: six GLBs committed; frame time on the owner's phone under 20 ms at
Medium quality.

### M5. Dressing and theme (one session)

The D5 concept applied: environment around the board, lighting rig, the HUD
skinned to the palette in `docs/presentation.md`, title screen, briefing. Then
the side-by-side gate against Three Kingdoms Tactics and Murder Squad.

### M6. Verification and release (one session)

At least two full human games, hotseat and AI, on phone and desktop. The perf
meter checked on both. STATUS.md rewritten with what is and is not verified.
Pages deploy live.

### Deferred

Online play, a second scenario, more machines, redeployment bases on the
board, and back-porting the reconciled rules to the 2D game.

## 5. Figures

The machines follow `../Mallet-42k/docs/FIGURE-STYLE.md`, the approved house
style, read for machines rather than troopers. Every prompt, brief and review
uses measurements and materials only. That file's banned-word list applies
here without exception, and the M4 prompt tool refuses a prompt containing
one.

The look: a highly detailed hard-surface machine, like a premium painted
model kit. Crisp panel lines, exposed joints and hydraulics at knees and
elbows, vents, matte paint with edge highlights and light weathering. The head
is a sensor block or visor, never a face.

Proportions carried over from the reference:

- About 2.8 head-heights tall, the head block about a third of the height.
- Shoulders about 1.8 head-widths, heavily armoured.
- Deep chest; hips to feet about one head; wide planted stance, large feet.
- The two printed weapons oversized and readable at the overview.

Each machine keeps its name, livery and two weapons from
`assets/ART_PROMPTS.txt`, rewritten without that file's style words, so the
HUD card matches the figure on the board.

**Card portraits** — decided 2026-11-03: regenerate all twenty in the new
style. The six unit portraits are rendered from the finished GLBs, so they
match the board exactly. The fourteen Tactics illustrations are regenerated
from rewritten prompts that follow `FIGURE-STYLE.md`, with machines in
unpainted grey steel so none is mistaken for a roster unit. Both happen in
M5, after the M4 machines exist.

## 6. Rules reconciliation: findings

Checked on 2026-11-03 against the **official core rulebook, version 1.0,
dated 2026-08-28**, read in full, and then diffed word for word against the
**current issue, dated 2026-10-30** (its cover text extracts as "Version
11.", most likely 1.1). Its changes are listed under "Changed on 2026-10-30"
below and are already reflected in the
tables. Where the publisher's official Q&A
adds something the rulebook does not say, the Q&A number is given.
Everything here is mechanics only.

The headline: the reconstruction guessed well on dice, Timeline costs and the
attack sequence. But **four of the seven open questions resolve differently,
four house decisions are wrong, and the reconstruction missed deployment
entirely**: every unit starts the game off the board. Deployment, engagement,
objective control and line of sight each need engine code, not a config
change. M1 is therefore real engine work, sized at two to three sessions, and
it must land before M2 relies on the AI for its e2e game.

### Open questions, resolved

| # | Question | We have | Rulebook | Work |
| --- | --- | --- | --- | --- |
| 1 | Phases per game | 3 | **2 Phases of 10 rounds.** Longer games add 3 Tactics cards to the deck per extra Phase. | Config |
| 2 | Redeployment | scenario-gated | **Universal and mandatory.** Every deployment, first or after defeat, is from the side's Base hex or adjacent to its Carrier's middle hex. | Engine (see Deployment below) |
| 3 | LoS on a hex boundary | `permissive` | **The acting player chooses** which of the two hexes counts. | Equals `permissive` for an attacker; a new mode for other ranged effects |
| 4 | Unit damage reduction | none | **None.** Shields prevent 1 damage each, applied after every other reduction. A Shield deactivates when it prevents damage and reactivates at its holder's next activation. Crit effects still apply when Shields stop all the damage. | Confirmed |
| 5 | Objective VP | 1 | **Set by each scenario**, scored at the end of each Phase. The rulebook gives no value. The publisher's demo scenario uses 4 neutral Objectives, worth 5 VP in the centre and 8 VP on the flanks, with 1 Base and 7 Garrisons a side. | Config per scenario, then AI re-tune |
| 6 | Terrain catalogue | four kinds and a spare | Elevation; water; debris fields (same as water); impassable (Hover only, never end there); and an accuracy-only interference field (below). | Engine: new kinds, Hover |
| 7 | Tactics draw | 3 every Phase | 3 at the start, **3 more at the end of Phase 1**; an empty deck stops drawing. | Config; same result in a 2-Phase game |

Questions 1 and 5 together set the scoring economy, and they moved the way
that matters most. Two Phases with scenario objectives likely worth several
VP each makes holding ground worth as much as a kill. Every weight in
`evaluate.js` was tuned for a hunting game.

### Deployment: the rule the reconstruction missed

- Every unit **starts in Reserve**, off the board. Its first activation
  places it on its Base hex, or adjacent to its Carrier's middle hex, and it
  then acts at once.
- No unit may end a move on a Base, so a deployed unit must move at least one
  hex before its activation ends.
- If every deployment hex is blocked, the unit deploys onto one as if it were
  empty and must Advance off it at once. If it cannot, it spends 2 Timeline
  to Energize and stays in Reserve.
- A unit in Reserve cannot be attacked or gain statuses.
- On defeat: the opponent scores its VP; it returns to Reserve; its token
  moves 2 rounds forward; HP resets and statuses clear; Energy and Upgrades
  are kept. A unit defeated during its own activation ends that activation.
- Carriers: activated like units, multi-hex, never Engaged, cannot be Pushed
  or Pulled. A defeated Carrier is disabled in place. It still blocks
  movement and LoS and still deploys units, but loses its Timeline token and
  no longer contests Objectives.

This changes the opening of every game. The current scenario places all six
machines on the board at setup; it must instead place Bases.

### House decisions that are wrong

| Decision | We have | Rulebook |
| --- | --- | --- |
| Engagement | +1 cost to **enter** a hex next to an enemy | Engaged means adjacent to an enemy unit or Garrison **at the same elevation**. A move **started** while Engaged loses 1 hex. An Engaged unit's attacks **must include an Engaged enemy**; an area attack qualifies if it includes one. Carriers neither engage nor can be engaged. |
| Objective control | Recomputed every round, adjacency only, ties leave it uncontrolled | A unit contests when it **ends its own activation on or adjacent** to the Objective. More allies than enemies there wins; ties fail. Neutral becomes held; enemy-held becomes neutral; **control persists** after units leave. Moves outside a unit's own activation never contest. "Capture" effects take control at once. |
| LoS blockers | Enemies always block; terrain by the reconstruction's two cases | Allies never block. Blocked if the line crosses terrain **higher than both** units; or an enemy unit, Garrison or structure **at the same elevation as both**; or, when the two are at different elevations, terrain or an enemy **at the higher unit's elevation**. LoS is checked only at range 2 or more. Effects "within N hexes" ignore LoS; effects with a stated range need it. |
| Water | +1 to enter, accuracy penalty | **-1 hex to a move started in water.** -1 accuracy attacking into water, -1 attacking from it, -2 for both. |
| Upgrade pickup | Collected moving onto or through the hex | Collected only by **ending** a move in the hex, or (since 2026-10-30) by **deploying directly into** it. Energy tokens on the map work the same way. |
| `slow` | Consumed when the activation opens | Consumed by the **next Advance**, which moves 0 hexes. Dash and other moves are unaffected. |
| `disarm` | Suppresses crits while held | Applies to the **next attack only**: reroll every hit, no crit effects. It resolves after the attacker's after-roll abilities, then is removed. |
| Defensive Tactics lockout | Switchable, on | **Not in the rulebook.** Turn it off; keep the switch. |

### Changed on 2026-10-30

The 2026-10-30 issue changes five rules. Everything else in the diff is page
footers, cross-reference removals and typo fixes.

- **Partial resolution.** An ability or effect that cannot resolve in full
  resolves as much as it can. The effect system must apply each step it can
  and skip the rest, never abort the whole ability.
- **Deploying onto pickups.** A unit that deploys directly onto an Upgrade,
  Energy token or carried Objective collects it, as if it had ended a move
  there.
- **The Primary keyword.** A Tactics card marked Primary counts as the
  active unit's Primary Action for that activation. The engine treats such a
  card like an Attack card that replaces the Primary Attack.
- **Capture, defined.** Winning a contest on a neutral Objective is
  "capturing" it, and the control token marks that. Effects that capture
  outright skip the contest. This names the existing rule rather than
  changing it.
- **Activation, defined.** One activation runs from a unit's first action to
  its last, and the player "may use any actions available". That supports the
  any-order reading of a turn.

### House decisions confirmed

- **Timeline overflow wraps.** A token is counted to round 10, then on from
  round 1, so a cost of 4 from round 8 lands on round 2 and acts there next
  Phase. Spending more than 10 in one activation also carries into the next
  Phase.
- **Activation order.** Sides alternate within a shared round, the side that
  acted most recently going last. A roll-off happens only on the game's first
  activation. A token arriving on a round goes under the side's existing
  stack.
- **Abilities.** Command abilities once each per activation, never in the
  middle of another action. Abilities are used before an attack is declared.
- **Movement.** A move cannot end where it began or be split around another
  action. Units pass through allies, not enemies, and end on no other unit or
  structure. Elevation costs +1 per level climbed, and stepping down is free.
- **Garrisons.** One HP, 2 VP to destroy, 2 VP to Rescue for 2 Timeline when
  adjacent. They block movement and LoS and cause Engagement like units.
- **Combat.** Elevation is +1 accuracy shooting down and -1 shooting up.
  Natural 1 always misses; 9 and 10 always crit. Accuracy never makes a crit.
  A crit effect fires once per attack.
- **Statuses.** Fracture triggers at 3 or more combat damage, adds 3, and is
  then removed. A unit holds one of each status at most.
- **Energy** is uncapped.

### The invention is unreachable

Forced pass (`actions.forcedPassTlCost`) never fires, because Energize is
always legal once a unit is on the board. The blocked-deployment case is now
covered by the rulebook's own Energize fallback. Keep the config as a guard,
add a test that asserts it is never reached in self-play, and close it.

### Rules to add

Each becomes an M1 engine task, with tests even where no current unit uses
it:

- **Push and Pull.** They ignore terrain and Engagement costs. Each hex must
  move strictly away from, or toward, the source. They cannot raise a unit's
  elevation; that is a collision instead. A collision with terrain deals 2
  damage. A collision with another unit deals 2 to each party. Shields stop
  collision damage. An adjacent same-elevation enemy cannot be Pulled.
- **Jump.** A unit starting a move on elevated terrain keeps that elevation
  for the move. It passes over lower enemies and gaps and pays extra only to
  climb above its starting level.
- **Hover.** Ignores terrain and elevation penalties and may cross impassable
  hexes.
- **Interference field.** -2 accuracy on a non-adjacent attack when either
  the attacker or the target is inside it. The penalty does not stack.
- **The Timeline.** A 0-cost action is an additional action and does not use
  up the Primary Action. Effects keyed to a cost use the modified cost
  (Q&A 26). A token moved back down the track goes to the bottom of its
  stack, never below the current round (Q&A 2). Simultaneous pushes resolve
  in Timeline order (Q&A 22, 28).
- **Responses.** Any number per activation, once per separate trigger. Each
  unit hit by an area attack is a separate trigger. The acting player decides
  first, and the attacker's Responses resolve first in each attack window.
  The three windows are before the roll, after the roll and after damage.
- **Area attacks.** The attacker places the pattern, and every enemy in it
  and in LoS is hit. One roll covers all targets. Hits are counted per target
  using that target's terrain modifiers. Units and Garrisons are ignored for
  LoS.
- **Damage.** Combat damage is hits, crit damage and Fracture. Everything
  else is non-combat, collisions included. Repair cannot exceed max HP.
- **Tactics.** Three types: Attack, Command and Response. Attack cards
  replace the Primary Attack. A signature card is playable only by its named
  unit. A trait card needs a squad member with that trait. One copy of each
  card per deck.
- **Squads.** Squads are 3 or 5 per scenario. A unit card may repeat only if
  that unit is marked mass-produced.
- **Tie-break.** The last player to act wins.
- **Out of scope for the slice**, listed so nothing is forgotten: remote
  weapon tokens, Reinforcements, carried Objectives, Challenge, Swap,
  Reposition, Setup abilities and unit-specific components.

### Still unknown

- **The map's physical size.** The grid is measured (see D6), but neither
  rulebook nor play guide gives centimetres or hex size.
- **The starter scenarios' Objective VP.** Only the demo scenario's values
  are published. Our scenario sets its own, starting from the demo's 5 and 8.
- **Turn order.** The body lists Advance, Primary Action, Command and
  Tactics in that order without saying they may be reordered. The play guide
  says any order, and the 2026-10-30 glossary's new Activation entry leans the same
  way. Movement must finish before any other action, which the engine
  already enforces. Keep any-order.

## 7. Risks

- **The scoring economy.** Retail Phases and objective VP do differ from the
  guess (§6), so every AI weight is wrong. M1 re-tunes by self-play before M2
  relies on the AI for its e2e game.
- **Rulebook revisions.** §6 matches the 2026-10-30 issue. The
  publisher has re-issued twice in two months without change notes, so
  re-diff each new issue the same way.
- **Picking at close zoom.** The sibling notes a click between two figures can
  select the neighbour. Hit-capsules sized to the machine, with the ground
  ring as the main click target.
- **Hunyuan on hard-surface subjects.** Mecha tend to come back with fused
  joints and soft panel lines. The concept image is the lever; paint at 2048
  only if panel lines vanish; re-roll before re-prompting.
- **Licence.** Hunyuan3D is under Tencent's non-commercial community licence,
  which this project satisfies; NOTICE says so.
- **Phone performance.** Six machines and a few hundred instanced hexes are
  light, but water and post effects are where the sibling lost frames. Quality
  tiers from M2, measured in M4.

## 8. Open questions for the owner

None. All six decisions were settled on 2026-11-03.
