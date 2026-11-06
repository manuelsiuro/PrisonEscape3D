---
name: real-phone
description: "Testing Prison Escape 3D on the real Android phone plugged into this computer (adb): the game opened in the phone's Chrome from the dev server, code run in that tab, its screen taken, real touches sent, frame times measured on real hardware. Use it whenever the user asks to test, measure, check or play something on the phone, a real device or Android; for a performance check (frame rate, the ?perf counter, perfprobe on a phone); for touch play the browser can only simulate (a lesson by touch, the joystick, the reading game, the action button); or when a check in BACKLOG.md §2 needs a real phone. Not for iPhone (no adb) or the desktop browser."
---

# Testing on the real phone

The browser's phone profile simulates touch and slows the CPU; it can't tell what a phone's graphics card does, or
how a real touch lands. A phone is plugged into this computer by USB (on 2026-11-06 a Galaxy S24, Exynos 2400,
Android, Chrome; check what's there, it may change). `scripts/dev/phone.ts` drives it; this says how and what
to watch for. It was built in session 5 (the phone performance pass, v2.34.3), whose history entry has the
first results.

## 1. Set up

The dev server must be running (`npm run dev`, port 5310; reuse one that is). Then:

```sh
npx tsx scripts/dev/phone.ts setup            # ?perf: the frame counter on; `setup ""` for none
```

It checks for exactly one phone (`adb devices`: "unauthorized" means the phone's USB-debugging prompt is waiting
for the user), reverses port 5310 so the phone's `localhost:5310` is the dev server, keeps the screen on while
plugged in, opens the game in Chrome, forwards Chrome's debugger (port 9333), closes older game tabs and
Chrome's install sheet. If the screen is locked, ask the user to unlock it: nothing here can.

## 2. What the tool does

| Command | What for |
|---|---|
| `eval <file.js>` or `eval -e '<js>'` | The body of an async function, run in the game's tab; its value printed as JSON |
| `shot <file.png>` | The phone's screen (1080×2340: shrink with `sips -Z 1000` before reading it) |
| `tapText <text>` | A real touch on the smallest button showing that text (in the language the phone shows: it's French) |
| `tapEl <selector>` | A real touch on an element's middle |
| `tap <x> <y>`, `swipe <x1> <y1> <x2> <y2> [ms]` | Page CSS pixels (`getBoundingClientRect`'s); a long swipe is a held drag (the walk) |
| `clear` | Chrome's install sheet closed, if it's up |
| `cleanup` | The screen's timeout back, the forwards removed: always at the end |

In `eval`, import the game's modules by their real URL: `await import(real('/src/play/context.ts'))`. After a hot
reload the game's copy is `?t=…`, and a plain import is a second copy whose state is empty (`view.worldView` null).
`/scripts/dev/playat.ts` and `perfprobe.ts` import fine as they are. Put longer scripts in a file in the
scratchpad. A script longer than two minutes is fine (`eval` waits up to ten).

## 3. Measuring speed

```js
// in a file, then: npx tsx scripts/dev/phone.ts eval that-file.js
const pp = await import('/scripts/dev/perfprobe.ts');
const rows = await pp.scenes(undefined, 3);   // 36 scenes, about 4 minutes
return rows.map((r) => [r.scene, r.fps, r.gap95, r.frame, r.frame95, r.render, r.calls, r.shadowCalls, r.tris].join(' | '));
```

- `pp.check()` refuses: its budget is the desktop's phone profile (618×1372); the phone's canvas differs. Compare
  with the history entry's figures instead.
- No graphics timer on phones (`gpu` null; the counter says so). Read the graphics card by the frames: 60 fps with
  `gap95` near 16.7 ms means on time; the frame's script time well under 16 ms and frames still late means the
  card is the limit.
- To try the tiers: `settings.quality = 'high'` then `view.setQuality(TIERS[k])` (`settings`, `view` from
  `context.ts`, `TIERS` from `app/quality.ts`, by `real()`), then put `'auto'` back. A frozen render waited for
  by `readPixels` takes 20–26 ms on the S24 whatever the size: that's the phone's latency, not its frame budget.
- Its Chrome ran at 60 Hz on its 120 Hz screen: say so rather than assume either.

## 4. Playing by touch

Read where things are with `eval` (an element's rect, the player's tile, the lesson's step), act with `tapText`,
`tapEl`, `tap` or `swipe`, then read again and take a `shot` to see it. A lesson from the menu: `tapText Tutoriel`,
`tapEl ".lesson-card.next"` (or the lesson's card by its text). The walk: a swipe from anywhere, held for its
`ms` (`swipe 180 330 180 450 2500` walked out of the first lesson's cell). Lesson 1's first step passed this way.

- The touches are real (Android's input, the game's own handlers), but their timing is a script's. A check of how
  something feels in a person's hand (a beat, reading speed, a finger's reach) still needs the user.
- The first touch on a tab measures where the page sits under Chrome's bar: one touch at the screen's middle,
  caught before the game sees it. It's kept for that tab and window size in the system's temp folder.
- `tapText`/`tapEl` look for Chrome's install sheet first (a second or two). `tap`/`swipe` don't, for timed
  sequences: `clear` before them. The sheet comes up by itself (the game is installable) over the bottom of the
  page, where the item bar is, and takes those touches.
- Don't use Back yourself: with no sheet up it leaves the game.
- A touch is never sent unless Chrome is the app in front, nor off the page, nor on an element something else
  covers: `tapText`/`tapEl` scroll the element into view first. (Before these guards, a tap aimed at a menu
  button below the fold landed on Android's Back and brought another app of the user's to the front.) When one
  refuses, read why; don't work round it with raw `adb shell input`.

## 4b. Screens and turning the phone

- Its window in Chrome: 360×641 upright, 697×274 turned (the address bar and Android's buttons take a
  third of the height). Turned, the game goes full screen at the first real tap in a game (780×360):
  start one (`playat`'s `at()` by `eval`), then `tap` once. A script's `click()` doesn't count.
- To turn it, Android's settings (the user's, so put them back exactly): read `settings get system
  accelerometer_rotation` and `user_rotation` first, then `settings put system accelerometer_rotation 0`
  and `user_rotation 1`; after, `user_rotation 0` and `accelerometer_rotation 1`, one at a time, and read
  them back (put together, the second was lost once).
- The layout's audit runs there as in the browser: `const s = await import('/scripts/dev/screensweep.ts');
  return await s.sweep();` (about two minutes; the phone shows French).

## 5. Long runs

- The phone can lock itself mid-run even with the screen kept on (2026-11-06, a 10-minute run lost): Chrome
  stops the page under the lock screen, and nothing here can unlock it (ask the user). Keep each `eval` under
  about five minutes (one prison's day at ×10 is 2.5), and keep results on `window` as well as returning them.
- The phone loads the same dev server: an edit to anything the page imports reloads it there too, and a run
  in progress dies. Write only new, unimported files while one runs.
- `performance.memory` doesn't move on Android Chrome (110.6 MB throughout): read memory from the
  renderer's counts there, the heap on the desktop.

## 6. The user's phone

It's the user's own: other tabs are open (the live site, the Play Console). The tool only ever touches tabs on
`localhost:5310`. Don't install the game on it, change its settings (but its rotation for a run, put back as
§4b says) or leave the screen forced on: run `cleanup` when done, and tell the user what's still open there
(the game's tab, the counter on: `?perf=0` turns it off; full screen, which Back leaves).

## 7. Writing it down

A check from `BACKLOG.md` §2 done on the phone gets its date, version and the phone's model there. Results go in
the work's history entry (`docs-upkeep`): what ran on which phone, the numbers, and what still needs a person.
