/**
 * How to play's topics (P37), as data: which tab and group each sits in, its icon and colour,
 * its picture (an in-game close-up in public/help/, or a diagram drawn from the game's own data),
 * the recipes it shows from the handbook, the tutorial lessons that teach it, and the topics it
 * points on to. Its words are i18n keys, help.<id>.*:
 * - `.t` the title, `.hook` the tile's line, `.sum` the summary, in bold, at the top;
 * - `.steps` numbered (one a line; `.sh` names the list, else "How it works"), `.list` bulleted
 *   (`.lh` names it), and a second, `.list2` (`.lh2`), for a topic in two parts;
 * - `.nums` the key numbers as chips ("value|what", one a line);
 * - `.tip`, `.warn` call-outs (a line each item);
 * - `.more` the fine print, folded (one fact a line);
 * - a diagram's own lines: `.meter`, `.tl` (a timeline), `.bars` ("n|what").
 * A prison's own rules name it, and show once it's open (no spoilers of the campaign ahead).
 */
export type HelpTab = 'basics' | 'life' | 'escape' | 'controls';

type Diagram = 'schedule' | 'meter' | 'timeline' | 'bars' | 'pockets' | 'pins' | 'medals';

export interface HelpTopic {
  id: string;
  icon: string;
  tone: string;
  prison?: string;
  /** An in-game close-up: public/help/<id>.webp. */
  pic?: true;
  /** Where its subject is, kept in view when the picture is cropped to a strip (a phone on its side): a CSS object-position ('50% 28%'); the middle when not given. */
  picAt?: string;
  diagram?: Diagram;
  /** Recipes shown from the handbook (their results' item ids). */
  recipes?: readonly string[];
  /** The lessons that teach it (lesson ids). */
  lessons?: readonly string[];
  /** Topics it leads on to (ids). */
  see?: readonly string[];
  /** An icon for each line of `.steps` / `.list` / `.list2`: an item ('item:<id>'), a colour ('dot:#rrggbb') or a UI icon. */
  stepIcons?: readonly string[];
  listIcons?: readonly string[];
  list2Icons?: readonly string[];
}

export interface HelpGroup {
  id: string;
  topics: readonly HelpTopic[];
}

const T = (id: string, icon: string, tone: string, more: Omit<HelpTopic, 'id' | 'icon' | 'tone'> = {}): HelpTopic => ({ id, icon, tone, ...more });

export const HELP: Record<Exclude<HelpTab, 'controls'>, readonly HelpGroup[]> = {
  basics: [
    {
      id: 'start',
      topics: [
        T('goal', 'route', '#ff7714', { pic: true, lessons: ['escape'], see: ['ways', 'delivery', 'bluff', 'glider', 'paperwork', 'parole'] }),
        T('routine', 'clock', '#3d7fd0', { diagram: 'schedule', lessons: ['routine'] }),
        T('heat', 'flame', '#e5484d', { diagram: 'meter', lessons: ['heat'], listIcons: ['clock', 'eye', 'lock'] }),
        T('items', 'briefcase', '#8e5a2b', { diagram: 'pockets', lessons: ['search', 'stash'] }),
      ],
    },
    {
      id: 'getting',
      topics: [
        T('craft', 'hammer', '#6f93b8', { recipes: ['sheet_rope', 'poster', 'flimsy_shovel'], lessons: ['craft'] }),
        T('energy', 'heart', '#e0507a', { lessons: ['gym'], listIcons: ['pause', 'utensils', 'water', 'item:chocolate', 'moon'] }),
      ],
    },
    {
      id: 'beyond',
      topics: [
        T('trophies', 'trophy', '#e2a21b', { diagram: 'medals', listIcons: ['star', 'trophy', 'shirt'] }),
        T('daily', 'calendar', '#2fb6c8', { listIcons: ['bolt', 'replay', 'flame'] }),
        T('replay', 'film', '#7b6fd6', { listIcons: ['play', 'moon', 'route', 'save'] }),
      ],
    },
  ],
  life: [
    {
      id: 'guards',
      topics: [
        T('guards', 'eye', '#1e3a5f', { pic: true, lessons: ['guards'], listIcons: ['dot:#f5c542', 'dot:#ff8c2a', 'dot:#e5484d'], see: ['guardWays', 'caught'] }),
        T('guardWays', 'shield', '#5b6fa8', { lessons: ['guards'], listIcons: ['book', 'moon', 'eye', 'coin'] }),
        T('caught', 'siren', '#e5484d', { listIcons: ['hammer'], see: ['heat'] }),
        T('searches', 'bell', '#d9930a', { recipes: ['bed_dummy'], lessons: ['stash'], listIcons: ['sun', 'moon'], see: ['items'] }),
      ],
    },
    {
      id: 'people',
      topics: [
        T('inmates', 'chat', '#3fb07a', { pic: true, lessons: ['talk', 'trade'], listIcons: ['coin', 'users', 'fist'], see: ['crew', 'games'] }),
        T('crew', 'users', '#ffa94d', { pic: true, lessons: ['crew'], listIcons: ['eye', 'pick', 'fist', 'drone'] }),
        T('chatter', 'ear', '#d9a21b', { listIcons: ['chat', 'star'] }),
        T('fight', 'fist', '#c0392b', { pic: true, lessons: ['fight'] }),
      ],
    },
    {
      id: 'days',
      topics: [
        T('day', 'calendar', '#d9930a', { lessons: ['day'], listIcons: ['eye', 'bell', 'star'], list2Icons: ['fog', 'rain', 'storm', 'heat'], see: ['holidays'] }),
        T('work', 'coin', '#c99a12', { pic: true, lessons: ['job', 'gardener'], listIcons: ['cart', 'gift'] }),
        T('train', 'dumbbell', '#8e4fc4', { pic: true, lessons: ['gym', 'laps'], listIcons: ['dumbbell', 'run', 'book'], see: ['grounds'] }),
        T('grounds', 'run', '#b0553f', { pic: true, lessons: ['laps', 'gardener'], see: ['garden', 'hoops', 'football'] }),
        // v2.21 (P42): the holidays (its picture: public/help/holidays.webp).
        T('holidays', 'tree', '#4fbf6a', { pic: true, picAt: '50% 0%', listIcons: ['egg', 'splash', 'pumpkin', 'tree'], list2Icons: ['calendar', 'star', 'close'], see: ['day'] }),
      ],
    },
    {
      id: 'games',
      topics: [
        T('games', 'dice', '#7ed957', { pic: true, lessons: ['games'] }),
        T('cheat', 'cards', '#2e8a5e', { pic: true, lessons: ['cards'] }),
        T('hoops', 'ball', '#e8742c', { pic: true, lessons: ['hoops'] }),
        T('checkers', 'checkers', '#8a5a2e', { pic: true, lessons: ['checkers'] }),
        T('football', 'ball', '#2f9e5a', { pic: true, lessons: ['football'] }),
        T('race', 'race', '#b0602e', { pic: true, diagram: 'timeline', recipes: ['rat_track'], lessons: ['ratRace'], see: ['rat'] }),
        T('talent', 'music', '#ff6fb5', { pic: true, diagram: 'timeline', recipes: ['guitar'], lessons: ['talent'] }),
        T('quiz', 'brain', '#5fb3ff', { pic: true, lessons: ['quiz'] }),
      ],
    },
    {
      id: 'pastimes',
      topics: [
        T('pruno', 'brew', '#c98a2e', { recipes: ['pruno_bag'], lessons: ['pruno'], listIcons: ['coin', 'gift', 'brew'], see: ['garden'] }),
        T('garden', 'sprout', '#4f9a3a', { pic: true, lessons: ['garden'], listIcons: ['rain', 'sun'], see: ['pruno'] }),
        T('tattoo', 'needle', '#3a3f5a', { pic: true, recipes: ['tattoo_gun'], lessons: ['tattoo'] }),
      ],
    },
    {
      id: 'outside',
      topics: [
        T('payphone', 'phone', '#2f9e8f', { pic: true, lessons: ['payphone', 'cousin'], listIcons: ['home', 'briefcase', 'megaphone', 'person'] }),
        T('kiosk', 'monitor', '#3a7bd5', { pic: true, recipes: ['hollow_book'], lessons: ['kiosk'], listIcons: ['letter', 'cart', 'news', 'brain'] }),
        T('oddjobs', 'pin', '#b98a55', { pic: true, picAt: '50% 28%', lessons: ['oddjob'], listIcons: ['hand', 'box', 'search', 'cards', 'rat', 'eye'], see: ['games', 'payphone', 'rat'] }),
      ],
    },
  ],
  escape: [
    {
      id: 'tricks',
      topics: [
        T('tools', 'pick', '#6f93b8', { lessons: ['dig'], see: ['noise', 'layers', 'cover'], listIcons: ['item:light_pickaxe', 'item:light_cutters', 'item:screwdriver', 'item:light_shovel'] }),
        T('lockpick', 'lockpick', '#8d949e', { diagram: 'pins', recipes: ['lockpick'], lessons: ['lockpick'] }),
        T('noise', 'ear', '#e8963a', { diagram: 'bars', lessons: ['noise'], listIcons: ['lock', 'ear'] }),
        T('layers', 'down', '#8e5a2b', { pic: true, picAt: '50% 70%', recipes: ['timber_brace'], lessons: ['tunnel', 'vents'], stepIcons: ['item:timber_brace', 'up', 'drop'] }),
        T('cover', 'lock', '#5d6779', { recipes: ['poster', 'fake_wall', 'fake_vent', 'fake_fence'], listIcons: ['item:poster', 'item:fake_wall', 'item:fake_vent', 'item:fake_fence'] }),
      ],
    },
    {
      id: 'security',
      topics: [
        T('power', 'plug', '#d9930a', { pic: true, listIcons: ['bolt', 'camera', 'eye', 'sun'] }),
        T('cams', 'camera', '#2fb6c8', { pic: true, recipes: ['pouch'], listIcons: ['item:duct_tape', 'item:pouch'] }),
        T('towers', 'target', '#e5484d', { pic: true, listIcons: ['sun', 'moon'] }),
        T('dogs', 'paw', '#e0a050', { prison: 'shankton', pic: true, recipes: ['sleepy_jerky'], lessons: ['dogs'] }),
      ],
    },
    {
      id: 'ways',
      topics: [
        T('ways', 'hook', '#ff7714', { pic: true, recipes: ['grapnel'], lessons: ['escape', 'tunnel'], listIcons: ['item:light_cutters', 'item:light_shovel', 'item:grapnel', 'fist'], see: ['delivery', 'bluff', 'glider', 'paperwork', 'parole'] }),
        T('delivery', 'truck', '#3fc79a', { pic: true, picAt: '50% 70%', diagram: 'timeline', lessons: ['stowaway'] }),
        T('bluff', 'idCard', '#5b8fd8', { pic: true, diagram: 'timeline', recipes: ['fake_id'], lessons: ['bluff'] }),
        T('glider', 'glider', '#9fc8e8', { pic: true, recipes: ['glider_frame', 'glider'], lessons: ['glider'] }),
        T('paperwork', 'clipboard', '#d8b04a', { pic: true, diagram: 'timeline', recipes: ['forged_release'], lessons: ['forgery', 'release'], see: ['parole'] }),
        T('parole', 'scale', '#8a6bd1', { pic: true, picAt: '50% 18%', diagram: 'timeline', lessons: ['parole'], see: ['paperwork', 'payphone'], listIcons: ['check', 'chat', 'brain'] }),
        // P41: the manhunt (its picture: public/help/manhunt.webp).
        T('manhunt', 'run', '#e0603a', { pic: true, picAt: '50% 40%', diagram: 'timeline', lessons: ['manhunt'], listIcons: ['shirt', 'water', 'toss', 'bone', 'item:light_cutters', 'truck', 'users'], see: ['dogs', 'ways'] }),
      ],
    },
    {
      id: 'getHold',
      topics: [
        T('smuggling', 'phone', '#5fd3a0', { pic: true, lessons: ['smuggle'] }),
        T('rat', 'rat', '#d98aa8', { pic: true, picAt: '50% 65%', recipes: ['rat_trap'], lessons: ['rat'] }),
      ],
    },
    {
      id: 'prisons',
      topics: [
        T('weather', 'snow', '#2f78be', { prison: 'stalag-flucht', pic: true, listIcons: ['snow', 'shirt', 'pick'] }),
        T('shell', 'shield', '#5d6b7a', { prison: 'shankton', pic: true, recipes: ['pouch'], listIcons: ['lock', 'eye', 'hook'] }),
        T('mines', 'mine', '#c8372d', { prison: 'san-pancho', pic: true, listIcons: ['item:light_shovel', 'item:key_red'] }),
        T('island', 'boat', '#2b6f9a', { prison: 'irongate', pic: true, recipes: ['raft'], stepIcons: ['boat', 'heli', 'fist'], listIcons: ['camera', 'bolt'] }),
      ],
    },
  ],
};

/** What the pockets diagram holds: six pockets (the contraband marked), the weapon, the outfit. */
export const POCKET_SAMPLE = { pockets: ['plastic_comb', 'chocolate', 'light_cutters', '', '', ''], weapon: 'comb_shiv', outfit: 'guard_outfit' };

/** Every topic, in tab and group order. */
export const ALL_TOPICS: ReadonlyArray<HelpTopic & { tab: Exclude<HelpTab, 'controls'> }> = (Object.keys(HELP) as Array<Exclude<HelpTab, 'controls'>>).flatMap((tab) => HELP[tab].flatMap((g) => g.topics.map((tp) => ({ ...tp, tab }))));

export const topicById = (id: string) => ALL_TOPICS.find((tp) => tp.id === id);
