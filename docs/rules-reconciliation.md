# Rules reconciliation

Every rule the pre-retail reconstruction guessed at, checked against the publisher's core rulebook
(issue of 2026-10-30, diffed against 2026-08-28) and brought into line. This replaces the open list
in `open-rules.md`, which is kept only as history.

Mechanics only, as everywhere in this project: no names, no rulebook wording. Config paths are in
`src/engine/rules.js`; tests are in `tests/engine/`.

## Resolved open questions

| # | Rule | Now | Config path | Tests |
| --- | --- | --- | --- | --- |
| 1 | Game length | Two Phases of ten rounds | `match.phasesPerGame` | suite: phases |
| 2 | Redeployment | Universal: every unit deploys from Reserve onto its Base, at the start and after each defeat | `destruction.redeploy` | deploy-suite |
| 3 | LoS on a hex boundary | The acting player chooses, which is the permissive reading | `combat.losBoundary` | combat-suite: line of sight |
| 4 | Unit damage reduction | None; Shields only, one point each, refreshed on activation, stacking | `upgrades.shieldAbsorb` | movement-extras-suite |
| 5 | Objective VP | Per scenario; the skirmish sets 6 (centre) and 4 (flanks) | `scoring.objectiveControlVp` (fallback) | content-suite: scenario layout |
| 6 | Terrain catalogue | Open, water, debris, interference field, impassable; elevation per hex | `terrain` | suite: movement; combat-suite |
| 7 | Tactics draw | Three at the start, three at the end of every Phase but the last | `tactics.drawPerPhase` | suite |

## House decisions corrected

| Rule | Was | Now | Config path |
| --- | --- | --- | --- |
| Engagement | +1 to enter a hex next to an enemy | Same elevation only; a move started while Engaged loses a hex; an Engaged unit may only attack an enemy it is Engaged with | `movement.engagementPenalty`, `engagementSameElevation`, `engagedMustTargetEngaged` |
| Objective control | Recomputed each round, adjacency only | Contested at the end of a unit's own activation from on or next to it; captured, neutralised, persists | `scoring.objectiveControl` |
| Line of sight | Enemies and objectives always block | Terrain above both units blocks; across a height difference anything at the higher level blocks; on level ground enemies and enemy structures block; allies and objectives never | `combat.losBlockers` |
| Elevation accuracy | One pip per level | A flat +1 shooting down, -1 shooting up | `combat.elevationAccuracyFlat` |
| Water | +1 to enter; -1 attacking into it | No entry cost; a move started in it loses a hex; -1 into, -1 from, -2 both | `terrain.water` |
| Upgrade pickup | Moving onto or through | Ending a move on it, or deploying onto it | `state.pickups` |
| Slow | Consumed when the activation opens | The next Advance moves 0 hexes and spends it; Dash unaffected | — |
| Movement block | No movement once another action is taken | A move cannot be interrupted, but a unit may act, then move | `movement.oneBlock` (off) |
| "Move N" effects | A bonus to the Advance | An additional Move action, usable after the Advance | `effects.js` `move` |
| Crit statuses | Applied after damage | Applied in the crit step, before damage, so a crit Fracture counts at once | `attack.js` `crits` |
| Fracture and Shields | Shields, then Fracture | Fracture, then Shields (Shields come after every other effect) | `combat.js` `dealDamage` |
| Defeat VP | To whoever dealt the damage | To the defeated unit's opponent; an own Garrison scores nobody | `combat.js` |
| Disarm | While held | The next attack only | — |
| Fracture | Any damage | Combat damage only | — |
| Defensive Tactics lockout | On | Not in the rulebook; off | `tactics.lockoutAfterDefensivePlay` |
| Tie | Draw | The last player to act wins | `scoring.tieBreakLastToAct` |

## Confirmed unchanged

Timeline overflow wraps past round 10; sides alternate within a shared round; initiative is rolled
only for the first activation; Command abilities once each per activation; a move cannot end where
it began or be split; Garrisons block movement and LoS and cause Engagement; natural 1 misses and
9 to 10 crit regardless of accuracy; a crit effect fires once per attack; Fracture at 3 for +3;
Energy uncapped; Garrisons fall to any damage; Rescue and Garrison kills are 2 VP.

## Added

| Rule | Where | Tests |
| --- | --- | --- |
| Reserve and deployment from Bases; must move off the Base; Energize and wait if boxed in | `actions.js` `reserveActions`, `deployOptions`; `apply.js` `deploy` | deploy-suite |
| Defeat: back to Reserve, HP reset, statuses cleared, Energy and Upgrades kept; activation ends at once | `combat.js` `destroyUnit` | deploy-suite |
| No move ends on a Base; enemy Bases block movement and LoS | `movement.noEndOnBase`, `enemyBaseBlocks`; `los.js` | deploy-suite, combat-suite |
| Jump from elevated terrain | `movement.jump`; `actions.js` | suite: movement |
| Hover (trait) | `State.hasHover` | movement-extras-suite |
| Push and Pull with collisions (2 damage each, Shields stop it) | `effects.js` `displace`; `movement.collisionDamage` | movement-extras-suite |
| Map pickups: Upgrades and Energy | `apply.js` `collectPickup` | movement-extras-suite |
| Stacking Upgrades | `State.upgradeCount` | movement-extras-suite |
| The 203-hex starter grid | `State.createBoard` `shortRows` | suite: board shape |

## Simplifications (our choices, recorded so they can be revisited)

1. **An occupied Base is unavailable** rather than treated "as though it were empty". No unit may
   end any move on a Base, and a Push or Pull into one is a collision, so this cannot arise.
2. *(Resolved 2026-11-03.)* Push and Pull are now the acting player's choice, hex by hex, with
   collisions and stopping early; see `src/engine/displace.js`.
3. *(Resolved 2026-11-03.)* Players pick their own nine cards on the briefing screen; the AI side takes the
   suggested deck.
4. **The accuracy cap of plus or minus five** stays. No source has a cap; the natural 1, 9 and 10
   rules make it harmless.
5. **The forced pass** (`actions.forcedPassTlCost`) stays as a wedge guard. It never fires in play:
   Energize is always available, and the rulebook's own Energize fallback covers a boxed-in Base.

## Added for card mechanics (2026-11-03)

The attack is a resumable sequence in `src/engine/attack.js`, in the rulebook's order, with response windows before
the roll, after the roll (attacker, then Disarm, then defender) and after damage, plus a window when a unit would be
defeated. Also: area weapons aimed in six directions (one roll, hits per target, units ignored for line of sight, an
Engaged attacker must include an Engaged enemy); per-unit crit thresholds; crits that add damage per crit, grant a Move
or repeat the attack; weapon effects before the roll, after it and after damage; granted additional actions that can
chain; weapon-specific and conditional bonuses; Attack cards replacing the Primary Attack; one Tactics card per player
per activation. Tests: `tests/engine/mechanics-suite.js`.

## Audit of 2026-11-03

Every rulebook section and every card in the local pack was checked against the code. Fixed:

| Rule | Was | Now | Tests |
| --- | --- | --- | --- |
| Area patterns | Shapes misread from the card diagrams | 60-degree wedges, d + 1 hexes at each distance | mechanics-suite: card audit fixes |
| Triggered unit responses | Always the first target | The owner picks a target; responses marked `optional` can be declined | triggered unit responses |
| "A defender" response cards | Covered every defending unit | Cover the one unit the defender picks | card audit fixes |
| Chained grants | The follow-up waited on the first part | A first part with no options is skipped and the next part offered | card audit fixes |
| Would-be-defeated window | Attack damage only | Also ability damage (including a unit's own) | card audit fixes |
| Push or Pull into a Base | A plain move | A collision | rulebook audit fixes |
| Deployed unit on its Base | Advance or Dash only | Also Commands and non-attack cards before stepping off | deploy-suite |
| Jump | Blocked by a lower enemy Base | Passes over it, like a lower enemy | — |
| Reaction moves | Ignored pickups | Collect them | rulebook audit fixes |
| Disarm on an area attack | Judged against the first target | Rerolls a die that hits any target | — |
| [Range N] abilities | No line of sight | Need it (`los`); "within N hexes" still does not | rulebook audit fixes |
| Dash and Rescue | Timeline paid after resolving | Paid on declaring | — |
| Deck size | Always nine | Nine plus three per Phase beyond two | rulebook audit fixes |
| Squads | Repeats allowed | A unit appears once unless it is `mass-produced` | pack-suite |

Judgement calls kept as they are: Push off the board edge just stops; area patterns rotate but do not mirror;
"one Tactics card per activation" is per player; a crit's "after combat damage" effects fire even on an attack that
dealt none; when an Upgrade is destroyed it is the oldest; a card that captures "an Objective" near its target takes
the first in board order; collision damage does not open the would-be-defeated window.

## Deferred until content needs them (PLAN.md D10)

Carriers, remote weapon tokens, Reinforcements, carried Objectives, Challenge, Swap, Reposition,
Setup abilities, the Primary keyword on Tactics cards, and Timeline cost reductions to 0 becoming
additional actions.

## Balance after reconciliation

The rule changes moved the scoring economy, so the roster was re-tuned by self-play
(`node tools/ai-selfplay.js 96 pairs=all`, every team pairing from both seats):

| Team | Before | After | After the 2026-11-03 audit |
| --- | --- | --- | --- |
| t_lance | 21% | 47% | 58% |
| t_hammer | 58% | 50% | 56% |
| t_anvil | 83% | 53% | 44% |
| t_spear | 29% | 50% | 42% |

Changes: the zone controller (u06) went from 18 HP and 5 VP to 13 HP and 7 VP, with its mortar at
range 3 and strength 5. The glass cannon (u03) went from 9 HP and 9 VP to 11 and 7. The skirmisher
(u02) went from 11 HP and 7 VP to 12 and 6, and its melee strike costs 3 Timeline instead of 4. The
berserker (u05) dropped from 10 VP to 8, and the bruiser (u04) from 8 to 7.

Moving after attacking pushed t_hammer to 69%, so after the audit: the berserker (u05) went to 16 HP and 9 VP, the
bruiser (u04) to 13 HP, the skirmisher (u02) to 13 HP, and the glass cannon (u03) to 12 HP and 6 VP.

Seats are even in mirror matches (23 to 25 over 48 games). Mixed games have run about 57% to side 0
across several runs with unpaired seeds; that is within noise for now and worth re-checking with
paired seeds.
