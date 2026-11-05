# Gameplay polish: what's been done

One row per area of the game. Read an area's row before changing it, and update it when the work
is released (the `polish-gameplay` skill does both). The detail is in `HISTORY.md`, the rules in
`PLAN.md` §2. `polishtest` (npm test) checks this table's shape and that each version is in the history.

**State:** *Done*: reworked or reviewed at the user's request and checked in the browser (which doesn't
mean finished). *Partly*: one side of it was reworked, the rest wasn't looked at. *Not reviewed*: built
and tested when it shipped, but no polish pass, so nothing is known either way.

| Area | Version | State | The user's choices | Known limits |
|---|---|---|---|---|
| Lights Out and sleep | 2.28.0 | Done | At night energy comes back only asleep; a few hours fill it, a whole night out means starting the day on what's left. The bed's button adapts at night: dummy in hand Tuck in, dummy in bed Take out, then Sleep; other things in the bed wait for morning. At a bed check, in your cell is enough, and the guard says something if you're up, at no cost. Claude's picks: awake, energy still creeps back to 20% so nobody is stranded; asleep a point every 2 minutes; 25 minutes to get home instead of 15, a warning at 22:50 and no searchlights on the walk; the cell block's lights go out at 23:25; the dummy drawn in the bed; a morning toast | San Pancho's tunnel bot, out of energy underground, gets out at 00:04 instead of 23:24. Stalag's walk home from the sports ground, shut by then, takes 24.7 of the 25 minutes. Not played by hand on a real phone; the lights' sound not heard; French not read by a native speaker |
| Roll call | 2.27.0 | Done | Counted on your own orange square only (off it to the end: +25% heat, no lockdown; out of the yard: a lockdown, as ever); the warden walks the line and calls you first, the button says "Here!" and you press it. Claude's picks: +5% heat for a call unanswered in 5 s, short of a chase; the 2.23 half hour stays; the shakedown stays at 08:00, shouted and kept on the pill through roll call. On screen it's "a guard" and their name, since the game's Warden is someone else | Not played by hand on a real phone; sounds not heard; French not read by a native speaker |
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
| Exercise and training | | Not reviewed | | |
| Jobs and the Work Period | | Not reviewed | | |
| Free time | | Not reviewed | | |
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
