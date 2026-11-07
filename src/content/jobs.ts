import type { PropKind } from './props';
import type { ZoneId } from './zones';

/**
 * Prison jobs (GDD §11). Each pays its wage once the day's quota is done during the Work
 * Period (12:00–15:00); a quota left unfinished at 15:00 costs the job. Intellect decides
 * who may apply at the job board. Names go through t() as `job.<id>`.
 *
 * How the work is done (`flow`):
 * - 'machine': take the raw item at `take` (the first such prop in the room), run it through
 *   a `machine` for `cycle` seconds, put what comes out on `put` (the last such prop).
 * - 'mail': sort a letter at a `machine`, then hand it to the inmate it's addressed to.
 * - 'mop': take a mop from `take`, then mop up the puddles left in the corridors.
 */
export type JobId =
  'laundry' | 'janitor' | 'kitchen' | 'woodshop' | 'mailman' | 'metalshop' | 'gardener' | 'kennels' | 'smokehouse' | 'nets';

export interface JobDef {
  id: JobId;
  /** The room the job is done in (and the Work Period's check-in). */
  zone: ZoneId;
  /** Intellect needed to apply. */
  int: number;
  /** Dollars paid when the quota is done. */
  wage: number;
  /** Loads, puddles, trays, pieces or letters a day. */
  quota: number;
  flow: 'machine' | 'mail' | 'mop';
  take?: PropKind;
  machine?: PropKind;
  put?: PropKind;
  /** Item ids: what is taken (and goes into the machine), what comes out of it. */
  raw?: string;
  done?: string;
  /** Seconds a machine takes. */
  cycle?: number;
}

export const JOBS: Record<JobId, JobDef> = {
  laundry: {
    id: 'laundry',
    zone: 'laundry',
    int: 20,
    wage: 30,
    quota: 4,
    flow: 'machine',
    take: 'bin',
    machine: 'washer',
    put: 'bin',
    raw: 'dirty_laundry',
    done: 'clean_laundry',
    cycle: 5,
  },
  janitor: { id: 'janitor', zone: 'janitor', int: 25, wage: 35, quota: 6, flow: 'mop', take: 'bin', raw: 'mop' },
  kitchen: {
    id: 'kitchen',
    zone: 'kitchen',
    int: 30,
    wage: 40,
    quota: 4,
    flow: 'machine',
    take: 'freezer',
    machine: 'oven',
    put: 'counter',
    raw: 'raw_food',
    done: 'meal_tray',
    cycle: 5,
  },
  woodshop: {
    id: 'woodshop',
    zone: 'woodshop',
    int: 40,
    wage: 50,
    quota: 3,
    flow: 'machine',
    take: 'bin',
    machine: 'workbench',
    put: 'bin',
    raw: 'timber',
    done: 'furniture',
    cycle: 4,
  },
  mailman: { id: 'mailman', zone: 'mailroom', int: 50, wage: 55, quota: 3, flow: 'mail', machine: 'sortingDesk', done: 'letter', cycle: 3 },
  // The best paid (GDD §11), and the metal bin's sheet metal is the worker's to keep.
  metalshop: {
    id: 'metalshop',
    zone: 'metalshop',
    int: 60,
    wage: 65,
    quota: 4,
    flow: 'machine',
    take: 'bin',
    machine: 'press',
    put: 'bin',
    raw: 'sheet_metal',
    done: 'license_plate',
    cycle: 5,
  },
  // P31: the vegetable garden's rows, out in the open (seedlings from the shed into a planter, a crate of produce out of it, into the kitchen's crate).
  gardener: {
    id: 'gardener',
    zone: 'garden',
    int: 20,
    wage: 35,
    quota: 4,
    flow: 'machine',
    take: 'toolShed',
    machine: 'planter',
    put: 'crate',
    raw: 'seedlings',
    done: 'produce',
    cycle: 6,
  },
  // The Six Hunter: the kennel hand (a sack of feed from the bin into a trough, a bowl of it out to the run's bin; a day's
  // quota done, every hound has had its share from the player's hands: systems/jobs.ts kennelsFed); the smokehouse (fish
  // from the freezer over the smoker, onto the counter); the net mender in the boathouse, by the river door.
  kennels: {
    id: 'kennels',
    zone: 'kennels',
    int: 20,
    wage: 35,
    quota: 4,
    flow: 'machine',
    take: 'bin',
    machine: 'trough',
    put: 'bin',
    raw: 'feed_sack',
    done: 'dog_bowl',
    cycle: 4,
  },
  smokehouse: {
    id: 'smokehouse',
    zone: 'smokehouse',
    int: 40,
    wage: 50,
    quota: 4,
    flow: 'machine',
    take: 'freezer',
    machine: 'smoker',
    put: 'counter',
    raw: 'raw_fish',
    done: 'smoked_fish',
    cycle: 6,
  },
  nets: {
    id: 'nets',
    zone: 'boathouse',
    int: 50,
    wage: 55,
    quota: 3,
    flow: 'machine',
    take: 'bin',
    machine: 'netFrame',
    put: 'bin',
    raw: 'torn_net',
    done: 'mended_net',
    cycle: 5,
  },
};

/** Job items that belong to the work (handed back at 15:00, worth nothing elsewhere). */
export const WORK_ITEMS: readonly string[] = [
  'dirty_laundry',
  'clean_laundry',
  'raw_food',
  'meal_tray',
  'furniture',
  'letter',
  'license_plate',
  'seedlings',
  'produce',
  'feed_sack',
  'dog_bowl',
  'raw_fish',
  'smoked_fish',
  'torn_net',
  'mended_net',
];
