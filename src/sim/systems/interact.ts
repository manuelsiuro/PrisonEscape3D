/**
 * What the action button does now (v2.34.2): one decision, read by the sim to do it (`actions.ts`)
 * and by the play layer to say it (the label), show it (the highlight) and answer a tap. Before,
 * each had its own copy of the order below, kept in step by hand; now they can't disagree.
 * Pure: it reads the state and changes nothing (the arrays it fills are the sim's scratch).
 */
import type { SimContext } from '../context';
import { LAYER } from '../world/World';
import { containersOf } from '../world/containers';
import { counterTray, trayOffer, type TrayOffer } from './canteen';
import { coolerOffer } from './cooler';
import { atTail } from './delivery';
import type { Station } from './economy';
import { atWindow, windowFirst } from './getaway';
import type { Guard } from './guards';
import type { Inmate } from './inmates';
import { interactTarget, itemOf, type Target } from './items';
import { letterDue, station } from './jobs';
import { menuOffer } from './menu';
import type { Body } from './movement';
import { atRelease, atTray } from './paperwork';
import { canAnswer } from './rollcall';
import { showerOffer } from './showers';
import { climbTarget, DIRT, facesProp, preferClimb, WALL_CHUNK, type ClimbTarget } from './structure';
import { chairForBook, readSeated, reading } from './training';
import { bedOffer } from './upkeep';
import { vendOffer } from './vending';
import { canChat } from './ways';

/** Something in reach the button acts on (never null). */
type Reached = Exclude<Target, null>;
type Fixture = Extract<Reached, { kind: 'fixture' }>;

/** What a press of the action button does, first match wins (the order of `interactPlan`). */
export type Plan =
  | { do: 'peel' } // in solitary: a potato
  | { do: 'answer' } // called at roll call
  | { do: 'underline' } // reading: a line marked
  | { do: 'readOn' } // a book on a library chair: open it there
  | { do: 'getUp' } // seated or resting
  | { do: 'climbOut' } // stowed in the delivery vehicle
  | { do: 'stow' } // at its open tail
  // (These three keep what's in reach there, for the highlight: the desk, its tray.)
  | { do: 'report'; target: Target } // the release desk, the name called
  | { do: 'fileForm'; target: Target } // its tray, a forged form
  | { do: 'showId'; target: Target } // the checkpoint's window, papers in the hotbar
  | { do: 'climb'; climb: ClimbTarget }
  | { do: 'work'; station: Station }
  | { do: 'tray'; offer: TrayOffer; target: Target }
  | { do: 'shower'; head: number; target: Target }
  | { do: 'vend' }
  | { do: 'cooler' }
  | { do: 'menu' }
  | { do: 'pickUp'; target: Extract<Reached, { kind: 'ground' }> }
  | { do: 'bed'; bed: 'tuck' | 'takeOut'; target: Extract<Reached, { kind: 'sleep' }> }
  | { do: 'sleep'; target: Extract<Reached, { kind: 'sleep' }> }
  | { do: 'talk'; target: Extract<Reached, { kind: 'person' }> }
  | { do: 'fixture'; target: Fixture }
  | { do: 'pockets'; target: Extract<Reached, { kind: 'pockets' }> }
  | { do: 'flush'; target: Extract<Reached, { kind: 'container' }> }
  | { do: 'search'; target: Extract<Reached, { kind: 'container' }> };

/** Everyone about on the ground floor (nobody digs under people); one array, refilled. */
export function bodiesAbout(sim: SimContext): Body[] {
  const list = sim.scratch.about;
  list.length = 0;
  for (const m of sim.state.inmates) list.push(m.body);
  for (const g of sim.state.guards) list.push(g.body);
  return list;
}

/** Everyone who can be fought or looted, by Cast id (inmates, then guards); one array, refilled. */
export function people(sim: SimContext): ReadonlyArray<Inmate | Guard> {
  const list = sim.scratch.cast;
  list.length = 0;
  for (const m of sim.state.inmates) list.push(m);
  for (const g of sim.state.guards) list.push(g);
  return list;
}

/** What's in reach of the button by itself: a book's chair, a letter's addressee, else the nearest thing (`interactTarget`). */
export function reachTarget(sim: SimContext): Target {
  const s = sim.state;
  // (2.31: a book in hand, at a free library chair: that, before anyone about.)
  const bookSeat = chairForBook(sim);
  if (bookSeat >= 0) return { kind: 'fixture', index: bookSeat, use: 'sit' };
  const due = letterDue(sim);
  if (due >= 0) return { kind: 'person', who: due };
  return interactTarget(
    sim.world,
    s.items,
    s.player,
    sim.bedtime,
    s.layer,
    people(sim),
    s.inmates.length,
    (k) => canChat(sim, k),
    sim.bedtime && !sim.rules227,
  );
}

/** The ladder, hatch, vent or tunnel in reach, unless the player faces furniture that's also in reach. */
export function reachClimb(sim: SimContext, target: Target): ClimbTarget | null {
  const s = sim.state;
  const faced =
    target?.kind === 'container' || target?.kind === 'sleep' ? facesProp(s.player, containersOf(sim.world)[target.index].prop) : false;
  return preferClimb(climbTarget(sim.world, s.layer, s.player, sim.ladderFoot, bodiesAbout(sim)), faced);
}

/** What a press of the action button does now; null: nothing (it does nothing). */
export function interactPlan(sim: SimContext): Plan | null {
  const s = sim.state;
  if (s.solitary > 0) return { do: 'peel' };
  // Called at roll call (2.27): before anything else, nothing is stopped to do it.
  if (canAnswer(sim)) return { do: 'answer' };
  // (2.31: reading, the action button underlines; with a book on a library chair, it opens it.)
  if (reading(sim)) return { do: 'underline' };
  if (readSeated(sim)) return { do: 'readOn' };
  // Seated (or resting): the action button gets the player up.
  if (s.seat >= 0) return { do: 'getUp' };
  // Delivery day (P18): out of the vehicle again; into it at its tail.
  if (s.stowed) return { do: 'climbOut' };
  if (atTail(sim)) return { do: 'stow' };
  const target = reachTarget(sim);
  const up = reachClimb(sim, target);
  // The release desk (P36): reporting there while the name is called, or a forged form slipped into its tray, comes first.
  if (atRelease(sim)) return { do: 'report', target };
  if (atTray(sim)) return { do: 'fileForm', target };
  // The checkpoint (P24): a fake ID shown at its window, first at the shift change (else when there's nothing else to do here).
  if (atWindow(sim) && windowFirst(sim, !!target || !!up)) return { do: 'showId', target };
  if (up) return { do: 'climb', climb: up };
  // On the job (GDD §11): the station's step comes first.
  const job = s.layer === LAYER.GROUND ? station(sim) : null;
  if (job) return { do: 'work', station: job };
  // A meal (2.25): the serving counter's tray taken or given back, ahead of anyone standing by; searched at the next press.
  const offer = counterTray(sim) ?? (target?.kind === 'container' ? trayOffer(sim, target.index) : null);
  if (offer) return { do: 'tray', offer, target };
  // The showers (2.26): the water turned on, ahead of anyone standing by; searched at the next press.
  const head = showerOffer(sim, target);
  if (head >= 0) return { do: 'shower', head, target };
  // The vending machine (2.32), faced: ahead of whoever's queueing for it beside the player.
  if (vendOffer(sim)) return { do: 'vend' };
  // The water cooler and the menu board (2.33), faced: ahead of whoever's drinking or reading beside the player.
  if (coolerOffer(sim)) return { do: 'cooler' };
  if (menuOffer(sim)) return { do: 'menu' };
  if (!target) return null;
  switch (target.kind) {
    case 'ground':
      return { do: 'pickUp', target };
    case 'sleep': {
      // (2.28: the dummy in or out first; the next press lies down.)
      const bed = bedOffer(sim, target.index);
      return bed ? { do: 'bed', bed, target } : { do: 'sleep', target };
    }
    case 'person':
      return { do: 'talk', target };
    case 'fixture':
      return { do: 'fixture', target };
    case 'pockets':
      // Going through someone's pockets while they're out cold (GDD §10.2).
      return { do: 'pockets', target };
    case 'container': {
      const held = itemOf(s.items.inv[s.items.hand]);
      if ((held === DIRT || held === WALL_CHUNK) && containersOf(sim.world)[target.index].prop.kind === 'toilet')
        return { do: 'flush', target };
      return { do: 'search', target };
    }
  }
}
