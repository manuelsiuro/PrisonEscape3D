# Decisions: Damage, tunnels and the layers

Chipping, digging, covers, the vents and the roofs, cave-ins. Where the design document (GDD) and `tech_plan.md` disagree, or say nothing, what was decided: the GDD wins unless a row says why not. Moved word for word from `PLAN.md` §2 on 2026-11-06, one file per area, rows in the order they were written. A new conflict, or a change to a decision, goes into its area's file in the same commit.

| Topic | tech_plan.md | Decision (GDD) |
|---|---|---|
| Reaching a ceiling grate | "By standing on a desk or toilet underneath" | Grates are reached **from the floor tile under them** (or the one ahead); no furniture needed. The L1 vents run from the player's cell over the corridors and the library to the generator room ladder (GDD §4.1 overlay) |
| Covers | Poster or fake block over a hole; fake vent; fake fence | Covers go on with the **use button** (the item in hand) and come off with the **action button** (back into the hand); a covered tile is shut and looks intact. A **poster only passes in the player's own cell** (a hole touching it); a fake wall block works anywhere |
| Desk over a tunnel | "Picking up the desk… sliding it back" | A tunnel can be dug **under the player's own desk**; the desk always covers it, except while the player is below (the desk is pushed aside: a guard looking in then sees the hole). The way down is a **Climb down** button in the desk's panel |
| Tile hit points | Walls 100, fences 100–120, grates 60; tools 4–50 a strike | As the GDD, plus a **tunnel entrance 40** and **earth 30** a tile (a spoon's 10 uses dig one tile). A strike lands at most every 9 steps; holding the button repeats it |
| Digging up | — | In a tunnel, facing **back along it** (not into earth), the shovel digs up through the floor above (any diggable floor); the player climbs out beside the hole |
| Cave-in damage | 40 HP | **40 health** (since P5; P4 took 40 energy) and the tile fills back in; at 0 the player is out cold (the infirmary). More than 2 unsupported tiles in a row cave in; a brace holds its 3×3, the tile under an entrance holds itself |
| Toilets | "More than 3 piles within an hour clogs" | A toilet takes **3 loads, then is clogged for an hour**. Wall chunks flush like dirt |
| Inmates and guards vs. holes | — | Holes and cut fences are the player's ways only: inmates and guards keep to the prison as built |
| Boulders (P9) | §4.2: "granite boulders on layer −1; dig around them" | Prisons may give an **underground picture** (`under`, `O` = boulder). A boulder refuses every tool (`cantStrike` "boulder", no wear, no energy), no tunnel entrance is dug over one, and the tunnel view shows them as grey rock humps so a digger can plan the way round |
