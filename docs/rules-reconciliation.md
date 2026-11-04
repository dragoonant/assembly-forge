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
   end a move on a Base, so this only arises after a Push or Pull onto one, which no content does.
2. *(Resolved 2026-11-03.)* Push and Pull are now the acting player's choice, hex by hex, with
   collisions and stopping early; see `src/engine/displace.js`.
3. **Automatic decks.** A pack's nine-card deck is built for each side (its squad's signature cards, then open cards
   in the pack's order) rather than chosen by the player.
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

## Deferred until content needs them (PLAN.md D10)

Carriers, remote weapon tokens, Reinforcements, carried Objectives, Challenge, Swap, Reposition,
Setup abilities, the Primary keyword on Tactics cards, and Timeline cost reductions to 0 becoming
additional actions.

## Balance after reconciliation

The rule changes moved the scoring economy, so the roster was re-tuned by self-play
(`node tools/ai-selfplay.js 96 pairs=all`, every team pairing from both seats):

| Team | Before | After |
| --- | --- | --- |
| t_lance | 21% | 47% |
| t_hammer | 58% | 50% |
| t_anvil | 83% | 53% |
| t_spear | 29% | 50% |

Changes: the zone controller (u06) went from 18 HP and 5 VP to 13 HP and 7 VP, with its mortar at
range 3 and strength 5. The glass cannon (u03) went from 9 HP and 9 VP to 11 and 7. The skirmisher
(u02) went from 11 HP and 7 VP to 12 and 6, and its melee strike costs 3 Timeline instead of 4. The
berserker (u05) dropped from 10 VP to 8, and the bruiser (u04) from 8 to 7.

Seats are even in mirror matches (23 to 25 over 48 games). Mixed games have run about 57% to side 0
across several runs with unpaired seeds; that is within noise for now and worth re-checking with
paired seeds.
