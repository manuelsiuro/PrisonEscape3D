---
name: docs-upkeep
description: "Where each kind of fact goes in Prison Escape 3D's documents, how to write it, and the release's docs step: one home per fact, small files, entries wrapped, counts kept true. Use it whenever finishing a feature, a polish pass, a fix or a release; when writing to anything in docs/, the README, CLAUDE.md or the project memory; when adding a test, an item, a lesson, a help topic or anything else the docs count; or when the user asks about the documentation, even if they don't say 'skill' or 'docs'."
---

# Keeping the documents

The record grew to 700 KB, with the same story written in five places, until finding one thing meant loading
everything. It was split by subject on 2026-11-06 (`docs/README.md` maps it). This keeps it that way. Rules alone
get skipped, so `docstest` checks what can be checked: run `npm test -- docstest polishtest` after writing.

## 1. One home per fact

Write each fact once, in its home, and link to it from elsewhere. Don't retell it.

| Kind of fact | Its home | Not |
|---|---|---|
| How the project is run, rules that matter every time | `CLAUDE.md` (short: pointers to the rest) | the detail of any feature |
| Where to find what | `docs/README.md` | |
| A rule of the game where the design document (GDD) is overruled or silent, as it stands now | its area's file in `docs/decisions/` (one row) | the story of how it was found |
| What a release changed, what its review found, what was accepted | its entry in the latest `docs/history/` file, and its line in `docs/HISTORY.md` | the user's choices again in full |
| A polish pass: the user's choices and the known limits | its area's row in `docs/POLISH.md` (at most 1,500 characters from 2.35) | what was built, measured or fixed |
| A polish pass: the snapshots it moved and why | its row in `docs/phases/8-polish.md` | |
| A new roadmap of phases | a new file in `docs/phases/` (`9-<name>.md`), listed in `PLAN.md` §4 | |
| The status, the counts | `PLAN.md` §8 (`docstest` checks the counts against the game) | |
| What's open: areas not polished, checks only a person can do, parked ideas, upkeep | `docs/BACKLOG.md` (a pass that polishes an area takes it off; a check done by hand gets its date) | the detail, which stays in its home |
| What the game has, for players | `docs/FEATURES.md`, the README | |
| The user's preferences, how they like to work | the project memory | anything `git log` or the docs already say (parked ideas: `BACKLOG.md`) |

The design documents in `docs/source/` are never edited: a departure from them is a row in `docs/decisions/`.

## 2. How to write it

**A history entry** (from 2.35 on; older ones stay word for word): a bold title with the version, the user's
request quoted with its date, then short bullets wrapped at about 100 characters (`docstest` fails at 300):

```markdown
- **Street lamps that lean over what they light (v2.34.1, not released yet)**, the user's request
  (2026-11-06: "all the lampposts are oriented in the same direction").
  - **Choices:** see `POLISH.md`'s row (or the user's picks in a line, when there's no row).
  - **Built:** what changed, in the code's own names.
  - **Found:** while building, by the review, by the user, each with what was done.
  - **Accepted:** what stays as it is, and why.
  - **Not checked:** what nobody verified, and how much it matters.
```

Keep "not released yet" until `npm run docs:released`; its line in `docs/HISTORY.md` is the same title.

**A decisions row:** `| Topic (version) | what tech_plan.md or the GDD says | the decision |`, the rule as it stands
now. When a later release changes it, edit the row (saying since when) rather than adding a second one.

**A `POLISH.md` row:** the user's choices, Claude's picks the user was told about, the known limits. The how and
the measurements go in the history entry.

## 3. When it's done, and at a release

- **Finishing work** (on its branch, before asking to release): the history entry ("not released yet") and
  its index line; the decisions row if a rule changed; the `POLISH.md` and `phases/8-polish.md` rows for a
  polish pass; the counts in `PLAN.md` §8, `FEATURES.md` and the README if they moved (a new test script counts);
  `BACKLOG.md` (an area polished comes off; a check done by hand, its date; a new idea parked, its sketch).
- **Releasing** (`CLAUDE.md`'s Release rule): after `npm run released` sees it live, run `npm run docs:released`.
  It marks the entry released, sets the status line and restamps the map viewer, then prints the commit to make.
- **Memory:** a note only for what the repo can't tell (the user's preferences, a decision's why when it isn't
  written down), with a pointer to the doc that has the rest.

## 4. When a file outgrows its size

`docstest` fails over these: `PLAN.md` 30 KB, `HISTORY.md` 24 KB, a `decisions/` file 40 KB, a `history/` file
80 KB, a `phases/` file 60 KB, `POLISH.md` 40 KB, `BACKLOG.md` 16 KB, `CLAUDE.md` 10 KB, `docs/README.md` 8 KB.

- A history file: the next range starts every ten minor versions (`v2.40-v2.49.md` from 2.40). `docstest` names
  the file the version belongs in. List it in `HISTORY.md` under its own heading.
- A decisions area: split it in two by subject, list both in `PLAN.md` §2 and in `docs/README.md` if named there.
- `POLISH.md` or `PLAN.md`: say less. The detail has a home in §1's table.

Moving text: move it word for word, and check line by line that nothing was lost (every non-empty line of the
old file present in the new ones). Then check what pointed at the old place: `git grep` the old name across
`src`, `scripts`, the docs, the skills and the project memory.
