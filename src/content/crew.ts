/**
 * Crew & specialists (P23): every inmate has a line of work, and a follower in the player's crew
 * takes orders in it. The numbers they work by; how it plays out is src/sim/systems/crew.ts.
 */

/** What an inmate is good at (PrisonDef.crew, by cell). Stored by name in data only; append only. */
export const SPECIALITIES = ['lookout', 'digger', 'muscle', 'smuggler'] as const;
export type Speciality = (typeof SPECIALITIES)[number];

/** A lookout posted somewhere whistles when an awake guard comes this close (tiles) where he can see it. */
export const WATCH_RANGE = 6;
/** A digger at the player's side (this close, tiles) makes the ground floor's digging and chipping go half as fast again; he takes the dirt and the rubble. */
export const DIG_REACH = 2;
/** Down a tunnel, with him waiting at the top of the shaft (this close to its side, tiles): tunnel digging a quarter faster, and the dirt handed up to him. */
export const SHAFT_REACH = 1.5;
/** Ground-floor and tunnel digging with a digger's help (out of 4: ×1.5 and ×1.25). */
export const DIG_HELP = 6;
export const SHAFT_HELP = 5;
/** A muscle watching the player's back: his blows ×1.5 (out of 2), and nobody jumps the player while he's this close (tiles). */
export const BACK_HELP = 3;
export const BACK_REACH = 4;
/** Starting a brawl: once a prison day, with another inmate this close (tiles) he can see; it lasts this long (steps: 60 s) and draws this many guards. */
export const BRAWL_RANGE = 5;
export const BRAWL_STEPS = 1200;
export const BRAWL_GUARDS = 2;
/** Brawlers square up this far apart (units, centre to centre: fists up between them, not through each other). */
export const BRAWL_GAP = 1100;
/** Fetching the drop: he gives up if he isn't there in this long (steps: 90 s). */
export const FETCH_STEPS = 1800;
/** He has it when he's this close to where it lies (units: three quarters of a tile). */
export const FETCH_REACH = 768;
/** "Tonight's the night": from this opinion, he stays with the player through Lights Out, until 06:00 (minutes of the day). */
export const NIGHT_OPINION = 90;
export const NIGHT_UNTIL = 6 * 60;
/** The crew who are this close (tiles) when the player gets out slip out with them (fence, gate, takeover, raft, helicopter: never through a hole). */
export const CREW_ESCAPE_REACH = 4;
