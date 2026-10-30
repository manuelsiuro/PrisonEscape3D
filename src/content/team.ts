/**
 * Team & ink (P29, docs/PLAN.md §9): yard football (three a side on the yard's pitch, and the
 * cover it gives) and the tattoo parlour (a homemade gun, a design traced for an inmate's money,
 * a friend's work on the player's own arm). Nothing here happens without the player asking, and
 * nothing draws on the state's RNG: the escape bots' runs stay as they were.
 */
import type { Pitch } from './prisons/types';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';

/** A pitch from (x, z), w across and d deep; its goals at the two ends of its longer side, in the end tiles' middle two (the nets). */
export const pitch = (x: number, z: number, w: number, d: number): Pitch => ({ x, z, w, d });

// ------------------------------------------------------------------ football

/** A match: 90 seconds of play from the whistle (45 before 2.16, Sim.rules215). */
export const MATCH_STEPS = 90 * STEPS_PER_SECOND;
export const MATCH_STEPS_215 = 45 * STEPS_PER_SECOND;
/** Before the whistle, the players walk on: it blows once all are on the field, or after this long. */
export const GATHER_STEPS = 15 * STEPS_PER_SECOND;
/** After a goal, the ball stays in the net this long, then it's back on the spot. */
export const GOAL_PAUSE = 2 * STEPS_PER_SECOND;
/** The goal's mouth: this far either side of the end's middle (units: the nets' two tiles wide). */
export const GOAL_HALF = UNIT;
/** The ball: its radius; what it keeps of its speed each step (per cent); below this it stops (units a step); what a bounce off the boards keeps (per cent). */
export const BALL_R = 160;
export const BALL_KEEP = 95;
export const BALL_STOP = 6;
export const BOUNCE_KEEP = 60;
/** Close enough to touch the ball (centre to centre): run into it to dribble, at the walk's pace and this much more. */
export const TOUCH = 480;
export const DRIBBLE_PUSH = 40;
/** A kick (Space held, let go): from KICK_MIN to KICK_MAX (units a step), held up to KICK_HOLD steps; the ball within KICK_REACH of the player. */
export const KICK_MIN = 240;
export const KICK_MAX = 560;
export const KICK_HOLD = 30;
export const KICK_REACH = 700;
/**
 * 2.16 (not under Sim.rules215), the kick on contact: Kick held KICK_TAP steps or more goes the
 * moment the ball is in reach (as hard as it was held); let go with the ball out of reach, it waits
 * KICK_GRACE steps for it. Every kick of the player's goes KICK_LIFT harder. A rival's kick at the
 * player's feet takes the ball off them for TACKLE_COOL steps.
 */
export const KICK_TAP = 4;
export const KICK_GRACE = 6;
export const KICK_LIFT = 60;
export const TACKLE_COOL = 10;
/**
 * 2.16, aim help: a kick within AIM_HELP of the way to the far net (its cosine, ×1024: 60°) goes at
 * the mouth, where the player's way crosses its line, AIM_IN at most from its middle (units); one
 * at their own net's mouth is cleared out wide instead.
 */
export const AIM_HELP = 512;
export const AIM_IN = 700;
/** A kick's thud, heard this many tiles away. */
export const KICK_NOISE = 3;
/** The inmates: a kick's speed (KICK_INMATE + up to KICK_SPREAD by roll()), how wide of the goal's middle they aim (up to, units), and the steps before one kicks again. */
export const KICK_INMATE = 260;
export const KICK_SPREAD = 220;
export const AIM_WIDE = 800;
export const KICK_COOL = 12;
/** At a kick-off the other side keeps off the ball until the side kicking off has touched it, this long at most (steps). */
export const KICKOFF_STEPS = 3 * STEPS_PER_SECOND;
/** An inmate shoots from within SHOOT_RANGE of the goal (units); further out he knocks it on up the field. A keeper reaches KEEPER_REACH. */
export const SHOOT_RANGE = 4 * UNIT;
export const KEEPER_REACH = 440;
/** A keeper is ready again sooner after a save (steps). */
export const KEEPER_COOL = 5;
/** A team-mate passes to the player ahead of him this many times in 100. */
export const PASS_ODDS = 50;
/** A keeper comes off his line for a ball this close to his goal (units). */
export const KEEPER_RUSH = 2600;
/** How far before the ball an inmate gets ready to kick it (units, behind it on the way to the goal). */
export const BEHIND = 300;
/** Who'll play: inmates within this many tiles of the pitch's middle; the player and the captain within PITCH_RANGE tiles of the pitch to start. */
export const CALL_RANGE = 40;
export const PITCH_RANGE = 3;
/** The match goes on while the player is within this many tiles of the pitch (on the ground floor). */
export const PITCH_LEAVE = 10;
/** Guards watching a match: those outdoors within this many tiles of the pitch's middle. Anything off the pitch they see at half their range. */
export const YARD_EYES = 16;
/** A goal turns every guard watching to look at it for this long. */
export const GOAL_LOOK = 5 * STEPS_PER_SECOND;
/** A won match: opinion with each team-mate, with each inmate watching (once a day each, as the crowd at arm-wrestling); a point of Speed. Played: each team-mate this much. */
export const TEAM_WIN_OPINION = 3;
export const TEAM_CROWD_OPINION = 1;
export const TEAM_PLAY_OPINION = 1;

// ------------------------------------------------------------------ tattoos

/** The designs (TALK.TATTOO's and TALK.INK_ME's b): their price, the character's tattoo shape, and the path traced (a box 0–1000, y down). Never renumber: logs and saves store them. */
export interface Design {
  id: 'heart' | 'skull' | 'eagle';
  price: number;
  shape: number;
  color: number;
  path: ReadonlyArray<readonly [number, number]>;
}
export const DESIGNS: readonly Design[] = [
  {
    id: 'heart',
    price: 15,
    shape: 2,
    color: 0xc0302a,
    path: [[500, 850], [330, 700], [190, 540], [150, 400], [190, 270], [300, 200], [420, 220], [500, 320], [580, 220], [700, 200], [810, 270], [850, 400], [810, 540], [670, 700], [500, 850]],
  },
  {
    id: 'skull',
    price: 25,
    shape: 6,
    color: 0x2b3038,
    path: [[500, 130], [690, 180], [810, 340], [790, 520], [680, 600], [670, 760], [600, 820], [570, 740], [535, 820], [500, 740], [465, 820], [430, 740], [400, 820], [330, 760], [320, 600], [210, 520], [190, 340], [310, 180], [500, 130]],
  },
  {
    id: 'eagle',
    price: 40,
    shape: 7,
    color: 0x6a4a2a,
    path: [[100, 420], [250, 300], [390, 380], [450, 250], [530, 200], [580, 260], [520, 320], [620, 380], [750, 300], [900, 420], [760, 460], [620, 490], [570, 650], [610, 820], [500, 740], [390, 820], [430, 650], [380, 490], [240, 460], [100, 420]],
  },
];
/** An inmate takes a tattoo from the player at this opinion or more (and it's one of the day's games with them); a friend inks the player's own at FRIEND_INK. */
export const INK_OPINION = 30;
/** Tattoos for inmates: one a prison day for each, INKS_A_DAY in all (a day's work for one gun). */
export const INKS_A_DAY = 3;
export const FRIEND_INK = 70;
/** Tracing as it was before 2.22 (Sim.rules221, old logs): the pen ran along the design at PEN_SPEED (box units a step) after a LEAD_IN still at its start; the needle moved at NEEDLE_SPEED the way the stick or keys pointed; the line's quality came from the needle's mean distance from the pen: within INK_SLACK perfect (100), INK_SLACK + INK_POOR or more nothing (0). */
export const PEN_SPEED = 16;
export const LEAD_IN = 30;
export const NEEDLE_SPEED = 22;
export const INK_SLACK = 12;
export const INK_POOR = 140;
/**
 * Tracing (2.22): the needle draws where the finger or the mouse takes it (NEEDLE_REACH at most a
 * step), or the way the stick or keys point (NEEDLE_KEYS a step); each step it moves it's pulled
 * INK_PULL% of the way onto the line. The line counts as traced as far as the needle has followed
 * it (within ON_LINE of it, no more than LINE_AHEAD past what's traced): the ring waits there, RING_AHEAD on.
 * The line's quality is the needle's mean distance from the design while it inks: within
 * LINE_SLACK perfect (100), LINE_SLACK + LINE_POOR or more nothing (0). Traced to within
 * LINE_END of its end, it's done; at INK_TIME it stops where it is, its quality cut to the share traced.
 */
export const NEEDLE_REACH = 70;
export const NEEDLE_KEYS = 14;
export const INK_PULL = 20;
export const ON_LINE = 60;
export const LINE_AHEAD = 90;
export const RING_AHEAD = 60;
export const LINE_SLACK = 10;
export const LINE_POOR = 60;
export const LINE_END = 30;
export const INK_TIME = 40 * STEPS_PER_SECOND;
/** What it pays: the price at 50% for the poorest line, 150% for a perfect one; opinion INK_GAIN_BASE + up to INK_GAIN more. */
export const PAY_MIN = 50;
export const PAY_SPAN = 100;
export const INK_GAIN_BASE = 2;
export const INK_GAIN = 10;
/** Given up halfway: the inmate thinks this much less of the player. */
export const INK_QUIT = 5;
/** A friend inking the player: this long (steps). The player's arms take MAX_INKED tattoos. */
export const INK_ME_STEPS = 6 * STEPS_PER_SECOND;
export const MAX_INKED = 3;
/** A guard who sees tattooing (either way round): this much heat, once a sitting. */
export const INK_HEAT = 15;
/** The client (or the friend at work) stands this close (units, centre to centre). */
export const INK_GAP = 900;
/** After a sitting, the client stays put this long (steps). */
export const INK_LINGER = 15 * STEPS_PER_SECOND;
