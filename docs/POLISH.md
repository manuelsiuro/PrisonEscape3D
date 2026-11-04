# Gameplay polish: what's been done

One row per area of the game. Read an area's row before changing it, and update it when the work
is released (the `polish-gameplay` skill does both). The detail is in `HISTORY.md`, the rules in
`PLAN.md` §2. `polishtest` (npm test) checks this table's shape and that each version is in the history.

**State:** *Done*: reworked or reviewed at the user's request and checked in the browser (which doesn't
mean finished). *Partly*: one side of it was reworked, the rest wasn't looked at. *Not reviewed*: built
and tested when it shipped, but no polish pass, so nothing is known either way.

| Area | Version | State | The user's choices | Known limits |
|---|---|---|---|---|
| Showers | 2.26.0 | Done | The action button turns a shower on and walking away turns it off; inmates take turns, wait aside and dry off (maps unchanged); shorts and a towel while washing and drying, looks only; an ambush warns first, everywhere (1.5 s, the length was Claude's pick). Claude's picks too, no objection: heat under 25% falls a point faster every 2 s while washing; being in the room still counts | In San Pancho the warning saves few: on day 1 a bot is knocked out in 7 to 11 of 12 blocks however it reacts (the grudge rule is unchanged). Not played by hand on a real phone; sounds not heard; French not read by a native speaker |
| Canteen and meals | 2.25.0 | Done | Tray from the counter, held in both hands with no slot, carried back, 6 s to eat; inmates stop at the counter with no formal queue; a tray eaten and not brought back costs +10% heat (the amount was Claude's pick) | The row of trays doesn't shrink; inmates brush past each other in the busiest prisons; not yet played by hand on a real phone |
| Stats tab | 2.24.0 | Done | A headline and even groups, zeros dimmed, icons beside numbers | |
| Guards watching the routine | 2.23.0 | Done | A block's check-in takes time, skipping is seen, snooping in other cells is minded | |
| Tattoo | 2.22.0 | Done | Drawn by hand, the ring waits, scored by distance from the line | |
| Quiz, football, rat races | 2.16.0 | Partly | Longer reading time, ball control and aim help, race-night reminders | Made easier from measurements; the other side games weren't looked at |
| The manhunt | 2.21.4 | Done | A real outside world (houses, the prison behind the wall), with its lessons and maps checked | |
| Parole | 2.21.3 | Done | Played through in the browser, from the desk to the hearing | |
| Odd jobs | 2.21.2 | Done | Played through in the browser | |
| How to play | 2.14.0 | Done | Every topic a page with icons and pictures | Pictures retaken only when what they show changes |
| Roll call | | Not reviewed | | |
| Exercise and training | | Not reviewed | | |
| Jobs and the Work Period | | Not reviewed | | |
| Free time | | Not reviewed | | |
| Lights Out and sleep | | Not reviewed | | |
| Items and crafting | | Not reviewed | | |
| Searching and looting | | Not reviewed | | |
| Fights | | Not reviewed | | |
| Stealth and heat | | Not reviewed | | |
| Tools, digging, vents and roofs | | Not reviewed | | |
| Talking, favors and opinion | | Not reviewed | | |
| Merchants and money | | Not reviewed | | |
| Crew | | Not reviewed | | |
| Side games (dice, arm-wrestling, cards, hoops, checkers) | | Not reviewed | | |
| Long games (pruno, garden, rats) | | Not reviewed | | |
| Pay phone, kiosk and paperwork | | Not reviewed | | |
