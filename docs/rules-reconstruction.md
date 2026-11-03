# Rules reconstruction

The mechanical system this project implements, reconstructed from public sources
before any engine code was written.

**Scope of this document.** It records *mechanics only* — turn structure, costs,
combat maths, numeric stat lines. Those are methods of play and facts about a
system, not creative expression. It deliberately contains **no unit, pilot,
faction, series or product names from the source game**, and no mapping from
source names to this project's names exists anywhere in this repository, by
design. See `NOTICE.md`.

Internal ids are given in `code font`. Every human-readable label is a display
string and belongs in `src/content/names.js` — including the names of actions,
statuses and keywords. Nothing below should be treated as final display text.

**Confidence.** Rules marked ✅ come from the publisher's own play guide. Rules
marked ⚠️ come from the community wiki only and should be re-verified against
the printed rulebook at retail release. Rules marked ❓ are unresolved.

---

## 1. Match structure

| Concept | Rule | Conf |
| --- | --- | --- |
| Board | Hex grid. One unit per hex, maximum. | ✅ |
| `phase` | A full pass down the Timeline: 10 `round`s. | ✅ |
| Game length | A scenario-specified number of Phases. Exact count per scenario unknown. | ❓ |
| Winner | Most VP at the end of the final Phase, for most scenarios. | ✅ |
| Squad size | Scenario-specified. Starter format is 3v3; larger sets go to 5v5. | ✅ |

At the end of a Phase, scoring triggers (see §6). If Phases remain, the round
tracker returns to round 1 and the next Phase begins. ⚠️

---

## 2. The Timeline

The spine of the game. This is what makes it not an ordinary alternating-activation
tactics game, and the engine should be built around it rather than around a
conventional turn loop.

- The track is **10 rounds**, with a red side and a blue side. Each player has
  their own side; a VP tracker sits at each end. ⚠️
- At setup, each unit's token is placed on the round equal to the **starting
  Timeline value (`tl`)** printed on its card. ✅
- The round tracker starts on the **lowest-numbered round holding any token**,
  and advances only once every unit in that round has taken its turn. ✅
- **Rounds holding no tokens are skipped.** ✅
- Only **Primary Actions cost Timeline.** Advancing, Command abilities and
  Tactics cards are free. ✅

### Stacking and activation order

This is the fiddliest part of the system and the most likely source of subtle
engine bugs.

- Multiple tokens may occupy one round; they form a **stack**. ✅
- Activation within a round runs **top of stack downward**. ✅
- Players may choose their stack order **only at initial setup**. ✅
- A token moved onto a round during play is added to the **bottom** of any
  existing stack there. ✅
- When both players hold tokens on the current round, activation begins with the
  **opponent of whoever acted last**. ✅
- At game start, if both players have a token on the first active round, roll one
  attack die; higher roll activates first. ✅
- A token pushed **past round 10** does not activate again until the next Phase. ⚠️

### Destruction and redeployment

A destroyed unit is removed from the board and its token immediately moves
**2 rounds forward**. ✅ The wiki adds that it may then **redeploy at an allied
base** when its round is reached. ⚠️ Whether redeployment is universal or
scenario-gated is unresolved. ❓

---

## 3. A unit's turn

On activation a unit may take each of these **once, in any order**, except that
exactly one Primary Action is **mandatory**: ✅

| Slot | Action | Cost |
| --- | --- | --- |
| A | `advance` — move up to 3 hexes | free |
| B | **Primary Action** — exactly one of the four below | see below |
| C | Use Command abilities | free |
| D | Play one Tactics card | free |

### Primary Actions

| Id | Effect | TL cost |
| --- | --- | --- |
| `attack` | Choose a weapon, target in range, roll dice | per weapon (2–4 observed) |
| `dash` | Move 2 additional hexes, before or after Advancing | 2 |
| `energize` | Gain 1 Energy token | 2 |
| `rescue` | Claim an adjacent friendly Garrison | 2 |

### Movement

- `advance` is up to **3 hexes**, any direction, hex to hex. ✅
- A unit **may not end its Advance on the hex it started on**. ⚠️
- Movement is taken **as one block** — a unit cannot split it around another
  action, and once it stops and acts it cannot resume. ✅
- A unit may **move through** friendly units and Garrisons but **not end** on
  them. ✅
- A unit **cannot pass through enemy units** and must detour. ✅
- **Elevation** costs 1 extra movement per level ascended. ⚠️
- **Water** costs 1 extra hex and penalises attack accuracy. ⚠️
- **Engagement:** entering a hex adjacent to an enemy unit or Garrison costs
  **−1 hex** of movement. ⚠️

---

## 4. Combat

### Sequence ✅

1. Choose a weapon and a valid target within its `range`. Facing is irrelevant.
2. Check line of sight.
3. Advance the attacker's Timeline token by the weapon's TL cost.
4. Roll a number of **d10** equal to the weapon's `strength`.
5. Each die **≥ accuracy** is a hit; damage equals the number of hits.
6. Apply damage. At 0 HP the target is destroyed.

### Dice

| Result | Meaning | Conf |
| --- | --- | --- |
| ≥ 4 (default accuracy) | Hit, +1 damage | ✅ |
| natural 1 | Miss, **regardless of modifiers** | ⚠️ |
| natural 9–10 | Hit **and** critical, **regardless of modifiers** | ⚠️ |

- **Accuracy** is the minimum roll to hit, **4 by default**, shifted by modifiers. ⚠️
- Modifiers are **cumulative and applied to the die face**, not to a target
  number. A `+1` improves each die by one pip. ⚠️
- A weapon's **critical effect triggers once per attack** no matter how many
  crits are rolled — though some effects explicitly scale with the crit count. ⚠️

Note the two independent axes: `strength` changes *how many* dice, accuracy
modifiers change *what each die needs*. Abilities exist for both. Keep them
separate in the state model.

### Line of sight ⚠️

Traced from **hex centre to hex centre**, and only checked at range 2+. Blocked by:

- a hex of **higher elevation than the attacker**, passed before the target;
- when the attacker is higher than the target, a hex **matching the attacker's
  elevation**, passed first;
- any **enemy unit, base, objective or token** other than the target itself.

**Unresolved:** the wiki states it is unclear how to resolve a line passing
exactly between two hexes. ❓ The engine must pick a deterministic rule and mark
it as a house decision.

### Defence

The publisher's play guide describes **no shield or damage-reduction step** —
damage equals hits. ✅ One reviewer described a flat "shield value", which
appears to describe a **Shield Upgrade** token (absorbs 1 damage per unit
activation ⚠️) rather than a unit stat. Treat unit-level damage reduction as
**not a rule** unless the printed rulebook contradicts it. ❓

---

## 5. Unit cards

Fields: `hp`, `vp`, `tl` (starting Timeline), name, traits, weapons, abilities,
card number. ✅

Each weapon carries: `tlCost`, `range`, `strength`, an optional always-on
`effect`, and a `critical` effect. ✅

### Observed value ranges

From six published starter-set cards. Useful as balance guardrails for our own
roster; the engine should not hard-code them.

| Stat | Range |
| --- | --- |
| `hp` | 9 – 17 |
| `vp` | 3 – 10 |
| `tl` (start) | 1 – 3 |
| weapon `tlCost` | 2 – 4 |
| weapon `range` | 1 – 4 |
| weapon `strength` | 2 – 8 |

The shape is consistent: each unit carries a **cheap short-ranged weapon**
(TL 2, strength 2–4) and an **expensive heavy weapon** (TL 3–4, strength 6–8).
Cost and strength track each other closely. Higher `vp` marks the more dangerous
unit — it is a self-balancing bounty.

### Ability timings ✅

| Type | When |
| --- | --- |
| `command` | Any time during this unit's activation, if conditions are met |
| `ongoing` | Continuously, while conditions are met |
| `response` | Any time conditions are met, activated or not |

Abilities are **once per turn**, except `ongoing`. ⚠️ Some `command` abilities
additionally cost **Energy**.

### Observed effect vocabulary

The engine's effect system needs at least these primitives, all seen on real
cards. This list is the argument for abilities-as-data:

`move N` · `+N strength` · `+N accuracy` · `deal N damage` · `+N damage on crit` ·
`push N` · `pull N` · `extra attack at TL0` · `repeat this attack at TL0` ·
`gain N energy` · `apply status` · `destroy/deactivate an upgrade` ·
`cone-shaped attack` · `ignore line of sight` · `ignore terrain penalties` ·
`ignore engagement` · `treat 7–8 as crits` · conditionals on damage taken,
objectives controlled, garrisons rescued, upgrades held, and allies in range.

Note `cone-shaped attack` and `ignore line of sight` — both are geometry
modifiers, so targeting must be a pluggable function of the weapon, not a fixed
range check.

---

## 6. Scoring

| Source | VP | Conf |
| --- | --- | --- |
| Destroy an enemy unit | that unit's printed `vp` | ✅ |
| Rescue a friendly Garrison | 2 | ⚠️ |
| Destroy an enemy Garrison | 2 | ⚠️ |
| Control an Objective | scenario-specified | ✅ |
| Scenario objectives | scenario-specified | ✅ |
| Some Tactics cards | card-specified | ✅ |

- **Objectives** are controlled by having **more adjacent allied units than
  enemy units**, evaluated **at the end of each round**; the controller at the
  **end of a Phase** scores. ✅ Note the two different clocks — control is
  tracked per round, but banked per Phase.
- **Garrisons** are destroyed by dealing **1 or more damage** — HP is
  irrelevant. ✅

---

## 7. Tactics cards

- Each player builds a deck of exactly **9 cards**, shuffles it blind, and draws
  **3** for an opening hand. ✅
- At the **end of the first Phase**, draw **3 more**. ✅ The wiki generalises
  this to 3 per Phase. ⚠️
- **One card per unit turn.** ⚠️
- If a card was played defensively against an opponent's attack on the previous
  turn, **no card may be played this turn**. ⚠️
- Deckbuilding: a card may be included only if **at least one unit in the squad
  meets its requirement** (faction, or a specific named unit). Normally one copy
  per deck. ✅

Observed card shapes: a **Response** with a timing tag (`[Before attack roll]`,
`[After combat damage]`) and an effect; and an **Attack** card, which is a
full weapon line (TL cost, range, strength, critical) usable by a qualifying unit.

---

## 8. Statuses and upgrades ⚠️

Statuses are tokens on the unit card. Multiple different statuses may be held;
duplicates of the same status may not.

| Id | Effect |
| --- | --- |
| `slow` | Prevents the unit's next Advance |
| `fracture` | The next time the unit takes 3+ damage, add 3 damage |
| `disarm` | Prevents critical effects and forces a reroll of all hit dice |

Upgrades are board pickups collected by moving onto or through their hex:

| Id | Effect |
| --- | --- |
| `shield` | Absorbs 1 damage per unit activation |
| `speed` | +1 hex on Advance |
| `strength` | +1 strength on attacks |

Upgrade effects reportedly persist for the rest of the game. ⚠️

---

## 9. Open questions for the printed rulebook

These seven are the gaps the sources leave. They are not the whole of what this
project has guessed — see **`docs/open-rules.md`** for the complete list, which
also covers the sixteen house decisions where the sources say something but not
precisely enough, and the one rule invented from nothing. That file is the
checklist to work down when the rulebook lands.

1. How many Phases does a game last, and is it always scenario-specified? ❓
2. Is redeployment at an allied base universal, or scenario-gated? ❓
3. Line of sight along an exact hex boundary — needs a deterministic house rule. ❓
4. Is there any unit-level damage reduction at all, or only the Shield Upgrade? ❓
5. Exact VP for objective control, per scenario. ❓
6. Full terrain catalogue and each type's movement and accuracy effect. ❓
7. Whether Tactics draw is 3 per Phase or only after the first. ❓

---

## Sources

Publisher play guide (authoritative), community wiki (rules pages, glossary,
unit and card pages), and a published rules review. Retrieved 2026-08-16, ahead
of the game's October 2026 retail release — which is why the printed rulebook
has not been consulted and why the ⚠️ and ❓ marks above exist.
