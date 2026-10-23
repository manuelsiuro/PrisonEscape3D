import { buzz } from '../app/haptics';
import { CHAIN_PIN, CHAINS, DIG_STEPS, FIXER_JOB_OPINION, FRAME_MINUTE, FROM, J, KIND, KIND_DEFS, KINDS, LIFT, LIFTS, PERK, STAGE } from '../content/oddjobs';
import { t, type Key } from '../i18n';
import { placesOf } from '../sim/ai/places';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { prisonDay } from '../sim/systems/calendar';
import { HOTBAR, itemOf } from '../sim/systems/items';
import { atBoard, boardOf, boardNow, boardRefusal, bringsOf, type Deal, digOf, fixerDeal, fixerJobRefusal, freezerOf, handInRefusal, jobOf, onWatch, owes } from '../sim/systems/oddjobs';
import { fixerOf, smugglingOf } from '../sim/systems/smuggling';
import { UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { MAP_W } from '../sim/world/World';
import { itemName } from '../ui/items';
import type { HeldView, OddJobsView, PinView } from '../ui/oddjobs';
import type { PaRow } from '../ui/pa';
import { guardSubject, inmateName, type OddJobTalkView } from '../ui/social';
import { banner, hud, itemsUI, oddjobsCard, sound, storyCard, talk } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';

/**
 * The odd jobs board on screen (P40): its card at the board (and the job's own card, from its
 * chip or B), the job's chip on the HUD (its step; on watch at a dig, the whistle), its steps in
 * the file's Today, the floor arrows to where its step is, what the one who asked (or the fixer)
 * offers in the talk panel; the toasts, sounds and a story's cards.
 */

/** The job's own card asked for (its chip or B), away from the board. */
let jobCard = false;

export function resetOddJobs() {
  jobCard = false;
  storyCard.hide();
}

const why = (k: string | null) => (k ? t(`refused.${k}` as Key) : '');
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The icon of each kind. */
export const KIND_ICON: readonly string[] = ['hand', 'box', 'search', 'arm', 'cards', 'checkers', 'rat', 'cookie', 'eye', 'gift', 'phone', 'cart'];

/** A guard's name for a job's words (his name alone; one without: "the guard"). */
const guardName = (sim: Sim, k: number) => sim.prison.guards[k]?.name ?? t('oddjob.someGuard');

/** The words a job's card asks in: who it's about, what's lifted. */
function askOf(sim: Sim, d: { kind: number; variant: number; giver: number; target: number }): string {
  const kind = KINDS[d.kind];
  const name = d.target >= 0 && d.kind !== KIND.LIFT ? inmateName(sim, d.target) : '';
  if (d.kind === KIND.LIFT) return t(`oddjob.ask.lift.${LIFTS[d.variant] ?? 'whistle'}` as Key, { guard: d.target >= 0 ? guardName(sim, d.target) : '' });
  if (d.kind === KIND.WRESTLE || d.kind === KIND.CHEAT || d.kind === KIND.CHECKERS) return t(`oddjob.ask.${kind}.${d.variant ? 'win' : 'lose'}` as Key, { name });
  if (d.kind === KIND.CAKE) return t(smugglingOf(sim)?.visits ? 'oddjob.ask.cake' : 'oddjob.ask.cakeParcel');
  return t(`oddjob.ask.${kind}` as Key, { name });
}

/** How long a job runs and what it pays, and what comes with it. */
function metaOf(d: Deal): { meta: string; perk: string } {
  const days = d.days === 1 ? t('oddjob.oneDay') : t('oddjob.days', { n: d.days });
  return { meta: `${days} · ${t('oddjob.pay', { n: d.pay })}`, perk: d.perk === PERK.ITEM && d.item ? t('oddjob.perkItem', { item: lower(itemName(d.item)) }) : d.perk === PERK.DEBT ? t('oddjob.perkDebt') : '' };
}

/** A story's title and step ("Doc’s watch · 2/3"). */
function storyTitle(sim: Sim, step: number) {
  const chain = CHAINS[sim.prison.id];
  return t('oddjob.storyStep', { title: t(`oddjob.chain.${sim.prison.id}.title` as Key), n: step + 1, of: chain?.steps.length ?? 0 });
}

/** The tile the player stands on to reach someone (where they are now). */
const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);

/** A step of the job held: its words, done or not, and where it's done (null: nowhere to point). */
interface Step {
  text: string;
  done: boolean;
  goal: number[] | null;
}

/** The job held's steps, in order; the last is always back to the one who asked. */
export function jobSteps(sim: Sim): Step[] {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return [];
  const kind = job[J.KIND];
  const giver = job[J.GIVER];
  const target = job[J.TARGET];
  const done = job[J.STAGE] === STAGE.DONE;
  const brings = bringsOf(job);
  const carrying = brings ? s.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === brings) : false;
  const giverName = inmateName(sim, giver);
  const name = target >= 0 && kind !== KIND.LIFT ? inmateName(sim, target) : '';
  const at = (who: number) => (s.inmates[who] ? [tileOfBody(s.inmates[who].body)] : null);
  const desk = (who: number) => {
    const m = s.inmates[who];
    const t0 = m ? placesOf(sim.world).deskside[m.cell] : -1;
    return t0 >= 0 ? [t0] : null;
  };
  const back: Step = { text: t(brings ? 'oddjob.step.bring' : 'oddjob.step.back', { name: giverName, item: brings ? lower(itemName(brings)) : '' }), done: false, goal: at(giver) };
  const steps: Step[] = [];
  switch (kind) {
    case KIND.LIFT: {
      if (job[J.VAR] === LIFT.MUG) {
        const f = freezerOf(sim);
        const p = f >= 0 ? containersOf(sim.world)[f].prop : null;
        const near = p ? [p.z * MAP_W + p.x - 1, p.z * MAP_W + p.x + 1, (p.z - 1) * MAP_W + p.x, (p.z + 1) * MAP_W + p.x].filter((i) => !sim.world.block[i]) : null;
        steps.push({ text: t('oddjob.step.mug'), done: carrying, goal: near });
      } else {
        const g = s.guards[target];
        steps.push({ text: t('oddjob.step.lift', { item: lower(itemName(brings)), guard: guardName(sim, target) }), done: carrying, goal: g ? [tileOfBody(g.body)] : null });
      }
      break;
    }
    case KIND.DROP:
      steps.push({ text: t('oddjob.step.drop', { name }), done, goal: desk(target) });
      break;
    case KIND.FRAME:
      steps.push({ text: t('oddjob.step.plant', { name }), done: done || job[J.PROG] > 0, goal: desk(target) });
      steps.push({ text: t('oddjob.step.search', { time: '19:00' }), done, goal: null });
      break;
    case KIND.WRESTLE:
    case KIND.CHEAT:
    case KIND.CHECKERS:
      steps.push({ text: t(`oddjob.step.${KINDS[kind]}.${job[J.VAR] ? 'win' : 'lose'}` as Key, { name }), done, goal: at(target) });
      break;
    case KIND.RAT:
      steps.push({ text: t('oddjob.step.rat', { name }), done, goal: desk(target) });
      break;
    case KIND.CAKE:
      steps.push({ text: t(smugglingOf(sim)?.visits ? 'oddjob.step.visit' : 'oddjob.step.parcel'), done: job[J.PROG] > 0, goal: null });
      break;
    case KIND.LOOKOUT: {
      const d = digOf(sim);
      const pct = Math.min(100, Math.floor((job[J.PROG] * 100) / DIG_STEPS));
      steps.push({ text: done ? t('oddjob.step.watched', { name: giverName }) : t('oddjob.step.watch', { name: giverName, n: pct }), done, goal: d ? [d.door] : null });
      break;
    }
    case KIND.DELIVER:
      steps.push({ text: t('oddjob.step.deliver', { name }), done, goal: at(target) });
      break;
    case KIND.TIP: {
      const c = sim.prison.comms;
      steps.push({ text: t('oddjob.step.tip', { name }), done, goal: c ? [c.phone.z * MAP_W + c.phone.x] : null });
      break;
    }
    case KIND.ERRAND:
      steps.push({ text: t('oddjob.step.errand', { name }), done: carrying, goal: at(target) });
      break;
  }
  steps.push(back);
  return steps;
}

/** The step under way (the first not done). */
const nowOf = (steps: readonly Step[]) => steps.findIndex((x) => !x.done);

/** Where the floor arrows lead for the job held (null: nowhere: no job, or its step has no place). */
export function jobGoal(sim: Sim): ((i: number) => boolean) | null {
  const steps = jobSteps(sim);
  const k = nowOf(steps);
  const goal = k >= 0 ? steps[k].goal : null;
  // (Already there: the arrows step aside.)
  if (!goal || goal.includes(tileOfBody(sim.state.player))) return null;
  return (i) => goal.includes(i);
}

/** How long the job held has left, in words. */
function leftOf(sim: Sim, job: readonly number[]): string {
  if (job[J.STAGE] === STAGE.DONE) return t('oddjob.leftDone');
  const day = prisonDay(sim.state.step);
  const last = prisonDay(job[J.ENDS] - 1);
  return last <= day ? t('oddjob.leftToday') : t('oddjob.leftDays', { n: last - day + 1 });
}

const pins: PinView[] = [];

/** The job held, as the cards show it. */
function heldView(sim: Sim): HeldView | null {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return null;
  const steps = jobSteps(sim);
  const k = nowOf(steps);
  const watch = job[J.KIND] === KIND.LOOKOUT && onWatch(sim as never);
  return {
    icon: KIND_ICON[job[J.KIND]],
    kind: t(`oddjob.kind.${KINDS[job[J.KIND]]}` as Key),
    who: inmateName(sim, job[J.GIVER]),
    ask: askOf(sim, { kind: job[J.KIND], variant: job[J.VAR], giver: job[J.GIVER], target: job[J.TARGET] }),
    steps: steps.map((x, i) => ({ text: x.text, done: x.done, now: i === k })),
    left: leftOf(sim, job),
    whistle: watch,
    urgent: watch && job[J.WARN] > 0,
  };
}

/** The card's view now (null: not at the board, and the job's own card not asked for). */
export function oddjobsNow(sim: Sim): OddJobsView | null {
  const s = sim.state;
  const b = boardOf(sim);
  if (!b) return null;
  const onTile = atBoard(sim as never) && Math.floor(s.player.x / UNIT) === b.x && Math.floor(s.player.z / UNIT) === b.z;
  const held = heldView(sim);
  if (!held) jobCard = false;
  if (!onTile) return jobCard && held ? { mode: 'job', note: '', pins: [], job: held } : null;
  // At the board: the day's pins and the story's card, each with why not.
  const now = boardNow(sim as never);
  pins.length = 0;
  now.pins.forEach((d, k) => {
    if (!d) return;
    pins.push({ pin: k, icon: KIND_ICON[d.kind], kind: t(`oddjob.kind.${KINDS[d.kind]}` as Key), who: inmateName(sim, d.giver), ask: askOf(sim, d), ...metaOf(d), why: why(boardRefusal(sim as never, k)), story: '' });
  });
  if (now.chain) {
    const d = now.chain;
    const step = s.oddjobs[2];
    pins.push({ pin: CHAIN_PIN, icon: KIND_ICON[d.kind], kind: t(`oddjob.kind.${KINDS[d.kind]}` as Key), who: inmateName(sim, d.giver), ask: t(`oddjob.chain.${sim.prison.id}.${step}` as Key), ...metaOf(d), why: why(boardRefusal(sim as never, CHAIN_PIN)), story: storyTitle(sim, step) });
  }
  const note = !pins.length ? t('oddjob.empty') : s.lockdown ? t('refused.gamesLockdown') : held ? '' : t('oddjob.note');
  return { mode: 'board', note, pins, job: held };
}

/** The job's own card, opened or closed (its chip, B): on watch at a dig, B whistles instead. */
export function toggleJob() {
  const g = play.game;
  if (!g || g.replay) return;
  const sim = g.rec.sim;
  if (!jobOf(sim.state)) return;
  if (onWatch(sim as never) && jobOf(sim.state)![J.KIND] === KIND.LOOKOUT) {
    sendOp(OP.EXT, EXT.WHISTLE);
    return;
  }
  jobCard = !jobCard;
}

/** B: the job's card (or the whistle). Taken: true. */
export function oddjobKey(code: string): boolean {
  const g = play.game;
  if (code !== 'KeyB' || !g || g.paused || g.replay || !jobOf(g.rec.sim.state)) return false;
  toggleJob();
  return true;
}

// ------------------------------------------------------------------ the HUD's chip

const chip = { icon: '', text: '', sr: '', left: 0, urgent: false, done: false, watch: false };

/** The job's chip: its kind's icon, the step under way, the time left (a bar); on watch, the whistle (null: no job). */
export function jobHud(sim: Sim): typeof chip | null {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return null;
  const steps = jobSteps(sim);
  const k = nowOf(steps);
  chip.icon = KIND_ICON[job[J.KIND]];
  chip.watch = job[J.KIND] === KIND.LOOKOUT && job[J.STAGE] === STAGE.ON && onWatch(sim as never);
  chip.urgent = chip.watch && job[J.WARN] > 0;
  chip.done = job[J.STAGE] === STAGE.DONE;
  chip.text = chip.watch ? t(chip.urgent ? 'oddjob.chip.coming' : 'oddjob.chip.watch', { n: Math.min(100, Math.floor((job[J.PROG] * 100) / DIG_STEPS)) }) : steps[k]?.text ?? '';
  const days = KIND_DEFS[KINDS[job[J.KIND]]].days;
  chip.left = chip.done ? 1 : Math.max(0, Math.min(1, (job[J.ENDS] - s.step) / (days * 1440 * 20)));
  chip.sr = `${t(`oddjob.kind.${KINDS[job[J.KIND]]}` as Key)}: ${chip.text}. ${leftOf(sim, job)}`;
  return chip;
}

// ------------------------------------------------------------------ the file's Today

/** The job held as a row of the file's Today (null: none). */
export function jobRow(sim: Sim): PaRow | null {
  const job = jobOf(sim.state);
  if (!job) return null;
  const steps = jobSteps(sim);
  const k = nowOf(steps);
  return {
    icon: KIND_ICON[job[J.KIND]],
    color: '#b98a55',
    label: t('oddjob.fileLabel'),
    title: `${t(`oddjob.kind.${KINDS[job[J.KIND]]}` as Key)} · ${inmateName(sim, job[J.GIVER])}`,
    when: leftOf(sim, job),
    sub: steps.map((x, i) => `${x.done ? '✓' : i === k ? '→' : '…'} ${x.text}`).join('  ·  '),
  };
}
/** What makes the file's Today redraw for the job. */
export const jobKey = (sim: Sim) => {
  const job = jobOf(sim.state);
  return job ? `${job.join(',')}:${sim.state.items.rev}` : '';
};

// ------------------------------------------------------------------ the talk panel

/** What odd jobs bring to a talk with an inmate: the job handed in, the fixer's own, a debt (null: nothing). */
export function oddjobTalk(sim: Sim, who: number): OddJobTalkView | null {
  const s = sim.state;
  const job = jobOf(s);
  const out: OddJobTalkView = { handIn: null, offer: null, owed: owes(s, who) ? why(null) : null, key: '' };
  if (job && job[J.GIVER] === who) {
    const r = handInRefusal(sim as never, who);
    out.handIn = { text: askOf(sim, { kind: job[J.KIND], variant: job[J.VAR], giver: who, target: job[J.TARGET] }), pay: t('oddjob.pay', { n: job[J.PAY] }), why: r === 'notDone' || r === 'missing' ? t(r === 'missing' ? 'oddjob.bringFirst' : 'oddjob.notYet') : why(r) };
  }
  if (who === fixerOf(sim)) {
    const d = fixerDeal(sim as never);
    if (d) {
      const r = fixerJobRefusal(sim as never, who);
      const m = metaOf(d);
      out.offer = { text: `${t(`oddjob.kind.${KINDS[d.kind]}` as Key)}: ${askOf(sim, d)}`, pay: `${m.meta}${m.perk ? ` · ${m.perk}` : ''}`, why: r === 'opinion' ? t('oddjob.fixerOpinion', { n: FIXER_JOB_OPINION }) : r === 'closed' ? t('phone.closed') : why(r) };
    }
  }
  if (!out.handIn && !out.offer && out.owed === null) return null;
  out.key = JSON.stringify(out);
  return out;
}

// ------------------------------------------------------------------ what happens

/** The words of a failure. */
const FAIL_KEY: Record<string, Key> = { time: 'toast.oddjob.time', quit: 'toast.oddjob.quit', seen: 'toast.oddjob.seen', caught: 'toast.oddjob.caught', fixed: 'toast.oddjob.fixed', found: 'toast.oddjob.found' };

/** What the odd jobs board does on screen: toasts, sounds, a story's cards. */
export function announceOddJob(sim: Sim, e: Extract<SimEvent, { type: 'oddjob' }>) {
  const name = e.who !== undefined && e.who >= 0 ? inmateName(sim, e.who) : '';
  switch (e.what) {
    case 'taken': {
      sound.chime();
      coachOnce('oddjob', 'hint.oddjob');
      if (e.from === FROM.CHAIN) {
        const step = sim.state.oddjobs[2];
        storyCard.show(name, storyTitle(sim, step), t(`oddjob.chain.${sim.prison.id}.${step}` as Key));
      } else itemsUI.toast(t('toast.oddjob.taken', { kind: lower(t(`oddjob.kind.${KINDS[e.kind ?? 0]}` as Key)), name }));
      return;
    }
    case 'done':
      sound.chime();
      buzz('attended');
      return banner.toast(t('toast.oddjob.done', { name }), 'good', 4500);
    case 'paid': {
      sound.coin();
      const extra = e.perk === PERK.ITEM && e.item ? t('toast.oddjob.paidItem', { item: lower(itemName(e.item)) }) : e.perk === PERK.DEBT ? t('toast.oddjob.paidDebt', { name }) : '';
      return banner.toast(`${t('toast.oddjob.paid', { name, n: e.n ?? 0 })}${extra ? ` ${extra}` : ''}`, 'good', 4500);
    }
    case 'chain': {
      const chain = CHAINS[sim.prison.id];
      const step = e.n ?? 0;
      storyCard.show(name, storyTitle(sim, step), t(`oddjob.chain.${sim.prison.id}.${step}.done` as Key));
      if (!e.more && chain) sound.levelUp();
      return;
    }
    case 'failed':
      sound.sting();
      buzz('missed');
      return banner.toast(t(FAIL_KEY[e.why ?? 'time'], { name }), 'bad', 4500);
    case 'planted':
      sound.pickup();
      return itemsUI.toast(t('toast.oddjob.planted', { time: `${Math.floor(FRAME_MINUTE / 60) + 8}:00` }));
    case 'tipped':
      return itemsUI.toast(t('toast.oddjob.tipped', { guard: e.guard !== undefined ? guardSubject(sim, e.guard) : '' }));
    case 'cake':
      sound.chime();
      return banner.toast(t(e.n ? 'toast.oddjob.cakeDesk' : 'toast.oddjob.cake', { name }), 'good', 4500);
    case 'cakeKept':
      return banner.toast(t('toast.oddjob.cakeKept'), 'bad', 3600);
    case 'digging':
      sound.blip();
      coachOnce('lookout', 'hint.lookout');
      return itemsUI.toast(t('toast.oddjob.digging', { name }));
    case 'coming':
      sound.sting();
      buzz('missed');
      return banner.toast(t('toast.oddjob.coming'), 'bad', 2500);
    case 'whistled':
      sound.whistle();
      return itemsUI.toast(t('toast.oddjob.whistled', { name }));
    case 'falseAlarm':
      sound.whistle();
      return itemsUI.toast(t('toast.oddjob.falseAlarm', { name }));
    case 'calledIn':
      sound.pickup();
      return banner.toast(t('toast.oddjob.calledIn', { name, item: lower(itemName(e.item ?? 0)) }), 'good', 4000);
    case 'owedJoin':
      return itemsUI.toast(t('toast.oddjob.owedJoin', { name }));
  }
}

/** The HUD's chip and the talk panel's offers, wired once. */
export function wireOddJobs() {
  hud.onJob = () => {
    sound.click();
    toggleJob();
  };
  talk.oddJob = oddjobTalk;
}

/** Shown: the board's card, the job's own card. */
export const oddjobsOpen = () => oddjobsCard.open;
