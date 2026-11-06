# Phases: Phone and kiosk (P34–P36, v2.10–v2.12)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P34 The pay phone** | 2.10 | `systems/phone.ts` (the queue from day 2 via `socialNow`, `wantsCall`, calls, `callRefusal`, `phrasesOf`, `phraseWorth`, `catchAt`, `louHears`, mail call at 12:00, `divertStep`, `cakeAtVisit`, `eatCake`, `wheels`, `carWaiting`, eavesdropping), `content/phone.ts`, `PrisonDef.comms` in the five campaign prisons, `EXT.CALL/SAY/LINE`, `TALK.SWAP`, `DOING.PHONE/QUEUE`, `SALT.CALLS/TAP`, `TODAY` bits, state `booth`, `line`, `turn`, `call`, `lou`, `phoned`, `rang` appended, `Sim.noQueue` for logs before 2.10, the cake item; `render/Phone.ts` (wall phone, handset off the hook, Lou's car, the diversion's beacon), PHONE and QUEUE poses, the cake's model; `ui/payphone.ts` (the dial, the queue, a call, Lou's three lines) and the talk panel's Swap places; sounds; rumour `phoneCall`, bubbles `in.phone`/`in.queue`; help; 6 achievements; lessons `payphone` and `cousin` (Center Perks) in Prison life | `phonetest` (the places, the queue, eavesdropping, places bought and cut, calls and refusals, money orders at mail call, the lawyer, tips, Lou's phrases and ways of talking measured against every listener, learned codes, each job through the real sim, saves); `tutorialtest` (the two lessons and their dead ends); `gossiptest` (phoneCall true); escapetest unchanged |
| **P35 The internet kiosk** | 2.11 | `systems/kiosk.ts` (logging in and the bill, `kioskRefusal`, `kioskOp`, letters (the money order shared with the phone: `askMoney`), the shop's order, courses (`courseQuestion`: `questionsOf` under `SALT.COURSE`), mail call's goods and drawings, the hollow book: `bookMove`, `openBook`, `hiddenIn`), `content/kiosk.ts`, `comms.kiosk` in the five campaign prisons, `EXT.KIOSK`, `DOING.KIOSK`, `SALT.KIOSK/COURSE`, state `kiosk`, `post`, `photos`, `course` appended, the thick and hollow books and the hollow book's recipe; `render/Kiosk.ts` (the wall terminal, the drawings over the bed), the typing pose, the books' model; `ui/kiosk.ts` (the bill and its clock, Mail, Shop, News, Courses); sounds; help; 3 achievements; lesson `kiosk` (Center Perks) in Prison life; the map viewer | `kiosktest` (the places, the bill, letters and money orders, drawings, the shop and a full desk, the news equal to the days that come, courses, the hollow book through every search but a dog, saves); `tutorialtest` (the lesson and its dead ends); stagetest (quiz night's questions unchanged); escapetest unchanged |
| **P36 The paperwork escape** | 2.12 | `systems/paperwork.ts` (`atDesk`, `atTray`, `trayRefusal`, `fileForm`, the records at 22:00, `calledNow`, `releaseRefusal`, `report`, the way out shutting), `content/paperwork.ts`, `GuardDef.about`, `comms.release` (`at`, `gates`, `bridge`) in the five campaign prisons, `World.release`/`setFreed`/`pastRelease`, route `paperwork` (`ESCAPES` appended), the release form in the strict guard's kit, state `release` appended, the blank and forged forms, own clothes, the forgery's recipe; no trail and no restricted-zone alarm while cleared (`watch.ts`, `k9.ts`); `render/Release.ts` (the podium), the forms' model, own clothes; `play/paperwork.ts` (the action button, the chips, the PA's call), the guide's arrows; rumours `guardNick/Home/Team`, `releaseForms`, `recordsCheck`, a guard's slip; help; 3 achievements, medals; lessons `forgery` and `release` (Center Perks) in Ways out; the map viewer | `paperworktest`; 5 new escape bots (the 28 others byte-identical); `dailytest`; `gossiptest`; `chattertest`; `tutorialtest` (both lessons and their dead ends) |

## Phone & kiosk (P34–P36) (PLAN.md §11 before 2026-11-06)

Prison life has no line to the outside. Every campaign prison gets two: a **pay phone** in a corridor and an **internet kiosk** in the library. Both are cheap, legal and open to everyone, and the guards watch them. The fun is bending them into an escape plan.

User decisions (2026-10-21):
- **Both machines**, in three phases: the phone, then the kiosk, then the paperwork escape (planned as hacking at the kiosk; built as forged paperwork, the user's choice on 2026-10-22).
- **The tapped line is a minigame**: the player picks the words, not a hidden risk roll.
- **Paperwork is a new way out** (an 11th route, `paperwork`), with an escape bot in every prison that has a front gate.
- Parked for later (see memory): gangs and turf, the riot, the parole board.

### Rules for every phase
- **Where**: the five campaign prisons. The Training Block has no library, mail room or visits, so these lessons run at Center Perks (as the stage and the quiz do).
- **Places are data**: `PrisonDef.comms = { phone, kiosk, release? }`. Each is a wall piece on a north wall (it faces the camera) or a side wall turned to the camera, and the tile in front of it, where the player stands.
  - They are **decor, not props**: nothing solid is added, so no inmate's or guard's path changes.
  - Candidates from the maps (final tiles picked at build and checked in the browser, never in the two rows a wall hides):
    - **Phone**: Center Perks' north corridor (41,21); Stalag Flucht's corridor (z51); Shankton's first corridor (28,24); San Pancho's wing hall (20,12); Irongate's main corridor (40,39).
    - **Kiosk**: Center Perks' library (19,30, the globe moves); Stalag Flucht's (17,54); Shankton's (24,43, side wall); San Pancho's (44,44, side wall, x=41 kept clear); Irongate's (48,34, the globe moves).
  - `stagetest`'s pattern checks them: open floor, the right zone, reachable, clear of decor on the floor.
- **The sim**:
  - New system files: `systems/phone.ts` (P34), `systems/kiosk.ts` (P35), `systems/paperwork.ts` (P36).
  - Inputs: `EXT` codes from 17 (`CALL`, `LINE`, `SAY`, `KIOSK`…; P36 needs none: the release desk is Interact), `TALK` from 25 (`SWAP`). OP 14 and 15 stay free.
  - Every draw from `roll()` with new `SALT`s from 27. `DOING` from 30 (`PHONE`, `QUEUE`). `TODAY` bits from 8192.
  - New state fields appended, loading as optional. What a card shows is a pure function of the state.
- **The escape bots stay byte-identical.** Everything is on the player's request, except inmates queuing for the phone.
  - The queue starts on **prison day 2** (as the dogs). Inmates are led there through `socialNow` (no draw from the state's RNG).
  - If a multi-day bot (the takeover bots train for days) still changes, the queue waits for the player's first call in the run. It is never fixed by accepting a changed snapshot.
  - **Built (P34, the rules review):** the economy bot's day 3 changed with the queue from day 2 alone, so the queue (and the `phoneCall` rumour) waits for the player's first use of the phone in the run (a call or a place in line: `phoned[6]`). Every multi-day test is back to its snapshot.
- **Time**: one game minute is one real second. Every card has a clock the player can see (as Cheat's 60 s), and a lesson's step has a least reading time.
- **Every phase ships** sim, 3D, phone and desktop UI (cards docked left in landscape), EN and FR, help, bubbles, rumours, achievements and ledger counters, lessons, a test script, the map viewer brought up to date (P35: the kiosk on its wall), three reviews (rules, UI and text, 3D), then a release. Then I wait for the go.

### P34 The pay phone (v2.10)
**The booth**: a wall phone with a hood, a coin box and a handset on its cord.
- Open in the morning and evening free time (`fixerOpen`), never in a lockdown. Each call costs coins up front.
- **On the phone** the player stands at the booth, the handset to their ear (`DOING.PHONE` pose). Walking away hangs up.

**The queue** (from prison day 2)
- In each free time, a few inmates want to call: `roll(SALT.CALLS, day, inmate)`, the line at most 4 (`LINE_MAX`). They wait on the tiles along the wall, then talk 10–20 game minutes each.
  - **Built:** 40 in 100 want a call, within the first hour of the free time (at one in four, spread over it, no line ever formed). The line faces up itself, each the one ahead.
- The player gets in line with Act at a busy booth. Their place shows on the HUD; leaving the line's tiles loses it.
- **Buy a place**: talk to the inmate ahead, "Swap places" for $5 (`TALK.SWAP`). **Built:** only the one just ahead (the rules review: buying the first place jumped the whole line, cheaper than cutting in).
- **Cut in**: straight to the front (`EXT.LINE`). Everyone in line thinks 10 less of the player, and the inmate pushed back may swing at them (`roll()`, more likely at San Pancho).

**The calls** (`EXT.CALL`, b = who, c = an argument)
| Call | Cost | What it does |
|---|---|---|
| **Home** | $2 | +15 energy, once a prison day. Once every 7 prison days the family sends a **money order** ($15–30, `roll()`), paid at the next mail call |
| **Lawyer** | $30 / $40 | **Appeal**: heat −30, once a prison day, refused while wanted (heat 80+) or in a lockdown. **Retainer**: for 3 prison days, a stretch in solitary is halved |
| **Your cousin Lou** | $2 + the job | The escape helper, on a tapped line (below) |
| **Anonymous tip** | $2 | Name a cell. The shakedown guard searches it within the hour (`assign(…, GUARD.SHAKEDOWN, [cell])`): a search you choose, and a guard drawn away. Nothing found: +15 heat. Once a prison day. A 1-in-4 chance (`roll()`) that word gets round: its inmate thinks 30 less of the player ("Snitch!") |

**Mail call** (new): at 12:00 each day, outside a lockdown, a guard hands out the post. P34 pays money orders; P35 adds shop goods and photos (into the player's desk's open slots, as the Red Cross parcel does).

**The tapped line** (the cousin's minigame)
- The player picks a job, then says it in **three lines** (who, what, when). Each line offers three phrases, shuffled by `roll()`:
  - **plain** ("Bring a file in a cake"): clear to Lou, but loud to a listener;
  - **coded** ("Bake that cake Mum made"): half clear, half loud;
  - **deep code** ("The rooster crows twice"): silent, and Lou misses it, *unless he has already learned it*.
- **Lou understands** when the clarity adds up (tuned in the build). If he doesn't, the money is lost and Lou says "What are you on about?".
- **The listener**: a guard on duty, drawn per call; the card names them. **Built:** drawn for the day, not the call (the rules review: hanging up and redialling for $2 dodged a strict listener every time). Their trait sets how much risk they catch: strict the least, then steady, then lazy and corrupt. A corrupt guard bribed to look away today isn't listening. Too loud: +40 heat and the job is blown (the cake seized at the visit, the diversion ignored, the car turned away).
- **Codes are learned**: a deep code Lou has understood once (from a plain or coded line in the same call) is his for the run, kept in state: clear *and* silent from then on. Early calls are risky; later ones get smooth.
- Measured in `phonetest` with pure strategies (all plain, all coded, all deep, learning): none is safe *and* clear on every listener at the first call.

**Lou's jobs**
| Job | Cost | What happens |
|---|---|---|
| **Diversion** | $30 | At the hour the player names (its next stroke at least an hour ahead), a disturbance at the front gate: car alarm, flashing light; the 3 nearest awake guards go and look for 10 game minutes (`summon`), then return to their beats (in a lockdown, ignored). Once a prison day |
| **Cake with a file** | $25 | At the next visit (Stalag Flucht: the next Red Cross parcel) after today, a cake. It isn't contraband, so the frisk passes it. Eating it gives energy and a **metal file** |
| **Getaway car** | $50 | Tonight (23:00–05:00) a car waits on the road. An escape that ends on the road that night drives off in it: its own escape scene, a line on the victory card and an achievement. A reward, not an advantage |

**Eavesdropping**: an inmate on the phone talks about things they know. A player within 2 tiles for 8 game minutes overhears **a true secret**: a sim event, then the `Director` picks a lasting fact the player hasn't heard (as the old-timer's secret does) and it goes in the file. Once a prison day per inmate.

**Also**: the phone's wall piece, the handset and queue poses, the cake, the car on the road, the gate's alarm light; the phone card (the dial, the coin, the clock) and the line card (three rows of phrases, the listener and their trait, the learned codes marked); the line on the HUD; sounds (coins, dial tone, the ring, a car alarm); the PA's diversion and mail-call lines; bubbles in the queue; rumours (`phoneLine`: who calls when); help topic **Pay phone**; achievements (calls home, a cousin's job done, wheels, secrets overheard, a successful tip, a line cut); lessons `payphone` (calls, mail call, eavesdropping) and `cousin` (a job on the tapped line) in Prison life, both at Center Perks with their own seeds.

**Proof**: `phonetest` (the places in every prison; the queue's draws, its places, swaps and cuts; each call's rules and refusals; money orders at mail call; lawyer's appeal and retainer; tips and their search; the line's phrases, listeners, learned codes and the strategies measured; each job through the real sim: the diversion's guards and their return, the cake through a frisk, the car's night; eavesdropping true; saves and old logs); `gossiptest` (the new rumour true); `tutorialtest` (both lessons and their dead ends); escapetest byte-identical.

### P35 The internet kiosk (v2.11)
**The kiosk**: a wall terminal with a glowing screen and a keyboard shelf, in each library. Open in the free times outside a lockdown. **$1 per 10 game minutes** while logged in (`EXT.KIOSK`), paid up front for each block.
- **Built:** where it hangs: Center Perks (19,30, its globe moved to 16,31), Stalag Flucht (17,54), Shankton (24,43, the west wall), San Pancho (44,44, the east wall), Irongate (48,34, its globe moved to 51,37). Walking off, the kiosk shutting or no dollar for the next block logs the player out; what's left of a block is lost, and so is a course under way. One player at a time: inmates never use it (the escape bots play as before).
- **Built (mail):** the reply's drawing comes at a mail call after the day the letter was written (never the same day); a letter while one is on its way doesn't change it. A new drawing is one not on the wall yet. A lockdown at noon holds the mail.
- **Built (shop):** 30% under a merchant's price to a stranger (well-liked merchants go lower: they're friends). One order a day, and one coming at a time. Goods go into the desk's open drawers, never the hidden one; a full desk keeps them for the next mail call.
- **Built (courses):** `questionsOf(sim, day, SALT.COURSE, 5, 2)`: two from the history bank, three about this prison, ten game minutes each. Answers 1–4 as at the quiz.
- **Built (after the reviews):** the kiosk shuts in a power cut (its screen goes dark: logged out, `kioskDark`); no course in the last hour of free time (`COURSE_LATE`, the longest a course can take); a hollow book with something in it can't be given away (`bookFull`); a save with a course and nobody logged in, or time paid far ahead, loads logged out.
- **Built (the hollow book):** the hidden item lives in the book's slot's upper bits (where wear is kept), so every search that reads `itemOf` misses it: the detector's frisk, the frisk out of the visiting room, a cell search, and the guards after a capture. The dog's nose reads inside. A small item moved onto an empty hollow book goes in; the use button takes it out. The razor blade is kept (it cuts the pages).

**The apps**
| App | What it does |
|---|---|
| **Mail** | Write home: once every 7 prison days the money order (shared with the phone: one a week, whichever asks). Once a prison day, a reply at the next mail call with a **photo** (a family drawing chosen by `roll()`); up to 3 pinned on the cell wall over the player's bed |
| **Shop** | Legal goods only (soap, chocolate, a magazine, toothpaste, talcum, ink, a battery, an alarm clock…), cheaper than the merchants, one order a prison day, into the desk at the next mail call. Nothing is stocked (P28's rule). `kiosktest` checks no item is contraband. Plus a **thick book**: with a razor blade (Intellect 30) it becomes a **hollow book** holding one small item; a frisk, the noon frisk, a cell search and a detector don't find it; a dog still smells what dogs smell |
| **News** | The next 3 days' cards, weather and wind (`planOf`, pure), the next delivery and visiting day, and headlines from the run (a lockdown, the quiz and talent winners) |
| **Courses** | 5 questions from the quiz bank (history and true questions about this prison: `questionsOf` under its own salt, not quiz night's set); 4 right: +3 Intellect. $5 and 10 energy, once a prison day |

**Also**: the kiosk model, the photos on the cell wall, the kiosk panel (tabs for the apps, the clock and the bill), sounds (keys, a chime), help topic **Internet kiosk**, achievements (photos, courses passed, the hollow book), lesson `kiosk` in Prison life (Center Perks).

**Proof**: `kiosktest` (the places, billing, each app's rules, mail call's goods and a full desk, the forecast equal to the days that come, courses' questions true and their reward, the hollow book through every search, saves); `tutorialtest`; escapetest byte-identical.

### P36 The paperwork escape (v2.12)
**Built as forged paperwork** (2026-10-22, the user's choice). The plan had the player hack a guard's account at the kiosk with a boot stick and a word screen; that is dropped, and the kiosk stays as P35 built it. What carries over: the guards' lives as gossip, the release list, the release at 10:00, route `paperwork` with five bots.

**Guards have lives**: each guard gets `about = { nick, home, team }` as data (A–Z, 5 to 7 letters, the same in every language). Lasting rumours `guardNick`, `guardHome`, `guardTeam`: inmates gossip them, and a guard the player chats with lets one the player hasn't heard slip, once a prison day (its own lines, `gu.slip.*`). Flavour: nothing in the rules reads them.

**The form**: the strict guard (the morning shakedown's: a supervisor) carries a **blank release form** in its pockets (`guardKit`; a new one at 08:00 once taken): knocked out, or its pockets raided by the pet rat while it sleeps. A blank form and ink make a **forged release form** (Intellect 80, `FORGE_INT`). Both are contraband and small.

**The tray**: at the **release desk** (`comms.release.at`, tiles the player can walk to at 10:00 with no key), a forged form in hand, Interact slips it into the tray: the player's name is on tomorrow's release list. Refused with a guard watching (`watched`), wanted or in a lockdown (`hunted`), or with a name already listed (`onList`).

**The records** at 22:00 that night: with the heat at 40 or more, or after a lockdown that prison day, the name gets a second look and the forgery is found: a lockdown, the player's cell searched, the name struck. Otherwise it passes. (A rule the player can read and play to: keep your head down tonight. No hidden roll.)

**The release**: at 10:00 the PA calls the name. Between 10:00 and 10:30 the player reports at the release desk (Interact): heat under 40, no lockdown, nothing contraband on them (the hotbar, weapon and outfit; a hollow book's inside isn't looked into). Cleared: into their **own clothes** (`own_clothes`), and the doors from the desk to the road (`comms.release.gates`, Irongate's drawbridge too) open for them alone for 60 s, never shutting on them between the doors; no alarm, no dog trail on the way. Out on the road: route `paperwork`. Turned away: +40 heat and the name struck. Not reported by 10:30: the name struck.
- **Built (where):** none of the checkpoint windows can be walked to at 10:00 without keys, so each prison has its own release desk, with the doors out from there: Center Perks by the visiting room's south doors (out through them and the south gate); Stalag Flucht in the yard at the front gate; Shankton at the staff door off the corridor (through the quarters, the control room and the shell's gates); San Pancho at the library's back door (the generator room, the control room, the supply road); Irongate at the corridor's south doors (the ferry gate, the drawbridge lowered). `paperworktest` checks each: reachable at 10:00 with no key, shut it keeps the player in, open it leads to the road, for the player alone.
- **Built (after the reviews):** the tray takes forms only until 22:00 (the night's records done: `trayLate`); the prison day of the last lockdown is kept in the state (`release[2]`); cleared, the way out shuts after its minute unless the player stands in one of its doorways (no more staying cleared past the desk), and at once on a capture; the blank form is worth more than the guard's key (a rat sent to the pockets brings the form).
- **Built (3D):** the desk is a freestanding podium beside the release point (a tray of forms, a sign on a post with no words, a lamp: amber blinking while the name is called, green while the way out is open): every desk tile is by doors or in open floor, with no wall facing the camera to hang it on.

**Also**: the forms' model, the player's own clothes (a blue shirt over jeans), the podium; the action button (File the form, Report for release), the HUD chip (on tomorrow's list; report by 10:30; Released with its 60 s), the floor arrows (to the desk when called, then out), the PA's call; the rumours `releaseForms` (who carries them) and `recordsCheck` (when, and at what heat); help topic **Forged paperwork**; achievements Time Served (out by paperwork), Forger (a form filed), Red Tape (hidden: the records found it); medals for `paperwork` in every prison; a replay highlight; lessons `forgery` and `release` in **Ways out** (Center Perks); the map viewer (the desk and its doors out, drawn and in-game photos).

**Proof**: `paperworktest` (the guards' words; the desks and their doors in every prison; the form, its recipe, a new one at 08:00; the tray's refusals; the records passing and finding it; the release called, turned away, cleared, missed, the doors holding and shutting, out by paperwork; saves); **5 new escape bots** for `paperwork`, the 28 others byte-identical; `dailytest` (paperwork under every twist of each prison); `gossiptest` (the new rumours true); `chattertest`; `tutorialtest` (both lessons and their dead ends).

### Phases
- **P34 The pay phone (v2.10)**: `comms` data and its checks; the queue; mail call; home, lawyer, tips, the cousin's tapped line and his three jobs; eavesdropping; two lessons.
- **P35 The internet kiosk (v2.11)**: the kiosk; mail and photos, the shop and the hollow book, the news, courses; one lesson.
- **P36 The paperwork escape (v2.12)**: the guards' lives as gossip, the blank and forged release forms, the release desk's tray, the records at 22:00, the release at 10:00 and route `paperwork` with five bots; two lessons.
