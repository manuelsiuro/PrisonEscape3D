---
name: polish-gameplay
description: "The steps for reworking, polishing, rebalancing or reviewing a game mechanic in Prison Escape 3D so that nothing is forgotten and the quality holds: what's already been done, every place a mechanic reaches, rule traps, proof in all six prisons, playing it in the browser, an independent review, and finishing with evidence. Use it whenever the user wants a part of the gameplay improved, changed or checked (the canteen, showers, roll call, jobs, fights, guards, a minigame, an animation, a rule, a cost), asks for a full or AAA review of a feature, or says something 'should be polished', even if they don't say 'skill' or 'polish'. It covers City Escape too (its rules, its dead, its look: the part 7b). Use it before writing code."
---

# Polishing a mechanic

A mechanic here reaches much further than its own code, and tests stay green while a player falls
into a trap. Rules alone don't prevent that: when the canteen was reworked (v2.25), `CLAUDE.md`
already asked for a How to play page and it was still skipped until a review. So this is a
procedure, and it ends with evidence. `CLAUDE.md` still holds the project's rules; `web-sim-game-playbook`
holds the general method. The worked example of all of this is the canteen's entry in `docs/history/v2.20-v2.29.md`.

## 1. Start from what's known

Read the area's row in `docs/POLISH.md`, then its entries in `docs/history/` (find them by name:
`grep -l`) and its rows in its `docs/decisions/` file (`docs/README.md` says which). Read those files,
not the whole record. They hold what the user already chose and accepted: build on it rather than
reopening it. Work on a `feature/` branch.

Read the code before asking anything. Then ask only what's truly the user's to decide (how it should
feel, who it applies to, what it costs), with a recommendation first. State your own defaults so they
can object. If they answer vaguely ("yes it should have a consequence"), pick something sensible and
tunable, say what you picked, and record it as your pick in `POLISH.md`.

## 2. Map where it reaches, before coding

Grep the mechanic's state, events and text, then go down this list and write down what applies. Each
line is something that was missed or broke at some point.

**Rules**
- Anything that reuses it under another name. `crowdPlan` puts the crowd on dinner's plan for film and
  talent nights, so "at dinner" code also ran at the movies.
- Day events, holidays and Daily twists (`src/content/days.ts`, `holidays.ts`, `twists.ts`).
- What interrupts it: lockdown, knockout, solitary, `sim.away`, being led off, a fight, a rat, a drill, a
  block change, the parole hearing. Then what happens when it's taken up again.
- What else reads the same state: `DOING.*` in `games.ts`, `penalties.ts`, `talk/mood.ts`, `talk/director.ts`.
- Saves (`load.ts`: fields at the end, optional, checked) and values whose meaning changed. Old logs
  (`Sim.rulesNNN`, `prepareReplay`, the `stale` gate in `RunRecorder`).
- A prison that lacks the thing (Training has no serving counter).
- Decor turned into a working prop: everything iterating `world.props` sees it, in old runs too (digging, the button's target). Add it last, not solid, and compare the old world with the new one on those tiles (`canDigFloor` refuses any prop's tile: an added chair would have broken old logs that dug there). Made solid
  behind a flag, its setter must also forget and recompute everything worked out from solidity (`forgetPlaces`,
  `forgetReserved`): the `Sim` is built before a replay sets its flags, and a stale no-dig list let 2.33's cooler
  (and, latent since 2.32, the vending machine) refuse holes old logs had dug.

**What the player meets**
- The action button: what a press does is decided once, by `interactPlan` (`sim/systems/interact.ts`, since
  2.34.2), the one order of priority. A new action is a kind of `Plan` there, done in `actions.ts`'s `doPlan`, worded
  in `labels.ts`'s `describePlan`, marked in `play/focus.ts`, and given its effect and verb in `buttontest`'s tables.
  Never decide it again in the play layer (before, four copies drifted: a meal's tray at the counter at the
  player's back took the press while the button said "Read").
- Keyboard, touch and a gamepad (2.45: `play/pad.ts` sends the keys and moves the focus on cards; a card played with
  the arrows goes in `modeNow`'s list; a text naming the mouse, a click, the digits, Esc or X gets a `…Pad` twin, which
  `t()` shows while a pad is in hand; a text picked by touch goes through `touchWords()`); the floor arrows (`guide.ts`); hints, toasts and floats (`announce.ts`); barks; the HUD and the day card.
- Who gets in the way: a crowd changes what the button targets and who stands where.
- A warning promises time: measure the whole job from nothing, from where people really are, against it. 30 s looked generous for a job a bot does in 18 s, and a third of the jobs couldn't finish.
- A new reason a guard reacts may count as being spotted (`FEAT.spotted`, the Ghost medal, a commendation lost). A telling-off that isn't a fault needs its own event.
- A rule about a room: grep what sends people there on purpose (odd jobs, holiday treats, side errands).
- A model with a door or window: check which way each prison turned it. From this camera a front turned to the wall is never seen. An inmate given a new pose keeps it until something clears it: check free time, when they walk off, as well as the block it was built for.
- Arrows that lead somewhere promise the button there does that thing. Stand on the arrows' last tile with someone in reach: a nearby guard took the button from the chair the book's arrows led to. And check what the arrows do when a bell rings mid-errand: the routine comes first.
- A card that takes over the keys (Space, the tool button hidden): make sure a blow ends it, or the player is beaten with no way to answer.
- A printed cost: measure it in every place the thing can be done. A chair's energy kept coming during a set, so "−10" was a gain of 29.
- A hint whose advice changes needs a new `coachOnce` id: anyone who has played has already seen the old one and won't be told.

**What teaches it**
- A How to play topic with its picture (`helpTopics.ts`, `SHOTS` in `scripts/dev/helpshot.ts`), and other
  pages that mention the same thing.
- A lesson in `CHAPTERS`. A lesson without its own `seed` uses `7 + its place`, so inserting one moves
  every unseeded lesson after it: add it after the last unseeded one, with a seed.
- A lesson's step is read on a phone turned in Chrome (697×274) above the hotbar: `screensweep`'s `lessonCards()`
  at that size measures every step in both languages (2.38's long steps ran off the screen there; keep them short).
- The first-day guide (`src/ui/coach.ts`).
- Every line in `src/i18n/en.ts` and `fr.ts` that describes the old behaviour. New French follows `fr.ts`: a narrow
  no-break space (U+202F) before `:` `;` `!` `?` and `%`, and inside « ».

**The world**
- Props and decor in all six prisons: is what the rule assumes actually there, and the same everywhere?
  Tray decor was only on Maple Grove's counter.
- The map viewer (`mapimage.ts`, `mapdata.ts`, overlays, routine notes, photos). `mapshot.send()` rewrites
  every photo: `git checkout` the ones nothing changed in.

**3D**
- Every state of the animation, in hands and set down, from both sides, with the camera's real angle. A held item
  is fixed to the hand and turns with the arm: a pose that raises it (a cup to the lips) must keep the item upright
  itself, or it's held out sideways and tipped over.
- Text on a wall (a board, a sign) is a thin strip from this steep camera: hang it from its top edge with its foot out
  so it faces up (tipped the other way it faces the floor and its back is culled). The card stays the readable version.
- The player's see-through silhouette treats anything not drawn in the body's material as a wall.
- Per-frame values must not accumulate; reduced motion must snap rather than vanish.
- A new pose or held item: `scripts/dev/posesheet.ts` shows it frame by frame from the game's camera angle, from both
  sides; `animtest` fails on a limb jumping at a change or a set-off, and on a pose left behind once it's over.

## 3. Look for traps in the rules

Most of what tests can't see lives here. For each new rule or cost, walk through someone who doesn't
want it:

- Can it happen to someone who only came for something else? The counter's first press handed a tray to
  people after a spoon, and they then paid heat for leaving with it.
- Can it be undone, or walked away from?
- Are they charged for something forced on them, or with no time left to comply (a block's last minutes)?
- Does a refused or empty press count as doing something?
- Can a small rule tip into a big consequence? A forgotten tray shouldn't start a chase, so the heat stops short.
- Does the reward or cost show before it applies?

## 4. Build it

Follow `CLAUDE.md`: a new rule goes behind a `rulesNNN` flag for old logs, new state at the end, text
through `t()` in both languages, tuning numbers in `tuning.ts`. New draws from the state's RNG move every
bot, so avoid them. Runs recorded in tests under the new rules are labelled with the coming version, or
they replay under the old ones. Decide patch or minor now: the flag's gate needs the version it ships in.

## 5. Prove it in all six prisons

Write `scripts/<area>test.ts` with its snapshot:

- Every place: every counter tile, every seat, every door, not one of each. Check nothing stands on them.
- The whole thing walked by real commands (`bot.walkTo`, `bot.act`), through the crowd, in each prison,
  with the time it takes against the time there is.
- Inmates on several seeds. Trace any that don't finish: that's how the stuck gardener and the inmate left
  standing at the counter were found. Measure crowding rather than judging it by eye.
- Each trap from step 3, and old rules still playing as they did.

**Reading changed snapshots.** `npm test -- -u` only after reading the diff, and gate on the exit code. A
changed bot snapshot is a regression until proven otherwise. Separate a real FAIL from a moved number, and
never explain a failure away unmeasured: run old and new code over many seeds with a git worktree of
`HEAD` (symlink `node_modules`, run one probe script against both). That showed Gull Rock's takeover bot wins
about half the time on either, and that the gardener's bug was older than the change. To name a moved snapshot's
cause, change one thing at a time in the same build (2.33: inmates at the cooler from day 2, then the cooler made
walk-through: the escape bots' drift went to zero, so the cooler being solid was all of it). A route lost on 24 seeds
may be luck: measure it on 60 on the old code and on each candidate fix before moving anything (Gull Rock's bluff: 58,
58 and 57; the cooler stayed where it was). Check a long probe has really started (a `.ts` with top-level await dies at once under `tsx`; use `.mts`). Remove the worktree
afterwards, and list every accepted change in the pass's row in `docs/phases/8-polish.md`.

## 6. Play it

Bots pass what people fail: the lesson that started inside a wall passed its bot. On the dev server
(`npm run dev`, port 5310, reuse one that's running) in an isolated browser context:

```js
const p = await import('/scripts/dev/playat.ts');
await p.at('gull-rock', 1, 9 * 60 + 1);          // the model prisoner's day up to then, on screen
await p.to(50, 12); await p.press('KeyE');      // real keys
p.freeze(); p.zoom(3);                          // held still and enlarged for a close look
```

Cover: all six prisons; desktop, 412×915 and 915×412; keyboard, touch and a pad (`scripts/dev/fakepad.ts`); English and French; every lesson
from the Tutorial menu, start to finish; light and reduced motion where it matters.

What will trip you up:
- The game runs in real time between tool calls. Freeze before looking, and do timed sequences within one script call.
- `p.put` refuses bad tiles because a bad one wastes the run: inside a wall nothing moves, outside the fence the game counts an escape.
- A switched language shows on what's drawn next, not on the screen already up.
- Time-limited messages expire before a screenshot. Read them in the same call as the action.
- Freezing stops the sim, not the view: its own timers (a towel for 2.5 s) run out before the screenshot. Read them in the same call too.
- Reduced motion is the game's setting (`view.reducedMotion`), not the browser's: emulating the media query doesn't test it.
- Screenshots may land in a temp folder at high device scale: crop them with `sips` to read detail.
- A module imported by hand can be a second copy of the game's, once it has been edited in this dev session (the game's has `?t=…`): a spy or a language switch on it does nothing, and a count of 0 proves nothing. Take the real URL from `performance.getEntriesByType('resource')`.
- `p.to` walks straight lines: through a door or round a corner it just pushes against the wall while the clock runs. Use `p.put` for the trip.

Say plainly what you moved by script, and what nobody has played by hand. Touch in the browser is simulated.

## 7. Get an independent review

Spawn one reviewer with the diff and the project's rules, not your conclusions, asking for verified findings
with a scenario for each (and its own folder for probes: one shared scratchpad let its results overwrite a long measurement's). It reads what you stopped seeing. Confirm each finding before fixing it, and re-run
the checks after: fixes introduce bugs too.

## 7b. When the mechanic is City Escape's

The same steps, with the city's own places (2.57 to 2.60 were run this way). Its record is `docs/decisions/city.md`
(the rules as they stand), `docs/phases/10-city-escape.md` (the code) and its two rows in `docs/POLISH.md`; "all six
prisons" becomes "twelve cities or more, every district" (a city is made from a seed: `new City(seed)`).

- **Rules** live in `src/city/sim` and `content`, deterministic as the prisons'. There is no replay log: only saves
  matter. A new state field goes in the last `fresh…()` (`tools.ts`), is made sound in its `sound…()` before the
  city is built, and a rule that must not appear in a city under way is switched by a field the save lacks
  (`state.locks`). What the story's places or the loot are drawn from must not change for a saved city: a new
  placement gets a stream of its own and reads `lockedLots`, never the other way round.
- **Draws from `state.rng` move every bot from that step on.** Keep the first day and night free of new draws, and
  read each moved snapshot: fingerprints alone (a new field), or counts too.
- **The bots are chaotic.** One sample of 40 cities moved the scavenger's falls by 0.7 a week for a change that
  moved nothing on the next 60. Measure old and new in one script (`city.state.locks = 0; city.reenter()` gives the
  old city), on two sets of seeds, before believing or dismissing a difference. The endings alone: the `quester`
  put at the way out with the kit, a bat and three bandages, night 1 and night 5, 16 to 32 cities.
- **A test that places its own dead** steps the city once first (`state.arrive` puts the district's own down on the
  first step and would replace them), stands the player well inside the district (a street's end on the border is
  a checkpoint: they cross), and steers with `nearestDir`, never a facing by number.
- **The picture** is `CityView` and its parts, handed frames by `play/city.ts`: nothing there reads the simulation,
  and nothing the player may walk through is thicker than a post. An effect begun by an event is stamped with
  `performance.now()`, the frame draws with the frame's own time, a moment earlier: never drop what is "not born
  yet". A new CSS animation's name is searched for first (2.60's pulse took the meters' `city-low`).
- **Deaths, falls and ends inside an action**: after anything that can hurt the player (`hurt`, a burst), the step
  returns on `state.over` or a `dead` event before the dead move (Hardcore died twice in one step).
- **In the browser**: `window.__city()`, `scripts/dev/citygo.ts`, `cityshot.ts` (`docs/TOOLS.md`); an edit reloads
  the page to the title (title → City Escape → Continue). A new city is needed to see what only new cities have.
  Check the action button's label at 915×412 against Hit: a long name lies over it.
- **How to play**: the City tab's topics; a list's lines must match its `listIcons`; a picture is a `SHOTS` entry of
  `cityshot.ts`.
- **The reviewer** gets the diff and the rules, its own probe folder, and is told not to touch files, snapshots or
  the browser. Every pass of 2.58 to 2.60 had real findings from it.

## 8. Finish with evidence

Before saying it's done, fill this in your report. Each line gets what proves it (a test's output, what was
seen and where), or "not checked". Never tick a line from memory.

| Check | Proof |
|---|---|
| `npm run build` and `npm run check` (types, lint, layout, tests: exit codes, clean re-run) | |
| Works in all six prisons | |
| Lesson played from the menu; first-day guide | |
| How to play page and picture; other pages that mention it | |
| English and French read through, on screen on a phone | |
| Desktop and both phone sizes; keyboard, touch and a pad; console clean | |
| Bot snapshot changes read and classified, listed in `docs/phases/8-polish.md` | |
| Old saves load, old logs replay, a log from before isn't carried on | |
| Map viewer: `npm run maps`, overlays, photos of what changed | |
| Independent review done, findings fixed | |
| Not checked (say what, and how much it matters) | |

Then, with the work, the documents as the `docs-upkeep` skill says (each fact once, in its home):
- `docs/POLISH.md`: the area's row, with the user's choices and the known limits, short.
- The history entry and its index line, the area's `docs/decisions/` row, the pass's row in `docs/phases/8-polish.md`, the counts. `docs/FEATURES.md` and the README's counts if they moved.
- Anything general the pass taught goes in `web-sim-game-playbook`; anything about this project's method, here.

Commit, merge and release only when the user asks, following `CLAUDE.md`'s Release rule (the check run again after the
version bump, before the tag), with `npm run released` in the background.
