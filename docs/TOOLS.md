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

## A gamepad without one

`scripts/dev/fakepad.ts` (2.45) plugs a pretend standard gamepad into the dev build: `install('xbox' | 'ps' |
'nintendo')`, then `press(B.A)`, `hold`/`release`, `stick('left' | 'right', x, y)`, and `rumbles()` for what the
game asked of its motors. It drives the game as a real pad would (`play/pad.ts` reads `navigator.getGamepads`
each frame); a real pad's feel, and the browsers' own mappings, still need one in hand (`BACKLOG.md` §2).

## City Escape

The mode shows on the title only with `?city` in the address (`http://localhost:5310/?city`) until it is whole.
In a dev build `window.__city()` is the city under way (null on the title, and undefined until the mode's code
has been fetched by opening it once): `.city` is the simulation (`state`, `district`, `plan`, `target()`,
`minute`, `day`), `.pilot.goTo(tile)` walks the player by ordinary commands, `.paused` says a screen of its own is
up. Keys are sent as for the prisons (`KeyE` act, `Space` hit, `KeyC` make, `KeyM` the map, `Digit1`–`Digit8` a
pocket, `KeyJ` the journal, `Escape`). Headless, a city is driven as the tests do: `new City(seed)`, `city.step(command(dir, COP.ACT))`,
`city.peace = true` for no dead, and `scripts/citybots.ts`'s `scavenger(city)` for a player made of commands (`quester(city, way)` follows
the story to a way out). The story's places are `city.story` (`things`, `notes`, `exits`, `pier`), what it asks
now `objectives(city)` (`city/sim/story.ts`); the survivors are `city.story.people` (`COP.ACT` beside one, `COP.TRADE` with `who * 4 + swap`); a test puts the player in another district with the private
`city.enter(d)` and a new `state.player`.
A page that falls to the background pauses the city (as the prisons do): a script that finds `.paused` true
with no pause card should look for another screen up (the map).
