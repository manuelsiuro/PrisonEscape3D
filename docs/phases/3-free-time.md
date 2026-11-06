# Phases: Free time (P27–P30, v2.2–v2.6)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P27 Card sharks** | 2.2 | `systems/cards.ts` (`dealRound`, `decide`, `claimOdds`, `lay`, `callOn`, `keepCheat`), `systems/hoops.ts` (`courtOf`, `rimOf`, `spotAt`, `powerAt`, `windAlong`, `eighthOf`, `shotWindow`, `judge`, `startShootout`, `keepHoops`), `systems/checkers.ts` (`stepsOf`, `elderMove`, `checkersOp`, `moveOn`, `keepCheckers`), `content/leisure.ts` `court()`, `PrisonDef.leisure`, `TALK.CHEAT/PLAY/LIAR/HOOPS/CHECKERS/MOVE`, `EXT.SHOOT`, state `cheat`, `shootout`, `shot`, `practice`, `board`, `elder` appended; `render/Pastimes.ts` (spots, ball, cards, board), poses CARDS/BOARD/SHOOT, the decor hoop's open rim and net; `ui/pastimes.ts` (Cheat, court and board cards), the talk panel's rows; sounds; help; 6 achievements; the `oldTimer` rumour and the old-timer's secret; lessons `cards`, `hoops`, `checkers` in Prison life | `cardstest` (data and courts, Cheat in the game and its ways of playing measured, the tell's odds, hoops' windows and shots, shootouts and sports day, checkers rules and AI, saves), `tutorialtest` (the three lessons and their dead ends), `gossiptest`, escapetest unchanged |
| **P28 Long games** | 2.3 | `systems/pantry.ts` (`take`, `buyStaple`, `sell`), `systems/pruno.ts` (`ferment`, `brewNear`, `drink`, `tipsy`), `systems/garden.ts` (`bedTarget`, `tend`, `growGarden`, `underPlant`), `systems/races.ts` (`rivals`, `raceCard`, `oddsOf`, `runRace`, `raceOp`, `races`, `trainRat`), `content/long.ts`, `leisure.garden`/`race`, 8 items and 2 recipes, `EXT.TAKE/RACE`, `TALK.SELL`, `SALT.RACE`, state `pantry`, `tipsy`, `plots`, `race` and the rat's `speed`/`fed`/`lap` appended; `render/Long.ts` (beds and plants, the chalk track, racers, the home track), the tipsy sway, item models; `ui/long.ts` (the race card), the container panel's take row, the talk panel's staples and sales, the tipsy pill; sounds; help; 4 achievements; rumours `pruno`, `gardenHole`, `raceNight`, `ratFed`, `ratHungry`; lessons `pruno`, `garden`, `ratRace` in Prison life | `longtest` (data, the makings, sales, fermentation, the dogs' nose and searches, tipsy, the garden and the weather, the hidden hole, the track, the race's odds measured, bets, scratches, lockdowns, gambling heat, saves), `tutorialtest` (the three lessons and the race's dead ends), `gossiptest`, escapetest unchanged |
| **P29 Team & ink** | 2.4 | `systems/football.ts` (`teamsFor`, `startMatch`, `matchTargets`, `keepMatch`, the ball's roll and goals, `sightFor`, `endMatch`), `systems/tattoo.ts` (`inkRefusal`, `startInk`, `steerNeedle`, `drawNeedle`, `keepInk`, `endInk`), `content/team.ts`, `leisure.pitch` in every prison, the tattoo gun and its recipe, `EXT.KICK/INK`, `TALK.FOOTBALL/TATTOO/INK_ME`, `SALT.FOOTBALL`, `DOING.FOOTBALL/TATTOO`, the followers' `pace`, state `match`, `ink`, `inked` appended; `render/Team.ts` (the pitch's paint, the goals and nets, the ball, the sides' rings), the forearm tattoos, kick and tattoo poses, the gun's model; `ui/team.ts` (the match card and its Kick pad, the tattoo card), the talk panel's rows; sounds; help; 4 achievements and 2 tattoo cosmetics; lessons `football` (Center Perks) and `tattoo` in Prison life | `teamtest` (the pitches, the ball, the teams, the walk on, matches measured against a bot, the cover and a goal's look, off and fouls, the gun, refusals, tracing from fixed commands, heat, giving up, the player's own tattoo, saves), `tutorialtest` (the two lessons), escapetest unchanged |
| **P30 Stage nights** | 2.5 | `systems/talent.ts` (`actsOf`, `stageRefusal`, `startShow`, `playNote`, `keepShow`, `markOf`, `placeOf`, `stageTargets`), `systems/quiz.ts` (`questionsOf`, `buzzOf`, `contestantsFor`, `joinQuiz`, `answerQuiz`, `keepQuiz`, `endQuiz`, `quizTargets`), `content/nights.ts` (the songs as note charts, the history bank), day cards `talent` and `quiz` in every deck with `beforeStage`, `leisure.stage`/`quiz` in every campaign prison, the guitar and its recipe, `EXT.STAGE/NOTE/QUIZ/ANSWER`, `SALT.STAGE/QUIZ`, `DOING.DRUMS/GUITAR/QUIZ`, the followers' `face`, state `show`, `stageDay`, `quiz`, `quizDay` appended; `render/Nights.ts` (the stage, the buzzers), the instruments and poses, the guitar's model; `ui/nights.ts` (the talent card with its lanes and pads, the quiz card); the song's music synthesized from its chart; rumours, help, 3 achievements; lessons `talent` and `quiz` (Center Perks) in Prison life | `stagetest` (the places, the decks, the charts, the acts on the stage, refusals, songs played by bots at fixed steps, the verdict, the questions true in the running game, quiz bots measured, saves, old saves and logs), `tutorialtest`, `gossiptest` (the new rumours true), escapetest unchanged |
| **P23–P30 polish** | 2.6 | Known limits and three reviews: `render/batch.ts` (BatchedMesh furniture and decor, `skipEmpty`, `disposeTree`, `Later`), one SkinnedMesh per character, instanced doors, lintels and leisure props, `View.setWorld` reusing the same World (Watch again) and freeing the last prison after the next frame, the ground canvases cached per prison; the trees' leaves faded over anyone under them (`DecorView.shelter`), side-wall hoops turned to the camera, the roll call's paint over a pitch on its own layer (`rollCallLayer`), Big Freeze snow anywhere; the play clock (`playNow`, `playLater`); `render/pitchFrame.ts` (a match framed whole); the pruno's two presses, arrow keys on radios and tabs, replay zoom; `Sim.rules250`, Cheat's and the shootout's clocks, talent no-shows (`keepActs`, `performersTonight`), `World.afoot`, `budgettest`, `rendertest`, `playclocktest`, `pitchframetest` |

## Free time (P27–P30) (PLAN.md §9 before 2026-11-06)

Ten free-time activities, one vertical slice per phase. Each one is fun on its own and feeds back into the escape (money, opinion, attributes, secrets, cover).

### Rules for every activity
- **When**: free time, morning and evening, and the exercise hour, never in a lockdown (`gamesOpen`), unless the activity says otherwise.
- **Who**: an inmate who thinks well enough of the player (`GAME_OPINION`), on their feet. A game against an inmate is one of the three each plays a day (`GAMES_A_DAY`, shared with dice and arm-wrestling); the old-timer's checkers is free of that (built: P27).
- **A game begun plays out** past the games' hours (a hand of Cheat, a shootout, a sitting at the board: a talking inmate stays put); the sirens, a knockout or walking away end it (built: P27).
- **The sim**:
  - Every draw comes from `roll()` with a new `SALT`, never the state's rng.
  - New state fields are appended and load as optional.
  - Inputs:
    - **Talk actions**: new `TALK` codes from 15 up (b, and c where needed).
    - **Other actions**: new `EXT` codes from 8 up.
    - The free `OP` slots 14 and 15 stay free.
  - What a card shows is a pure function of the state, so the screen and the rules never disagree. This is the lockpick's pattern.
- **No map edits** where it can be avoided. A prison's places for the activities are data (`PrisonDef.leisure`): a hoop, a pitch, a garden or a stage. They are drawn by the render and checked by `maptest` (open floor, in the right zone, reachable).
- **The escape bots stay byte-identical.** Nothing new happens unless the player asks for it.
  - A new day card replaces a card "in place of" one, as sports day did.
  - It comes with a guard for older saves and run logs, like `beforeSports`, so older replays play the same.
- **Every phase ships**:
  - the sim with its rules;
  - 3D models and poses;
  - phone and desktop UI (touch pads, keyboard keys, cards docked left in landscape);
  - English and French text;
  - help, bubbles, rumours, achievements and ledger counters;
  - a lesson per activity, appended to **Prison life** (`CHAPTERS.life`);
  - a test script per phase;
  - three independent reviews (rules, UI and text, 3D) before the release.

### P27 Card sharks (v2.2): Cheat, Hoops, Checkers

**Cheat, the card game** (bluffing; in French « Menteur »)
- **The table**:
  - With an inmate in the games' hours, from the talk panel's Games, for a stake ($5, $10 or $20, as dice; asked twice).
  - The deck is 14 cards: 4 Kings, 4 Queens, 4 Aces and 2 Jokers (wild), shuffled by `roll()` (built: 20 cards made a three-card claim impossible to prove false).
  - 5 cards each, and a table card (K, Q or A) is drawn each round.
- **A turn**:
  - Play 1–3 cards face down, claimed to be the table card, or call **"Liar!"** on the last play.
  - The caller is right: the liar loses a chip. The caller is wrong: the caller loses a chip.
  - After a call, a new round is dealt.
  - A hand played out with no call: the other player must call.
  - First to lose 2 chips loses the stake. The stake is held on the table, as with dice.
- **The inmate**:
  - Plays true when it holds the table card, and bluffs otherwise.
  - Calls with certainty when the claim can't be true given its own cards and the true cards it laid this round. Otherwise it calls on the claim's odds as it sees them (exact, from the cards it can't see), more when it has no true card and when the player is down to two cards. Measured (2000 games each, Int 10 and 80): a player who never calls wins 40%, one who reads the tells 48–55%, one who counts the cards 58%, calling everything 2%, bluffing everything 28–32%.
- **Tells**: each inmate has a tell of its own (scratching an ear, a glance away, drumming its fingers, a whistle). It shows on the card and as a bubble.
  - When it lies, the odds of a tell are 30% + Intellect/4, at most 80% (built; first 50%: reading tells won 77%).
  - When it tells the truth, a false tell shows 20% of the time.
  - So Intellect lets the player read people, but never with certainty.
- **Heat and rewards**:
  - A guard who sees the game gives gambling heat, as with dice.
  - Any game gives +2 opinion.
  - The ledger counts games, wins and correct calls.
- **The clock** (2.6): the player's move has 60 s (game minutes: `TURN_STEPS`), shown on the card. When it runs out, the call is made for them if that is all they can do, else the hand is folded ("Time's up"). A game still on at roll call or Lights Out is settled at the bell: behind, it's lost; ahead or level, the stake comes back (never won at the bell: a lead stalled to it would be a sure profit). No clock in the lessons.

**Hoops** (aim and timing; the wind and the rain matter)
- **The court**: the decor's basketball hoop on its pole in each prison's yard (Center Perks, Shankton and Irongate had one; Stalag Flucht, San Pancho and the Training Block got one; most face the camera), its rim over a tile (`leisure.hoop`: the tile and its facing), with 5 shooting spots painted on the ground (built: no wall-mounted boards).
- **The shootout**: against an inmate, 5 shots each from the 5 spots, taking turns. Most baskets wins; a tie goes to sudden death, at most 3 more.
- **Solo practice**: anytime the yard is open.
- **A shot**:
  - Stand on the lit spot and hold Space or the Shoot pad. The power marker rises and falls.
  - Release: the sim judges the step of release, or the one before, against a make window.
  - The window is centred on the power needed for that distance:
    - it is wider with Speed;
    - it is narrower with distance and rain;
    - the wind (P14) moves it.
  - Inside the middle third of the window: a swish. Elsewhere inside it: in off the rim. Just outside: a rim-out. Further out: an airball.
  - The rim's clang is a small noise.
- **The inmate**: it shoots by `roll()` with a skill drawn by cell.
- **Rewards**:
  - A win gives +6 opinion and +1 Speed (trained today), and the crowd cheers as at a bout (once a day each).
  - A shootout won counts for **sports day** like a bout won.
  - Practice gives +1 Speed at most once a day.
- **The 3D**: the ball's arc follows the same pure function the sim judges.

**Checkers with the old-timer** (strategy; the prize is a secret)
- **The old-timer**: one inmate per prison (`leisure.oldTimer`: a cell), grey-haired, who has been inside for decades. He plays from opinion 20, seated or not, with no stakes and no heat.
- **The game**:
  - English draughts on 8×8: forced captures, multi-jumps and kings.
  - The player's move is `TALK.MOVE` (b = from, c = to, 0–31). A multi-jump is one jump per command.
  - A draw: 60 plies (30 moves each) with no capture and no new king. Resigning counts as a loss and brings nothing (no opinion, no Intellect).
- **The board stays set up**: one free time is only about two real minutes. The board is kept in the state, so the game goes on next time, possibly over several days.
- **His moves**:
  - A deterministic alpha-beta search with an integer evaluation and ties broken by `roll()`.
  - The depth grows with the games he has lost, from 2 up to 6.
  - He answers after 1–3 seconds of "thinking".
- **Rewards**:
  - A win: he tells a **secret**, a lasting fact the player hasn't heard yet. Examples: a camera's blind time, the lazy guard's nap stop, a loose grate, the next shakedown. It comes from the gossip facts and is kept in the prisoner's file.
  - A win also gives +1 Intellect and +4 opinion.
  - Any finished game gives +1 Intellect, at most once a day.

**Proof**: `cardstest` covers:
- the deal, the turns, the calls and the chips;
- the tell odds, measured;
- the inmate never calling against what its own cards prove;
- checkers' rules: forced captures, multi-jumps, kings and the draw;
- the search's determinism and the time each move takes;
- shots judged at release, the wind and the rain;
- sports day, saves, and older logs;
- escapetest unchanged.

**Lessons**: `cards`, `hoops` and `checkers` in Prison life, after Side games (built: Cheat for $5 played out; a shot, a basket, a shootout; the old-timer's game left set up, won with a double jump, and his secret).

### P28 Long games (v2.3): Pruno, the garden, rat racing

Nothing here touches a container's stock or draws on the state's RNG: the escape bots' runs stay as they were. New goods are taken on request, not stocked.

**Getting the makings** (on request: `EXT.TAKE`, b = what)
- **Fruit**: from an open canteen counter during breakfast and dinner, one piece a meal.
- **Sugar**: from an open kitchen freezer, one bag a prison day (the kitchen is a job room: the kitchen job, or sneaking in).
- **Seed packets** (vegetable or fruit): from an open library shelf, one packet a prison day.
- **The merchants' staples**: every merchant also sells sugar and both seed packets, whatever its stock (`TALK.BUY` with b past the shop's slots; no opinion for them, built: bought and given back they farmed it), and buys ripe pruno and vegetables at three quarters of their value, four sales a prison day in all (`TALK.SELL`, b = the hotbar slot; built: at full value, unlimited, they were a riskless farm).

**Pruno** (a risky project over several days)
- **Making it**: fruit ×2 + sugar → a pruno bag (Intellect 20).
- **Fermenting**: left in a desk (any drawer) or a toilet's tank, it ferments for 2 prison days. The days left are the item's uses and count down at 08:00. Carried or on the floor, it doesn't ferment.
- **The risks**:
  - **The smell**: a dog on shift that passes furniture holding a bag (or ripe pruno) within 2 tiles (built: through bars and walls, no line needed) points at it; the bag is seized. In the player's cell: sniffed heat.
  - **Searches**: a shakedown or an inspection finds it in a desk's standard drawers (it's contraband). The hidden drawer and the toilet's tank are never searched: only a dog finds it there.
- **Ripe pruno** (contraband, worth $40):
  - Sold to a merchant for $30, or given as a gift (+15 opinion).
  - Or drunk (the use button): tipsy for 3 prison hours. Blows hit 50% harder; walking is 20% slower; every few seconds of walking a stumble makes a small noise.
  - A guard who sees the player tipsy: +20% heat, once each time he catches sight of them.

**The garden plot** (care over time, with a secret)
- **The plot**: a rectangle of beds in each yard (`leisure.garden`), drawn as tilled soil; each tile is a bed. maptest checks the beds are open, diggable yard floor that nobody needs to stand on.
- **Growing** (the use button on the bed ahead, or the one underfoot):
  - Seed packet in hand: planted.
  - Plastic cup in hand: watered (twice a day at most).
  - It grows a stage each prison day it was watered: 3 days to ripe. Rain or a storm waters it; a heatwave needs watering twice.
  - A day without water wilts it (it stops growing); two in a row kill it.
- **The harvest** (the use button on a ripe bed, whatever is in hand): 2 vegetables (a gift, or sold to a merchant) or 2 fruit (for pruno).
- **The secret**: a hole dug down through a planted bed doesn't show: no guard sees damage under a plant (a dog following the trail still digs it up). Harvested or dead, the hole is plain to see until something is planted over it again. (Tunnels could already start from the yard's soil, GDD §9.2: dirt, grass or any non-reinforced floor. No conflict.)

**Rat racing** (training and betting; builds on P20)
- **Training**: the tame rat gets a speed (0–100; 20 when tamed), appended to the rat's state. A rat track is crafted from two magazines and duct tape (Intellect 30; one magazine and tape already make a poster). Used in the player's cell in evening free time, once a prison day, with bait in the hotbar: the rat eats it and runs the track. It gains less the faster it is already. Trained today is fed today.
- **Race nights**: odd prison days, at 21:00, on a straight track in the cell block (`leisure.race`).
  - **The card**: from 20:00, three inmates' rats (drawn by cell with `roll()`, each with a name, a speed and whether it was fed today) and the player's, if entered.
  - **Bets**: at the track before 21:00, $5, $10 or $20 on one rat, one bet a night. The bookie's odds go by the speeds alone (built: each rat's chance worked out over 400 races run by `roll()` with whether each ate drawn as most nights, paid at 85% of fair, rounded down to a half, ×1.2–×20, stake included; first fixed by rank, ×2/×3/×5/×8, which paid the favourite ×1.5 a dollar). The pet is entered before any bet, and an entered pet trains no more until the race is run: the field and its form are what the odds were quoted on (built: a reviewer's exploit).
  - **The race**: 10 legs; each leg a rat runs its speed, plus 40 fed, plus up to 200 by `roll()`. The furthest wins. Its course is a pure function, so the 3D and the sim agree. Measured (longtest): a blind bet returns ×0.78 a dollar, the favourite ×0.75, betting only on rats that ate ×1.09; a fed pet at speed 80 wins 65% of nights, hungry 14%.
  - The pet away at the off (not on the shoulder by the track): scratched, and every bet void (built: a bet on a rival stood at odds quoted with the pet in the field).
  - A fed rat beats its odds: the edge is knowing which rats ate (yours, and what the gossip says of the others).
  - The player's rat winning: a $10 purse.
- **Risks**: the race is noise (guards come to look), and a guard who sees the player at it with a bet on gives gambling heat. Without the player taking part, nothing happens in the simulation.

**Proof**: `longtest` covers fermentation (desk, tank, hand), the dogs' nose and searches, tipsy, growing, wilting and the weather, the hidden hole, the rat's training, the race and its odds measured (blind bets lose, informed ones win), saves, and old logs; escapetest unchanged.

**Lessons**: `pruno`, `garden` and `ratRace` in Prison life, after Checkers (built: on the Training Block: a bag brewed and hidden at Lights Out, last night's ripe by morning and drunk; a bed planted and watered, a wilted one saved, a ripe one harvested; the rat's laps at home, entered and backed on race night, the race).

### P29 Team & ink (v2.4): yard football, the tattoo parlour

Nothing here happens without the player asking, and nothing draws on the state's RNG: the escape bots' runs stay as they were.

**Yard football** (a 3-a-side team match, and cover)
- **The pitch**: each yard has one (`leisure.pitch`: its rectangle and two goals, drawn as frames and painted lines). Built: the goals' nets are the end tiles' middle two; the field runs between the goal lines; Shankton's, Stalag Flucht's and Irongate's lie on their roll-call floor in the yard; teamtest checks each is open floor clear of the garden, the hoop and props.
- **Starting a match**: in free time or the exercise hour, talk to an inmate at the pitch (built: he captains the other side; one of the day's games with him). The player and the 2 inmates who think most of them play him and the 2 others nearest (built: any up and about within 40 tiles, who walk over; a whistle once all are on the field, or after 15 s).
- **The match**: 45 seconds of play (built: the side that let a goal in kicks off; full time at the bell for the next block).
- **The ball**:
  - Integer position and speed, with friction (built: 95% kept a step).
  - It bounces off the pitch's boards (built: its sides and ends, but for the goals' mouths, 2 tiles wide).
  - Run into it to dribble. Hold Space (or the Kick pad) to kick toward where the player faces, harder the longer it's held (built: 240–560 units a step over 1.5 s, within 0.7 tile).
- **The inmates**: they chase the ball and keep goal (built: a keeper each side, the nearer outfield player after the ball, the other back; shots by `roll()` within 4 tiles of goal, knocked on further out; a team-mate passes to the player ahead half the time). Measured against a simple bot: won 18, lost 5, drawn 7 of 30, 1.5 goals a match.
- **Fouls**: a hard foul on a rival can start a brawl (P23's rules). Built: a blow at a player of the other side ends the match; they all go for the player and the nearest two guards come to look.
- **Cover**:
  - While a match is on, guards in the yard watch the ball. For anything off the pitch their sight range is halved (built: guards on duty outdoors within 16 tiles with the ball in plain view; the player, damage and the drone's drop; the cones are drawn at that range).
  - A goal turns every eye in the yard to the goal for 5 seconds (built: each guard on duty there stops and faces the net).
- **Rewards**: a win gives +3 opinion with the teammates and +1 with everyone watching, and +1 Speed (built: and a win toward sports day; a match played, +1 with the team-mates).
- **Telling the sides apart** (built): a green ring under the player's team-mates, a red one under the other side.

**The tattoo parlour** (tracing, cosmetics, money)
- **The gun**: a crafted item, a toothbrush + a battery + a razor blade (built: Intellect 30). It is contraband, and each tattoo uses one `ink` (built: a jar of ink from the hotbar, used as the sitting starts).
- **A job**: an inmate at opinion 30 or more takes a design: a heart for $15, a skull for $25 or an eagle for $40 (built: in the games' hours, one of the day's games with him).
- **Tracing**:
  - The needle follows the stick or the keys over the design's path, at a set speed, deterministic from the commands (built: the pen runs at 16 box units a step after a 1.5 s lead-in, the needle at 22; the player doesn't walk meanwhile; on touch, a drag).
  - The distance from the path adds up. A cleaner line pays up to 150% and more opinion (built: +2 to +12); a poor one pays as little as 50%. Given up: no pay, and −5.
  - **Redone in v2.22.0** after players found it too hard (scored by the distance from a pen on a clock, a human's reaction time alone cost half the line): the design is drawn on (a finger, or the mouse button held; `EXT.NEEDLE`, `EXT.NEEDLE_DOWN`; the keys and stick still steer it), pulled a little onto the line; the ring waits where the line is traced to; the line scored by its distance from the design; 40 seconds; no further traced than inked. Runs logged before 2.22 replay the old tracing (`Sim.rules221`).
- **The player's own tattoos**: a friend inks the player (built: 70+ opinion, 6 seconds, up to 3 designs, one of each). They show on the prisoner's arms and in the file (built: on the forearms; two achievements give the skull and the eagle for the Intake's own tattoo too).
- **Heat**: a guard who sees tattooing gives +15% heat (built: once a sitting, either way round).

**Proof**: `teamtest` covers:
- the ball's physics and goals;
- the inmates' play;
- the guards' halved sight during a match;
- fouls and brawls;
- tracing scores from fixed command sequences;
- pay, the look, saves and old logs;
- escapetest unchanged.

**Lessons**: `football` (built: at Center Perks, where there are enough inmates: a match started, a kick, the final whistle, the cover explained) and `tattoo` (on the Training Block: the gun crafted, a heart traced for Sparky, a design of his on the player's arm).

### P30 Stage nights (v2.5): talent night, quiz night

**Talent night** (rhythm)
- **The card**: a new day card in place of a card in every deck, with a guard for old saves and logs. It runs 19:00–21:00 on a stage in the canteen (built: `leisure.stage`, the performer's tile and the way the room is; the evening's crowd sits in the canteen as on movie night, and the music muffles noise there as the film does).
- **The instruments**: bucket drums (free) or a homemade guitar (crafted; built: timber + wire + duct tape, Intellect 30, not contraband).
- **The song**: notes scroll in 2–3 lanes, and the sim judges each press by its step.
  - Within ±1 step: perfect. Within ±2 steps: good (built: centred a step late, as a press reaches the sim on the step after it's made; a press with no note near costs 25 of a perfect note's 100; measured in the browser, presses made as the notes reach the line on screen judge all perfect).
  - The music is synthesized from the same note chart (built: the beat and the bass under the player's notes, each note sounding as it's played; an act's song heard in the canteen for its ten minutes, a quarter of it).
  - 3 songs of about 40 seconds (built: 100, 120 and 150 a minute, one to three stars).
- **The competition**: 2–3 inmates perform, with scores from `roll()` (built: 10 minutes each from 19:00, walking to the wings first; marks 50–85%; the player's turn after the last act, once a night).
- **Rewards**:
  - Opinion with everyone in the canteen (built: +1 at a mark of 50%+, +2 when first).
  - Prize money by place (built: $30, $15, $5, times 1, 1.5 or 2 by the song's stars; a tie goes to the player).
  - A score of 80% or more wins the warden's goodwill: −20% heat.

**Quiz night** (knowledge)
- **The card**: a day card in the library (or the canteen where there's none), 19:00–21:00 (built: every campaign prison has a library; `leisure.quiz`, four places in a row).
- **The quiz**: 8 questions with 4 choices and 10 seconds each, against 3 inmates (built: the three nearest up and about walk over; the first right answer takes the point, a wrong one is out of that question).
  - Inmates buzz at a time drawn by `roll()`, and answer right with odds by their Intellect (built: 2.5–10 s; wits 25–75 by cell, right 30% + wits × 0.7).
  - The player answers with `EXT.ANSWER` (built: keys 1–4 or a tap).
- **The questions** come in two kinds, in English and French:
  - **Escape history**: Alcatraz 1962, the Great Escape's tunnels and the like. These are written facts, checked (built: 15, four a night).
  - **This prison**: generated from the game's own data and constants, the way gossip is, so they are always true. Examples: roll call's time, the colour of a guard's key, what the lazy guard does (built: also breakfast, showers and lights out, the corrupt and strict guards, the cells, what a recipe makes, the delivery's search and visiting hours where they come; four a night; stagetest checks every one against the data).
- **Rewards**: a win gives $30, +2 Intellect and opinion (built: +2 with each contestant, +1 for playing it out; a tie at the top halves the prize and the Intellect). Measured: answering right in 3 s wins every night, in 5 s most (25 of 40), in 7.5 s rarely; guessing never.

**Proof**: `stagetest` covers note judging at the step, the inmates' scores, the questions' answers against the running game, the day cards in the decks, old saves and logs, and escapetest unchanged.

**Lessons**: `talent` and `quiz` (built: both at Center Perks, after Tattoos).
