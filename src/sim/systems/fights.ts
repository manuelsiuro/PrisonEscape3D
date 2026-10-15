/**
 * Fights as the Sim runs them (GDD §7.3, §10): keys carried and worn, the player's blows and
 * throws, knockouts and coming round (a guard's missing key raises the alarm), blows on the
 * player and what happens at 0 health. The numbers (damage, reach, pace) are in combat.ts.
 */
import { itemDef } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { nearestDir as faceTo } from '../ai/path';
import { lineOfSight } from '../ai/sight';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { SPOT, WAKE } from '../state';
import { ANGRY_STEPS, CHASE_HEAT, GRUDGE_SETTLED, GUARD_SWING_STEPS, HIT_OPINION, INMATE_SWING_STEPS, KO_OPINION, KO_STEPS, LOCK_KEEP, MELEE_REACH, THROW_RANGE } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { closeBox } from './actions';
import { BATON_ATTACK, damage, dist2, type Fighter, GUARD_DEFENSE, INMATE_DEFENSE, isGuard, maxHealth, personOf, reachOf, swingSteps } from './combat';
import { FAVOR, FAVOR_STATE } from './economy';
import { awake, backToDuty, type Guard, GUARD } from './guards';
import { DOING, type Inmate } from './inmates';
import { guardKit, HOTBAR, itemOf, pocketOf, slot, usesOf } from './items';
import { caught } from './justice';
import { type Body, tileOfBody } from './movement';
import { changeOpinion, dismiss, dismissAll, endTalk, favorDone } from './social';
import { stopTraining } from './training';
import { addHeat } from './watch';

/** Bit k: the player carries a key (real or plastic) for door color k (keys work from the hotbar). */
export function keysCarried(sim: SimContext): number {
  const it = sim.state.items;
  let mask = 0;
  for (let k = 0; k < HOTBAR; k++) {
    const v = it.inv[k];
    const d = v ? itemDef(itemOf(v)) : null;
    if (d?.cat === 'key' && d.key) mask |= 1 << d.key;
  }
  return mask;
}

/**
 * A plastic key wears a little at each door it opens (GDD §7.3: 15 uses); a real key never
 * does. Counted once a door, as the player steps out of it (the door stays open to them
 * while they're in it, so the last use still gets them through). A two-wide door is one door.
 */
export function wearKeys(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  const t = tileOfBody(s.player);
  const i = t.z * MAP_W + t.x;
  const inDoor = s.layer === LAYER.GROUND && w.ground.kind[i] === TILE.DOOR && w.doorShut[i] === 1;
  const was = s.doorAt;
  if (inDoor) {
    s.doorAt = i;
    return;
  }
  if (was < 0) return;
  s.doorAt = -1;
  wearKey(sim, w.ground.key[was]);
}

/** One use off a plastic key of a color (none if the player holds the real one). */
function wearKey(sim: SimContext, color: number) {
  const it = sim.state.items;
  let plastic = -1;
  for (let k = 0; k < HOTBAR; k++) {
    const v = it.inv[k];
    const d = v ? itemDef(itemOf(v)) : null;
    if (d?.cat !== 'key' || d.key !== color) continue;
    if (!d.uses) return;
    if (plastic < 0) plastic = k;
  }
  if (plastic < 0) return;
  const item = itemOf(it.inv[plastic]);
  const left = usesOf(it.inv[plastic]) - 1;
  it.inv[plastic] = left > 0 ? slot(item, left) : 0;
  it.rev++;
  if (left <= 0) sim.events.push({ type: 'broke', item });
}

/** The weapon the player fights with: one in hand, else the one in the weapon slot (0: fists). */
function weapon(sim: SimContext): { item: number; slot: number } {
  const it = sim.state.items;
  const inHand = itemOf(it.inv[it.hand]);
  if (inHand && itemDef(inHand).cat === 'weapon') return { item: inHand, slot: it.hand };
  return { item: itemOf(it.inv[SLOT.WEAPON]), slot: SLOT.WEAPON };
}

/**
 * A blow at the locked-on target (GDD §10.1): at the weapon's pace, within its reach, with a
 * clear line; Strength and the weapon against the target's outfit. Molten chocolate is
 * thrown instead (3 tiles, out cold at once). Whoever is hit knows it: an inmate fights
 * back, a guard turns round (and sees who it was). Returns false with nobody locked on (the
 * press goes to the tool in hand).
 */
export function attack(sim: SimContext, fresh: boolean): boolean {
  const s = sim.state;
  const it = s.items;
  const p = s.player;
  if (s.lock < 0 || s.layer !== LAYER.GROUND) return false;
  const f = personOf(s, s.lock);
  if (!f || f.ko > 0) {
    s.lock = -1;
    return false;
  }
  const { item, slot: from } = weapon(sim);
  const wdef = item ? itemDef(item) : null;
  const d2 = dist2(f.body, p);
  const clear = lineOfSight(sim.world, p.x, p.z, f.body.x, f.body.z);
  if (wdef?.thrown) {
    if (!fresh) return true;
    if (d2 > THROW_RANGE * THROW_RANGE || !clear) {
      sim.events.push({ type: 'cantHit', why: 'far' });
      return true;
    }
    if (d2 > 0) p.facing = faceTo(f.body.x - p.x, f.body.z - p.z);
    it.inv[from] = 0;
    it.rev++;
    s.swingAt = s.step;
    const who = s.lock;
    sim.events.push({ type: 'thrown', who });
    knockOut(sim, who);
    return true;
  }
  if (s.step - s.swingAt < swingSteps(s.spd, wdef)) return true;
  const reach = reachOf(wdef);
  if (d2 > reach * reach || !clear) {
    if (fresh) sim.events.push({ type: 'cantHit', why: 'far' });
    return true;
  }
  if (d2 > 0) p.facing = faceTo(f.body.x - p.x, f.body.z - p.z);
  s.swingAt = s.step;
  const who = s.lock;
  const guard = isGuard(s, who);
  s.selfDefense = false;
  const dmg = damage(s.str, wdef?.attack ?? 0, guard ? GUARD_DEFENSE : INMATE_DEFENSE);
  f.hp = Math.max(0, f.hp - dmg);
  const ko = f.hp === 0;
  // They know who hit them.
  if (d2 > 0) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
  if (guard) {
    const g = f as Guard;
    if (g.doing === DOING.SLEEP) g.doing = DOING.NOTHING;
    g.face = g.body.facing;
  } else {
    const m = f as Inmate;
    // Hitting back at someone already after the player: self-defense (GDD §10.3 ambushes).
    s.selfDefense = m.angry > 0;
    m.angry = ANGRY_STEPS;
    m.doing = DOING.NOTHING;
    m.wait = 0;
    // Its first punch comes back quickly.
    m.swing = Math.min(m.swing, s.step - INMATE_SWING_STEPS / 2);
    // Nobody likes being hit; a follower hit stops following.
    changeOpinion(sim, who, -HIT_OPINION);
    dismiss(sim, who);
    if (s.talk === who) endTalk(sim);
  }
  sim.events.push({ type: 'hit', who, dmg, ko, weapon: item });
  // A scene at roll call (GDD §10.4: the distraction favor).
  const block = ROUTINE[s.routine].id;
  if (block === 'rollCall' || block === 'eveningRollCall') for (const fv of s.favors) if (fv.kind === FAVOR.DISTRACTION && fv.state === FAVOR_STATE.TAKEN) favorDone(sim, fv);
  if (ko) knockOut(sim, who);
  return true;
}

/** Someone the player (or a follower, `by`) put down: out cold for 30 s where they stand (GDD §10.2). */
function knockOut(sim: SimContext, who: number, by: Body = sim.state.player) {
  const s = sim.state;
  const f = personOf(s, who) as (Inmate | Guard) | undefined;
  if (!f) return;
  f.hp = 0;
  f.ko = KO_STEPS;
  f.body.moving = false;
  if (!isGuard(s, who)) {
    const m = f as Inmate;
    // Knocked out on the job: it misses work (GDD §11: sabotage).
    if (ROUTINE[s.routine].id === 'work') m.shift = 2;
    if (by === s.player) changeOpinion(sim, who, -KO_OPINION);
    if (s.talk === who) endTalk(sim);
    for (const fv of s.favors) if (fv.kind === FAVOR.BEATDOWN && fv.target === who && fv.state === FAVOR_STATE.TAKEN) favorDone(sim, fv);
  }
  // Down facing whoever did it: they fall back, away from them.
  const p = by;
  if (f.body.x !== p.x || f.body.z !== p.z) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
  f.path = [];
  f.goal = -1;
  f.wait = 0;
  f.doing = DOING.KNOCKED_OUT;
  if (isGuard(s, who)) {
    resumeAfterKo(f as Guard);
    s.tally[2]++;
  } else (f as Inmate).angry = 0;
  f.doing = DOING.KNOCKED_OUT;
  if (s.lock === who) {
    s.lock = -1;
    sim.events.push({ type: 'lock', who: -1 });
  }
  sim.events.push({ type: 'koed', who });
}

/**
 * The knocked out come round, healed. A guard is handed a new baton or uniform if they were
 * taken; a guard whose key is gone radios it in: a lockdown (GDD §10.2), and a spare key.
 */
export function recover(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  s.inmates.forEach((m, id) => {
    if (m.ko <= 0 || --m.ko > 0) return;
    m.hp = maxHealth(m.str);
    m.doing = DOING.NOTHING;
    m.plan = -1;
    sim.events.push({ type: 'cameTo', who: id, keyMissing: false });
  });
  s.guards.forEach((g, k) => {
    if (g.ko <= 0 || --g.ko > 0) return;
    g.hp = maxHealth(g.str);
    g.doing = DOING.NOTHING;
    resumeAfterKo(g);
    const id = s.inmates.length + k;
    const pockets = s.items.containers[pocketOf(w, id)];
    const key = guardKit(w, k)[0];
    const missing = !pockets.some((v) => itemOf(v) === key);
    // The key is radioed in (and a spare drawn); a missing baton or uniform waits for 08:00.
    if (missing) {
      const free = pockets.indexOf(0);
      if (free >= 0) pockets[free] = slot(key);
      s.items.rev++;
      s.keyAlarm = true;
    }
    sim.events.push({ type: 'cameTo', who: id, keyMissing: missing });
  });
  raiseKeyAlarm(sim);
}

/**
 * A missing key raises the alarm (GDD §10.2) as soon as it can: not during a lockdown
 * (already on), nor while the player is out cold or in solitary (it waits for them).
 */
export function raiseKeyAlarm(sim: SimContext) {
  const s = sim.state;
  if (!s.keyAlarm || s.lockdown || sim.away) return;
  s.keyAlarm = false;
  sim.events.push({ type: 'spotted', reason: 'keyMissing' });
  s.spotted = SPOT.indexOf('keyMissing');
  addHeat(sim, 100);
}

/**
 * A guard back on its feet (or just put down): a chase or a search is over, a round starts
 * afresh, but a bed check or shakedown under way is taken up again.
 */
function resumeAfterKo(g: Guard) {
  g.path = [];
  g.goal = -1;
  g.wait = 0;
  if (g.mode !== GUARD.BED_CHECK && g.mode !== GUARD.SHAKEDOWN) backToDuty(g);
}

/** 08:00: guards draw a new baton or uniform from the quarters if theirs were taken (never more than one each). */
export function reissueKit(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  s.guards.forEach((_, k) => {
    const pockets = s.items.containers[pocketOf(w, s.inmates.length + k)];
    for (const n of guardKit(w, k).slice(1)) {
      if (pockets.some((v) => itemOf(v) === n)) continue;
      const free = pockets.indexOf(0);
      if (free >= 0) pockets[free] = slot(n);
    }
  });
}

/**
 * Blows on the player (GDD §10.1): a chasing guard's baton, an angry inmate's fists, at
 * arm's length with a clear line, each at its own pace. The lock lets go of someone out
 * cold, gone too far, or off the player's floor.
 */
export function fight(sim: SimContext) {
  const s = sim.state;
  const p = s.player;
  if (s.lock >= 0) {
    const f = personOf(s, s.lock);
    if (!f || f.ko > 0 || s.layer !== LAYER.GROUND || sim.away || dist2(f.body, p) > LOCK_KEEP * LOCK_KEEP) {
      s.lock = -1;
      sim.events.push({ type: 'lock', who: -1 });
    }
  }
  if (sim.away || s.layer !== LAYER.GROUND) return;
  const defense = itemDef(itemOf(s.items.inv[SLOT.OUTFIT]))?.defense ?? 0;
  for (let id = 0; id < s.inmates.length && !sim.away; id++) if (s.inmates[id].angry > 0) blow(sim, s.inmates[id], id, INMATE_SWING_STEPS, 0, defense);
  for (let k = 0; k < s.guards.length && !sim.away; k++) {
    const g = s.guards[k];
    if (g.mode === GUARD.CHASE && awake(g)) blow(sim, g, s.inmates.length + k, GUARD_SWING_STEPS, BATON_ATTACK, defense);
  }
  // Followers fight for the player (GDD §10.3).
  for (const id of s.followers) {
    const m = s.inmates[id];
    const foe = sim.scratch.allyFoe[id] ?? -1;
    const f = foe >= 0 ? personOf(s, foe) : undefined;
    if (!m || !f || m.ko > 0 || f.ko > 0 || s.step - m.swing < INMATE_SWING_STEPS || dist2(m.body, f.body) > MELEE_REACH * MELEE_REACH) continue;
    if (!lineOfSight(sim.world, m.body.x, m.body.z, f.body.x, f.body.z)) continue;
    m.swing = s.step;
    if (m.body.x !== f.body.x || m.body.z !== f.body.z) m.body.facing = faceTo(f.body.x - m.body.x, f.body.z - m.body.z);
    const guard = isGuard(s, foe);
    const dmg = damage(m.str, 0, guard ? GUARD_DEFENSE : INMATE_DEFENSE);
    f.hp = Math.max(0, f.hp - dmg);
    if (guard && (f as Guard).doing === DOING.SLEEP) (f as Guard).doing = DOING.NOTHING;
    sim.events.push({ type: 'allyHit', by: id, who: foe, dmg, ko: f.hp === 0 });
    if (f.hp === 0) knockOut(sim, foe, m.body);
  }
}

/** Someone's blow at the player, if it's their moment and the player is at arm's length with nothing between. */
function blow(sim: SimContext, f: Fighter, id: number, pace: number, attack: number, defense: number) {
  const s = sim.state;
  const p = s.player;
  if (f.ko > 0 || s.step - f.swing < pace || dist2(f.body, p) > MELEE_REACH * MELEE_REACH) return;
  if (!lineOfSight(sim.world, f.body.x, f.body.z, p.x, p.z)) return;
  f.swing = s.step;
  if (f.body.x !== p.x || f.body.z !== p.z) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
  hurt(sim, damage(f.str, attack, defense), id);
}

/** The player takes a blow (by Cast id, -1 for the tunnel roof): at 0 health, out cold. */
export function hurt(sim: SimContext, dmg: number, by: number) {
  const s = sim.state;
  s.health = Math.max(0, s.health - dmg);
  if (s.sleeping) {
    s.sleeping = false;
    sim.events.push({ type: 'sleep', on: false });
  }
  sim.events.push({ type: 'hurt', by, dmg });
  if (s.health > 0) return;
  // Put down by a guard: caught (solitary or the infirmary). By anyone else: the infirmary.
  if (by >= 0 && isGuard(s, by)) caught(sim);
  else {
    // An inmate who put the player down has settled its score: the grudge is spent (beaten, it would hate them all the more).
    const m = by >= 0 ? s.inmates[by] : undefined;
    if (m && m.opinion < GRUDGE_SETTLED) changeOpinion(sim, by, GRUDGE_SETTLED - m.opinion);
    floored(sim);
  }
}

/** Knocked out by an inmate or a cave-in: carried to the infirmary (contraband taken, as after a capture). */
function floored(sim: SimContext) {
  const s = sim.state;
  // In a lockdown (or wanted), the guards pick the player up: as good as caught.
  if (s.lockdown || s.heat >= CHASE_HEAT) {
    caught(sim);
    return;
  }
  s.lock = -1;
  dismissAll(sim);
  endTalk(sim);
  stopTraining(sim);
  s.ko = KO_STEPS;
  s.excused = true;
  s.wake = WAKE.FLOORED;
  s.sleeping = false;
  s.player.moving = false;
  for (const m of s.inmates) m.angry = 0;
  closeBox(sim);
  sim.events.push({ type: 'floored' });
}
