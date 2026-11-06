# THE ESCAPISTS 3D — COMPLETE GAME DESIGN & FEATURE SPECIFICATION

## 1. Game Overview & Core Loop

### 1.1 High-Concept Summary

**The Escapists 3D** is a top-down 3D sandbox prison-escape strategy and simulation game. Players step into the shoes of an inmate inside a series of five increasingly secure, multi-layered 3D correctional facilities. On the surface, the player must play the role of a model prisoner—attending roll calls, working a prison job, eating meals, and keeping guard suspicion low. Behind the scenes, the player scavenges items from desks, trades contraband with fellow inmates, trains their physical and mental attributes, crafts improvised tools and weapons, digs tunnels, sneaks through ventilation shafts, clones guard keys, and executes an intricate escape plan.

### 1.2 Camera Perspective & 3D Layer Cutaway

* **Isometric/Angled Top-Down Camera:** The game is viewed from a raised, angled top-down perspective that clearly shows 3D character models, room interiors, furniture, and wall faces. Players can smoothly zoom in for close-up stealth and combat or zoom out for tactical awareness of guard patrols.

* **Dynamic 4-Layer Cutaway View:** Every prison is built across four vertical layers (**Layer $-1$: Underground Tunnels**, **Layer $0$: Ground Floor**, **Layer $+1$: Ventilation Shafts**, and **Layer $+2$: Rooftops**). The camera automatically hides roofs and upper layers when the player is indoors on the ground floor, dims the ground floor when crawling inside overhead ventilation ducts, and reveals the entire facility when climbing onto the rooftops.

### 1.3 The Core Gameplay Loop

1. **Comply & Blend In:** Follow the daily prison routine (Roll Call, Meals, Work, Exercise, Showers, Lights Out) so guards do not raise the alarm.

2. **Acquire & Earn:** Complete daily job quotas and run favors for fellow inmates to earn cash, or scavenge everyday and contraband items from cell desks and workshops.

3. **Train & Upgrade:** Spend free time in the Gym (increasing **Strength** and **Speed**) and the Library (increasing **Intellect**) to unlock advanced crafting recipes, higher-paying jobs, and stronger combat abilities.

4. **Craft & Conceal:** Combine items into tiered shovels, pickaxes, cutters, weapons, key molds, and disguises while hiding contraband inside secret desk compartments before cell shakedowns.

5. **Chip, Dig & Sabotage:** Gradually chip through walls, unscrew vents, or dig underground tunnels at night while hiding structural damage behind posters and fake blocks—and flushing excavated dirt down toilets.

6. **Execute the Escape:** Coordinate timing, disguises, generator sabotage, or a full prison riot to breach the outer perimeter and reach freedom, unlocking the next prison level in the campaign.

---

## 2. The 24-Hour Prison Schedule & Daily Routines

Time advances continuously ($1\text{ real second} = 1\text{ in-game minute}$, meaning a full 24-hour day lasts 24 real-time minutes). Every routine change is announced via prison bells, HUD banners, and floor directional arrows showing where inmates are expected to go.

### 2.1 Daily Schedule Table

| **Time Window** | **Routine Phase** | **Required Location** | **Mandatory Check?** | **Gameplay Opportunities** |
|---|---|---|---|---|
| **08:00 – 09:00** | Morning Roll Call | Roll Call Yard | **Mandatory** | All inmates line up outdoors. The Warden announces 2 random cells for a morning shakedown. |
| **09:00 – 10:00** | Breakfast | Canteen | **Mandatory** | Grab a food tray to restore $+35\%$ Energy. Loot plastic cutlery from Canteen trays. |
| **10:00 – 12:00** | Morning Free Time | Anywhere Legal | Optional | Scavenge inmate desks, trade with inmate merchants, complete favors, or train in the Gym/Library. |
| **12:00 – 15:00** | Work Period | Assigned Job Room | **Mandatory** (if employed) | Complete daily job quota to earn wages and smuggle raw materials out of workshops. |
| **15:00 – 16:00** | Exercise Period | Gym / Yard | **Mandatory** | Check into the Gym and use workout equipment to raise Strength and Speed. |
| **16:00 – 17:00** | Shower Block | Showers | **Mandatory** | Stand under running showers to rapidly restore Energy and reduce minor Heat. |
| **17:00 – 18:00** | Evening Meal | Canteen | **Mandatory** | Second opportunity to eat a meal ($+35\%$ Energy) and socialize/fight in the Canteen. |
| **18:00 – 22:00** | Evening Free Time | Anywhere Legal | Optional | Final window to buy items, stash contraband, prepare tools, and set up nighttime diversions. |
| **22:00 – 23:00** | Evening Roll Call | Roll Call Yard | **Mandatory** | Final headcount of the day before cells are locked for the night. |
| **23:00 – 08:00** | Lights Out | Player Cell | **Mandatory** | Cell doors lock automatically. Sleep in bed to save progress and restore $100\%$ Energy—or place a **Bed Dummy** in your bed and sneak out to work on your escape! |

### 2.2 Attendance Rules & Penalties

* **The Attendance Grace Window:** Whenever a mandatory routine begins, the player simply needs to step foot inside the designated room at least once during that block to earn an **ATTENDED** checkmark on the HUD. Once checked in, the player is free to slip away to other unrestricted areas.

* **Missing a Routine:**
  * Failing to check into **Breakfast**, **Exercise**, **Showers**, or **Evening Meal** raises Guard Heat by $+25\%$.
  * Failing to complete your **Work Quota** during the Work Period results in losing your job at $15:00$.
  * Failing to attend **Morning Roll Call** or **Evening Roll Call** triggers an immediate **Prison Lockdown** ($100\%$ Heat; all guards actively hunt the player).

---

## 3. Character Attributes, Needs & Training

### 3.1 Core Status Bars

* **Health ($0\text{–}100+$):** Determines how much punishment the player can take in combat or from hazards. Maximum Health scales with Strength ($\text{Max HP} = 50 + \text{Strength}$). If Health reaches $0$, the player is knocked unconscious and wakes up in the Infirmary (or Solitary Confinement if knocked out by guards).

* **Energy / Stamina ($0\%\text{–}100\%$):** Consumed whenever the player digs, chips walls, cuts fences, unscrews vents, or trains in the Gym/Library. If Energy drops below $10\%$, the player becomes exhausted and cannot use tools or train until they rest.
  * *Restoring Energy:* Sleeping in a bed ($+100\%$), eating a Canteen meal ($+35\%$), standing under a shower ($+2\%$ per second), sitting in a chair ($+1.5\%$ per second), or eating a Chocolate Bar ($+15\%$).

* **Guard Heat ($0\%\text{–}100\%$):** Represents how suspicious the guards are of the player.
  * $0\%\text{–}79\%$ **Heat:** Guards patrol normally. Heat decays naturally by $1\%$ every 4 in-game minutes when out of sight.
  * $80\%\text{–}99\%$ **Heat:** Any guard who spots the player will draw their baton and attempt to knock the player out. Watchtower snipers will aim at the player if outdoors.
  * $100\%$ **Heat (Lockdown):** Prison sirens wail, red emergency lights flash, cell doors lock, and every guard hunts the player. Being knocked out at $90\%+$ Heat sends the player straight to **Solitary Confinement**.

* **Cash ($\$$):** Earned through daily job payouts, completing inmate favors, or looting small amounts of change from unconscious NPCs and desks. Spent at inmate contraband shops.

### 3.2 Primary Attributes & Training Minigames

All three attributes range from $20$ to $100$ (starting at $40$). Attributes slowly decay by $1$ point per day if neglected, encouraging regular use of prison facilities.

1. **Strength ($20\text{–}100$):**
   * *Effects:* Increases melee attack damage and increases Maximum Health.
   * *How to Train:* Use the **Weight Bench** or **Push-Up Mat** in the Gym. Triggers a rhythmic progress-bar minigame (alternating keys rapidly to fill the bar before draining $12\%$ Energy for $+2$ Strength).

2. **Speed ($20\text{–}100$):**
   * *Effects:* Increases movement speed across the prison and decreases the cooldown between weapon swings and tool strikes.
   * *How to Train:* Use the **Treadmill** or **Speed Bag** in the Gym.

3. **Intellect ($20\text{–}100$):**
   * *Effects:* Unlocks higher-tier crafting recipes ($30\text{ to }90\text{ INT}$) and qualifies the player for higher-paying prison jobs.
   * *How to Train:* Interact with **Bookshelves** in the Library to read study books (consumes $10\%$ Energy per session for $+2$ Intellect).

---

## 4. The 5-Level Prison Campaign & ASCII Blueprints

The campaign features **5 distinct prison levels**, progressing from a relaxed minimum-security facility to an inescapable supermax island fortress. Every map operates on a $64 \times 64$ tile grid across 4 vertical layers:
* **Layer $-1$:** Underground Tunnels & Subterranean Obstacles
* **Layer $0$:** Ground Floor Compound
* **Layer $+1$:** Overhead Ventilation Shafts
* **Layer $+2$:** Rooftops, Catwalks & Watchtowers

### 4.0 Master ASCII Blueprint Legend

Use this legend across all ASCII prison plans below:

```text
================================================================================
MASTER ASCII MAP LEGEND
================================================================================
  #   Brick Wall (Destructible: 100 HP, requires Chipping Tool)
  @   Reinforced Concrete Wall (Indestructible)
  =   Standard Chain-Link Fence (Destructible: 100 HP, requires Cutting Tool)
  ⚡  Electric Perimeter Fence (120 HP; Fatal shock if Generator is ON!)
  ~   Deep Ocean Water / Moat (Impassable on foot; requires Raft)
  *   Buried Landmine (Explodes for 100 HP damage if stepped on at Layer 0)
  O   Subterranean Boulder (Layer -1 rock obstacle; cannot be dug through)
  .   Outdoor Grass / Sand / Snow Ground
  ,   Outer Freedom Road / Escape Zone (Stepping here wins the level!)
  [Y] Yellow Door (Cell Key)          [C] Cyan Door (Work Key)
  [P] Purple Door (Utility Key)       [R] Red Door (Security Key)
  [G] Green Door (Master Gate Key)    [D] Contraband Detector Archway
  [V] Ceiling Vent Grate (L0 <-> L1)  [L] Ladder (Connects L0/L1 <-> L2 Roof)
  [GEN] Central Power Generator       [CAM] Security Camera
  [TWR] Sniper Watchtower (Layer +2)  [P1] Player's Assigned Cell
================================================================================
```

---

### 4.1 LEVEL 1: Center Perks (Minimum Security — Suburban Correctional)

* **Difficulty:** $\star\☆☆\☆☆$ (Beginner / Tutorial Prison)
* **Inmates:** 8 | **Guards:** 5 | **Watchtowers:** 2 (South Corners only)
* **Available Jobs:** Laundry (Default), Janitor, Kitchen, Woodshop, Mailman
* **Security Profile:**
  * Outer perimeter fence is a **Standard Chain-Link Fence (`=`)** on the North, East, and West sides; only the South Main Gate features an **Electric Fence (`⚡`)** section.
  * Contraband Detectors (`[D]`) are only placed at the Canteen and Woodshop entrances—the Cell Block hallway is completely un-scanned!
  * Ideal for learning the basics of desk scavenging, key cloning, nighttime Bed Dummies, and cutting through a simple perimeter fence.

#### Level 1 — Layer 0 (Ground Floor ASCII Plan)
```text
X: 00        10        20        30        40        50        60  63
Z: +---------+---------+---------+---------+---------+---------+---+
00 |,,,,,,,,,,,,,,,,,,, FREEDOM ESCAPE ROAD (NORTH) ,,,,,,,,,,,,,,,|
02 |,,===========================================================,,|
04 |,,= . . . . . . . . . . . . . . . . . . . . . . . . . . . . =,,|
06 |,,= . +-------------------+-----------+-----------------+ . =,,|
08 |,,= . | CELL BLOCK (NW)   | ROLL CALL | CANTEEN (NE)    | . =,,|
10 |,,= . | [P1][C2][C3][C4]  |   YARD    | [Tables/Trays]  | . =,,|
12 |,,= . |  [V]              |           |          +------+ . =,,|
14 |,,= . | [C5][C6][C7][C8]  |  (Open    |          |KITCH.| . =,,|
16 |,,= . +--------[Y]--------+  Asphalt) +---[D]----+-[C]--+ . =,,|
18 |,,= . | MAIN CORRIDOR [JOB BOARD]                           =,,|
20 |,,= . +---[Y]---+---------+-----------+---[D]----+------+ . =,,|
22 |,,= . | GYM     | SHOWERS | CENTRAL   | WOODSHOP |LAUND.| . =,,|
24 |,,= . | (Mat/   |         | GRASS     | (Timber  |(Guard| . =,,|
26 |,,= . |  Bench) +---------+ COURTYARD |  Supply) |Outf.)| . =,,|
28 |,,= . +---------+ LIBRARY |           +---[C]----+-[C]--+ . =,,|
30 |,,= . | INFIRM. | (Books) |   . . .   | MAILROOM |JANIT.| . =,,|
32 |,,= . +---[Y]---+---[Y]---+-----------+---[C]----+-[C]--+ . =,,|
34 |,,= . |                                                 | . =,,|
36 |,,= . +---[P]---+---------+           +---[R]----+------+ . =,,|
38 |,,= . | GENERAT.|SOLITARY |   MAIN    | GUARD    |CTRL  | . =,,|
40 |,,= . |  [GEN]  | CELLS   |  CORRIDOR | QUARTERS |ROOM  | . =,,|
42 |,,= . | [L][V]  |         |           | (Beds)   |[CAM] | . =,,|
44 |,,= . +---------+---------+----[G]----+----------+------+ . =,,|
46 |,,= . . . . . . . . . . . . . |   | . . . . . . . . . . . . =,,|
48 |,,=[TWR]======================⚡[G]⚡====================[TWR]=,,|
50 |,,,,,,,,,,,,,,,,,,, FREEDOM ESCAPE ROAD (SOUTH) ,,,,,,,,,,,,,,,|
63 +---------------------------------------------------------------+
```

#### Level 1 — Layer +1 (Vents) & Layer +2 (Roof) Overlay Plan
```text
   +---------------------------------------------------------------+
   |   [ROOFTOP EDGE - Tie Sheet Rope Here to Drop to North Yard]  |
   |      +-------------------+           +-----------------+      |
   |      | [P1]              |           |                 |      |
   |      |  [V]===(VENT)====>|           |                 |      |
   |      |        ||         |           |                 |      |
   |      +--------||---------+           +-----------------+      |
   |               || (Layer +1 Duct runs over Main Corridor)      |
   |      +--------||---------+                                    |
   |      |        \/         |                                    |
   |      |     [LIBRARY]     |                                    |
   |      |        ||         |                                    |
   |      +--------||---------+                                    |
   |               \/                                              |
   |      +-------------------+                                    |
   |      | [GEN] [V] -> [L]  | ==> Climb [L] to Layer +2 Roof!    |
   |      +-------------------+                                    |
   +---------------------------------------------------------------+
```

---

### 4.2 LEVEL 2: Stalag Flucht (Medium Security — Alpine POW Camp)

* **Difficulty:** $\star\star\☆☆☆$ (Medium Security)
* **Inmates:** 10 | **Guards:** 6 | **Watchtowers:** 3
* **Available Jobs:** Kitchen (Default), Laundry, Woodshop, Metalshop, Janitor
* **Unique Level Mechanics:**
  1. **Dual-Compound Split Layout:** The camp is divided into the **West Prisoner Compound** (wooden cabins) and the **East Guard Command Compound**, separated by an electrified inner fence (`⚡`).
  2. **Fully Electrified Perimeter:** The entire outer perimeter fence is electrified (`⚡`) and wired to the Generator (`[GEN]`) located inside the heavily guarded East Compound.
  3. **Subterranean Boulders (`O`):** Layer $-1$ contains large underground granite boulders (`O`). Players digging tunnels must route around boulders rather than digging in a straight line.
  4. **Freezing Alpine Weather:** Staying outdoors in the snow for more than 60 seconds without a **Cushioned** or **Plated Outfit** doubles Stamina consumption.

#### Level 2 — Layer 0 (Ground Floor ASCII Plan)
```text
X: 00        10        20        30        40        50        60  63
Z: +---------+---------+---------+---------+---------+---------+---+
00 |,,,,,,,,,,,,,,,,,,, ALPINE FOREST ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
02 |,,⚡[TWR]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[TWR]⚡,,|
04 |,,⚡ . . . . . . . . . . . . . . . . . | . . . . . . . . . . ⚡,,|
06 |,,⚡ . +-----------+   +-----------+ . ⚡ . +---------------+ ⚡,,|
08 |,,⚡ . | CABIN A   |   | CABIN B   | . ⚡ . | GUARD BARRACKS| ⚡,,|
10 |,,⚡ . | [P1] [C2] |   | [C5] [C6] | . ⚡ . | [R] (Red Key  | ⚡,,|
12 |,,⚡ . | [C3] [C4] |   | [C7] [C8] | . ⚡ . |  & Guard Beds)| ⚡,,|
14 |,,⚡ . +----[Y]----+   +----[Y]----+ . ⚡ . +---------------+ ⚡,,|
16 |,,⚡ . . . . . . . . . . . . . . . . . ⚡ . . . . . . . . . . ⚡,,|
18 |,,⚡ . . . [ROLL CALL SNOW YARD] . . . [P] (Inner Gate)      ⚡,,|
20 |,,⚡ . +-----------+---+-----------+ . ⚡ . +---------------+ ⚡,,|
22 |,,⚡ . | CANTEEN   |   | GYM &     | . ⚡ . | GENERATOR HUT | ⚡,,|
24 |,,⚡ . | & KITCHEN |   | SHOWERS   | . ⚡ . | [P] [GEN] [L] | ⚡,,|
26 |,,⚡ . +----[D]----+   +----[D]----+ . ⚡ . +---------------+ ⚡,,|
28 |,,⚡ . . . . . . . . . . . . . . . . . ⚡ . . . . . . . . . . ⚡,,|
30 |,,⚡ . +-----------+   +-----------+ . ⚡ . +---------------+ ⚡,,|
32 |,,⚡ . | WOODSHOP  |   | METALSHOP | . ⚡ . | SOLITARY &    | ⚡,,|
34 |,,⚡ . | & LAUNDRY |   | & LIBRARY | . ⚡ . | INFIRMARY     | ⚡,,|
36 |,,⚡ . +-[D]---[C]-+   +-[D]---[C]-+ . ⚡ . +------[R]------+ ⚡,,|
38 |,,⚡ . . . . . . . . . . . . . . . . . | . . . . . . . . . . ⚡,,|
40 |,,⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[G]⚡⚡⚡⚡⚡[TWR]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡,,|
42 |,,,,,,,,,,,,,,,,,,, ALPINE FOREST ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
63 +---------------------------------------------------------------+
```

#### Level 2 — Layer -1 (Underground Granite Boulders Plan)
```text
   +---------------------------------------------------------------+
   |                     [NORTH ESCAPE SURFACE]                    |
   |  ====================(Electric Fence Above)=================  |
   |        O    O      ^                               O          |
   |      +-----------+ | (Zig-Zag Tunnel)                         |
   |      | CABIN A   | |   O     O       +---------------+        |
   |      | [P1 Hole]=>-+                 | [GEN] Above   |        |
   |      +-----------+     O   O         +---------------+        |
   |          O    O                                O              |
   |  Note: 'O' = Indestructible Underground Boulders on Layer -1  |
   +---------------------------------------------------------------+
```

---

### 4.3 LEVEL 3: Shankton State Pen (High Security — Industrial Megaprison)

* **Difficulty:** $\star\star\star\☆☆$ (High Security)
* **Inmates:** 12 | **Guards:** 8 | **Watchtowers:** 4 (All 4 Corners)
* **Available Jobs:** All 6 Jobs (Metalshop Default)
* **Unique Level Mechanics:**
  1. **Reinforced Concrete Outer Shell (`@`):** The main prison building's exterior walls are made of **Reinforced Concrete (`@`)** and cannot be chipped through! Players cannot simply chip an exterior wall to reach the yard—they must use the **Ventilation Maze (Layer $+1$)**, **Rooftop Catwalks (Layer $+2$)**, **Underground Tunnels (Layer $-1$)**, or **Cloned Keys**.
  2. **Contraband Detector Chokepoints (`[D]`):** Every major corridor intersection is gated by a Contraband Detector archway, making the **Contraband Pouch** ($\text{Foil} + \text{Duct Tape}$) essential.
  3. **Double Perimeter:** Protected by an inner Chain-Link Fence (`=`) AND an outer Electric Fence (`⚡`).

#### Level 3 — Layer 0 (Ground Floor ASCII Plan)
```text
X: 00        10        20        30        40        50        60  63
Z: +---------+---------+---------+---------+---------+---------+---+
00 |,,,,,,,,,,,,,,,,,,, STATE HIGHWAY ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
02 |,,⚡[TWR]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[TWR]⚡,,|
04 |,,⚡ . =================================================== . ⚡,,|
06 |,,⚡ . = . @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ . = . ⚡,,|
08 |,,⚡ . = . @ NORTH CELL BLOCK  #  CANTEEN  # KITCHEN @ . = . ⚡,,|
10 |,,⚡ . = . @ [P1][C2][C3][C4]  #  (Dining) #  [C]    @ . = . ⚡,,|
12 |,,⚡ . = . @-----[Y]-----[D]---+----[D]----+---------@ . = . ⚡,,|
14 |,,⚡ . = . @ [CAM]     NORTH SECURITY CORRIDOR [CAM] @ . = . ⚡,,|
16 |,,⚡ . = . @-----[D]-----+---------------+-----[D]---@ . = . ⚡,,|
18 |,,⚡ . = . @ GYM         |   CENTRAL     | WOODSHOP  @ . = . ⚡,,|
20 |,,⚡ . = . @ & SHOWERS   |   INDOOR      | [C]       @ . = . ⚡,,|
22 |,,⚡ . = . @-------------+   ROLL CALL   +-----------@ . = . ⚡,,|
24 |,,⚡ . = . @ LIBRARY     |   COURTYARD   | METALSHOP @ . = . ⚡,,|
26 |,,⚡ . = . @ & MAILROOM  |   (Open Sky)  | & LAUNDRY @ . = . ⚡,,|
28 |,,⚡ . = . @-----[D]-----+---------------+-----[D]---@ . = . ⚡,,|
30 |,,⚡ . = . @ [CAM]     SOUTH SECURITY CORRIDOR [CAM] @ . = . ⚡,,|
32 |,,⚡ . = . @-----[Y]-----[D]---+---[P]-----+---[R]---@ . = . ⚡,,|
34 |,,⚡ . = . @ SOUTH CELL BLOCK  # GENERATOR # GUARD   @ . = . ⚡,,|
36 |,,⚡ . = . @ [C5][C6][C7][C8]  # [GEN] [L] # CONTROL @ . = . ⚡,,|
38 |,,⚡ . = . @@@@@@@@@@@@@@@@@@@@@====[G]====@@@@@@@@@@@ . = . ⚡,,|
40 |,,⚡ . =============================[G]=================== . ⚡,,|
42 |,,⚡[TWR]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[G]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[TWR]⚡,,|
44 |,,,,,,,,,,,,,,,,,,, STATE HIGHWAY ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
63 +---------------------------------------------------------------+
```

#### Level 3 — Layer +2 (Rooftop Catwalks & Grapnel Crossing Plan)
```text
   +---------------------------------------------------------------+
   |  ⚡[TWR]⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡[TWR]⚡  |
   |  ⚡   ===================================================   ⚡  |
   |  ⚡   =   +-----------------------------------------+   =   ⚡  |
   |  ⚡   =   | NORTH ROOFTOP                           |   =   ⚡  |
   |  ⚡   =   |  [Vent Hatch from P1]                   |   =   ⚡  |
   |  ⚡   =   +------+                           +------+   =   ⚡  |
   |  ⚡   =   | WEST |     (Open Courtyard       | EAST |   =   ⚡  |
   |  ⚡   =   | ROOF |      Drop Below)          | ROOF |   =   ⚡  |
   |  ⚡   =   +------+                           +------+   =   ⚡  |
   |  ⚡   =   | SOUTH ROOFTOP              [Ladder L]   |   =   ⚡  |
   |  ⚡   =   +-------------------||--------------------+   =   ⚡  |
   |  ⚡                           || (Use GRAPNEL here to zip   ⚡  |
   |  ⚡                     +------------+  over Inner Fence!)  ⚡  |
   |  ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡| SOUTH GATE |⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡  |
   |                        | ROOF [Rope]|                         |
   |                        +-----||-----+                         |
   |                              \/ (Sheet Rope to Freedom!)      |
   +---------------------------------------------------------------+
```

---

### 4.4 LEVEL 4: San Pancho (Maximum Security — Desert Cartel Compound)

* **Difficulty:** $\star\star\star\star\☆$ (Maximum Security)
* **Inmates:** 14 (Highly Aggressive) | **Guards:** 8 | **Watchtowers:** 4
* **Available Jobs:** Kitchen, Laundry, Janitor (Default), Woodshop, Metalshop, Mailman
* **Unique Level Mechanics:**
  1. **Lawless Interior / Armed Perimeter:** Guards rarely enter the dusty central adobe compound except during Roll Call and Shakedowns. Instead, guards patrol the outer perimeter walkway between the **Inner Wall (`@`)** and **Outer Wall (`@`)**, while 4 Watchtower Snipers watch the open desert sand day and night!
  2. **The Desert Minefield (`*`):** The wide outer desert strip surrounding the compound is heavily planted with **Buried Landmines (`*`)** on Layer $0$. Attempting to run across the outer desert on foot triggers lethal explosions ($100\text{ HP}$ damage).
  3. **Primary Escape Solutions:**
     * **Deep Desert Tunneling:** Dig a long, timber-braced tunnel on **Layer $-1$** completely underneath the Inner Wall, Guard Walkway, and Minefield (`*`) to surface safely at the outer desert road.
     * **The Supply Jeep Gate Breakout:** Clone the **Red** and **Green** keys (or stage a full compound Riot Takeover) to pass through the safe paved South Supply Road corridor that cuts cleanly through the minefield.

#### Level 4 — Layer 0 (Ground Floor & Minefield ASCII Plan)
```text
X: 00        10        20        30        40        50        60  63
Z: +---------+---------+---------+---------+---------+---------+---+
00 |,,,,,,,,,,,,,,,,,,, DESERT BORDER ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
02 |,,@[TWR]@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@[TWR]@,,|
04 |,,@ * . * . * . * [DESERT MINEFIELD ZONE] * . * . * . * . * @,,|
06 |,,@ . * . * . * . * . * . * . * . * . * . * . * . * . * . * @,,|
08 |,,@ * . @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ . * @,,|
10 |,,@ . * @ GUARD WALKWAY (Patrolled by Armed Guards)   @ * . @,,|
12 |,,@ * . @ . +-------------+---------+-------------+ . @ . * @,,|
14 |,,@ . * @ . | ADOBE CELLS | CENTRAL | ADOBE CELLS | . @ * . @,,|
16 |,,@ * . @ . | [P1][C2][C3]| DESERT  | [C5][C6][C7]| . @ . * @,,|
18 |,,@ . * @ . |     [C4]    | PLAZA & |     [C8]    | . @ * . @,,|
20 |,,@ * . @ . +-----[Y]-----+ ROLL    +-----[Y]-----+ . @ . * @,,|
22 |,,@ . * @ . | CANTEEN &   | CALL    | GYM, SHOWER | . @ * . @,,|
24 |,,@ * . @ . | KITCHEN     | SQUARE  | & LIBRARY   | . @ . * @,,|
26 |,,@ . * @ . +-------------+         +-------------+ . @ * . @,,|
28 |,,@ * . @ . | WORKSHOPS   |         | GENERATOR & | . @ . * @,,|
30 |,,@ . * @ . | (Wood/Metal)|         | GUARD POST  | . @ * . @,,|
32 |,,@ * . @ . | [D] [C]     |         | [P][GEN][R] | . @ . * @,,|
34 |,,@ . * @ . +-------------+---[R]---+-------------+ . @ * . @,,|
36 |,,@ * . @@@@@@@@@@@@@@@@@@@@@@[R]@@@@@@@@@@@@@@@@@@@@@@ . * @,,|
38 |,,@ . * . * . * . * . * . * |     | * . * . * . * . * . * . @,,|
40 |,,@ * . * . * . * . * . * . |SAFE | . * . * . * . * . * . * @,,|
42 |,,@[TWR]@@@@@@@@@@@@@@@@@@@@@[G]@@@@@@@@@@@@@@@@@@@@@@@[TWR]@,,|
44 |,,,,,,,,,,,,,,,,,,, DESERT BORDER ESCAPE ROAD ,,,,,,,,,,,,,,,,,|
63 +---------------------------------------------------------------+
```

---

### 4.5 LEVEL 5: HMP Irongate (Supermax — Island Fortress)

* **Difficulty:** $\star\star\star\star\star$ (Final Boss Prison — Supermax Island)
* **Inmates:** 14 | **Guards:** 10 (Includes Armored Riot Guards) | **Watchtowers:** 4
* **Available Jobs:** All 6 Jobs
* **Unique Level Mechanics:**
  1. **Surrounded by Deep Ocean (`~`):** HMP Irongate sits on a rocky island surrounded on all sides by freezing ocean water (`~`). Players **cannot** simply walk or tunnel to the edge of the map—tunnels dug under the ocean flood instantly!
  2. **Dual Power Generators (`[GEN-1]` & `[GEN-2]`):** The fortress has two independent generators (West Generator powers Contraband Detectors and Cameras; East Generator powers the Electric Dock Fence and Searchlights).
  3. **Three Exclusive Island Escape Routes:**
     * **Escape A — The Boat Dock & Makeshift Raft:** Craft a **Makeshift Raft** ($2\times\text{Balsa Wood} + \text{Bed Sheet} + \text{Rope}$), disable `GEN-2`, cut through the East Dock Electric Fence (`⚡`), and launch the raft from the **East Pier** into the ocean escape zone!
     * **Escape B — The Rooftop Helipad Extraction:** Unscrew vents to reach Layer $+2$, use a **Grapnel** to cross the fortress roof chasm to the **Admin Helipad Tower**, knock out the 2 elite Helipad Guards while wearing a **Guard Uniform**, and board the supply helicopter at night!
     * **Escape C — Full Supermax Takeover:** Recruit 2 maxed-out inmate allies, equip **Plated Armor** and **Nunchucks**, and defeat 9 of the 10 guards simultaneously to force the Warden to lower the South Ferry Drawbridge!

#### Level 5 — Layer 0 (Island Fortress Ground Floor ASCII Plan)
```text
X: 00        10        20        30        40        50        60  63
Z: +---------+---------+---------+---------+---------+---------+---+
00 |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
02 |~~~  [DEEP OCEAN WATER - Requires Makeshift Raft or Heli]  ~~~~|
04 |~~~~~~@@[TWR]@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@[TWR]@@~~~~~~~~|
06 |~~~~~~@@ . . . . . . . . . . . . . . . . . . . . . . @@~~~~~~~~|
08 |~~~~~~@@ . @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ . @@~~~~~~~~|
10 |~~~~~~@@ . @ SUPERMAX CELLS  # SOLITARY # GEN-1  @ . @@~~~~~~~~|
12 |~~~~~~@@ . @ [P1][C2][C3][C4]#  WING    # [GEN]  @ . @@~~~~~~~~|
14 |~~~~~~@@ . @ [C5][C6][C7][C8]#  [R]     # [P][V] @ . @@~~~~~~~~|
16 |~~~~~~@@ . @-------[Y]-------+----------+--------@ . @@~~~~~~~~|
18 |~~~~~~@@ . @ [D]   MAIN FORTRESS CORRIDOR    [D] @ . @@~~~~~~~~|
20 |~~~~~~@@ . @---[D]---+---------------+---[D]-----@ . @@⚡⚡⚡⚡⚡~~~|
22 |~~~~~~@@ . @ CANTEEN | INDOOR        | WORKSHOPS @ . [R]   ⚡~~~|
24 |~~~~~~@@ . @ & KITCH.| ROLL CALL &   | (Wood /   @ . @@BOAT⚡~~~|
26 |~~~~~~@@ . @---------@ EXERCISE HALL @  Metal /  @ . @@DOCK⚡,,,|
28 |~~~~~~@@ . @ GYM,    | [CAM]   [CAM] |  Laundry) @ . @@PIER⚡,,,|
30 |~~~~~~@@ . @ LIBRARY |               |  [C]      @ . [G]   ⚡~~~|
32 |~~~~~~@@ . @ & SHOWER+---------------+-----------@ . @@⚡⚡⚡⚡⚡~~~|
34 |~~~~~~@@ . @ [D]   SOUTH SECURITY CORRIDOR   [D] @ . @@~~~~~~~~|
36 |~~~~~~@@ . @-------[R]---------------+----[P]----@ . @@~~~~~~~~|
38 |~~~~~~@@ . @ GUARD ARMORY & CONTROL  #  GEN-2    @ . @@~~~~~~~~|
40 |~~~~~~@@ . @ [R] [CAM] [Ladder L]    #  [GEN]    @ . @@~~~~~~~~|
42 |~~~~~~@@ . @@@@@@@@@@@@@@@@@@@==[G]==@@@@@@@@@@@@@ . @@~~~~~~~~|
44 |~~~~~~@@[TWR]@@@@@@@@@@@@@@@@@==[G]==@@@@@@@@@@@[TWR]@@~~~~~~~~|
46 |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|FERRY|~~~~~~~~~~~~~~~~~~~~~~~~~~|
48 |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|PIER |~~~~~~~~~~~~~~~~~~~~~~~~~~|
50 |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+,,,,,+~~~~~~~~~~~~~~~~~~~~~~~~~~|
63 +---------------------------------------------------------------+
```

#### Level 5 — Layer +2 (Fortress Rooftops & Helipad ASCII Plan)
```text
   +---------------------------------------------------------------+
   |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
   |~~~~~~@@[TWR]@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@[TWR]@@~~~~~~~~|
   |~~~~~~@@   +-------------------------------------+   @@~~~~~~~~|
   |~~~~~~@@   | NORTH FORTRESS ROOF                 |   @@~~~~~~~~|
   |~~~~~~@@   | [Vent Hatch from GEN-1]             |   @@~~~~~~~~|
   |~~~~~~@@   +---------+                 +---------+   @@~~~~~~~~|
   |~~~~~~@@             | (Chasm - Hook   |             @@~~~~~~~~|
   |~~~~~~@@             |  Grapnel Here!) |             @@~~~~~~~~|
   |~~~~~~@@             \/                \/            @@~~~~~~~~|
   |~~~~~~@@   +-------------------------------------+   @@~~~~~~~~|
   |~~~~~~@@   | SOUTH ADMIN ROOF        [Ladder L]  |   @@~~~~~~~~|
   |~~~~~~@@   |   +--------------------+            |   @@~~~~~~~~|
   |~~~~~~@@   |   |  [ H ] HELIPAD     |            |   @@~~~~~~~~|
   |~~~~~~@@   |   | (Escape Chopper!)  |            |   @@~~~~~~~~|
   |~~~~~~@@   +---+--------------------+------------+   @@~~~~~~~~|
   |~~~~~~@@[TWR]@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@[TWR]@@~~~~~~~~|
   |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
   +---------------------------------------------------------------+
```

---

## 5. Security Systems, Guard Heat & Consequences

### 5.1 Guard Vision Cones & Patrols

* Every awake guard projects a visible **60-degree Vision Cone** in front of them that is dynamically blocked by walls and closed doors.
* Cone color indicates alert state:
  * **Soft Yellow:** Normal patrol.
  * **Orange:** Investigating a noise, open door, or tripped detector.
  * **Crimson Red:** Actively chasing the player or responding to a Lockdown.

### 5.2 Actions That Generate Guard Heat

| **Action Performed** | **Condition** | **Heat Penalty** |
|---|---|---|
| Attacking an inmate or guard | Inside Guard Vision Cone | **Instant $100\%$ Heat** |
| Chipping walls, cutting fences, digging, or unscrewing vents | Inside Guard Vision Cone | **Instant $100\%$ Heat** |
| Entering a Restricted Zone (Generator, Roof, Vents, Guard Room) | Seen without a Guard Outfit | **Instant $100\%$ Heat** |
| Being outside your cell during Lights Out ($23:00\text{–}08:00$) | Seen in an Inmate Outfit | **Instant $100\%$ Heat** |
| Lingering within $2.5$ tiles of a guard at night | Wearing a Guard Outfit for $>2\text{ sec}$ | $+50\%$ Heat per second |
| Holding a Contraband Weapon or Tool visibly in your active hand | Inside Guard Vision Cone | $+40\%$ Heat per second |
| Walking through an active Contraband Detector archway | Carrying unshielded contraband | $+50\%$ Heat + Siren + Guard Dispatch |
| Stepping into a sweeping Yard Searchlight at night | Without a Guard Outfit | $+35\%$ Heat per second + Alarm |
| Missing a mandatory Meal, Exercise, or Shower routine | Routine timer expires | $+25\%$ Heat |
| Missing Morning or Evening Roll Call | Routine timer expires | **Instant $100\%$ Heat (Lockdown)** |

### 5.3 Nighttime Stealth: Bed Dummies & Guard Disguises

* **Nighttime Bed Checks:** During Lights Out ($23:00\text{–}08:00$), a night-patrol guard walks past the cell block windows at $00:30$ and $04:00$ to verify every inmate is asleep in bed.
* **The Bed Dummy Trick:** If you plan to sneak out of your cell at night (via cloned keys, vents, or tunnels), you must craft a **Bed Dummy** ($2\times\text{Pillows} + 1\times\text{Bed Sheet}$) and place it in your bed before leaving. When the guard looks into your cell, the Bed Dummy fools them completely. Don't forget to remove it and hide it before Morning Roll Call!
* **Guard Uniform Disguise:** Wearing a **Guard Outfit** allows you to walk through corridors and restricted rooms at night without triggering immediate alarms, provided you keep a respectful distance ($>2.5\text{ tiles}$) from real guards so they don't recognize your face.

### 5.4 Contraband Detector Archways & Contraband Pouches

* Electronic scanner archways stand at the entrances to the Cell Block, Canteen, Gym, and all industrial workshops.
* Walking through an active archway while carrying any item marked as **Contraband** triggers loud buzzers, flashing red lights, $+50\%$ Heat, and alerts nearby guards to search you.
* **Countermeasures:**
  1. Craft a **Contraband Pouch** ($\text{Foil} + \text{Duct Tape}$). Simply holding it in your inventory shields all carried contraband from scanner waves (consumes $1$ durability per pass, lasting $20$ passes).
  2. Shut off the **Central Power Generator**, which disables all Contraband Detectors across the prison.
  3. Pass items through chipped wall holes or overhead ventilation ducts that bypass the archway doors.

### 5.5 The Central Power Generator

Located inside the locked Generator Room, the **Generator** powers four prison systems simultaneously:
1. **The Outer Electric Perimeter Fence** (makes it safe to cut with cutters when OFF).
2. **All Contraband Detector Archways** (disables scanning when OFF).
3. **Outdoor Night Searchlights** (turns off sweeping yard spotlights when OFF).
4. **Indoor Security Cameras** (blinds cameras when OFF).

* **Maintenance Guard Response:** When the player switches the Generator OFF, a maintenance guard is dispatched to investigate and flip it back ON after **45 real seconds**, giving the player a tense, timed window to cut through the electric fence or smuggle bulk contraband.

### 5.6 Security Cameras, Watchtower Snipers & Solitary Confinement

* **Security Cameras:** Mounted in high-security hallways and workshop corners. If a camera spots the player chipping a wall or unscrewing a vent, it sounds an alarm and summons guards. Players can temporarily disable a camera for $60\text{ seconds}$ by applying **Duct Tape** or **Toothpaste** directly to its lens.
* **Watchtower Snipers:** During daytime hours, if the player's Heat reaches $90\%+$ while outdoors—or if the player is spotted cutting an outer fence during the day—watchtower snipers fire high-damage warning and takedown shots. Snipers go off-duty at night ($23:00\text{–}08:00$), replaced by sweeping searchlights.
* **Lockdown & Solitary Confinement:**
  * Triggered whenever a guard catches the player at $100\%$ Heat, or whenever a guard discovers an uncovered tunnel, broken wall, cut fence, or missing guard key.
  * **Penalties:**
    1. All contraband in the player's inventory and non-hidden desk drawers is confiscated.
    2. Player's equipped outfit is reset to a standard Orange Inmate Outfit.
    3. Any uncovered structural damage (tunnels, wall holes, cut fences) discovered by guards is repaired and concreted over.
    4. The player is locked in a dark **Solitary Cell** for 2 in-game hours—or can mash the interact key in the **Potato Peeling Minigame** to earn early release!

---

## 6. Inventory, Storage & Contraband Concealment

### 6.1 Player Inventory Layout

* **6 Active Hotbar Slots:** Holds tools, raw materials, consumables, keys, and quest items.
* **1 Dedicated Weapon Slot:** Holds your currently equipped melee or ranged weapon.
* **1 Dedicated Outfit Slot:** Holds your currently worn uniform or armor.

### 6.2 Cell Desks & Hidden Compartments

Every inmate cell contains a personal **Desk** with **16 total storage slots** split into two distinct sections:

1. **Hidden Compartments (6 Slots — Safe from Shakedowns):** Secret false-bottom drawers. Guards conducting Morning Roll Call shakedowns or random searches **never** detect contraband stored in these 6 slots.
2. **Standard Drawers (10 Slots):** Regular storage space. Legal everyday items are always safe here, but any **Contraband** left in standard drawers will be confiscated if your cell is selected for a shakedown.

* *Daily Scavenging:* Every morning at $08:00$, the desks inside the other AI inmates' cells restock with randomized everyday items and occasional contraband materials, encouraging daily looting runs.

---

## 7. Complete Item Encyclopedia (All 77 Items)

### 7.1 Everyday & Contraband Raw Materials (35 Items)

| **Item Name** | **Legal Status** | **Base Value** | **Primary Whereabouts** | **Gameplay Uses** |
|---|---|---|---|---|
| **Plastic Comb** | Legal | $\$5$ | Inmate Desks | Melt with a lighter for Molten Plastic, or sharpen into a Comb Shiv / Comb Blade. |
| **Toothbrush** | Legal | $\$5$ | Inmate Desks | Sharpen on a wall into a Toothbrush Shiv, or melt into Molten Plastic. |
| **Lighter** | **Contraband** | $\$15$ | Desks / Merchants | Essential heat source to melt plastic combs or chocolate bars. |
| **Roll of Toilet Paper** | Legal | $\$3$ | Toilets / Desks | Combine with glue to craft Papier-Mâché. |
| **Tube of Glue** | **Contraband** | $\$12$ | Desks / Merchants | Adhesive combined with toilet paper to create Papier-Mâché. |
| **Roll of Duct Tape** | **Contraband** | $\$20$ | Desks / Merchants | Universal binding material required for almost all tiered tools, weapons, and armor. |
| **Metal File** | **Contraband** | $\$20$ | Desks / Merchants | Core component for crafting Flimsy, Lightweight, and Sturdy Cutters, or shaping wood handles. |
| **Timber** | **Contraband** | $\$15$ | Woodshop / Merchants | Raw wood plank used for Tool Handles, Timber Braces, Bats, Nunchucks, and Whips. |
| **Sheet Metal** | **Contraband** | $\$20$ | Metalshop / Merchants | Heavy metal plate used for Shovels and Plated Inmate Armor. |
| **Crowbar** | **Contraband** | $\$35$ | Merchants | Can chip walls directly or be crafted into Pickaxes and Grappling Hooks. |
| **Pillow** | Legal | $\$5$ | Cell Beds | Combine 2 Pillows with a Bed Sheet for a Bed Dummy, or tape to uniform for Cushioned Armor. |
| **Bed Sheet** | Legal | $\$5$ | Cell Beds | Used to craft Bed Dummies, Sheet Ropes, and Makeshift Rafts. |
| **Sock** | Legal | $\$3$ | Desks / Laundry | Harmless alone; stuff with Soap or a Battery to craft a deadly Sock Mace. |
| **Bar of Soap** | Legal | $\$5$ | Showers / Desks | Combine with a Sock to craft a Sock Mace. |
| **Battery** | Legal | $\$10$ | Inmate Desks | High-density weight for a Super Sock Mace, or power source for a Powered Screwdriver. |
| **Length of Wire** | **Contraband** | $\$12$ | Desks / Merchants | Used for Fake Fence Covers, Nunchucks, Razor Whips, and Powered Screwdrivers. |
| **Razor Blade** | **Contraband** | $\$12$ | Desks / Merchants | Attached to combs or whips for high-damage slicing weapons. |
| **Jar of Ink** | Legal | $\$8$ | Library / Desks | Dyes Papier-Mâché to craft convincing Fake Wall Blocks. |
| **Magazine** | Legal | $\$8$ | Library / Desks | Combine with Duct Tape to create a Wall Poster that hides chipped holes. |
| **Roll of Foil** | **Contraband** | $\$15$ | Kitchen / Merchants | Combine with Duct Tape to craft a Contraband Pouch that fools scanner archways. |
| **Talcum Powder** | Legal | $\$8$ | Inmate Desks | Combine with Toothpaste to create a Wad of Putty for key impressions. |
| **Tube of Toothpaste** | Legal | $\$5$ | Inmate Desks | Combine with Talcum Powder for Putty, or smear on security cameras to blind them. |
| **Wad of Putty** | **Contraband** | $\$25$ | Crafted | Soft impression putty; press any Guard Key into it to create a Key Mold. |
| **Molten Plastic** | **Contraband** | $\$20$ | Crafted | Pour into a Key Mold to cast a working Plastic Key. |
| **Papier-Mâché** | **Contraband** | $\$15$ | Crafted | Used to craft Fake Vent Covers and Fake Wall Blocks. |
| **Tool Handle** | **Contraband** | $\$18$ | Crafted | Wooden grip required as the base for crafting Shovels and Pickaxes. |
| **Plastic Cup** | Legal | $\$3$ | Canteen / Desks | Vessel for melting chocolate into a scalding ranged weapon. |
| **Bar of Chocolate** | Legal | $\$8$ | Canteen / Desks | Eat to restore $+15\%$ Energy, or melt in a cup with a lighter. |
| **Broom** | Legal | $\$10$ | Janitor Closet | Long wooden handle; can be used as an improvised weak weapon. |
| **Mop** | Legal | $\$10$ | Janitor Closet | Equipped to clean floor spills for the Janitor prison job. |
| **Bottle of Bleach** | Legal | $\$12$ | Laundry / Janitor | Used in laundry processing and uniform bleaching. |
| **Balsa Wood** | **Contraband** | $\$15$ | Woodshop | Lightweight buoyant wood used to craft the Makeshift Raft on Level 5. |
| **Length of Rope** | **Contraband** | $\$25$ | Merchants | Combined with a Grappling Hook for a Grapnel, or Balsa Wood for a Makeshift Raft. |
| **Pile of Dirt** | **Contraband** | $\$0$ | Digging Tunnels | Automatically generated when digging. Must be flushed down toilets or hidden! |
| **Concrete Wall Chunk** | **Contraband** | $\$0$ | Chipping Walls | Drops when a brick wall is broken through. Must be hidden in a desk or tunnel. |
| **Raw Potato** | Legal | $\$1$ | Solitary / Kitchen | Peeled during Solitary Confinement to work off punishment time rapidly. |

### 7.2 Digging, Chipping, Cutting & Unscrewing Tools (17 Items)

Tools belong to four functional categories (**Digging**, **Chipping**, **Cutting**, **Unscrewing**) and four quality tiers (**Tier 1 to Tier 4**). Higher tiers deal much more structural damage per strike, last longer, and drain far less player Energy.

| **Tool Name** | **Function Category** | **Tier** | **Max Durability** | **Tile Damage / Use** | **Energy Cost / Use** | **Contraband?** |
|---|---|---|---|---|---|---|
| **Plastic Spoon** | Digging | Tier 1 | 10 uses | 4 dmg | $8\%$ Energy | Legal |
| **Garden Trowel** | Digging | Tier 2 | 20 uses | 10 dmg | $6\%$ Energy | **Contraband** |
| **Flimsy Shovel** | Digging | Tier 1 | 18 uses | 10 dmg | $6\%$ Energy | **Contraband** |
| **Lightweight Shovel** | Digging | Tier 2 | 30 uses | 18 dmg | $5\%$ Energy | **Contraband** |
| **Sturdy Shovel** | Digging | Tier 3 | 50 uses | 25 dmg | $4\%$ Energy | **Contraband** |
| **Plastic Fork** | Chipping (Walls) | Tier 1 | 10 uses | 4 dmg | $8\%$ Energy | Legal |
| **Flimsy Pickaxe** | Chipping (Walls) | Tier 1 | 18 uses | 10 dmg | $6\%$ Energy | **Contraband** |
| **Lightweight Pickaxe** | Chipping (Walls) | Tier 2 | 30 uses | 18 dmg | $5\%$ Energy | **Contraband** |
| **Sturdy Pickaxe** | Chipping (Walls) | Tier 3 | 50 uses | 25 dmg | $4\%$ Energy | **Contraband** |
| **Plastic Knife** | Cutting (Fences/Vents) | Tier 1 | 10 uses | 4 dmg | $8\%$ Energy | Legal |
| **Flimsy Cutters** | Cutting (Fences) | Tier 1 | 18 uses | 10 dmg | $6\%$ Energy | **Contraband** |
| **Lightweight Cutters** | Cutting (Fences) | Tier 2 | 30 uses | 18 dmg | $5\%$ Energy | **Contraband** |
| **Sturdy Cutters** | Cutting (Fences) | Tier 3 | 50 uses | 25 dmg | $4\%$ Energy | **Contraband** |
| **Nail File** | Unscrewing (Vents) | Tier 1 | 8 uses | 12 dmg | $6\%$ Energy | **Contraband** |
| **Screwdriver** | Unscrewing (Vents) | Tier 2 | 25 uses | 25 dmg | $4\%$ Energy | **Contraband** |
| **Powered Screwdriver** | Unscrewing (Vents) | Tier 4 | 50 uses | 50 dmg | $2\%$ Energy | **Contraband** |
| **Multitool** | Digging & Chipping | Tier 4 | 80 uses | 35 dmg | $3\%$ Energy | **Contraband** |

### 7.3 Weapons, Outfits, Keys & Escape Gear (25 Items)

| **Item Name** | **Category** | **Combat / Utility Stats** | **Contraband?** |
|---|---|---|---|
| **Comb Shiv** | Weapon | $+6$ Melee Attack Damage | **Contraband** |
| **Toothbrush Shiv** | Weapon | $+6$ Melee Attack Damage | **Contraband** |
| **Comb Blade** | Weapon | $+10$ Melee Attack Damage | **Contraband** |
| **Sock Mace** | Weapon | $+10$ Melee Attack Damage | **Contraband** |
| **Super Sock Mace** | Weapon | $+16$ Melee Attack Damage | **Contraband** |
| **Wooden Bat** | Weapon | $+14$ Melee Attack Damage | **Contraband** |
| **Spiked Baseball Bat** | Weapon | $+20$ Melee Attack Damage | **Contraband** |
| **Guard Baton** | Weapon | $+18$ Melee Attack Damage (Looted from knocked-out guards) | **Contraband** |
| **Nunchucks** | Weapon | $+22$ Melee Attack Damage, $+15\%$ Faster Swing Speed | **Contraband** |
| **Razor Whip** | Weapon | $+20$ Melee Attack Damage, Extended $2.5$-Tile Reach | **Contraband** |
| **Cup of Molten Chocolate** | Ranged Weapon | Single-use thrown splash attack ($3$-Tile range) — **Instant Knockout!** | **Contraband** |
| **Orange Inmate Outfit** | Outfit | $+5$ Defense (Standard legal prison uniform) | Legal |
| **Cushioned Inmate Outfit** | Outfit | $+15$ Defense + Cold Weather Insulation on Level 2 | **Contraband** |
| **Plated Inmate Outfit** | Outfit | $+30$ Defense (Heavy sheet-metal armor for riots and guard fights) | **Contraband** |
| **Guard Uniform** | Outfit | $+15$ Defense; disguises wearer in restricted areas and during Lights Out | **Contraband** |
| **Real Guard Keys (5 Colors)** | Key | Opens Yellow, Cyan, Purple, Red, or Green doors. Must be returned before guard wakes! | **Contraband** |
| **Key Molds (5 Colors)** | Crafting Mold | Impression of a Guard Key; combine with Molten Plastic. | **Contraband** |
| **Plastic Keys (5 Colors)** | Cloned Key | Unlocks matching color doors ($15$ uses durability). | **Contraband** |
| **Contraband Pouch** | Stealth Gear | Shields all carried contraband from Detector Archways ($20$ passes). | **Contraband** |
| **Bed Dummy** | Concealment | Placed in player bed at night to fool night-patrol bed checks. | **Contraband** |
| **Wall Poster** | Concealment | Placed over a broken brick wall tile to hide the hole from guards. | **Contraband** |
| **Fake Wall Block** | Concealment | Placed inside a chipped wall opening; looks identical to real brickwork. | **Contraband** |
| **Fake Vent Cover** | Concealment | Covers an unscrewed ceiling Vent Grate so guards don't notice it missing. | **Contraband** |
| **Fake Fence Cover** | Concealment | Covers a cut section of chain-link fence. | **Contraband** |
| **Timber Brace** | Tunnel Support | Placed in Layer $-1$ tunnels to prevent roof cave-ins. | **Contraband** |
| **Sheet Rope** | Escape Gear | Tied to rooftop ledges (Layer $+2$) to climb down to the ground floor. | **Contraband** |
| **Grappling Hook** | Component | Combined with Rope or Sheet Rope to make a Grapnel. | **Contraband** |
| **Grapnel** | Escape Gear | Hooks across rooftop gaps and climbs up outer perimeter walls. | **Contraband** |
| **Makeshift Raft** | Escape Gear | Crafted from Balsa Wood, Bed Sheet, and Rope to escape HMP Irongate's Boat Dock. | **Contraband** |

---

## 8. Complete Crafting & Recipe Handbook

Players can open the **3-Slot Crafting Workbench** at any time. Ingredient order does not matter. If the player's **Intellect** attribute is lower than the recipe's requirement, the crafting system displays a hint indicating how much Intellect is needed. Once crafted for the first time, the recipe is permanently recorded in the player's **Recipe Handbook**.

### 8.1 Complete Recipe Table

| **Crafted Item** | **Ingredient 1** | **Ingredient 2** | **Ingredient 3** | **Intellect Required** |
|---|---|---|---|---|
| **Molten Plastic** | Plastic Comb *(or Toothbrush)* | Lighter | — | $30\text{ INT}$ |
| **Wad of Putty** | Talcum Powder | Tube of Toothpaste | — | $40\text{ INT}$ |
| **Papier-Mâché** | Roll of Toilet Paper | Tube of Glue | — | $30\text{ INT}$ |
| **Tool Handle** | Timber | Metal File | — | $30\text{ INT}$ |
| **Bed Dummy** | Pillow | Pillow | Bed Sheet | $30\text{ INT}$ |
| **Sheet Rope** | Bed Sheet | Bed Sheet | — | $20\text{ INT}$ |
| **Wall Poster** | Magazine | Roll of Duct Tape | — | $20\text{ INT}$ |
| **Fake Vent Cover** | Papier-Mâché | Papier-Mâché | — | $30\text{ INT}$ |
| **Fake Wall Block** | Papier-Mâché | Papier-Mâché | Jar of Ink | $50\text{ INT}$ |
| **Fake Fence Cover** | Length of Wire | Length of Wire | Length of Wire | $40\text{ INT}$ |
| **Timber Brace** | Timber | Timber | — | $20\text{ INT}$ |
| **Contraband Pouch** | Roll of Foil | Roll of Duct Tape | — | $50\text{ INT}$ |
| **Flimsy Shovel** | Tool Handle | Sheet Metal | Roll of Duct Tape | $40\text{ INT}$ |
| **Lightweight Shovel** | Flimsy Shovel | Sheet Metal | Roll of Duct Tape | $60\text{ INT}$ |
| **Sturdy Shovel** | Lightweight Shovel | Sheet Metal | Roll of Duct Tape | $80\text{ INT}$ |
| **Flimsy Pickaxe** | Tool Handle | Crowbar | Roll of Duct Tape | $40\text{ INT}$ |
| **Lightweight Pickaxe** | Flimsy Pickaxe | Timber | Roll of Duct Tape | $60\text{ INT}$ |
| **Sturdy Pickaxe** | Lightweight Pickaxe | Timber | Roll of Duct Tape | $80\text{ INT}$ |
| **Flimsy Cutters** | Metal File | Metal File | Roll of Duct Tape | $40\text{ INT}$ |
| **Lightweight Cutters** | Flimsy Cutters | Metal File | Roll of Duct Tape | $60\text{ INT}$ |
| **Sturdy Cutters** | Lightweight Cutters | Metal File | Roll of Duct Tape | $80\text{ INT}$ |
| **Multitool** | Sturdy Shovel | Sturdy Pickaxe | Roll of Duct Tape | $90\text{ INT}$ |
| **Powered Screwdriver** | Screwdriver | Battery | Length of Wire | $70\text{ INT}$ |
| **Key Mold (Any Color)** | Wad of Putty | Real Guard Key (Color) | — | $50\text{ INT}$ |
| **Plastic Key (Any Color)** | Key Mold (Color) | Molten Plastic | — | $60\text{ INT}$ |
| **Sock Mace** | Sock | Bar of Soap | — | $20\text{ INT}$ |
| **Super Sock Mace** | Sock | Battery | — | $40\text{ INT}$ |
| **Comb Blade** | Plastic Comb | Razor Blade | — | $30\text{ INT}$ |
| **Wooden Bat** | Timber | Roll of Duct Tape | — | $40\text{ INT}$ |
| **Spiked Baseball Bat** | Wooden Bat | Nail File *(or Wire)* | Roll of Duct Tape | $60\text{ INT}$ |
| **Nunchucks** | Timber | Timber | Length of Wire | $70\text{ INT}$ |
| **Razor Whip** | Timber | Length of Wire | Razor Blade | $80\text{ INT}$ |
| **Cup of Molten Chocolate** | Plastic Cup | Bar of Chocolate | Lighter | $40\text{ INT}$ |
| **Cushioned Inmate Outfit** | Orange Inmate Outfit | Pillow | Roll of Duct Tape | $40\text{ INT}$ |
| **Plated Inmate Outfit** | Orange Inmate Outfit | Sheet Metal | Roll of Duct Tape | $70\text{ INT}$ |
| **Grappling Hook** | Crowbar | Crowbar | Roll of Duct Tape | $60\text{ INT}$ |
| **Grapnel** | Grappling Hook | Length of Rope *(or Sheet Rope)* | — | $60\text{ INT}$ |
| **Makeshift Raft** | Balsa Wood | Bed Sheet | Length of Rope | $70\text{ INT}$ |

### 8.2 The Non-Destructive Key Cloning Process

One of the signature mechanics of *The Escapists* is cloning a guard's key without getting caught:

1. Prepare a **Wad of Putty** ($\text{Talcum Powder} + \text{Toothpaste}$) and **Molten Plastic** ($\text{Comb} + \text{Lighter}$) in advance, and make sure your Intellect is at least $60$.
2. Knock out the guard carrying the target key color (each guard's key color is visible on their belt or inspection tooltip).
3. Loot the unconscious guard's **Real Guard Key** within the **30-second knockout window**.
4. Open the Crafting menu and combine the **Wad of Putty** + **Real Guard Key**. This consumes the putty to create a **Key Mold**, while **returning the Real Guard Key intact**.
5. Immediately place the **Real Guard Key** back into the unconscious guard's pocket before the 30 seconds expire! When the guard wakes up, they still have their key, so no Lockdown is triggered.
6. Combine your **Key Mold** + **Molten Plastic** to cast your own **Plastic Key**!

---

## 9. World Destruction, Tunneling & Cover-Ups

### 9.1 Destructible vs. Reinforced Structures

* **Brick Walls:** Can be chipped through ($100\text{ HP}$) using Forks, Crowbars, Pickaxes, or the Multitool. Drops a **Concrete Wall Chunk** when broken.
* **Reinforced Concrete Walls:** Indestructible walls found on higher-security prisons (Levels 3, 4, and 5); forces the player to use keys, vents, roofs, or tunnels instead.
* **Chain-Link & Electric Fences:** Can be cut ($100\text{–}120\text{ HP}$) using Knives or Cutters. **Warning:** Striking an **Electric Fence** while the prison Generator is ON electrocutes the player for an instant knockout!
* **Ceiling Vent Grates:** Can be unscrewed ($60\text{ HP}$) using Nail Files or Screwdrivers by standing on a desk or toilet underneath the grate.

### 9.2 Digging Tunnels, Dirt Disposal & Cave-Ins

* **Starting a Tunnel:** Stand on any ground-floor dirt, grass, or non-reinforced floor tile with a digging tool (Spoon, Trowel, Shovel, Multitool) to dig a **Tunnel Entrance** down to Layer $-1$.
* **Dirt Generation:** Completing a tunnel entrance or digging out an underground dirt block places a **Pile of Dirt** directly into your inventory.
* **Disposing of Dirt & Concrete Chunks:**
  * If a guard ever sees a **Pile of Dirt** or **Concrete Wall Chunk** lying on the floor, they sound the Lockdown whistle immediately.
  * Players can safely dispose of dirt by **flushing it down any Cell Toilet**.
  * **Toilet Clogging Limit:** Flushing more than **3 Piles of Dirt** down the same toilet within an hour clogs the plumbing (causing overflowing water particles). A clogged toilet cannot flush more dirt for $60\text{ in-game minutes}$. Alternatively, dirt can be carried into an existing underground tunnel and dropped on Layer $-1$ where guards cannot see it.
* **Underground Cave-In Hazard:** When digging horizontally on Layer $-1$, digging more than **2 consecutive tiles** without placing a **Timber Brace** causes a ceiling collapse ($40\text{ HP}$ damage and refills the tunnel tile with dirt). Each **Timber Brace** stabilizes a $3\times 3$ underground section permanently.

### 9.3 Concealing Structural Damage

If a guard's Vision Cone touches an uncovered hole in a wall, an open tunnel entrance, a missing vent grate, or a cut fence, they immediately trigger a **Lockdown** and send the player to Solitary. Players must cover their work before leaving:
* **Chipped Wall Hole:** Cover with a **Wall Poster** or insert a **Fake Wall Block** (which you can pick up and put back in place whenever you pass through).
* **Unscrewed Vent Grate:** Cover with a **Fake Vent Cover**.
* **Cut Fence Section:** Cover with a **Fake Fence Cover**.
* **Tunnel Entrance:** Start your tunnel underneath your **Cell Desk** (picking up the desk to dig, then sliding the desk back over the hole to conceal it completely!).

---

## 10. Combat, Knockouts & Social AI Systems

### 10.1 Melee & Ranged Combat

* **Target Lock-On:** Press the Lock-On key to highlight the nearest inmate or guard within range, displaying their Health Bar, Strength rating, and current Attitude.
* **Damage Calculation:** Melee damage scales with your **Strength** attribute plus your equipped **Weapon Bonus**, minus the target's **Outfit Defense**. Attack speed scales with your **Speed** attribute.
* **Instant-KO Ranged Attack:** The **Cup of Molten Chocolate** can be thrown from up to $3\text{ tiles}$ away to instantly knock out even the toughest guard in a single hit—making it the ultimate tool for silent key-cloning ambushes.

### 10.2 Knockout State & The Missing Key Rule

* Knocked-out inmates and guards lie unconscious on the floor for **30 real seconds** with spinning stars above their heads.
* While unconscious, the player can loot their inventory, swap their uniform, or take their weapon.
* **The Missing Guard Key Rule:** Each of the 5 patrol guards carries one specific color key (**Yellow**, **Cyan**, **Purple**, **Red**, or **Green**). If a knocked-out guard wakes up after 30 seconds and discovers their assigned key is no longer in their inventory, they immediately radio Control and trigger a **Prison-Wide Lockdown**.

### 10.3 Inmate Opinion, Merchants & Recruiting Allies

* Every fellow inmate has an **Opinion Rating ($0\text{–}100$, starting at $50$)** toward the player:
  * **Low Opinion ($0\text{–}25$):** The inmate despises you and may randomly ambush you in the Canteen or Showers.
  * **Neutral Opinion ($26\text{–}79$):** Standard behavior.
  * **High Opinion ($80\text{–}100$):** Friendly ally. You can press Interact to **Recruit** up to 2 high-opinion inmates to follow you and fight alongside you against guards!
* **Increasing Opinion:** Give gifts (items or cash) directly to an inmate or complete their **Favors**.
* **Inmate Contraband Merchants:** Three inmates operate secret shops during Free Time, selling rare raw materials, tools, and crowbars. Higher Opinion with a merchant grants up to a **50% price discount**!

### 10.4 Inmate Favor Quests

Inmates with a floating exclamation mark (`!`) above their head offer side quests paying $\$20\text{ to }\$50$ and $+15\text{ Opinion}$:

1. **Scavenge & Delivery Favor:** *"Find a [Target Item] in someone's desk and bring it to me."*
2. **Contraband Retrieval Favor:** *"Inmate [Name] stole my [Quest Item]. Knock them out, take it back from their pockets, and return it to me."*
3. **Beatdown Favor:** *"Inmate [Name] has been running their mouth. Knock them unconscious for me."*
4. **Roll Call Distraction:** *"Cause a scene by starting a fight during the next Roll Call so I can slip away."*

---

## 11. Prison Jobs & Economy

Players can inspect the **Job Board** in the main corridor to apply for any open job they meet the **Intellect** requirement for. If another inmate currently holds the job you want, you can sabotage them (by beating them up or blocking them from reaching their work room during Work Period) so they get fired at $15:00$, opening the slot for you!

### 11.1 The 6 Prison Jobs Breakdown

| **Job Title** | **Intellect Req** | **Daily Wage** | **Step-by-Step Daily Quota Workflow** | **Covert Escape Advantage** |
|---|---|---|---|---|
| **1. Laundry Officer** | $20\text{ INT}$ | $\$30$ | Take dirty clothes from the Dirty Bin, load into Washing Machine ($5\text{s}$ cycle), and place clean clothes into the Clean Bin (4 loads). | Grants legal access to **Guard Uniforms** and **Inmate Outfits** that can be stolen! |
| **2. Janitor** | $25\text{ INT}$ | $\$35$ | Grab a Mop from the Janitor Closet and scrub 6 dirty puddles across the prison corridors. | Grants a free **Mop/Broom** and legal roaming access across hallways during Work Period. |
| **3. Kitchen Cook** | $30\text{ INT}$ | $\$40$ | Take raw food from the Freezer, bake in the Kitchen Oven ($5\text{s}$), and place cooked meals on the Canteen Serving Table (4 trays). | Grants easy access to **Rolls of Foil** (for Contraband Pouches) and extra food to restore Energy. |
| **4. Woodshop Carpenter** | $40\text{ INT}$ | $\$50$ | Take **Timber** from the Wood Supply Bin, assemble furniture at the Workbench, and place in Output Bin (3 pieces). | Unlimited free supply of **Timber** and **Balsa Wood** for Pickaxes, Tunnel Braces, Weapons, and Rafts! |
| **5. Mailman** | $50\text{ INT}$ | $\$55$ | Sort mailbags at the Mailroom Desk and hand-deliver letters to 3 designated inmates around the prison. | High pay with fast completion time, leaving the rest of the Work Period free for scavenging. |
| **6. Metalshop Machinist** | $60\text{ INT}$ | $\$65$ | Take **Sheet Metal** from the Metal Bin, stamp license plates at the Hydraulic Press, and place in Output Bin (4 plates). | Highest daily wage plus unlimited free **Sheet Metal** for Shovels and Plated Armor! |

---

## 12. Master Escape Routes Across the 5-Level Campaign

Every prison supports multiple sandbox escape strategies:

1. **The Classic Nighttime Perimeter Cutout (Levels 1–3):** Craft **Cutters**, a **Bed Dummy**, a **Guard Uniform**, and cloned **Plastic Keys**. At $23:00$ (**Lights Out**), place the **Bed Dummy** in bed, sneak into the **Generator Room**, shut off the **Power Generator** (disabling Electric Fences and Searchlights for 45 seconds), and cut through the outer fence before power is restored!
2. **The Great Underground Tunnel (Levels 1–4):** Stockpile **Timber** (for **Timber Braces**) and craft a **Sturdy Shovel** or **Multitool**. Dig a **Tunnel Entrance** underneath your **Cell Desk**, flush all **Piles of Dirt** down toilets, and tunnel on **Layer $-1$** underneath fences and minefields (routing around underground boulders on Level 2) to surface on the outer freedom road.
3. **The Rooftop Grapnel & Sheet Rope Breakout (Levels 1–5):** Unscrew your cell ceiling **Vent Grate**, replace it with a **Fake Vent Cover**, crawl through **Layer $+1$ Vents** to the **Layer $+2$ Rooftops**, use a **Grapnel** to hook across to the outer perimeter wall or **Helipad** (Level 5), and use a **Sheet Rope** to descend outside the walls.
4. **The Prison Takeover / Riot Escape (Levels 1–5):** Train **Strength** and **Speed** to $90+$, craft **Plated Inmate Armor** and **Nunchucks**, recruit **2 allied inmates** ($80+\text{ Opinion}$), and knock out at least $85\%$ of the guard force simultaneously to force the main perimeter gates (or Level 5 Ferry Drawbridge) wide open!
5. **The Island Boat Dock Raft Escape (Level 5 Exclusive):** Craft a **Makeshift Raft** ($\text{Balsa Wood} + \text{Bed Sheet} + \text{Rope}$), disable **Generator #2**, breach the East Boat Dock electric fence, and launch into the ocean from the pier.

---

## 13. Controls, HUD & User Experience

### 13.1 Player Controls Summary

* **Movement (`W, A, S, D` / Arrow Keys):** Move in 8 directions across the current layer.
* **Context Interact (`E`):** Open desks/containers, loot unconscious NPCs, sit in chairs, sleep in bed, flush dirt in toilets, toggle the generator, climb ladders/vents, talk/trade with inmates, or hang posters/concealment blocks over holes.
* **Use Tool / Attack (`Space` or `Left-Click`):** Strike an adjacent wall, fence, vent, or floor tile with your active hotbar tool—or swing your equipped weapon at a locked-on target.
* **Target Lock-On (`R`):** Lock onto or switch between nearby NPCs for combat or interaction.
* **Crafting & Handbook (`C`):** Open the 3-slot Crafting Workbench and discovered Recipe Handbook.
* **Hotbar Selection (`1 – 6`):** Select active inventory slot.
* **Drop Item (`Q`):** Drop the currently selected item onto the floor.
* **Level Select / Campaign Menu (`M`):** Switch between unlocked prison levels (1 to 5).
* **Camera Zoom (`Mouse Wheel`):** Zoom in and out smoothly.

### 13.2 HUD & Visual Feedback Elements

* **Top Status Bar:** Displays Prison Name & Level ($1\text{–}5$), Day Counter, 24-Hour Digital Clock, Current Routine Phase, Mandatory Location Reminder, Attendance Status Badge (`PENDING` / `ATTENDED`), Health Bar, Energy Bar, Guard Heat Meter ($0\%\text{–}100\%$), Current Layer Indicator (`TUNNELS` / `GROUND` / `VENTS` / `ROOF`), and Player Stats (`STR`, `SPD`, `INT`, `CASH`).
* **Bottom Hotbar:** Displays the 6 inventory slots, Weapon slot, and Outfit slot, with red warning borders on **Contraband** items and durability bars on tools.
* **3D World Cues:**
  * Floating speech bubbles and quest icons (`!`, `$`) over inmates.
  * Animated directional floor arrows for 15 seconds whenever a new routine starts.
  * Dust clouds when chipping walls, dirt bursts when digging, electric sparks on live fences, water spray in showers, and spinning stars above unconscious characters.
  * Victory Summary Screen upon escaping each prison, tracking **Days Taken**, **Walls Chipped**, **Tunnels Dug**, **Guards Knocked Out**, **Total Cash Earned**, and **Escape Method Achieved**, before advancing to the next prison level.