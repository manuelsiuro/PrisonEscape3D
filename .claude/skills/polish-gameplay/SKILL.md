---
name: polish-gameplay
description: "The steps for reworking, polishing, rebalancing or reviewing a game mechanic in Prison Escape 3D so that nothing is forgotten and the quality holds: what's already been done, every place a mechanic reaches, rule traps, proof in all five prisons, playing it in the browser, an independent review, and finishing with evidence. Use it whenever the user wants a part of the gameplay improved, changed or checked (the canteen, showers, roll call, jobs, fights, guards, a minigame, an animation, a rule, a cost), asks for a full or AAA review of a feature, or says something 'should be polished', even if they don't say 'skill' or 'polish'. Use it before writing code."
---

# Polishing a mechanic

A mechanic here reaches much further than its own code, and tests stay green while a player falls
into a trap. Rules alone don't prevent that: when the canteen was reworked (v2.25), `CLAUDE.md`
already asked for a How to play page and it was still skipped until a review. So this is a
procedure, and it ends with evidence. `CLAUDE.md` still holds the project's rules; `web-sim-game-playbook`
holds the general method. The worked example of all of this is the canteen's entry in `docs/HISTORY.md`.

## 1. Start from what's known

Read the area's row in `docs/POLISH.md`, then its entries in `docs/HISTORY.md` and its row in
`docs/PLAN.md` §2. Those record what the user already chose and accepted: build on it rather than
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
- What else reads the same state: `DOING.*` in `games.ts`, `football.ts`, `talk/mood.ts`, `talk/director.ts`.
- Saves (`load.ts`: fields at the end, optional, checked) and values whose meaning changed. Old logs
  (`Sim.rulesNNN`, `prepareReplay`, the `stale` gate in `RunRecorder`).
- A prison that lacks the thing (Training has no serving counter).

**What the player meets**
- The action button: `labels.ts` must say exactly what `actions.ts` does, in the same order of priority.
  The highlight (`focusOf`) must agree with both.
- Keyboard and touch; the floor arrows (`guide.ts`); hints, toasts and floats (`announce.ts`); barks; the HUD and the day card.
- Who gets in the way: a crowd changes what the button targets and who stands where.
- A hint whose advice changes needs a new `coachOnce` id: anyone who has played has already seen the old one and won't be told.

**What teaches it**
- A How to play topic with its picture (`helpTopics.ts`, `SHOTS` in `scripts/dev/helpshot.ts`), and other
  pages that mention the same thing.
- A lesson in `CHAPTERS`. A lesson without its own `seed` uses `7 + its place`, so inserting one moves
  every unseeded lesson after it: add it after the last unseeded one, with a seed.
- The first-day guide (`src/ui/coach.ts`).
- Every line in `src/i18n/en.ts` and `fr.ts` that describes the old behaviour.

**The world**
- Props and decor in all five prisons: is what the rule assumes actually there, and the same everywhere?
  Tray decor was only on Center Perks' counter.
- The map viewer (`mapimage.ts`, `mapdata.ts`, overlays, routine notes, photos). `mapshot.send()` rewrites
  every photo: `git checkout` the ones nothing changed in.

**3D**
- Every state of the animation, in hands and set down, from both sides, with the camera's real angle.
- The player's see-through silhouette treats anything not drawn in the body's material as a wall.
- Per-frame values must not accumulate; reduced motion must snap rather than vanish.

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

## 5. Prove it in all five prisons

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
`HEAD` (symlink `node_modules`, run one probe script against both). That showed Irongate's takeover bot wins
about half the time on either, and that the gardener's bug was older than the change. Check a long probe has really started (a `.ts` with top-level await dies at once under `tsx`; use `.mts`). Remove the worktree
afterwards, and list every accepted change in `PLAN.md`.

## 6. Play it

Bots pass what people fail: the lesson that started inside a wall passed its bot. On the dev server
(`npm run dev`, port 5310, reuse one that's running) in an isolated browser context:

```js
const p = await import('/scripts/dev/playat.ts');
await p.at('irongate', 1, 9 * 60 + 1);          // the model prisoner's day up to then, on screen
await p.to(50, 12); await p.press('KeyE');      // real keys
p.freeze(); p.zoom(3);                          // held still and enlarged for a close look
```

Cover: all five prisons; desktop, 412×915 and 915×412; keyboard and touch; English and French; every lesson
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

## 8. Finish with evidence

Before saying it's done, fill this in your report. Each line gets what proves it (a test's output, what was
seen and where), or "not checked". Never tick a line from memory.

| Check | Proof |
|---|---|
| `npm run build` and `npm test` (exit codes, clean re-run) | |
| Works in all five prisons | |
| Lesson played from the menu; first-day guide | |
| How to play page and picture; other pages that mention it | |
| English and French read through, on screen on a phone | |
| Desktop and both phone sizes; keyboard and touch; console clean | |
| Bot snapshot changes read and classified, listed in `PLAN.md` | |
| Old saves load, old logs replay, a log from before isn't carried on | |
| Map viewer: `npm run maps`, overlays, photos of what changed | |
| Independent review done, findings fixed | |
| Not checked (say what, and how much it matters) | |

Then, with the work:
- `docs/POLISH.md`: the area's row, with the user's choices and the known limits.
- `docs/HISTORY.md` (what changed, what the review found, what was accepted) and `docs/PLAN.md` (§2's row, the status line and counts). `docs/FEATURES.md` and the README's counts if they moved.
- Anything general the pass taught goes in `web-sim-game-playbook`; anything about this project's method, here.

Commit, merge and release only when the user asks, following `CLAUDE.md`'s Release rule, with `npm run released` in the background.
