/**
 * The paperwork escape (P36, docs/PLAN.md §11; numbers in content/paperwork.ts).
 *
 * - **The form**: the strict guard (the morning shakedown's) carries a blank release form in its
 *   pockets (items.ts guardKit; a new one at 08:00 if it's gone). Forged with ink (Intellect
 *   FORGE_INT: recipes.ts), it's slipped into the tray at the release desk (Interact with it in
 *   hand, no guard watching, no lockdown): the player's name is on tomorrow's release list.
 * - **The records** at 22:00 that night: with the heat at RECORDS_HEAT or more, or a lockdown that
 *   prison day, the name gets a second look and the forgery is found: a lockdown, the player's cell
 *   searched, the name struck. Otherwise it passes.
 * - **The release**: the PA calls the name at 10:00. Reporting at the desk by 10:30 with the heat
 *   under RELEASE_HEAT, no lockdown and nothing contraband on them, the player changes into their
 *   own clothes and the doors out open for them alone (World.setFreed): out on the road is route
 *   `paperwork`. A failed check costs RELEASE_FAIL_HEAT and the name.
 *
 * Inmates never touch any of it, and nothing here draws on the state's RNG.
 */
import { itemDef, itemNumber } from '../../content/items';
import { FREED_STEPS, RECORDS_HEAT, RECORDS_MINUTE, RELEASE_FAIL_HEAT, RELEASE_FROM, RELEASE_HEAT, RELEASE_TO } from '../../content/paperwork';
import type { CommsDef } from '../../content/prisons/types';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import type { Refusal, SimState } from '../state';
import { BODY_HALF, CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { LAYER } from '../world/World';
import { dayMinute, prisonDay } from './calendar';
import { assign, GUARD } from './guards';
import { HOTBAR, itemOf, slot } from './items';
import { searcher } from './phone';
import { addHeat } from './watch';
import { tileAt } from '../world/grid';

const FORGED = itemNumber('forged_release');
const OWN_CLOTHES = itemNumber('own_clothes');

/** The prison's release desk (none at the Training Block). */
export const releaseOf = (sim: Pick<SimContext, 'world'>): CommsDef['release'] | null => (sim.world.def.rules?.relaxed ? null : (sim.world.def.comms?.release ?? null));

/** Cleared for release: the way out open for the player alone. */
export const freedNow = (s: Pick<SimState, 'release'>) => s.release[1] > 0;

/** The name is called now: on today's list, 10:00–10:30. */
export function calledNow(s: Pick<SimState, 'release' | 'step'>): boolean {
  const m = dayMinute(s.step);
  return s.release[0] === prisonDay(s.step) && m >= RELEASE_FROM && m < RELEASE_TO;
}

/** On the release desk's tiles: on the ground floor, up and about, not hidden, not in a takeover. */
export function atDesk(sim: SimContext): boolean {
  const r = releaseOf(sim);
  const s = sim.state;
  if (!r || s.layer !== LAYER.GROUND || s.stowed || sim.away || s.takeover || s.sleeping) return false;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  return r.at.some((q) => q.x === x && q.z === z);
}

/** At the desk with the name called (and not yet cleared): reporting is what Interact does there. */
export const atRelease = (sim: SimContext) => atDesk(sim) && calledNow(sim.state) && !freedNow(sim.state);

/** At the desk with a forged form in hand (and not called: then it's reporting). */
export const atTray = (sim: SimContext) => atDesk(sim) && !calledNow(sim.state) && itemOf(sim.state.items.inv[sim.state.items.hand]) === FORGED;

// ------------------------------------------------------------------ the tray

/** Why the form can't be slipped in now (null: it can). Pure: the button says the same. */
export function trayRefusal(sim: SimContext): Refusal | null {
  const s = sim.state;
  if (s.lockdown || s.heat >= CHASE_HEAT) return 'hunted';
  // (Tonight's records already checked: the tray's next pick-up is tomorrow before 22:00.)
  if (dayMinute(s.step) >= RECORDS_MINUTE) return 'trayLate';
  if (s.seen) return 'watched';
  return s.release[0] > prisonDay(s.step) ? 'onList' : null;
}

/** The forged form slipped into the tray (Interact): the name on tomorrow's list, the form gone. */
export function fileForm(sim: SimContext) {
  const s = sim.state;
  if (!atTray(sim)) return;
  const why = trayRefusal(sim);
  if (why) return void sim.events.push({ type: 'refused', why });
  const day = prisonDay(s.step);
  s.items.inv[s.items.hand] = 0;
  s.items.rev++;
  s.release[0] = day + 1;
  sim.events.push({ type: 'paper', what: 'filed', n: day + 1 });
}

/** 22:00: tomorrow's list looked over. A name with the heat up, or after a lockdown today, is looked at twice: the forgery found. */
function records(sim: SimContext) {
  const s = sim.state;
  const day = prisonDay(s.step);
  if (s.release[0] !== day + 1) return;
  // (P39: a name the parole board put there has nothing forged to find.)
  if (s.parole[9] === s.release[0]) return;
  const hot = s.heat >= RECORDS_HEAT || s.release[2] === day || s.lockdown;
  if (!hot) return void sim.events.push({ type: 'paper', what: 'passed', n: day + 1 });
  s.release[0] = 0;
  sim.events.push({ type: 'paper', what: 'found' });
  // The player's cell searched (by the shakedown guard, else whoever's up), and the sirens.
  const k = searcher(sim);
  if (k >= 0) assign(s.guards[k], GUARD.SHAKEDOWN, [1]);
  addHeat(sim, 100);
}

// ------------------------------------------------------------------ the release

/** Something contraband on the player (the hotbar, the weapon and the outfit slots: a hollow book's inside isn't looked into). */
function carryingContraband(s: Pick<SimState, 'items'>): boolean {
  for (let k = 0; k <= SLOT.OUTFIT; k++) {
    if (k >= HOTBAR && k !== SLOT.WEAPON && k !== SLOT.OUTFIT) continue;
    const v = itemOf(s.items.inv[k]);
    if (v && itemDef(v).contraband) return true;
  }
  return false;
}

/** Why the desk wouldn't clear the player now (null: it would). Pure: the button says the same. */
export function releaseRefusal(s: Pick<SimState, 'heat' | 'lockdown' | 'items'>): 'heat' | 'lockdown' | 'contraband' | null {
  if (s.lockdown) return 'lockdown';
  if (s.heat >= RELEASE_HEAT) return 'heat';
  return carryingContraband(s) ? 'contraband' : null;
}

/** Reporting at the desk (Interact): cleared and into their own clothes, or turned away (heat, the name struck). */
export function report(sim: SimContext) {
  const s = sim.state;
  if (!atRelease(sim)) return;
  const why = releaseRefusal(s);
  if (why) {
    s.release[0] = 0;
    sim.events.push({ type: 'paper', what: 'turnedAway', why });
    addHeat(sim, RELEASE_FAIL_HEAT);
    return;
  }
  s.items.inv[SLOT.OUTFIT] = slot(OWN_CLOTHES);
  s.items.rev++;
  s.release[1] = s.step + FREED_STEPS;
  sim.events.push({ type: 'paper', what: 'cleared' });
}

/** The player's footprint in one of the release's doorways (a door never shuts on the player standing in it). */
function inTheWay(sim: SimContext): boolean {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND || sim.away) return false;
  const w = sim.world;
  const b = s.player;
  for (const x of [b.x - BODY_HALF, b.x + BODY_HALF - 1])
    for (const z of [b.z - BODY_HALF, b.z + BODY_HALF - 1]) if (w.release[tileAt(x, z)]) return true;
  return false;
}

/** Each step: the records at 22:00, the call at 10:00, a name not answered by 10:30, the way out shutting again. */
export function paperwork(sim: SimContext) {
  const s = sim.state;
  if (!releaseOf(sim)) return;
  const day = prisonDay(s.step);
  // (The prison day of the last lockdown: the records look twice at a name after one.)
  if (s.lockdown) s.release[2] = day;
  const listed = s.release[0];
  if (listed && s.step % STEPS_PER_MINUTE === 0) {
    const m = dayMinute(s.step);
    if (m === RECORDS_MINUTE) records(sim);
    if (listed === day && m === RELEASE_FROM) sim.events.push({ type: 'paper', what: 'called', n: day });
    // (Not there by 10:30, or the day gone by in solitary: the name comes off the list.)
    if (s.release[0] && !freedNow(s) && ((listed === day && m >= RELEASE_TO) || listed < day)) {
      s.release[0] = 0;
      sim.events.push({ type: 'paper', what: 'missed' });
    }
  }
  // Cleared: the way out shuts again after its minute (at once, wanted, with the sirens going, or caught), never on the player standing in a doorway.
  const free = s.release[1];
  if (free && (s.step >= free || s.heat >= CHASE_HEAT || s.lockdown || sim.away) && !inTheWay(sim)) {
    s.release[1] = 0;
    if (s.release[0] === day) s.release[0] = 0;
    sim.events.push({ type: 'paper', what: 'shut' });
  }
}
