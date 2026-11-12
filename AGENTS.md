# Prison Escape 3D: guide for other coding agents (Antigravity and the like)

Written 2026-11-07 (v2.36.0), kept free of version numbers since 2026-11-12, so the project can go on with another agent while Claude's weekly
tokens reset. The project was built with Claude Code: its rules live in `CLAUDE.md` and its methods
in **skills** (`SKILL.md` files). This page says where everything is and how to use it from any
agent. It points to the real sources rather than repeating them; when they disagree, they win.

## 1. Where the project stands

- **Live:** the version in `docs/PLAN.md` §8's status line, at <https://manuelsiuro.github.io/PrisonEscape3D/> (repo
  <https://github.com/manuelsiuro/PrisonEscape3D>, branch `main`, tags `vX.Y.Z`).
- **The game:** an original Escapists-like 3D prison escape for the browser, phone and desktop.
  Six prisons and the Training Block; the sixth, **The Six Hunter** (level 6, out of the Daily),
  came in 2.36. The counts (ways out, items, tests…) are in `docs/PLAN.md` §8, checked by `docstest`.
- **Done:** every planned roadmap (P0–P42), the polish series, and the improvement queue
  (`docs/BACKLOG.md` §4). **What's open** is all in `docs/BACKLOG.md` (§1 areas not polished yet,
  §2 checks only a person can do, §3 ideas the user parked, §5 upkeep).
- **Another developer** has a clone for a Roblox port. Run `git fetch` before any merge or release,
  never force-push, rewrite history, or delete branches or tags without the user's go.

## 2. Read in this order

1. **`CLAUDE.md`**: the rules that matter every time (determinism, old runs replaying as they were,
   content as data, tests and snapshots, lint, storage, text in two languages, keys, UI tokens and
   sizes, map viewer, How to play, the release routine; the tools' procedures in `docs/TOOLS.md`). Everything in it applies to you too.
2. **`docs/README.md`**: where to find what (one small file per question).
3. **The skill for your task** (§5 below), before writing code.
4. The area's row in `docs/POLISH.md` and its file in `docs/decisions/`, before touching an area.

## 3. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server, the game at <http://localhost:5310/> (one may already be running: reuse it) |
| `npm run check` | Types, lint, layout and every test: gate on its **exit code**, never on `| tail` |
| `npm test -- name1 name2` | Some tests only; `npm test -- -u` accepts snapshots, **only after reading the diff** |
| `ONLY=<prison> npx tsx scripts/escapetest.ts` | One prison's escape bots (after any map change) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run maps` | Redraws the map viewer (`assets/maps/index.html`) from the game's data |
| `npm run released` | After a push: waits for CI, then the live bundle (exit 0 live, 1 failed, 2 still waiting) |
| `npm run docs:released` | Once live: marks the release in the docs, then commit and push what it lists |

In a dev build the browser console can drive the game: `const p = await import('/scripts/dev/playat.ts');
await p.at('six-hunter', 1, 8*60); p.freeze(); p.zoom(3);` (`window.__game()` is the running game).
`]` fast-forwards the clock ×30.

## 4. How to use the documentation

**To find a fact**, ask which kind it is and open its one home (the full table is `docs/README.md`):

| Question | File |
|---|---|
| What are the rules of the project? | `CLAUDE.md` |
| What is decided about a part of the game, and why it differs from the design doc? | `docs/decisions/<area>.md` (listed in `PLAN.md` §2) |
| What has a polish pass done to an area, what did the user choose, what are its limits? | `docs/POLISH.md`, that area's row |
| What did a release change, what did its reviews find? | `docs/HISTORY.md` (one line each), then `docs/history/<range>.md` |
| How was a roadmap planned and proved (the prisons, the polish series, the Six Hunter)? | `docs/phases/` (listed in `PLAN.md` §4) |
| What does the game have, for players? | `docs/FEATURES.md`, `README.md` |
| What's open or parked? | `docs/BACKLOG.md` |
| The original design (the source of truth for the game)? | `docs/source/the_escapists_3d_complete_game_design_document.md` (never edited) |

Search instead of reading whole files: `grep -l "vending" docs/history/*.md`.

**To write a fact**, follow `.claude/skills/docs-upkeep/SKILL.md`:

- One home per fact; link, don't retell.
- A history entry for every change, ending "not released yet" until `npm run docs:released`.
- Keep entries terse; files have size limits. A history file holds five minor versions from 2.35, so 2.40 starts `v2.40-v2.44.md`.
- Counts kept true.

Then run `npm test -- docstest polishtest`. `docstest` checks links, the index, sizes and counts.

## 5. How to use the skills

A skill is a folder with a `SKILL.md`: YAML front matter (`name`, `description`: when to use it)
and the body (the procedure). Any agent can read one as plain instructions: **open the skill whose
description matches the task and follow it step by step.**

| Skill | Where | Use it when |
|---|---|---|
| `polish-gameplay` | `.claude/skills/polish-gameplay/SKILL.md` | Reworking, polishing, rebalancing or reviewing any mechanic (a rule, a cost, a minigame, an animation). It starts from `docs/POLISH.md` and ends with an evidence table: every check with its proof, or "not checked". |
| `docs-upkeep` | `.claude/skills/docs-upkeep/SKILL.md` | Writing to anything in `docs/`, the README or `CLAUDE.md`; finishing a feature or a fix; the release's docs step. |
| `real-phone` | `.claude/skills/real-phone/SKILL.md` | Testing on the Android phone plugged in by USB (`scripts/dev/phone.ts`: adb, real touches, frame times). It's the user's own phone: put its settings back. |
| `web-game-playbook` | `~/.claude/skills/web-game-playbook/` (`SKILL.md` + `PLAYBOOK.md`) | The general method for browser games: architecture, tests, UI, releases, reviews, a team of agents. Not in the repo: it lives in this Mac's home folder. |
| `web-sim-game-playbook` | `~/.claude/skills/web-sim-game-playbook/` (`SKILL.md` + `PLAYBOOK.md`) | Big real-time sims, PrisonEscape3D's own lessons: NPC AI, saves, bots that prove content, growing a released sim without breaking it (§10), reworking a mechanic (§12). Also in the home folder. |

**Making Antigravity find them on its own.** The folder layout is not settled across Antigravity versions: guides
mention `.agents/skills/` (newer) and `.agent/` (older), so check your version's docs. Then link the skills
in rather than copying them, so there is one copy to keep up:

```sh
mkdir -p .agents/skills
for s in polish-gameplay docs-upkeep real-phone; do ln -s ../../.claude/skills/$s .agents/skills/$s; done
ln -s ~/.claude/skills/web-game-playbook ~/.claude/skills/web-sim-game-playbook .agents/skills/
echo ".agents/" >> .git/info/exclude    # local to this machine; nothing committed
```

On another machine, copy the two playbook folders from this Mac first, since they aren't in git.

**What in the skills is specific to Claude Code**, and how to do it elsewhere:

- *chrome-devtools tools with `isolatedContext`*: any Chrome in a fresh profile or incognito window
  (the user may be using the same Chrome).
- *`scripts/dev/playat.ts` and the other `scripts/dev/*` browser tools*: plain ES modules, imported in
  the dev build's console.
- *"Spawn a reviewer" / "a team of agents" / `run_in_background`*:
  - another agent session (Antigravity's agent manager), each in its own `git worktree`
    with its own dev-server port;
  - long commands in another terminal.
- *"The project memory"*: it isn't in the repo; §6 below holds what it says that matters.

## 6. Working with the user (from the project's memory)

- **AAA bar**: polished, consistent, no traps for a player, nothing half-done; light, family-friendly game text.
- **Plans first**: before building, give options with a recommendation; the user often takes the
  recommended ones. Record your own picks in `docs/POLISH.md` and tell them.
- **One step at a time**: one phase or session, then report what was verified and what wasn't
  (say "not checked" rather than imply it), then wait for the go.
- **Merge and release are separate goes.** Commit or push only when asked. "Bump version and push" means
  the release routine in `CLAUDE.md`: build, `npm run check` green, commit, `npm version minor|patch`,
  `git push --follow-tags origin main`, `npm run released`, then `npm run docs:released`.
- **Reviews before a merge**: an independent review (a fresh agent given the diff, not your
  conclusions), findings verified, fixed, then the checks again.
- **Technical calls are yours, with evidence**: show the measured benefit and the proof of no regression
  (snapshots unchanged, identical drawhash), not a question.
- **The map viewer stays in step with the prisons**; lessons go back into the playbooks only when the
  user asks.

## 7. Recipes for the usual tasks

- **Polish an area**: `polish-gameplay`, start to finish. Write `scripts/<area>test.ts` covering every prison,
  then play it in the browser at desktop, 412×915 and 915×412, in English and French.
- **Change a rule**: old logs must replay as they were. Put the new rule behind a new `Sim` flag, set by
  `src/sim/runlog.ts` for older logs:
  - copy the newest one: the last `rulesNNN` flag in `src/sim/Sim.ts`, set in `prepareReplay`
    (`src/sim/runlog.ts`) from a `beforeNNN` gate on the version the change ships in;
  - the `stale` gate in the `RunRecorder` moves to that version too (grep the newest flag's name).

  New state fields go at the end and are optional. If a field is absent from `freshState()`, copy it
  explicitly in `loadState` (`src/sim/load.ts`), or a save drops it. Avoid new draws from the state's random
  numbers, which move every bot. A changed `escapetest` snapshot is a regression until proven otherwise.
- **Add content** (an item, a job, a prison): it is data in `src/content/`. Follow
  `docs/phases/9-six-hunter.md` for a prison: its checklist lists everything a prison touches. Append only to item,
  zone, recipe and loot lists.
- **A render change**: if it should draw nothing new, run `scripts/dev/drawhash.ts`, taking its baseline on the old
  code first. If it changes what's drawn, run `scripts/dev/perfprobe.ts` `check()` in the phone profile.
  Both, and `hitchprobe.ts`, are in `docs/TOOLS.md`.
- **Release**: §6's routine; read what `npm run released` prints, not only its exit code.

## 8. Handing back to Claude

Leave the repo the way Claude would:
- work committed on a `feature/` branch;
- a history entry marked "not released yet";
- `docs/POLISH.md` and `docs/BACKLOG.md` updated;
- `npm run check` green.

Claude reads `CLAUDE.md`, the docs and `git log`, so anything not written there is lost.
