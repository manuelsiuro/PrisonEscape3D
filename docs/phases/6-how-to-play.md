# Phases: How to play, laid out again (P37–P38, v2.13–v2.17)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P37 How to play, laid out again** | 2.13 | `ui/screens/help.ts` rewritten: each tab a grid of tiles in groups (`ui/screens/helpTopics.ts`: tab, group, icon, colour, picture, diagram, recipes, item icons per line, lessons, see-also, prison gating), a search over every topic (word starts, accents off), a page per topic (picture or diagram, summary, key-number chips, numbered steps, a list, recipes drawn from the handbook, tip and watch-out call-outs, the fine print folded, Play the lesson from the title or a note in a game, previous and next); diagrams drawn from the game's data (the heat meter, timelines, noise in tiles, the pockets, pins by door colour, medals, the day's schedule); Basics and Escaping (29 topics) rewritten in that shape in English and French, Prison life with tile lines (pages next phase); 17 in-game pictures in `public/help/` from `scripts/dev/helpshot.ts` (a moment of an escape bot's run or a lesson, replayed and shown paused) and `shotsink.ts`; `tutorialFlow(first)` and the title's help loop (a lesson picked, played, back on its page) | `helptest` (every part in French with as many lines; every item, recipe, icon, lesson, prison, topic and picture there; words on each page); `i18ntest` |
| **P38 How to play II** | 2.14 | Prison life's 25 topics in the page shape in English and French (old French terms evened out: Intellect, suspicion, opinion, isolement, mutinerie), a second list per topic (`.list2`, for a topic in two parts: dice and arm-wrestling, the sports field and the garden, events and weather, the calls and Lou's line), colour dots as line icons (the cone's colours), the Controls tab grouped (moving, doing things, panels, games; keys and touch); 19 pictures from lesson scenes played on by the tutorial bots' moves (`helpshot.ts`); every topic now a page | `helptest` (both lists, dots, the controls' groups); `i18ntest` |
| **The day's card, easier games, Share** | 2.15–2.17 | The HUD clock opens the day's card (routine timeline, `state.blocks`); reading time at quiz night, kick and aim help at football, race-night reminders (`Sim.rules215`); Share on the title (QR code, copy link, share sheet) | `playclocktest`, `teamtest`, `stagetest`, `longtest` |

## How to play, laid out again (P37–P38) (PLAN.md §12 before 2026-11-06)
The user found How to play hard to read (2026-10-23): 6,164 words in 54 topics, a paragraph each, up to
290 words, the numbers buried, nothing to look at but an icon, no search, no link to the 45 lessons. The
user's choices: each tab a grid of tiles grouped under headings, with a search; a page per topic; in-game
pictures and diagrams drawn from the game's data; every fact kept, the fine print folded under More
details; two releases.

### Rules
- A topic's words are i18n parts (`help.<id>.hook`, `.sum`, `.steps`, `.list`, `.nums`, `.tip`, `.warn`,
  `.more`, and a diagram's own lines), one item a line; French has as many lines as English (`helptest`).
- What can be drawn from the game is drawn from it, never written twice: recipes from the handbook, pins
  by door colour, the routine's schedule, medals, the items' own pictures.
- A prison's own topics stay hidden until the prison is open, pictures included.
- Pictures are moments of real runs (an escape bot's or a lesson's), never staged by hand; retaken with
  `scripts/dev/helpshot.ts` when what they show changes (like the map viewer's photos).

### Phases
- **P37 (v2.13)**: the layout, the search, the diagrams, the picture tools and 17 pictures; Basics and
  Escaping (29 topics) rewritten; Play the lesson.
- **P38 (v2.14)**: Prison life (25 topics) and Controls in the same shape, with 19 pictures from the
  lessons' scenes.
