# Notice

**Assembly Forge is an original, unaffiliated, non-commercial work by evilgouki.**

It is not associated with, endorsed by, or licensed from Bandai Namco, Sunrise,
Sotsu, or any rights holder of the hex-based mecha skirmish miniatures game
whose rules system it implements, which reached retail in October 2026.

Assembly Forge is the 3D successor to MegaMechaTactics, by the same author,
and carries that project's rules engine and this notice forward.

## What this project reproduces, and why that is permissible

This project implements a **rules system** that matches a published miniatures
game: its Timeline scheduler and round structure, the mandatory-Primary-Action
turn, Timeline costs, movement and terrain costs, the dice-and-accuracy combat
maths, objective and garrison scoring, and numeric values such as costs, stat
lines and the size of the starter board's hex grid.

Game mechanics, systems, and rules are functional. They are methods of play,
not creative expression, and are not protected by copyright. A number such as a
weapon's Timeline cost, a unit's hit points or a board's hex count is a fact
about a system rather than authorship.

`docs/rules-reconstruction.md` and the rules section of `PLAN.md` record that
system the same way: mechanics only, no names, and no mapping from any
published name to any name used here.

## What this project deliberately does not contain

- **No trademarks.** No unit, pilot, faction, series, or product name from the
  source game appears in code, identifiers, comments, filenames, test
  fixtures, or documentation, beyond the rights-holder names in this notice.
  Every name in this project is invented for it.
- **No published artwork or models.** No illustration, rendering, photograph,
  logo, frame design or sculpt from any published product appears here. Every
  image and 3D model is generated for this project from prompts and briefs
  written for it, and depicts this project's own machines and terrain.
- **No published map layout.** The board uses the starter map's grid size so
  the game lines up with the physical set. The terrain, bases, garrisons and
  objectives placed on it are this project's own.
- **No published audio.** Any audio shipped here is generated for this project.
- **No card or ability text.** Abilities are stored as structured effect data,
  never as prose; the English a player reads is generated from that data at
  display time, so there is nowhere for published wording to live.
- **No layout or visual identity.** Nothing copies another product's card
  frame, board art, iconography, or logo. The interface is this project's own.
- **No fiction.** No setting, faction, character, or flavour text is carried
  over.
- **Nothing fetched at run time.** The game calls no external service and loads
  no remote asset.

## Renaming

Every name a player reads lives in one file, `src/content/names.js`. The engine
refers to everything only by internal id and never imports that file, so the
whole cast can be renamed by editing one place.

## Third-party tools and code

- 3D models are made with Tencent Hunyuan3D under the Tencent Hunyuan
  **non-commercial** community licence, which this non-commercial project
  satisfies.
- The camera model and map controller in `src/client/board/` are ported from
  Three Kingdoms Tactics, by the same author.

## Use

Free and non-commercial. If you fork it, keep this notice, keep it
non-commercial, and do not reintroduce any third party's names, art, or text.
