# Figures: the six machines (M4 brief)

**Status, 2026-11-04: second pass.** The owner rejected the first concept set (2026-11-03, `art/concepts/contact-v1.jpg`,
local only). The machines read as heavy miniature-wargame armour: rounded bulk, dome heads, short legs, weathered matte
paint. This brief replaces it with the proportions and finish of premium assembled mecha model kits, measured on the
owner's reference photo (`art/refs/kit-proportions-owner-ref.png`, git-ignored, never committed or attached to a prompt).
Every design stays this project's own.

**All six second-pass concepts exist** (2026-11-04): `art/concepts/v2-u01.jpg` to `v2-u06.jpg` at 2752 by 1536, and the
sheet `art/concepts/contact-v2.jpg`, all local only. They wait on the owner's review before any 3D work.

M4 is done together: the owner reviews the concept images before any 3D work, and the GPU stages run on the owner's PC.

Every prompt, edit request and review uses measurements and materials only. The banned-word list in the owner's
instructions (also in Mallet 42k `docs/FIGURE-STYLE.md`) applies to everything in this document and every prompt made
from it. For this project, the proportions below replace that file's 2.8-head trooper proportions (owner, 2026-11-04).

## The look

A highly detailed original fighting machine as a premium assembled plastic model kit, factory fresh. The shapes are
angular and tapered: chevrons, blade edges, fins, layered armour plates over a visible grey inner frame at the joints.
Crisp recessed panel lines, satin painted plastic in solid saturated colours, clear coloured lens parts. No weathering,
rust, rivets or battle damage. Large equipment on the back (thrusters, fins, binders, a shield) carries a lot of the
silhouette. The head is a compact sensor housing with a visor or lenses, never a face.

What changed from the first pass, and why:

| | First pass (rejected) | Second pass |
| --- | --- | --- |
| Height | 2.8 head-heights | About 3.7 head-heights |
| Head | A third of the height, a rounded dome | A quarter of the height, compact and angular, with a crest |
| Legs | About one head, short and thick | About 1.5 heads, long flared shins, big pointed feet |
| Body | Rounded bulk, barrel chest | High compact chest, narrow waist, skirt plates |
| Back | Little or nothing | A large back unit that shapes the silhouette |
| Finish | Matte, weathered, riveted | Clean satin plastic, crisp panel lines |
| Stance | Planted, static | A ready stance, feet wide, weapon raised |

## Proportions (measured on the reference)

| Part | Measure |
| --- | --- |
| Height | About 3.7 head-heights from the top of the helmet to the soles (3.5 to 4); a crest may add up to half a head |
| Head | About a quarter of the height (25 to 28%), a little taller than it is wide, about half the shoulder span wide |
| Shoulders | Angular armour blocks, the span about twice the head's width |
| Arms | Slim, with the grey inner frame visible at the elbows and wrists; hands about a third of a head |
| Chest | High and compact, with intakes and a raised collar; chin to waist about one head |
| Waist and hips | Narrow waist; front and side skirt armour plates |
| Legs | Hips to soles about 1.5 heads (about 40% of the height); short thighs, long shins that flare at the bottom |
| Feet | Large, pointed and armoured, each about 0.9 of a head long, with a heel spur |
| Back | One large back unit extending above and behind the shoulders |
| Weapons | The main weapon about as long as the machine is tall; the second one clearly smaller |
| Footprint | The widest point (back unit, shield or weapon) no more than about 85% of the height, so it fits its hex |

In the game a machine stands 1.1 world units tall on a hex 1 unit across the flats (PLAN.md D3), so the footprint rule keeps
every machine inside its own hex. Thin parts (crest blades, fins, antennas) need to be at least about a tenth of the
head's width thick, or the 3D stage loses them.

## Recipe

Gemini in the owner's Chrome, one chat for all six. **The owner's reference photo is never attached.** It shows real
products, and an attached photo pulls the model towards their heads and crests. The words carry the proportions instead.

1. **Pilot.** Generate one machine from the template below with no image attached. Measure it, then the owner approves
   it or a re-roll. The approved u02 pilot (2026-11-04) is `art/concepts/v2-u02.jpg`; the attached copy is
   `v2-u02-ref.jpg`, cut to 1024 px wide.
2. **The rest.** Attach the approved pilot to each later request, in the same chat, and add "same proportions, finish
   and level of detail as the attached machine, but a different machine:" before the filled template.

**Give proportions as comparisons, not head counts.** The first pilot (2026-11-04) asked for "3.7 head-heights" and came
back at about 6.5, a full-height kit, and a corrective edit in the same chat barely moved it. A fresh chat that states how
the parts compare (shoulder span against height, head against chest and waist) landed at about 3.7 on the first try. Start
each pilot in a fresh chat, and do not fix proportions by editing in place.

> Create an image. A highly detailed original combat machine as a premium compact-scale assembled plastic model kit with
> deliberately compressed, heroic proportions, factory fresh, no weathering. The overall figure is short and broad: its
> shoulder span is about half of its total height. The head is large: the head alone is about as tall as the chest and
> waist together, and about a quarter of the whole figure's height. The legs are short: from the hips to the soles is only
> about one and a half times the head's height, with long flared shins over big pointed armoured feet, each foot about as
> long as the head. The arms are slim with a grey inner frame visible at the elbows and wrists, and the hands are about a
> third of the head's height. Livery: **[LIVERY]**. Head: **[HEAD AND CREST]**, no human face. A high compact chest with
> intakes and a raised collar, a narrow waist, front and side skirt armour plates, angular shoulder armour blocks. On the
> back, **[BACK UNIT]**. **[WEAPON 1]**, and **[WEAPON 2]**, about as long as the figure is tall. Sharp tapered edges,
> chevron and blade shapes, layered armour plates, crisp recessed panel lines, satin painted plastic, clear lens parts. A
> ready stance with the feet wide apart, front three-quarter view, standing on a plain low black round base, plain white
> background, the full figure and base in view, no text, no logos or emblems.

The plain round base and white background are for the 3D stage: the shape stage cuts the base off, and the game draws its
own ground ring instead.

## The six briefs

Names are this project's own (`src/content/names.js`); the briefs never use them in a prompt, only the descriptions. The
heads are kept deliberately unlike any well-known kit line: no forehead V crest, no paired human-shaped eyes over a
faceplate.

| Id | Role | Livery | Head and crest | Back unit | Weapon 1 | Weapon 2 (the big one) |
| --- | --- | --- | --- | --- | --- | --- |
| u01 | Objective runner | Safety orange and slate grey, black and yellow hazard chevrons on the shins | A searchlight bar across the brow over a single wide visor slit, and one short stub antenna on the left | A winch drum between two compact boxy thruster pods | A forearm rivet gun | A long shoulder-mounted grapple harpoon launcher with a coiled line |
| u02 | Skirmisher | Pale teal and bone white, grey frame | One round sensor lens in a narrow wedge-shaped housing, a single blade crest swept straight back | Two long narrow thruster fins angled back and up like a swept wing | A wrist dart pod | A two-handed beam glaive with a long pale energy blade |
| u03 | Glass cannon | Pale gold and white, thin magenta light lines along the armour seams | A tall visor housing with a magenta slit, two short upright antenna prongs | A fanned ring of radiator vanes behind the shoulders, like a halo | A small chest-mounted scatter emitter | A long beam cannon carried on the right side, reaching past the head |
| u04 | Debuff bruiser | Deep crimson and black, green vapour leaking from the waist vents | A cowled armour hood over three green eye slits in a row | Two tall exhaust stacks trailing green vapour | A barbed wrist hook | A two-handed barbed lance |
| u05 | Berserker | Gunmetal and rust red, ember-orange inner frame glowing through gaps in the armour, deliberately asymmetric | A blunt jaw-shaped housing with no visible lens and one heavy horn swept forward | A cluster of three angled thruster cones | A scrap-built pistol | An oversized wrecking claw that replaces the right forearm |
| u06 | Zone controller | Deep blue and bronze | A smooth bronze crown plate with a thin dark visor band, two flat side fins | A heavy backpack under the mortar | A hip-mounted pepperbox gun | A shoulder suppression mortar, plus a tall rectangular shield wall on the left arm (armour, not a weapon) |

u05 keeps its salvage character through colour and asymmetry instead of rust and damage, so it still matches the clean
finish of the other five.

**Weapons are the game's.** Each machine shows exactly the two weapons on its card (`src/content/units.js`), so a player
can read what a machine does from the figure.

**Side identity is the game's job, not the paint's.** Both sides can field the same machine. The game marks the side with
the ground ring and tints the shoulders, so the liveries stay as above for both.

## Second-pass results (measured 2026-11-04)

Each machine took one try, attached to the pilot, in the pilot's chat.

| Id | Head share | Two weapons right | Notes |
| --- | --- | --- | --- |
| u01 | About 26% | Yes | Harpoon on the right shoulder, rivet gun on the left forearm |
| u02 | About 26% | Yes | The pilot; the glaive is held in one hand, not two |
| u03 | About 25% | Cannon yes; the chest scatter emitter is hard to see | The halo ring reads well |
| u04 | About 26% | Yes | Hood, three green slits, vapour from the waist and stacks |
| u05 | About 27% | Yes | Claw replaces the right forearm; pistol in the left hand |
| u06 | About 25% | Yes | Mortar, shield wall and a hip gun on the right side |

**Footprint.** The bodies and back units fit, but the long held weapons (u01's harpoon, u02's glaive, u04's lance) made
those three 1.2 to 1.4 times as wide as they are tall, reaching over a neighbouring hex.

## Rig pose (third pass, 2026-11-04)

The owner asked for rigged, animated machines. A single fused mesh cannot be rigged cleanly when a weapon crosses the
body, so each concept was re-posed in the same chat, with its second-pass image attached: standing straight, feet at
shoulder width, both arms hanging about 30 degrees out from the body with clear space under them, the held weapon upright
beside the leg, nothing crossing in front. That also settled the footprint. Files: `art/concepts/v3-u01.jpg` to
`v3-u06.jpg`, sheet `contact-v3-rigpose.jpg` (local only). The re-pose prompt, per machine, is "Create an image of exactly
the same machine as this newly attached image: the same design, ... Only the pose changes, to a neutral pose for 3D
rigging: ..." followed by where each weapon goes.

## Rig pilot: u02 (2026-11-04)

All six re-posed concepts are through cutout, shape (16k faces) and paint. u02 is rigged: 17 bones (the shared skeleton
plus a glaive bone on the right hand), all eight clips, in `public/assets/models/u02.glb`, enabled in `ENABLED_MODELS`.
`tests/e2e/figures.spec.ts` screenshots each clip through the figure viewer (`?viewer=u02&clip=walk&t=0.4&yaw=30`).

Known rough edges, waiting on the owner's review before the other five:

- The file is 2.9 MB against the 1.5 MB budget. Hunyuan's texture layout gives every triangle its own vertices (about
  47k), and Blender's exporter writes them at full precision. Quantizing them (KHR_mesh_quantization, which three.js reads
  natively) should bring it near 1.2 MB, but needs a new dev dependency (`@gltf-transform/cli`).
- In the melee wind-up the glaive's butt dips below the floor, and a flat armour piece by the right foot drags during
  the strike. Both are joint-table fixes (a claim box and the wind-up angle).

## All six rigged (2026-11-04)

The other five followed the pilot: each turned square by eye from a top-down render (`yaw` in `tools/rig/rigs.json`; the
automatic turn is only a first guess and came out backwards for u05), its joints read off the grid renders, and boxes that
hand each weapon, shield, back unit or hip gun to its bone. `tools/rig/pack_glb.py` then stores normals, texture
coordinates and skin weights at reduced precision (KHR_mesh_quantization), which takes each machine from about 2.9 MB to
1.7 MB; the export scripts run it automatically. The wind-up of the melee clip was eased (upper arm 115 degrees, forearm
50) so a long weapon no longer dips through the floor.

## Board objects (2026-11-04)

Seven props, concepts from a fresh Gemini chat (one prompt, then "same style, finish, materials and camera as the previous
images, but a different terrain piece"), all in gunmetal satin plastic with amber and black hazard accents, on a plain
white background with no base: the objective (a data-uplink pylon on a hexagonal plinth), the garrison (an armoured
pillbox with a twin autocannon), the base (a launch pad with gantry arms), the supply crate (upgrade pickups), the energy
cell, and two wrecks (a fallen machine's torso, a crashed dropship hull). Concepts in `art/props/` (local only), meshes
through the same Hunyuan stages with `--nocut` and 12k faces (`~/Hunyuan3D-2/af_props.json`), then
`tools/rig/finalize_prop.py` writes `public/assets/models/props/<name>.glb` (about 1 MB each). `src/client/board/Prop.tsx`
fits each to its hex on load and falls back to the old primitive shape. Side colour stays the game's job: rings, flags and
lights over neutral models.

## Deck textures (2026-11-04)

Six textures from FLUX.1 dev on the local Flux studio (two seeds each, the cleaner one kept): diamond-plate deck, deck with
debris, flooded water over plate, scorched plate (under the wrecks), container roof and container side. Cropped and
written to `public/assets/textures/*.jpg` at 512 px. Every prompt ends "even flat lighting, no shadows, no perspective,
viewed straight down, fills the whole frame edge to edge, seamless texture, no text". The board keeps one tile set per
terrain (`SKINS` in `BoardCanvas.tsx`); raised open hexes use the container textures. Metalness stays near 0.1, because
with no environment map a metallic surface renders almost black.

## Pipeline per machine (Hunyuan Studio, owner's PC)

1. **Concept** in Gemini as above. Measure the result against the proportions table before any 3D work. Redo with a
   corrective note if the head drifts above about 32% of the height, the legs drop below about 1.3 heads, or the footprint
   is wider than the height allows.
2. **Cutout**, then **Hunyuan3D 2.1 shape** (Standard preset, 16k faces, base removed), then **2.0 paint** (1024 texture;
   2048 only if the panel lines go soft). The picks file is `~/Hunyuan3D-2/af_picks.json` (slugs `af_u01` to `af_u06`),
   run with `PICKS=af_picks.json`.
3. **Rig and animate** with `tools/rig/rig_machine.py <id>` in the 2.1 venv (it has Blender's `bpy`). It turns the mesh
   to face forward, fits the shared skeleton from the joint table in `tools/rig/rigs.json`, weights the armour stiffly
   (each part follows one bone, blending only in a narrow band at its joint, with boxes that hand a weapon, shield or back
   unit to a named bone), keys the clips and writes `public/assets/models/<id>.glb` at game scale: the top of the helmet
   1.0 units up, feet on y = 0, facing +z. `--inspect` renders a grid, the skeleton, the weight split and the key poses to
   `~/Hunyuan3D-2/outputs/af_<id>/rig_*.png`, which is how the joints are placed and checked.
4. **Clips** (the same set for every machine): `idle`, `walk`, `jump`, `fly`, `melee`, `shoot`, `hit`, `destroyed`. The
   game picks one from the current beat (`src/client/board/motionCue.ts`): a move walks, a change of level jumps, a Dash
   flies, an attack swings or shoots, damage flinches, a wreck slumps. Travel through the air stays the game's job; the
   clips only pose the body.
5. **In game**: the loader swaps a GLB in for the stand-in of each id in `ENABLED_MODELS` (`Figure.tsx`), plays its clips
   if it has them, and falls back to the stand-in if the file is missing.
6. **Review** by screenshot at the overview and at close zoom. Re-roll a machine once before changing its prompt.

One GPU job at a time; the shape and paint stages each use most of the 16 GB card.

Budget: under 1.5 MB per GLB, under 12 MB for all six.

## Review checklist

- Proportions against the table: head share, leg length, shoulder span, footprint.
- An original design: no forehead V crest, no faceplate with human eyes, no copied kit silhouette.
- Exactly two weapons, the right two, with the main one clearly bigger.
- Clean satin finish; no text, logos or emblems on the armour.
- After the 3D stage: no fused limbs or missing joints, the crest and fins survived, panel lines still crisp.
- Reads at the overview: the silhouette, back unit and weapon tell the six apart at 40 px tall.

## After the machines (M5)

All twenty card illustrations are regenerated in this style (owner decision, 2026-11-03): the six unit portraits rendered
from the finished GLBs, and the fourteen Tactics illustrations from rewritten prompts with machines in unpainted grey
plastic, so none is mistaken for a roster machine.
