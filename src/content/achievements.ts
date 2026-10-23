/**
 * Achievements (P16), as data: each is earned during a run (`run`, checked as it goes), by an
 * escape (`escape`), or over a career (`career`: lifetime stats and records). Conduct needs the
 * whole run in the ledger (not one loaded from a save made before it). Some give a cosmetic
 * for your prisoner (prisoner.ts). Mishaps stay hidden until earned.
 * Names and descriptions: i18n `ach.<id>` and `ach.<id>.d`.
 */
import { FEAT, type Feat } from '../sim/systems/ledger';
import { ATTR_MAX } from '../sim/tuning';
import type { Medal } from './medals';

export type AchievementGroup = 'out' | 'speed' | 'conduct' | 'skills' | 'life' | 'days' | 'daily' | 'holidays' | 'mishaps' | 'career';
export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = ['out', 'speed', 'conduct', 'skills', 'life', 'days', 'daily', 'holidays', 'mishaps', 'career'];

/** A run as the checks see it: the ledger and a few of the player's numbers. */
export interface RunView {
  prison: string;
  feats: readonly number[];
  days: readonly number[];
  str: number;
  spd: number;
  int: number;
}

/** An escape: the run, how and on which day, and the medal it earned; the weather out there as it went (P17; unknown for escapes from the records). */
export interface EscapeView extends RunView {
  via: string;
  day: number;
  medal: Medal | null;
  weather?: string;
  /** How many of the crew got out too (P23; unknown for escapes from the records). */
  crew?: number;
  /** A Daily Escape's (P26): its twists, the try it was won on, the streak it makes. */
  daily?: { twists: number; tries: number; streak: number };
}

/** A career: lifetime stats (stats.ts keys), and each prison's ways out found and medals won. */
export interface Career {
  stats: Readonly<Record<string, number>>;
  prisons: ReadonlyArray<{ id: string; routes: readonly string[]; of: number; medals: readonly Medal[] }>;
  /** Tutorial lessons done, of how many. */
  lessons: number;
  lessonsOf: number;
}

export interface Achievement {
  id: string;
  group: AchievementGroup;
  icon: string;
  /** Hidden on the shelf until earned (mishaps). */
  hidden?: boolean;
  /** The cosmetic it gives (prisoner.ts id). */
  gives?: string;
  run?: (r: RunView) => boolean;
  escape?: (e: EscapeView) => boolean;
  career?: (c: Career) => boolean;
  /** How far along a counted one is, [now, goal]: the shelf's progress bar. */
  progress?: (c: Career) => readonly [number, number];
}

const f = (r: RunView, k: Feat) => r.feats[FEAT[k]] ?? 0;
/** The whole run is in the ledger (not a game loaded from before it). */
const whole = (r: RunView) => f(r, 'partial') === 0;
const stat = (c: Career, k: string) => c.stats[k] ?? 0;
/** A career count reaching a goal, with its progress. */
const counted = (k: string, goal: number) => ({ career: (c: Career) => stat(c, k) >= goal, progress: (c: Career) => [Math.min(goal, stat(c, k)), goal] as const });

export const ACHIEVEMENTS: readonly Achievement[] = [
  // Ways out.
  { id: 'freshAir', group: 'out', icon: 'run', gives: 'amber', escape: () => true },
  { id: 'mole', group: 'out', icon: 'shovel', gives: 'goggles', escape: (e) => e.via === 'tunnel' },
  { id: 'overTheTop', group: 'out', icon: 'hook', gives: 'propeller', escape: (e) => e.via === 'roof' },
  { id: 'snip', group: 'out', icon: 'cutters', gives: 'rust', escape: (e) => e.via === 'fence' },
  { id: 'riotAct', group: 'out', icon: 'users', gives: 'bandana', escape: (e) => e.via === 'takeover' },
  { id: 'keyMaster', group: 'out', icon: 'key', gives: 'star', escape: (e) => e.via === 'gate' },
  { id: 'castaway', group: 'out', icon: 'boat', gives: 'straw', escape: (e) => e.via === 'raft' || e.via === 'helicopter' },
  // (P18.)
  { id: 'specialDelivery', group: 'out', icon: 'truck', escape: (e) => e.via === 'stowaway' },
  // P24: waved out through the checkpoint on a fake ID; off a roof on a glider.
  { id: 'papersPlease', group: 'out', icon: 'idCard', escape: (e) => e.via === 'bluff' },
  { id: 'wingIt', group: 'out', icon: 'glider', escape: (e) => e.via === 'glider' },
  // P36: walked out the front gate, your name on the release list.
  { id: 'timeServed', group: 'out', icon: 'clipboard', escape: (e) => e.via === 'paperwork' },
  { id: 'houdini', group: 'out', icon: 'star', gives: 'topHat', career: (c) => c.prisons.some((p) => p.routes.length >= p.of) },
  { id: 'grandTour', group: 'out', icon: 'map', gives: 'crown', career: (c) => c.prisons.every((p) => p.routes.length > 0), progress: (c) => [c.prisons.filter((p) => p.routes.length > 0).length, c.prisons.length] },
  // Speed.
  { id: 'dayOne', group: 'speed', icon: 'clock', gives: 'shades', escape: (e) => e.day === 1 },
  { id: 'quickStep', group: 'speed', icon: 'walk', gives: 'tangerine', escape: (e) => e.day <= 3 },
  { id: 'goldStandard', group: 'speed', icon: 'trophy', gives: 'gold', escape: (e) => e.medal === 'gold' },
  // Conduct: the whole run.
  // No blow, nothing thrown at anyone, and nobody knocked out on your account (your followers' fists count too).
  { id: 'pacifist', group: 'conduct', icon: 'heart', gives: 'heart', escape: (e) => whole(e) && f(e, 'blows') + f(e, 'flung') + f(e, 'koGuards') + f(e, 'koInmates') === 0 },
  { id: 'ghost', group: 'conduct', icon: 'eyeOff', gives: 'platinum', escape: (e) => whole(e) && f(e, 'spotted') === 0 },
  { id: 'cleanRecord', group: 'conduct', icon: 'shield', gives: 'cream', escape: (e) => whole(e) && f(e, 'caught') === 0 && f(e, 'solitary') === 0 },
  { id: 'modelPrisoner', group: 'conduct', icon: 'bell', gives: 'ponytail', escape: (e) => whole(e) && f(e, 'missed') === 0 },
  { id: 'calm', group: 'conduct', icon: 'sun', gives: 'swallow', escape: (e) => whole(e) && f(e, 'lockdowns') === 0 },
  // Skills.
  { id: 'sweetTooth', group: 'skills', icon: 'cookie', gives: 'curls', run: (r) => f(r, 'chocolate') >= 5 },
  { id: 'bookworm', group: 'skills', icon: 'book', gives: 'square', run: (r) => r.int >= ATTR_MAX },
  { id: 'strongman', group: 'skills', icon: 'dumbbell', gives: 'fullBeard', run: (r) => r.str >= ATTR_MAX },
  { id: 'sprinter', group: 'skills', icon: 'run', gives: 'headband', run: (r) => r.spd >= ATTR_MAX },
  { id: 'sleepwalker', group: 'skills', icon: 'moon', gives: 'goatee', run: (r) => f(r, 'dummy') >= 1 },
  { id: 'blackout', group: 'skills', icon: 'plug', gives: 'teal', run: (r) => f(r, 'powerCuts') >= 1 },
  { id: 'candid', group: 'skills', icon: 'camera', gives: 'flame', run: (r) => f(r, 'taped') >= 1 },
  { id: 'handyman', group: 'skills', icon: 'hammer', gives: 'bucket', run: (r) => f(r, 'crafted') >= 10 },
  { id: 'employee', group: 'skills', icon: 'briefcase', gives: 'chef', run: (r) => f(r, 'wages') >= 5 },
  // Prison life: talk, noise, guards' ways.
  { id: 'allEars', group: 'life', icon: 'ear', gives: 'sideburns', ...counted('rumors', 10) },
  { id: 'decoy', group: 'life', icon: 'toss', gives: 'anchor', run: (r) => f(r, 'decoys') >= 1 },
  { id: 'partyPopper', group: 'life', icon: 'flame', gives: 'party', run: (r) => f(r, 'bangs') >= 1 },
  { id: 'greasedPalm', group: 'life', icon: 'hand', gives: 'monocle', run: (r) => f(r, 'bribes') >= 1 },
  { id: 'paperTrail', group: 'life', icon: 'letter', gives: 'starShades', run: (r) => f(r, 'paperwork') >= 1 },
  { id: 'popular', group: 'life', icon: 'chat', gives: 'mohawk', run: (r) => f(r, 'crew') >= 2 },
  // The day (P17): events and weather.
  { id: 'teachersPet', group: 'days', icon: 'clipboard', run: (r) => f(r, 'commended') >= 1 },
  { id: 'present', group: 'days', icon: 'bell', run: (r) => f(r, 'mustered') >= 1 },
  { id: 'seconds', group: 'days', icon: 'utensils', run: (r) => f(r, 'feasts') >= 1 },
  { id: 'foodFighter', group: 'days', icon: 'fist', run: (r) => f(r, 'foodBlows') >= 3 },
  { id: 'stormRunner', group: 'days', icon: 'storm', escape: (e) => e.weather === 'storm' },
  { id: 'peaSouper', group: 'days', icon: 'fog', escape: (e) => e.weather === 'fog' },
  // Delivery day (P18).
  { id: 'offTheBooks', group: 'days', icon: 'clipboard', run: (r) => f(r, 'slipped') >= 1 },
  { id: 'airMail', group: 'days', icon: 'heli', escape: (e) => e.via === 'stowaway' && e.prison === 'irongate' },
  // Guard dogs (P19).
  { id: 'goodBoy', group: 'life', icon: 'bone', run: (r) => f(r, 'dogFriends') >= 1 },
  { id: 'blessYou', group: 'life', icon: 'wind', run: (r) => f(r, 'dogsPeppered') >= 1 },
  { id: 'sweetDreams', group: 'life', icon: 'moon', run: (r) => f(r, 'dogsAsleep') >= 1 },
  { id: 'squeakyClean', group: 'life', icon: 'drop', run: (r) => f(r, 'washed') >= 1 },
  // The pet rat (P20).
  { id: 'piedPiper', group: 'life', icon: 'rat', run: (r) => f(r, 'ratsTamed') >= 1 },
  { id: 'ratMail', group: 'life', icon: 'gift', run: (r) => f(r, 'ratLeft') >= 1 },
  { id: 'ratRace', group: 'life', icon: 'siren', run: (r) => f(r, 'ratPanics') >= 1 },
  { id: 'insideJob', group: 'skills', icon: 'key', run: (r) => f(r, 'keyHeists') >= 1 },
  // Smuggling (P21).
  { id: 'onTheLine', group: 'life', icon: 'phone', run: (r) => f(r, 'phones') >= 1 },
  { id: 'dropZone', group: 'skills', icon: 'drone', run: (r) => f(r, 'drops') >= 1 },
  { id: 'visitingHours', group: 'days', icon: 'users', run: (r) => f(r, 'smuggled') >= 1 },
  // Side games (P22).
  { id: 'highRoller', group: 'life', icon: 'dice', run: (r) => f(r, 'bigPots') >= 1 },
  { id: 'ironArm', group: 'skills', icon: 'arm', run: (r) => f(r, 'boutsWon') >= 5 },
  { id: 'openSesame', group: 'skills', icon: 'lockpick', run: (r) => f(r, 'locksPicked') >= 1 },
  { id: 'champion', group: 'days', icon: 'trophy', run: (r) => f(r, 'champion') >= 1 },
  // Card sharks (P27).
  { id: 'mindReader', group: 'life', icon: 'cards', run: (r) => f(r, 'liarsCaught') >= 5 },
  { id: 'cardShark', group: 'life', icon: 'cards', run: (r) => f(r, 'cheatsWon') >= 3 },
  { id: 'nothingButNet', group: 'skills', icon: 'ball', run: (r) => f(r, 'swishes') >= 10 },
  { id: 'courtKing', group: 'skills', icon: 'trophy', run: (r) => f(r, 'shootoutsWon') >= 3 },
  { id: 'grandmaster', group: 'skills', icon: 'checkers', run: (r) => f(r, 'boardWins') >= 3 },
  // Long games (P28).
  { id: 'moonshiner', group: 'life', icon: 'brew', run: (r) => f(r, 'brewed') >= 3 },
  { id: 'greenThumb', group: 'skills', icon: 'sprout', run: (r) => f(r, 'harvests') >= 5 },
  { id: 'ratDerby', group: 'skills', icon: 'rat', run: (r) => f(r, 'raceWins') >= 1 },
  { id: 'longShot', group: 'life', icon: 'trophy', run: (r) => f(r, 'longShots') >= 1 },
  // Team & ink (P29).
  { id: 'hatTrick', group: 'skills', icon: 'ball', run: (r) => f(r, 'hatTricks') >= 1 },
  { id: 'teamPlayer', group: 'life', icon: 'users', run: (r) => f(r, 'matchWins') >= 3 },
  { id: 'steadyHand', group: 'skills', icon: 'needle', gives: 'eagleInk', run: (r) => f(r, 'cleanLines') >= 3 },
  { id: 'inkedUp', group: 'life', icon: 'needle', gives: 'skullInk', run: (r) => f(r, 'inked') >= 3 },
  // P30 (stage nights): first on a talent night; a mark the warden smiles at; a quiz night won.
  { id: 'headliner', group: 'life', icon: 'music', run: (r) => f(r, 'actWins') >= 1 },
  { id: 'starTurn', group: 'skills', icon: 'star', run: (r) => f(r, 'starActs') >= 1 },
  { id: 'quizChamp', group: 'skills', icon: 'brain', run: (r) => f(r, 'quizWins') >= 1 },
  // P34: the pay phone.
  { id: 'collectCall', group: 'life', icon: 'phone', ...counted('homeCalls', 5) },
  { id: 'familyBusiness', group: 'life', icon: 'route', ...counted('louJobs', 3) },
  { id: 'codeTalker', group: 'skills', icon: 'chat', ...counted('codesLearned', 5) },
  { id: 'walls', group: 'life', icon: 'ear', ...counted('overheard', 3) },
  { id: 'tipOff', group: 'life', icon: 'phone', run: (r) => f(r, 'tipsFound') >= 1 },
  { id: 'wheels', group: 'out', icon: 'truck', run: (r) => f(r, 'wheels') >= 1 },
  // P35: the internet kiosk.
  { id: 'familyGallery', group: 'life', icon: 'picture', ...counted('photos', 3) },
  { id: 'nightSchool', group: 'skills', icon: 'brain', ...counted('coursesPassed', 3) },
  { id: 'betweenTheLines', group: 'skills', icon: 'book', run: (r) => f(r, 'hiddenContraband') >= 1 },
  // P36: a forged release form slipped into the tray.
  { id: 'forger', group: 'skills', icon: 'clipboard', run: (r) => f(r, 'formsFiled') >= 1 },
  // The crew (P23).
  { id: 'inGoodCompany', group: 'out', icon: 'users', escape: (e) => (e.crew ?? 0) >= 1 },
  { id: 'wholeGang', group: 'out', icon: 'star', escape: (e) => (e.crew ?? 0) >= 2 },
  { id: 'eyesPeeled', group: 'life', icon: 'eye', run: (r) => f(r, 'whistles') >= 5 },
  { id: 'diversion', group: 'life', icon: 'fist', run: (r) => f(r, 'brawls') >= 1 },
  { id: 'legwork', group: 'skills', icon: 'box', run: (r) => f(r, 'crewFetched') >= 1 },
  { id: 'manyHands', group: 'skills', icon: 'shovel', run: (r) => f(r, 'dirtTaken') >= 20 },
  // P24: a glide of 7 tiles or more (the wind behind it).
  { id: 'tailwind', group: 'skills', icon: 'wind', run: (r) => f(r, 'glideFar') >= 7 },
  // Mishaps (hidden).
  { id: 'shocking', group: 'mishaps', icon: 'bolt', hidden: true, run: (r) => f(r, 'shocked') >= 1 },
  { id: 'headRoom', group: 'mishaps', icon: 'pick', hidden: true, run: (r) => f(r, 'caveIns') >= 1 },
  { id: 'washedOut', group: 'mishaps', icon: 'splash', hidden: true, run: (r) => f(r, 'floods') >= 1 },
  { id: 'watchStep', group: 'mishaps', icon: 'mine', hidden: true, run: (r) => f(r, 'blasts') >= 1 },
  { id: 'spudPeeler', group: 'mishaps', icon: 'potato', hidden: true, run: (r) => f(r, 'potatoes') >= 1 },
  { id: 'sunstroke', group: 'mishaps', icon: 'heat', hidden: true, run: (r) => f(r, 'baked') >= 1 },
  { id: 'drillDodger', group: 'mishaps', icon: 'siren', hidden: true, run: (r) => f(r, 'drillsMissed') >= 1 },
  { id: 'returnToSender', group: 'mishaps', icon: 'box', hidden: true, run: (r) => f(r, 'stowFound') >= 1 },
  // P24: a glide that came down inside the walls.
  { id: 'grounded', group: 'mishaps', icon: 'glider', hidden: true, run: (r) => f(r, 'glidesIn') >= 1 },
  { id: 'nosyParker', group: 'mishaps', icon: 'paw', hidden: true, run: (r) => f(r, 'dogDug') >= 1 },
  { id: 'rudeAwakening', group: 'mishaps', icon: 'key', hidden: true, run: (r) => f(r, 'keyless') >= 1 },
  { id: 'findersKeepers', group: 'mishaps', icon: 'drone', hidden: true, run: (r) => f(r, 'dropsSeized') + f(r, 'parcelsSeized') >= 1 },
  { id: 'snakeEyes', group: 'mishaps', icon: 'dice', hidden: true, run: (r) => f(r, 'snakeEyes') >= 1 },
  // P27: five airballs in a run.
  { id: 'brickLayer', group: 'mishaps', icon: 'ball', hidden: true, run: (r) => f(r, 'airballs') >= 5 },
  // P36: the records check found the forgery.
  { id: 'redTape', group: 'mishaps', icon: 'clipboard', hidden: true, run: (r) => f(r, 'formsFound') >= 1 },
  // Career.
  // The Daily Escape (P26).
  { id: 'dailyBread', group: 'daily', icon: 'calendar', escape: (e) => !!e.daily },
  { id: 'firstTry', group: 'daily', icon: 'star', escape: (e) => e.daily?.tries === 1 },
  { id: 'twisted', group: 'daily', icon: 'storm', escape: (e) => (e.daily?.twists ?? 0) >= 3 },
  { id: 'dailyGold', group: 'daily', icon: 'trophy', escape: (e) => !!e.daily && e.medal === 'gold' },
  { id: 'onARoll', group: 'daily', icon: 'flame', ...counted('dailyStreak', 3) },
  { id: 'weekInside', group: 'daily', icon: 'sun', ...counted('dailyStreak', 7) },
  { id: 'dailyRegular', group: 'daily', icon: 'clock', ...counted('dailies', 10) },
  { id: 'regular', group: 'career', icon: 'sun', ...counted('days', 10) },
  { id: 'moneybags', group: 'career', icon: 'coin', gives: 'ginger', ...counted('cash', 500) },
  { id: 'seasoned', group: 'career', icon: 'route', ...counted('escapes', 10) },
  { id: 'marathon', group: 'career', icon: 'walk', ...counted('walked', 10000) },
  { id: 'graduate', group: 'career', icon: 'bulb', career: (c) => c.lessons >= c.lessonsOf, progress: (c) => [Math.min(c.lessons, c.lessonsOf), c.lessonsOf] },
  // v2.18 (P39, the parole board): out on parole; parole granted on the lawyer's filing; a lie the board caught; an application voided by plotting.
  { id: 'goodBehaviour', group: 'out', icon: 'scale', gives: 'paroleSpecs', escape: (e) => e.via === 'parole' },
  { id: 'counsel', group: 'life', icon: 'briefcase', run: (r) => f(r, 'lawyerFiled') >= 1 && f(r, 'paroleGranted') >= 1 },
  { id: 'caughtOut', group: 'mishaps', icon: 'scale', hidden: true, run: (r) => f(r, 'liesCaught') >= 1 },
  { id: 'backToSquareOne', group: 'mishaps', icon: 'siren', hidden: true, run: (r) => f(r, 'paroleVoided') >= 1 },
  // v2.21 (P42, holidays): five eggs found in one egg hunt's run; in the water fight; three inmates laughing at the costume; a present given; work done under New Year's fireworks.
  { id: 'eggHunter', group: 'holidays', icon: 'egg', gives: 'holBunny', run: (r) => f(r, 'eggsFound') >= 5 },
  { id: 'splashdown', group: 'holidays', icon: 'splash', gives: 'holShades', run: (r) => f(r, 'waterFights') >= 1 },
  { id: 'trickOrTreat', group: 'holidays', icon: 'pumpkin', gives: 'holWitch', run: (r) => f(r, 'laughs') >= 3 },
  { id: 'secretSanta', group: 'holidays', icon: 'gift', gives: 'holSanta', run: (r) => f(r, 'giftsGiven') >= 1 },
  { id: 'withABang', group: 'holidays', icon: 'sparkle', run: (r) => f(r, 'fireworkWork') >= 5 },
];

export const achievement = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);
