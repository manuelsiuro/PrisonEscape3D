# Backlog: what's open

Everything not done yet, in one place (2026-11-06): the gameplay areas no polish pass has looked at,
the checks only a person can do, the ideas the user parked, the improvement queue and upkeep. Each item says where its
detail lives; nothing here is planned until the user picks it. When something is done, take it off
(and a check done by hand: its date).

## 1. Gameplay areas not polished yet

From `POLISH.md`, where each area's row says what's known (`docstest` keeps this list in step with
it). A pass on one of them follows the `polish-gameplay` skill.

Every area has had a pass (the last, football, rebuilt as penalties in 2.44; City Escape's rules again in
2.64 to 2.65, the 2026-11-19 review's batches: §4b). An area found wanting goes here as a row:

| Area | State in POLISH.md |
|---|---|

## 2. Checks only a person can do

Bots and the browser checks can't do these, so every release since the polish series began (2.25)
lists them under "Not checked". They pile up: one session every few releases clears them. Write the
date and version here when one is done.

| Check | Why a person | Last done |
|---|---|---|
| Play on a real phone, portrait and landscape: the reading game, the beat of a set, the tattoo, the action button, the joystick | Touch is simulated in the browser: a finger's timing and reach aren't | not recorded |
| A real gamepad (2.45): an Xbox and a PlayStation pad at least, in Chrome, Firefox and Safari; the stick's feel, the rumble, a lesson start to finish | No pad here: a pretend one (`scripts/dev/fakepad.ts`) drove the browser checks | not recorded |
| A real phone's speed: the `?perf` counter read in a busy yard, day and night, the phone's model noted | A computer's graphics card is 10–20 times a phone's: only a phone says whether a lighter look is needed | 2026-11-06, v2.35.0: a Galaxy S24 (flagship), 60 fps everywhere at every tier; a mid-range phone still to do |
| An iPhone, upright and turned: every screen and card (`scripts/dev/screensweep.ts` in its Safari) | No iPhone here (the tools drive Android by adb); its Safari can't go full screen, so turned it has only the height its own bars leave | not recorded |
| Listen: sounds, music, a phone's vibration | Nobody has heard them since they were made; no test can | not recorded |
| French read by a native speaker, on screen | The French is checked for coverage and length, not for how it reads | not recorded |
| Every lesson from the Tutorial menu, start to finish, by hand | Bots pass what people fail (`CLAUDE.md`); done per lesson when it changes, never all at once | not recorded |

## 3. Ideas the user parked

Not planned; offered again when the user asks what's next (moved here from the project memory,
2026-11-06). The riot changes how inmates behave: protect the escape bots (off on day 1, or measured and
re-tuned, as the sports grounds were; gangs, 2.36, start once the player meets them).

- **The riot** (2026-10-21): a grievance meter (bad meals, heatwaves, harsh shakedowns, lockdowns,
  grumbling barks) the player can spark (a canteen food fight, a yard brawl). Guards fall back to
  hold doors, some doors jam, storerooms are looted: an escape window. Then the riot squad, a full
  shakedown, a lockdown day. Built on the gangs (2.36): a gang war can tip into a riot.
- **Photo mode and postcards**, **a custom escape** (a twist sandbox and Hard time), **the escape
  planner corkboard**, **a story through the prisons** (2026-10-23, offered with parole, not picked).

## 4. The improvement queue

All sixteen sessions the user picked on 2026-11-06 are done (v2.34.2–v2.36.0, their entries in
`history/v2.30-v2.34.md` and `history/v2.35-v2.39.md`); 10, gamepad support, came last (v2.45.0); 9's
colour-blind palette was left out by the user.

## 4b. City Escape: what's left

The second mode is whole and on the title (`phases/10-city-escape.md`, v2.46.0 to v2.49.0), and
everything parked at its finish is built (v2.50.0 to v2.56.0). Left:

- By hand (§2): touch on a real phone, a real pad, a real phone's speed in a busy district at night
  (since 2.60 the dead are a dozen draws, not one; 2.61's fog on the boat's night), the French read by
  a native speaker, its sounds listened to (2.60 added five), a whole city played to its end by a
  person under the rules of 2.58 to 2.61.
- Nothing of the design is left unbuilt after 2.61, nor of the reviews or the look. Known and left: a pane
  is cut away with its wall round the player, so the window being broken isn't seen from where it is
  broken. (The last nights' waits, harder with a bat since 2.61, were shortened in 2.63.2.)
- **Stage C5, Make it yours** (the testers' asks, 2026-11-20; the design and its six batches in
  `phases/11-city-make-it-yours.md`): 1, breaking and salvage (2.66.0, built); 2 to 6 (building a base, the Rush,
  crafting that grows, survival with weight, a city that doesn't wait) to come, each at the user's go.
- The 2026-11-19 review's polish, in four batches (the user's go for each): 1, a first day that works (2.64,
  done); 2, readable screens and fights (2.64.1, done); 3, fair last nights
  and real choices (2.65, done); 4, the look (2.65.1, done). Left of it: a phone's speed with the new
  light and shade (§2).

## 5. Upkeep

- **Before selling (2.62 renamed the borrowed names):** the trailer on YouTube shows the old prison names
  (remade for 2.63 as "Over the Wall", on YouTube and in the README: the old one to unlist); the repo is public and its history and the old site still hold them (going
  private, or a fresh repo, is the user's call); a trademark search on the new names and the new title (Over the Wall since 2.63: a first web search found
  no game of that name);
  generic item names some players will still recognise (the fake wall block, the fake fence, the bed
  dummy) left as they are.
- **The repository's size:** shrunk 795 → 39 MB on 2026-11-18 (the user's go): `git filter-repo`
  took the 743 old versions of `assets/maps/*` pictures out of history (every commit, message and tag
  kept, today's files the same tree). Every commit and tag has a new id: an older clone (the Roblox
  port's) must be cloned again, never pulled into. The backup from before was deleted
  (the user, 2026-11-18). Since 2.34.1 the pictures change only with a map.
- **Shader programs first made mid-play** (found 2026-11-07, v2.36.0): `View.warmDay` now links every
  program at load (the worst frames 934 → 250 ms), but a few things are first built mid-play and still
  stall about 80 ms once each (the shower water, a night mesh, a holiday piece's shadow, the team view).
  Drawing them at load would change pixels; warming their materials on a hidden mesh would not.
  `scripts/dev/hitchprobe.ts` now counts these (`waited`).
