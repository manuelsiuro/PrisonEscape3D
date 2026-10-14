#Game idea

Here is a complete, comprehensive list of game features and systems you will need to design, broken down by category. 

### 1. Core Time & Routine System (The Simulation)
The heartbeat of the game is the prison schedule. Players must balance escaping with playing the part of a "good" prisoner.

*   **In-Game Clock:** A continuous day/night cycle.
*   **Daily Routine States:** The game must transition between specific phases (e.g., Roll Call, Breakfast, Free Time, Prison Job, Exercise, Dinner, Showers, Evening Roll Call, Lights Out).
*   **Routine Enforcement:** If the player is not in the designated zone during a routine (e.g., missing roll call), a "Heat" (suspicion) meter increases.

### 2. Player Systems & Stats
The player needs core attributes to manage their physical condition and capabilities.

*   **Health (HP):** Decreases in combat. If it hits zero, the player wakes up in the infirmary (and loses contraband).
*   **Energy/Stamina:** Consumed by working, exercising, fighting, digging, or chipping walls. Replenished by sleeping, eating, or showering.
*   **RPG Stats:** 
    *   **Strength:** Increases Max HP and combat damage. Gained via the exercise yard.
    *   **Speed:** Increases movement speed. Gained via the exercise yard (treadmills).
    *   **Intellect:** Required to craft more complex items and apply for better prison jobs. Gained by reading books or using the internet in the library.
*   **Heat Meter:** A percentage (0-100%). High heat makes guards follow, attack, or arrest the player on sight.

### 3. Inventory & Item Economy
Items are the key to escaping.

*   **Player Inventory:** Limited slots (e.g., 6 slots) + an equipped weapon/outfit slot.
*   **Cell Desk:** A personal storage space in the player's cell. Includes a hidden compartment for storing illegal items.
*   **Item Types:**
    *   **Legitimate Items:** Combs, soap, magazines, food.
    *   **Contraband:** Weapons, tools, files, duct tape, guard keys. Outlined in a different color (usually red) to warn the player.
*   **Item Degradation:** Tools (shovels, cutters) lose durability with each use and eventually break.

### 4. Crafting System
A robust system to combine raw materials into escape tools.

*   **Recipe System:** Combining 2 or 3 specific items to create a new one (e.g., Sock + Soap = Soap Mace; File + Timber + Wire = Flimsy Cutters).
*   **Intellect Gating:** Certain recipes are locked until the player reaches a specific Intellect level.
*   **Crafting Notes:** Collectible notes hidden around the prison that teach the player recipes.

### 5. NPC & AI Systems
The prison needs to feel alive with predictable but reactive AI.

*   **Guards:** 
    *   Patrol the prison grounds.
    *   Call out routines.
    *   Attack players with high Heat or those caught doing illegal acts.
    *   Carry specific colored keys (Security, Utility, Cell, etc.) and wear guard uniforms.
*   **Inmates:**
    *   Follow the daily routine.
    *   Have opinions of the player (Affection meter). Hitting them lowers it; giving gifts raises it.
    *   Can be recruited as followers if they like the player enough.
*   **The Merchant System:** Specific inmates sell items for in-game currency. Their inventory randomizes daily.
*   **Quest/Favor System:** Inmates offer favors (e.g., "Find me a roll of duct tape," "Beat up Inmate X") in exchange for coins.

### 6. Environment & Interaction (The Sandbox)
This is where Three.js will shine. You need a multi-layered world map.

*   **Multi-Level Grid:** The environment needs distinct elevation levels:
    *   **Underground:** Digging tunnels.
    *   **Ground Floor:** The main prison.
    *   **Vents:** Navigating above the ceiling.
    *   **Roof:** Walking on top of the buildings.
*   **Destructible/Modifyable Environment:** 
    *   Chipping through walls with forks/pickaxes.
    *   Cutting chain-link fences.
    *   Digging holes in the dirt.
    *   Unscrewing vent covers.
*   **Cover-Up Mechanics:** The ability to craft and place Fake Vent Covers, Fake Wall Blocks, or Dirt Rubble to hide escape attempts from guards.
*   **Prison Jobs:** Interactive mini-games or tasks (e.g., doing laundry, pressing license plates) to earn daily money.

### 7. Security Systems & Fail States
Obstacles that prevent an easy escape.

*   **Metal Detectors:** Trigger an instant lockdown if the player walks through them with Contraband (unless they have crafted a Contraband Pouch).
*   **Security Cameras:** Increase player Heat if they are caught fighting or breaking things in the camera's cone of vision.
*   **Guard Dogs:** Can track the player by scent, especially if the player is digging tunnels.
*   **Cell Shakedowns:** Randomly, guards will search specific cells. If they find contraband in a desk or spot a hole in the wall, the player is sent to solitary.
*   **Solitary Confinement:** A fail-state penalty where the player loses all contraband, loses stats, and has their escape tunnels filled in (reset).

### 8. Combat Mechanics
*   **Basic Actions:** Light attack, heavy attack, and blocking.
*   **Weapons:** Fists, improvised weapons (combs with razor blades, bats), and guard batons.
*   **Downed State:** When an NPC or player loses all HP, they lie on the floor for a set time.
*   **Looting:** The player can steal uniforms, items, and keys from downed guards/inmates before the medics arrive. (Note: Stealing a guard key requires crafting a plastic mold of it, then returning the original key before the guard wakes up, or the prison goes into lockdown).

### 9. Win Conditions (The Escapes)
Different ways the game recognizes a "Victory."

*   **Perimeter Escape:** Physically digging under, cutting through, or climbing over the outermost boundary of the map.
*   **Disguise Escape:** Walking out the front door using a fake ID, Guard Uniform, and knowing the timing of the guard shifts.
*   **Special Escapes:** Map-specific escapes (e.g., building a makeshift glider on the roof, fixing a broken boat at a dock).