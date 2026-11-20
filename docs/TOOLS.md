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
goals, beds, the rat track, Gull Rock's drawbridge up; nothing that comes with an event.

## How to play's pictures

A topic's picture is a `SHOTS` entry in `scripts/dev/helpshot.ts`: a bot's run or a lesson replayed
in the dev build, posted to `public/help/` through the shot sink. A topic seen from the start is
pictured at Maple Grove. Retake a picture when what it shows changes.

## The prison cards' pictures

Choose a prison's cards (and the Daily's) show each prison in 3D: `CARDS` in `scripts/dev/cardshot.ts` (2.63.1),
the whole prison from a low angle in its own light, staged as the trailer stages its shots. In the dev build at
1280×800, isolated: `look(id)` to frame one (`stop()` after), `send()` to post all six through the shot sink
to `public/prisons/` (640×400 WebP; `helptest` checks they're there and under 90 kB). Retake them when a
prison's map or look changes.

## A gamepad without one

`scripts/dev/fakepad.ts` (2.45) plugs a pretend standard gamepad into the dev build: `install('xbox' | 'ps' |
'nintendo')`, then `press(B.A)`, `hold`/`release`, `stick('left' | 'right', x, y)`, and `rumbles()` for what the
game asked of its motors. It drives the game as a real pad would (`play/pad.ts` reads `navigator.getGamepads`
each frame); a real pad's feel, and the browsers' own mappings, still need one in hand (`BACKLOG.md` §2).

## City Escape

The mode is on the title (since 2.49; before, only with `?city` in the address).
In a dev build `window.__city()` is the city under way (null on the title, and undefined until the mode's code
has been fetched by opening it once): `.city` is the simulation (`state`, `district`, `plan`, `target()`,
`minute`, `day`), `.pilot.goTo(tile)` walks the player by ordinary commands, `.paused` says a screen of its own is
up. Keys are sent as for the prisons (`KeyE` act, `Space` hit, `KeyC` make, `KeyM` the map, `Digit1`–`Digit8` a
pocket, `KeyJ` the journal, `Escape`). Headless, a city is driven as the tests do: `new City(seed)`, `city.step(command(dir, COP.ACT))`,
`city.peace = true` for no dead, and `scripts/citybots.ts`'s `scavenger(city)` for a player made of commands (`quester(city, way)` follows
the story to a way out). The story's places are `city.story` (`things`, `notes`, `exits`, `pier`), what it asks
now `objectives(city)` (`city/sim/story.ts`); the survivors are `city.story.people` (`COP.ACT` beside one, `COP.TRADE` with `who * 4 + swap`); a test puts the player in another district with the private
`city.enter(d)` and a new `state.player` (in the browser, `window.__cityStage()` then puts the district up). The metro's tunnel (2.56) is place 9
(`TUNNEL`): `city.descend()` puts the player at the foot of its stairs, `city.tunnel` has its `start`, `end` and `way`. What burns is
`state.lights` (2.52) and `state.fires` (2.55), a car's alarm `state.alarm` (2.54); `city.dim` is the tiles dark by day (2.53). The help's seventeen city pictures are staged by
`scripts/dev/cityshot.ts` (`stage('cityDead')` in a city open at 1040 × 480, the page's screenshot, then
`cwebp -q 80 -resize 1040 480`).
`stage` empties the pockets and puts the bus's orange back on (the pictures are of the first days); a scene on a street
picks its tiles well inside the district (a street's end on the border is a checkpoint: stood on, the player crosses).
Since 2.58: `city.locked` (1 on a chained door), `city.fences` (where the fence can be cut), `state.forced`, `state.cuts`,
`state.outfit`; a city without chains for a comparison: `city.state.locks = 0; city.reenter()`. Since 2.60 a `Zed` has a
`kind` 0 to 5 (`content/dead.ts`'s `ZKIND`, `kindStats`); every death goes through `putDown` and is said as `fell`.
A test or a probe that places its own dead steps the city once first (`state.arrive`: the district's own are put down on
the first step in it, and would replace them). A balance question is measured on 40 cities or more, twice on different
seeds, the old rule beside the new in one script (the scavenger's falls a week moved by 0.7 on one sample of 40 and by
nothing on the next 60).
To look at a district: `scripts/dev/citygo.ts` (`go('downtown', 0.7)`, or `go('suburbs', 1.6, 22 * 60, 'house')`
for an hour and the inside of a building; nobody about, the game held still).
A page that falls to the background pauses the city (as the prisons do): a script that finds `.paused` true
with no pause card should look for another screen up (the map).
