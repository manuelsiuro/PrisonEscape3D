# The documents: where to find what

Split by subject on 2026-11-06 (v2.34.1) so that one question needs one small file, not the whole
record. Nothing was rewritten: rows and entries moved word for word.

| You want | Read |
|---|---|
| How the project is run, the rules that matter every time | [`../CLAUDE.md`](../CLAUDE.md) |
| The plan: decisions, architecture, tests, the release routine, the status | [`PLAN.md`](PLAN.md) |
| What was decided about one part of the game, where the design document was overruled, what was accepted | [`decisions/`](decisions/), one file per area (the list is in `PLAN.md` §2) |
| What a polish pass already did to an area, the user's choices, its known limits | [`POLISH.md`](POLISH.md) |
| What one release changed, what its reviews found | [`HISTORY.md`](HISTORY.md), one line per release, then its range's file in [`history/`](history/) |
| How a phase was planned and proved (P0–P42, the polish series) | [`phases/`](phases/), one file per roadmap (the list is in `PLAN.md` §4) |
| What the game has, for players | [`FEATURES.md`](FEATURES.md) |
| The original design | [`the_escapists_3d_complete_game_design_document.md`](the_escapists_3d_complete_game_design_document.md) (the GDD, the source of truth), [`game_idea.md`](game_idea.md), [`tech_plan.md`](tech_plan.md) (engineering, where the GDD says nothing) |

**Finding one area's story.** Its row in `POLISH.md`, its file in `decisions/`, then search
`history/` for its name (`grep -l "vending" docs/history/*.md`).

**Old references.** `PLAN.md` §9–§13 and §5 are now in `phases/`, under headings that still say
which section they were (search for "PLAN.md §11"). `PLAN.md` §2's rows are in `decisions/`.

**Adding to them.**
- A new conflict or decision: a row in its area's file in `decisions/`.
- A release: its entry at the end of the latest file in `history/` (a new file every ten minor
  versions: `v2.40-v2.49.md` from 2.40), and its line in `HISTORY.md`.
- A polish pass: its row in `POLISH.md`, its row in `phases/8-polish.md`, its history entry.
- The status line: `PLAN.md` §8.
