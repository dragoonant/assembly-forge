# Figures: the six machines (M4 brief)

**Status, 2026-11-03: ready for the owner.** Nothing has been generated. M4 is done together: the owner reviews the
concept images before any 3D work, and the GPU stages run on the owner's PC.

The house style is Mallet 42k `docs/FIGURE-STYLE.md` (approved 2026-10-31), read for machines rather than troopers. Every
prompt, edit request and review here uses measurements and materials only. That file's list of words never to use applies
to everything in this document and every prompt made from it.

## The look

A highly detailed hard-surface fighting machine, like a premium painted miniature or a high-end plastic model kit: crisp
panel lines, exposed pistons at the knees and elbows, vents, rivets and armour seams, matte realistic paint with edge
highlights and light weathering. The head is an armoured sensor housing with a visor or lens, never a face.

## Proportions (measured on the reference, carried over)

| Part | Measure |
| --- | --- |
| Height | About 2.8 head-heights from the top of the head to the soles |
| Head | About a third of the height; about 0.55 of the shoulder span wide |
| Shoulders | About 1.8 times the head's width, with heavy armour |
| Chest | Deep; chin to waist about three quarters of a head |
| Legs | Hips to soles about one head; short and thick, armoured |
| Feet | Large flat armoured feet in a wide planted stance |
| Weapons | Oversized: the main weapon at least as long as the head is wide |

In the game a machine stands 1.1 world units tall on a hex 1 unit across the flats (PLAN.md D3).

## Recipe (from the approved Gemini run)

Gemini in the owner's Chrome, one chat for all six, with `figure-style-reference.jpg` attached to the first message. The
first message is the template below with the first machine filled in. Each later machine is a fresh request in the same chat
that again says "same proportions and finish as the reference photo".

> Create an image. Match this figure's proportions, materials and paint finish exactly, but make a different subject: a
> highly detailed painted miniature of a bipedal combat machine, **[LIVERY AND DETAILS]**, about 2.8 head-heights tall: a
> large armoured sensor head about a third of its height with **[HEAD]**, very broad armoured shoulders almost twice the
> head's width, a deep armoured chest (chin to waist about three quarters of a head), short thick armoured legs about one
> head long with big flat armoured feet in a wide planted stance, **[WEAPON 1]**, and an oversized **[WEAPON 2]**, clearly
> the bigger of the two, crisp panel lines, exposed pistons at the knees and elbows, vents and rivets, matte realistic paint
> with edge highlights and light weathering, standing on a plain black round base, white background, full figure in view,
> front three-quarter view, no text, no logos or emblems on the armour.

The plain round base and white background are for the 3D stage: the shape stage cuts the base off, and the game draws its
own ground ring instead.

## The six briefs

Names are this project's own (`src/content/names.js`); the briefs never use them in a prompt, only the descriptions.

| Id | Role | Livery and details | Head | Weapon 1 | Weapon 2 (the big one) |
| --- | --- | --- | --- | --- | --- |
| u01 | Objective runner | Rescue frame in safety orange and slate grey, hazard chevrons on the shins, a winch drum on the back | A searchlight bar above a single visor slit | A forearm rivet gun | A huge shoulder-mounted grapple harpoon launcher with a coiled line |
| u02 | Skirmisher | Lean frame in pale teal and bone white, swept-back thruster fins on the calves and back | One round sensor lens set in a narrow armoured housing | A wrist dart pod | A long two-handed beam glaive with a pale energy edge |
| u03 | Glass cannon | Artillery frame in pale gold and white, thin magenta light along the armour seams, a fanned ring of radiator vanes behind the shoulders | A tall visor housing with a magenta slit | A small chest-mounted scatter emitter | An enormous dorsal beam cannon reaching over the right shoulder |
| u04 | Debuff bruiser | Close-assault frame in deep crimson and black, waist vents leaking green vapour | A cowled armour hood with three green eye slits | A barbed wrist hook | A massive two-handed barbed lance |
| u05 | Berserker | Battered salvage frame in rust brown, armour plates torn open to ember-orange internal light | A blunt jaw-shaped housing with no visible lens | A scrap-built pistol | An oversized wrecking claw filling the right arm |
| u06 | Zone controller | Fortress frame in deep blue and bronze, a vast rectangular shield wall on the left arm (armour, not a weapon) | A smooth bronze dome with a thin dark visor band | A hip-mounted pepperbox gun | A huge shoulder suppression mortar |

**Weapons are the game's.** Each machine shows exactly the two weapons on its card (`src/content/units.js`), so a player
can read what a machine does from the figure.

**Side identity is the game's job, not the paint's.** Both sides can field the same machine. The game marks the side with
the ground ring and tints the shoulders, so the liveries stay as above for both.

## Pipeline per machine (Hunyuan Studio, owner's PC)

1. **Concept** in Gemini as above. Measure the result against the proportions table before any 3D work, and redo with a
   corrective note if the head drifts above about 40% of the height (the Mallet tests drifted on tall helmets).
2. **Cutout**, then **Hunyuan3D 2.1 shape** (Standard preset, 10k faces, base removed), then **2.0 paint** (1024 texture;
   2048 only if the panel lines go soft).
3. **Finalize**: scale to 1.1 units tall, feet at y = 0, facing +z, matte materials, written to
   `public/assets/models/<id>.glb` (for example `u01.glb`).
4. **In game**: the loader swaps a GLB in for the stand-in of that id, and falls back to the stand-in if a file is missing,
   so a half-finished set still plays.
5. **Review** by screenshot at the overview and at close zoom. Re-roll a machine once before changing its prompt.

One GPU job at a time; the shape and paint stages each use most of the 16 GB card.

Budget: under 1.5 MB per GLB, under 12 MB for all six.

## Review checklist

- Proportions against the table: head share, shoulder width, leg length, stance.
- Exactly two weapons, the right two, with the main one clearly bigger.
- A sensor head, never a face; no text, logos or emblems on the armour.
- No fused limbs or missing joints after the 3D stage; panel lines still crisp after paint.
- Reads at the overview: the silhouette and weapon tell the six apart at 40 px tall.

## After the machines (M5)

All twenty card illustrations are regenerated in this style (owner decision, 2026-11-03): the six unit portraits rendered
from the finished GLBs, and the fourteen Tactics illustrations from rewritten prompts with machines in unpainted grey
steel, so none is mistaken for a roster machine.
