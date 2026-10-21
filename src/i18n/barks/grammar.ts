import type { ZoneId } from '../../content/zones';
import type { Lang } from '..';

/**
 * The words the speech bubbles' slots are filled with (P13), per language: places with their
 * preposition and article ("in the canteen", « à la cantine »), the items people talk about
 * with their articles (French gender and elision), the day's menu, the days of the week, what
 * happened today, and what the prison calls the player. Kept apart from the game's names
 * (t()): spoken words, not labels.
 */

/** A place: where someone is ("in the yard") and what it's called ("the yard"). */
export interface PlaceWords {
  at: string;
  the: string;
}

const EN_PLACES: Partial<Record<ZoneId, PlaceWords>> = {
  cellBlock: { at: 'in the cell block', the: 'the cell block' },
  rollCall: { at: 'in the roll call yard', the: 'the roll call yard' },
  canteen: { at: 'in the canteen', the: 'the canteen' },
  kitchen: { at: 'in the kitchen', the: 'the kitchen' },
  corridor: { at: 'in the corridor', the: 'the corridor' },
  gym: { at: 'at the gym', the: 'the gym' },
  showers: { at: 'in the showers', the: 'the showers' },
  library: { at: 'in the library', the: 'the library' },
  infirmary: { at: 'in the infirmary', the: 'the infirmary' },
  yard: { at: 'in the yard', the: 'the yard' },
  laundry: { at: 'in the laundry', the: 'the laundry' },
  woodshop: { at: 'in the woodshop', the: 'the woodshop' },
  metalshop: { at: 'in the metal shop', the: 'the metal shop' },
  mailroom: { at: 'in the mailroom', the: 'the mailroom' },
  janitor: { at: "in the janitor's closet", the: "the janitor's closet" },
  generator: { at: 'in the generator room', the: 'the generator room' },
  solitary: { at: 'in solitary', the: 'solitary' },
  visitation: { at: 'in the visiting room', the: 'the visiting room' },
  guardQuarters: { at: 'in the guard quarters', the: 'the guard quarters' },
  controlRoom: { at: 'in the control room', the: 'the control room' },
  storeroom: { at: 'in the storeroom', the: 'the storeroom' },
  walkway: { at: 'on the walkway', the: 'the walkway' },
  minefield: { at: 'in the minefield', the: 'the minefield' },
  helipad: { at: 'on the helipad', the: 'the helipad' },
  dock: { at: 'on the dock', the: 'the dock' },
  sports: { at: 'out on the sports ground', the: 'the sports ground' },
  garden: { at: 'in the vegetable garden', the: 'the vegetable garden' },
  perimeter: { at: 'out by the fence', the: 'the fence' },
  playerCell: { at: 'in your cell', the: 'your cell' },
  inmateCell: { at: 'in my cell', the: 'my cell' },
};

const FR_PLACES: Partial<Record<ZoneId, PlaceWords>> = {
  cellBlock: { at: 'dans le bloc', the: 'le bloc' },
  rollCall: { at: 'dans la cour de l’appel', the: 'la cour de l’appel' },
  canteen: { at: 'à la cantine', the: 'la cantine' },
  kitchen: { at: 'en cuisine', the: 'la cuisine' },
  corridor: { at: 'dans le couloir', the: 'le couloir' },
  gym: { at: 'à la salle de sport', the: 'la salle de sport' },
  showers: { at: 'aux douches', the: 'les douches' },
  library: { at: 'à la bibliothèque', the: 'la bibliothèque' },
  infirmary: { at: 'à l’infirmerie', the: 'l’infirmerie' },
  yard: { at: 'dans la cour', the: 'la cour' },
  laundry: { at: 'à la blanchisserie', the: 'la blanchisserie' },
  woodshop: { at: 'à la menuiserie', the: 'la menuiserie' },
  metalshop: { at: 'à l’atelier métal', the: 'l’atelier métal' },
  mailroom: { at: 'à la salle de tri', the: 'la salle de tri' },
  janitor: { at: 'à la conciergerie', the: 'la conciergerie' },
  generator: { at: 'au générateur', the: 'le générateur' },
  solitary: { at: 'à l’isolement', the: 'l’isolement' },
  visitation: { at: 'au parloir', the: 'le parloir' },
  guardQuarters: { at: 'chez les gardiens', the: 'les quartiers des gardiens' },
  controlRoom: { at: 'en salle de contrôle', the: 'la salle de contrôle' },
  storeroom: { at: 'dans la remise', the: 'la remise' },
  walkway: { at: 'sur le chemin de ronde', the: 'le chemin de ronde' },
  minefield: { at: 'dans le champ de mines', the: 'le champ de mines' },
  helipad: { at: 'à l’héliport', the: 'l’héliport' },
  dock: { at: 'sur le quai', the: 'le quai' },
  sports: { at: 'sur le terrain de sport', the: 'le terrain de sport' },
  garden: { at: 'au potager', the: 'le potager' },
  perimeter: { at: 'près du grillage', the: 'le grillage' },
  playerCell: { at: 'dans ta cellule', the: 'ta cellule' },
  inmateCell: { at: 'dans ma cellule', the: 'ma cellule' },
};

/** Where a random {place} may be: rooms everyone knows (a prison without one never names it). */
export const PUBLIC_PLACES: readonly ZoneId[] = ['canteen', 'yard', 'gym', 'showers', 'library', 'laundry', 'kitchen', 'woodshop', 'metalshop', 'mailroom', 'infirmary', 'rollCall', 'corridor', 'cellBlock', 'sports', 'garden'];

/** An item as people say it: English "a" or "an"; French gender (feminine) and elision (vowel first). */
export interface ItemWords {
  name: string;
  an?: boolean;
  f?: boolean;
  v?: boolean;
}

const EN_ITEMS: Record<string, ItemWords> = {
  plastic_spoon: { name: 'plastic spoon' },
  plastic_fork: { name: 'plastic fork' },
  plastic_knife: { name: 'plastic knife' },
  plastic_cup: { name: 'plastic cup' },
  toothbrush: { name: 'toothbrush' },
  plastic_comb: { name: 'comb' },
  soap: { name: 'bar of soap' },
  sock: { name: 'sock' },
  pillow: { name: 'pillow' },
  bed_sheet: { name: 'bed sheet' },
  magazine: { name: 'magazine' },
  toilet_paper: { name: 'toilet roll' },
  chocolate: { name: 'chocolate bar' },
  potato: { name: 'potato' },
  lighter: { name: 'lighter' },
  battery: { name: 'battery' },
  duct_tape: { name: 'roll of duct tape' },
  glue: { name: 'tube of glue' },
  toothpaste: { name: 'tube of toothpaste' },
  talcum: { name: 'tin of talc' },
  ink: { name: 'pot of ink' },
  foil: { name: 'roll of foil' },
  wire: { name: 'bit of wire' },
  timber: { name: 'plank' },
  sheet_metal: { name: 'sheet of metal' },
  crowbar: { name: 'crowbar' },
  razor_blade: { name: 'razor blade' },
  rope: { name: 'length of rope' },
  trowel: { name: 'trowel' },
  nail_file: { name: 'nail file' },
  metal_file: { name: 'metal file' },
  screwdriver: { name: 'screwdriver' },
  broom: { name: 'broom' },
  mop: { name: 'mop' },
  bleach: { name: 'bottle of bleach' },
  letter: { name: 'letter' },
  meal_tray: { name: 'meal tray' },
};

const FR_ITEMS: Record<string, ItemWords> = {
  plastic_spoon: { name: 'cuillère en plastique', f: true },
  plastic_fork: { name: 'fourchette en plastique', f: true },
  plastic_knife: { name: 'couteau en plastique' },
  plastic_cup: { name: 'gobelet' },
  toothbrush: { name: 'brosse à dents', f: true },
  plastic_comb: { name: 'peigne' },
  soap: { name: 'savon' },
  sock: { name: 'chaussette', f: true },
  pillow: { name: 'oreiller', v: true },
  bed_sheet: { name: 'drap' },
  magazine: { name: 'magazine' },
  toilet_paper: { name: 'rouleau de PQ' },
  chocolate: { name: 'tablette de chocolat', f: true },
  potato: { name: 'patate', f: true },
  lighter: { name: 'briquet' },
  battery: { name: 'pile', f: true },
  duct_tape: { name: 'rouleau de chatterton' },
  glue: { name: 'tube de colle' },
  toothpaste: { name: 'tube de dentifrice' },
  talcum: { name: 'boîte de talc', f: true },
  ink: { name: 'pot d’encre' },
  foil: { name: 'rouleau d’alu' },
  wire: { name: 'bout de fil de fer' },
  timber: { name: 'planche', f: true },
  sheet_metal: { name: 'tôle', f: true },
  crowbar: { name: 'pied-de-biche' },
  razor_blade: { name: 'lame de rasoir', f: true },
  rope: { name: 'bout de corde' },
  trowel: { name: 'truelle', f: true },
  nail_file: { name: 'lime à ongles', f: true },
  metal_file: { name: 'lime en métal', f: true },
  screwdriver: { name: 'tournevis' },
  broom: { name: 'balai' },
  mop: { name: 'serpillière', f: true },
  bleach: { name: 'bouteille de javel', f: true },
  letter: { name: 'lettre', f: true },
  meal_tray: { name: 'plateau-repas' },
};

/** Items a random {item} is picked from (everyday things; a merchant's stock fills it with what is there). */
export const CHAT_ITEMS: readonly string[] = ['plastic_spoon', 'plastic_fork', 'plastic_cup', 'toothbrush', 'plastic_comb', 'soap', 'sock', 'pillow', 'bed_sheet', 'magazine', 'toilet_paper', 'chocolate', 'potato', 'battery', 'glue', 'toothpaste', 'talcum'];

/** "a spoon" / « une cuillère », "the spoon" / « la cuillère », "my spoon" / « ma cuillère » (« mon oreiller »). */
export function itemPhrase(lang: Lang, id: string, form: 'a' | 'the' | 'my' | ''): string | null {
  const w = (lang === 'fr' ? FR_ITEMS : EN_ITEMS)[id];
  if (!w) return null;
  if (form === '') return w.name;
  if (lang === 'en') return `${form === 'a' ? (w.an ? 'an' : 'a') : form === 'the' ? 'the' : 'my'} ${w.name}`;
  if (form === 'a') return `${w.f ? 'une' : 'un'} ${w.name}`;
  if (form === 'the') return w.v ? `l’${w.name}` : `${w.f ? 'la' : 'le'} ${w.name}`;
  return `${w.f && !w.v ? 'ma' : 'mon'} ${w.name}`;
}

export function placePhrase(lang: Lang, zone: ZoneId): PlaceWords | null {
  return (lang === 'fr' ? FR_PLACES : EN_PLACES)[zone] ?? null;
}

/** Day 1 is a Monday. */
export const WEEKDAYS: Record<Lang, readonly string[]> = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
};

/** Today's menu (hashed by the day): breakfast, then the evening meal. French dishes carry their partitive article. */
export const MEALS: Record<Lang, { breakfast: readonly string[]; dinner: readonly string[] }> = {
  en: {
    breakfast: ['lumpy porridge', 'grey eggs', 'toast with a side of toast', 'oatmeal surprise', 'cold beans', 'mystery muesli', 'pancakes, allegedly', 'porridge with a crunch'],
    dinner: ['mystery stew', 'meatloaf of uncertain origin', 'boiled cabbage', 'fish fingers without the fish', 'grey spaghetti', 'bean casserole', "last week's leftovers", 'soup that fights back'],
  },
  fr: {
    breakfast: ['du porridge grumeleux', 'des œufs gris', 'des tartines rassies', 'de la bouillie surprise', 'des haricots froids', 'du muesli mystère', 'des crêpes, paraît-il', 'du porridge qui croustille'],
    dinner: ['du ragoût mystère', 'du pain de viande douteux', 'du chou bouilli', 'des bâtonnets de poisson sans poisson', 'des spaghettis gris', 'du gratin de haricots', 'les restes de la semaine', 'de la soupe qui se défend'],
  },
};

/** Today's talking point ({event}), by what happened. */
export const EVENTS: Record<Lang, Record<DayEvent, string>> = {
  en: { lockdown: 'the lockdown', power: 'the blackout', fight: 'that punch-up', shakedown: 'the shakedown', blast: 'that big bang', takeover: 'the riot', detector: 'the detector going off', shot: 'the sniper shooting', firecracker: 'that firecracker', alarmClock: 'that alarm clock' },
  fr: { lockdown: 'le confinement', power: 'la panne de courant', fight: 'la bagarre', shakedown: 'la fouille', blast: 'la grosse explosion', takeover: 'l’émeute', detector: 'le détecteur qui a sonné', shot: 'le tir du sniper', firecracker: 'ce pétard', alarmClock: 'ce réveil' },
};
export type DayEvent = 'lockdown' | 'power' | 'fight' | 'shakedown' | 'blast' | 'takeover' | 'detector' | 'shot' | 'firecracker' | 'alarmClock';

/** What the prison calls the player ({you}): the new fish for two days, then a name earned. */
export const NICKS: Record<Lang, Record<Nick, string>> = {
  en: { fish: 'fish', mole: 'Mole', champ: 'Champ', brains: 'Brains', muscles: 'Muscles', moneybags: 'Moneybags', kid: 'kid' },
  fr: { fish: 'le bleu', mole: 'la Taupe', champ: 'Champion', brains: 'Cerveau', muscles: 'Musclor', moneybags: 'Picsou', kid: 'petit' },
};
export type Nick = 'fish' | 'mole' | 'champ' | 'brains' | 'muscles' | 'moneybags' | 'kid';

/** A guard by name: "Officer Pratt" / « le gardien Pratt ». */
export const guardFull = (lang: Lang, name: string) => (lang === 'fr' ? `le gardien ${name}` : `Officer ${name}`);
