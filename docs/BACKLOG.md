# Backlog: what's open

Everything not done yet, in one place (2026-11-06): the gameplay areas no polish pass has looked at,
the checks only a person can do, the ideas the user parked, and upkeep. Each item says where its
detail lives; nothing here is planned until the user picks it. When something is done, take it off
(and a check done by hand: its date).

## 1. Gameplay areas not polished yet

From `POLISH.md`, where each area's row says what's known (`docstest` keeps this list in step with
it). A pass on one of them follows the `polish-gameplay` skill.

| Area | State in `POLISH.md` |
|---|---|
| Quiz, football, rat races | Partly |
| Free time | Not reviewed |
| Items and crafting | Not reviewed |
| Searching and looting | Not reviewed |
| Fights | Not reviewed |
| Stealth and heat | Not reviewed |
| Tools, digging, vents and roofs | Not reviewed |
| Talking, favors and opinion | Not reviewed |
| Merchants and money | Not reviewed |
| Crew | Not reviewed |
| Side games (dice, arm-wrestling, cards, hoops, checkers) | Not reviewed |
| Long games (pruno, garden, rats) | Not reviewed |
| Pay phone, kiosk and paperwork | Not reviewed |

## 2. Checks only a person can do

Bots and the browser checks can't do these, so every release since the polish series began (2.25)
lists them under "Not checked". They pile up: one session every few releases clears them. Write the
date and version here when one is done.

| Check | Why a person | Last done |
|---|---|---|
| Play on a real phone, portrait and landscape: the reading game, the beat of a set, the tattoo, the action button, the joystick | Touch is simulated in the browser: a finger's timing and reach aren't | not recorded |
| Listen: sounds, music, a phone's vibration | Nobody has heard them since they were made; no test can | not recorded |
| French read by a native speaker, on screen | The French is checked for coverage and length, not for how it reads | not recorded |
| Every lesson from the Tutorial menu, start to finish, by hand | Bots pass what people fail (`CLAUDE.md`); done per lesson when it changes, never all at once | not recorded |

## 3. Ideas the user parked

Not planned; offered again when the user asks what's next (moved here from the project memory,
2026-11-06). Gangs and the riot change how inmates behave: protect the escape bots (off on day 1, or
measured and re-tuned, as the sports grounds were).

- **Gangs and turf** (2026-10-21, Claude's first recommendation): 2 or 3 cliques a prison (the
  Kitchen Crew, the Lifers, the Gym Rats), each owning a canteen table, a yard corner and a
  merchant. Trespass starts trouble; an initiation favour to join, then discounts, protection in
  fights and colours to wear; rivals pick fights; a gang war day card. Turf as zone data, no map
  edits; built on opinion, favours, fights, the crew, merchants and the day deck.
- **The riot** (2026-10-21): a grievance meter (bad meals, heatwaves, harsh shakedowns, lockdowns,
  grumbling barks) the player can spark (a canteen food fight, a yard brawl). Guards fall back to
  hold doors, some doors jam, storerooms are looted: an escape window. Then the riot squad, a full
  shakedown, a lockdown day. Better after gangs (a gang war can tip into a riot).
- **Photo mode and postcards**, **a custom escape** (a twist sandbox and Hard time), **the escape
  planner corkboard**, **a story through the prisons** (2026-10-23, offered with parole, not picked).

## 4. Upkeep

- **The repository's size:** 705 MB, nearly all of it old versions of the map viewer's pictures.
  Since 2.34.1 they no longer change at every release, and the 3D photos are WebP (a fifth of the
  size), so it grows only when a map does. Shrinking what's already there means rewriting git
  history and force-pushing (`git filter-repo` on old versions of `assets/maps/*`: to about 35 MB).
  **On hold (the user, 2026-11-06):** another developer has a clone for a Roblox port and will
  push soon. A rewrite gives every commit and tag a new id, so it needs his work in first and a
  fresh clone on his side after; never without the user's go. Before it: a `git clone --mirror`
  backup; after it: build, tests, every tag, the site and CI checked.
