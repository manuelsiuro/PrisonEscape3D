# The dev tools: when and how

The procedures behind `CLAUDE.md`'s one-line rules, read when the work calls for them (moved there
word for word on 2026-11-12). The tools are in `scripts/dev/`; the browser ones run in the dev build
(`npm run dev`, port 5310).

## The screen sizes

After a layout change, `scripts/dev/screensweep.ts` at its eight sizes: every screen and moment of
play, in English and French. A phone turned in Chrome is only ~274 tall; the interface scaled up lays
a phone out on as little as 300 across: 360×641 at 130%, an Android user agent in the emulation
(`app/scale.ts`).

## Render changes

- A render change meant to draw nothing new (a refactor, a speed-up): `scripts/dev/drawhash.ts`
  fingerprints 279 frames (every prison and moment, forced weather, layers, stances, effects, the
  cameras, the manhunt), its baseline taken on the old code first.
- A change to what's drawn: `scripts/dev/perfprobe.ts`'s `check()` in a phone's profile (draw calls
  and triangles of 42 scenes against `perfbudget.json`; `record()` after a change meant to draw more).
- Slow frames, shader compiles and memory over a long game: `scripts/dev/hitchprobe.ts`.

## The map viewer

`assets/maps/index.html`: keep it in step with the prisons. When a phase changes a map or adds
something placed on it (props, decor, guards, a new `PrisonDef` field such as `comms`), draw the new
data in `scripts/dev/mapimage.ts` (picture, legend and the tile info in `tileData`), then run
`npm run maps`. If the change shows in 3D, also retake the "In game" photos with
`scripts/dev/mapshot.ts` in the dev build (`send()` writes them to `assets/maps/` through
`scripts/dev/shotsink.ts`; a change to the manhunt's outside: `send(true)`, its "Outside 3D"
photos). Check that the new thing appears: a group the title screen hides needs showing in
`View.mapShot` (its `dress`, for what stands there every day). Then run `npm run maps` again, and
commit the pictures with the phase. Rules and non-places go in `scripts/dev/mapdata.ts` (the prison
sheet, the overlays). `mapviewertest` fails when `data.js` or a drawn picture no longer matches the
game, or when a prison gets a field the viewer doesn't know yet; it can't see the 3D photos go stale.
The 3D photos show permanent things only (the user's choice, 2026-11-04): cameras, searchlights,
goals, beds, the rat track, Irongate's drawbridge up; nothing that comes with an event.

## How to play's pictures

A topic's picture is a `SHOTS` entry in `scripts/dev/helpshot.ts`: a bot's run or a lesson replayed
in the dev build, posted to `public/help/` through the shot sink. A topic seen from the start is
pictured at Center Perks. Retake a picture when what it shows changes.
