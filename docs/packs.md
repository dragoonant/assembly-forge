# Content packs

A content pack swaps the roster without touching the engine: its own unit definitions, the names a player reads for
those units, their weapons and abilities, and the preset teams on squad select. The game always has the built-in cast
("Our names"); any other pack is optional.

## Where packs live, and why

Packs go in `src/content/packs/local/`, one `.js` file each. That folder is in `.gitignore`, so a pack there:

- is never committed or pushed,
- is never built by CI, so it can never reach the GitHub Pages site,
- exists only on the machine that holds it, for playing locally with `npm run dev`.

The public build therefore always ships only this project's own cast, which keeps `NOTICE.md` true.

When a local pack is present, squad select shows a **Roster** toggle: "Our names" or the pack. The choice is
remembered in the browser and switching reloads the page. With no pack present the toggle does not appear.

## Format

A pack file's default export is one object:

```js
export default {
  id: 'my-pack',            // anything except 'ours'
  label: 'My roster',       // shown on the toggle
  units: {                  // unit definitions, same shape as src/content/units.js
    m1: {
      defId: 'm1',
      hp: 14, vp: 6, tl: 2,
      traits: ['assault'],  // our trait vocabulary, used to gate Tactics cards
      standIn: 'u04',       // which built-in stand-in figure to borrow (u01 to u06)
      weapons: [
        { wid: 'm1a', tlCost: 2, range: 2, strength: 3, crit: { status: 'slow' } },
        { wid: 'm1b', tlCost: 3, range: 1, strength: 6, crit: { damage: 2 } }
      ],
      abilities: [
        { aid: 'm1c', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'strength', n: 2 }] }
      ]
    }
  },
  names: { m1: 'Unit name', m1a: 'Light weapon', m1b: 'Heavy weapon', m1c: 'Ability name' },
  roles: { m1: 'Bruiser' },
  teams: { team_a: { units: ['m1', 'm2', 'm3'] } },  // m2 and m3 defined like m1
  teamOrder: ['team_a'],
  teamNames: { team_a: 'Team A' },
  teamNotes: { team_a: 'One line about how it plays.' }
}
```

Rules the loader checks at startup (a broken pack is skipped with a console warning, never a crash):

- every team in `teamOrder` exists and uses only units the pack defines;
- every unit's key matches its `defId` and has a display name;
- no team repeats a unit unless that unit has the `mass-produced` trait.

Abilities are structured effect data, never prose, exactly as in the built-in cast: the player-facing text is generated
from the data. Effects the engine does not support yet are left out and listed in a comment in the pack file.

### Tactics cards

A pack may bring its own cards as `tactics: { cid: card }`, with `tacticsOrder` listing them. A card with
`requires: { defId }` is a signature card for that unit; the rest are open. Players pick nine cards, one copy each,
from what their squad may take; the suggested deck is the squad's signature cards, then open cards in `tacticsOrder`.
Without `tactics`, the built-in cards are used and the pack's units qualify for them through `traits`.

Card and ability fields worth knowing:

- `timing`: `command`, `response` (with `window` and `role`), or `attack` (with its own `weapon`).
- `pick: 'one'` on a defender's response: "a defender", so the player picks which unit it covers.
- `optional: true` on a unit's triggered response (`on: 'dash'` and so on): the card says "may", so it can be declined.
  A response with more than one possible target always asks for the target.
- `los: true` on a ranged ability, or on `strengthPerAlly`: the card says "[Range N]", which needs Line of Sight;
  "within N hexes" does not.

## Testing

`tests/engine/pack-suite.js` registers an invented test pack, plays a full AI game on it, and checks that switching back
restores the built-in cast exactly. It never depends on a local pack.
