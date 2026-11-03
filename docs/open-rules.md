> **Closed 2026-11-03.** Every row below was checked against the publisher's core rulebook (2026-10-30)
> and resolved; see `rules-reconciliation.md` for the outcome. This file is kept as the record of what
> was guessed before retail.

# Open rules, house decisions, and one invention

Everything in this game that is **ours rather than the publisher's**.

The source game reaches retail in October 2026. Until the printed rulebook
exists, some of what this project implements is a reading rather than a rule.
This file is the complete list, so that verifying the game against the rulebook
is an afternoon with a checklist rather than an archaeology exercise.

**How to use this in October.** Work down the tables. For each row, find the
rule in the printed book, compare it against *Our reading*, and where they
differ change the value at *Config path* in `src/engine/rules.js`. Almost
nothing here requires touching engine code — that is the entire point of
routing every one of these through a named config value. Then delete the row,
or move it to a "confirmed" section, so the list only ever shrinks.

Three tiers, in descending order of how likely we are to be wrong:

1. **Open questions** — the sources describe the mechanic but leave a specific
   value or behaviour unstated. Seven of these.
2. **House decisions** — the sources say something, but not precisely enough to
   implement without choosing. Sixteen of these.
3. **Inventions** — nothing in any source covers it and the engine could not
   function without an answer. One of these, and it is the one to check first.

Two machine-readable lists in `src/engine/rules.js`, `OPEN_QUESTIONS` and
`HOUSE_DECISIONS`, mirror tiers 1 and 2. A test walks them and fails if any
entry stops resolving to a real config path, which is what stops this document
and the code drifting apart.

---

## 1. Open questions

The seven from section 9 of `docs/rules-reconstruction.md`. Each is a gap the
sources leave rather than a reading we chose.

| # | Question | Config path | Our reading |
| --- | --- | --- | --- |
| 1 | How many Phases does a game last? | `match.phasesPerGame` | Three; scenarios override |
| 2 | Is redeployment universal or scenario-gated? | `destruction.redeploy` | `'scenario'` — only where a base exists |
| 3 | Line of sight along an exact hex boundary | `combat.losBoundary` | `'permissive'` — blocked only if both flanking hexes block |
| 4 | Any unit-level damage reduction? | `combat.unitDamageReduction` | `false` — damage equals hits |
| 5 | VP for controlling an objective | `scoring.objectiveControlVp` | 1 |
| 6 | The full terrain catalogue | `terrain` | Four kinds, plus a spare |
| 7 | Tactics draw: every Phase, or only after the first? | `tactics.drawPerPhase` | Three, every Phase |

### The two that matter most

**#1 and #5 together set the entire scoring economy.** Three Phases at 1 VP
means objectives contribute at most 3 points across a whole game, against 5–10
for a single kill — so the game we have rewards hunting over holding. If the
real numbers are five Phases at 5 VP, objectives stop being a side activity and
become the point of the game, and every weight in `src/ai/evaluate.js` is tuned
for the wrong sport. **Check this pair first.**

**#4 is quietly load-bearing.** The publisher's play guide describes no
damage reduction at all. One reviewer mentions a fixed "shield value", but that
appears to describe the Shield Upgrade token rather than a unit stat. If a
unit-level soak does exist, every weapon in the roster is over-tuned —
strength 8 into no reduction is a completely different weapon from strength 8
into a flat −2.

**#3 is the one the sources openly cannot answer.** The community wiki states
outright that it is unclear how to resolve a line running exactly between two
hexes. All three readings — `permissive`, `strict`, `nudge` — are implemented
and tested, so this is a one-word change.

**#2 and #7 are the least consequential.** Redeployment never fires in the
current scenario because no bases are placed, and the draw rule only shifts
hand size by three across a game.

---

## 2. House decisions

The sources say something here, but not precisely enough. Each of these is a
choice, and each could be wrong.

### Timeline and activation

| Decision | Config path | Why this reading |
| --- | --- | --- |
| A token pushed past round 10 **wraps** into the next Phase (round 12 → round 2) rather than resetting to 1 | `timeline.overflow` | Preserves the difference between a 2-cost and a 4-cost overrun. Resetting would make an expensive action free at the end of a Phase. |
| Sides alternate for the **whole round**, not only its first activation | `timeline.alternateWithinRound` | The narrow reading makes the rule meaningless after one unit has acted. |
| Initiative is rolled **only** when both sides hold a token on the first active round | — | Rolling unconditionally would burn a random number and shift every downstream roll, breaking replay compatibility for no benefit. |
| A Command ability may be used **once per activation**, each | — | "Once per turn" in the glossary, applied per ability rather than per unit. |

### Movement

| Decision | Config path | Why this reading |
| --- | --- | --- |
| Engagement is a **penalty** of one hex, not a discount | `movement.engagementCost` | The wiki says "reduces your movement by 1 hex". A discount would make closing with the enemy cheaper than walking in the open, inverting the whole zone-of-control idea. |
| An enemy **Garrison blocks movement** like an enemy unit, and projects engagement | `movement.enemyGarrisonBlocks`, `movement.engagementFromEnemyGarrison` | The sources are silent. Treating it as terrain-with-a-side is the reading consistent with it being attackable. |
| A movement action **may not finish where it began** | `movement.noEndOnStartHex` | Stated on the wiki, not in the play guide. Applied per movement *action*, so an Advance and a Dash each have their own start hex. |
| `slow` is consumed when the activation **opens**, not when movement is attempted | — | Otherwise a slowed unit could stand still to save the status for a turn it cared about, which is not what "prevents your next Advance" means. |

### Combat

| Decision | Config path | Why this reading |
| --- | --- | --- |
| Friendly units **do not** block line of sight; enemy units, garrisons and objectives do | `combat.losBlockers` | The sources name "any **enemy** unit, base, objective or unit token". The asymmetry is theirs, but it reads like a bug, so it is called out here. |
| Elevation shifts accuracy by **one pip per level**, favouring the higher shooter | `combat.elevationAccuracyPerLevel` | The glossary says elevation "affects accuracy based on level differences" and gives no number. One is the smallest reading that honours the sentence. |
| Accuracy modifiers are **capped at ±5** | `combat.maxAccuracyShift` | Invented guard rail. No source suggests a cap; without one, stacking modifiers could make a die face meaningless. |
| A critical's **extra dice resolve before** damage; the flat bonus and status apply after | — | Ordering is unstated. This ordering lets extra dice contribute hits, which is the only reading where "roll 2 additional dice" does anything. |
| The Shield upgrade's charge **refreshes when its holder activates** | `upgrades.shieldAbsorb` | The glossary says "per unit activation" without saying when it comes back. |
| `disarm` **rerolls every hit and keeps the new face**, and suppresses crits | — | The glossary says "forcing reroll of all hit dice". Keeping the worse reading makes it a genuine cost rather than a free re-draw. |
| `fracture` fires at **3 damage** and adds **3** | `statuses.fractureThreshold`, `statuses.fractureBonus` | Taken from the glossary directly; listed because the glossary is community-written, not the publisher. |
| Energy has **no cap** | `actions.maxEnergy` | No source mentions one. |

### Scoring

| Decision | Config path | Why this reading |
| --- | --- | --- |
| An objective tie leaves it **uncontrolled**, rather than leaving the previous holder in place | — | "More allied units than enemy units" is a strict majority; nothing suggests control persists. |
| Objective control is **adjacency, not occupancy** — standing on a marker does not take it | — | The play guide says "surrounding". Worth stating because it surprises every new player. |

### Tactics cards

| Decision | Config path | Why this reading |
| --- | --- | --- |
| A defensive card locks the player out of their **next activation** | `tactics.lockoutAfterDefensivePlay` | Modelled per player rather than per unit, since "previous turn" is unqualified. Currently unreachable: every card in the pool is command-timed. |
| `buildDeck` pads with **duplicates** if a squad qualifies for fewer than nine distinct cards | — | Normally one copy per deck. The six-unit roster never triggers this; a smaller scenario squad could. |

---

## 3. Inventions

One rule appears in **no source at all**. It exists because the engine cannot
function without an answer, not because anything suggested it.

### Forced pass

**`actions.forcedPassTlCost`, default 2.**

A unit with no available Primary Action — boxed in, nothing in range, nothing
to rescue — may end its activation anyway, and its Timeline token is pushed 2
rounds regardless.

**Why it had to exist.** Exactly one Primary Action per activation is
*mandatory*, and taking one is what pushes the unit's token off the current
round. A unit that cannot take any Primary therefore never moves its token, the
round never empties, and the Timeline sits on that unit for ever. The game
deadlocks with no legal action available to break it.

**How likely we are wrong.** The real rulebook almost certainly addresses this,
and may do so differently — perhaps the unit is skipped entirely, or the push is
a different size, or some Primary is always available in a way the reconstruction
missed. **Check this one first in October.**

**Containment.** It cannot fire under the default configuration; self-play over
30 games reports zero forced passes. If it ever starts firing, something else is
wrong.

### A near-invention worth listing beside it

**Destroyed units' tokens are removed from the Timeline** unless redeployment
can bring the unit back.

The rule as written says a destroyed unit's token "is immediately moved two
spaces forward", which reads as though the token stays on the track. If it does,
the scheduler eventually opens an activation for a unit that no longer exists,
`legalActions` returns nothing, and the game wedges — the same deadlock as
above by a different route. Removing the token keeps the invariant that every
token belongs to a living unit.

This is a reading of a real rule rather than an invention, but it is the reading
that makes the rule *work*, which is not the same as the reading that is
*correct*. If the rulebook confirms tokens persist, then redeployment must be
universal and `destruction.redeploy` should become `'always'`.

---

## Also unverified, but not rules

Not decisions, just things nobody has checked:

- Every rule tagged ⚠️ in `docs/rules-reconstruction.md` comes from the
  community wiki rather than the publisher, and should be re-read against the
  printed book even where this document does not list it.
- The **stat lines** in `src/content/units.js` are ours, built to the observed
  ranges (hp 9–18, vp 5–10, Timeline 1–3, strength 2–8, range 1–5). They are not
  the published units' numbers and are not trying to be.
- The **abilities and Tactics cards** are entirely this project's design. Only
  their *shape* — three timings, Energy costs, nine-card decks — comes from the
  sources.
