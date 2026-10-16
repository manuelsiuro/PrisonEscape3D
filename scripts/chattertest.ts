/**
 * Speech bubbles (P13): the phrase banks and the director.
 * - Data: every English bank has its French one, with enough lines (French at least 60% of
 *   English); every slot is one the director fills, gossip's numbers only in gossip and never
 *   typed (they come from the rules); voices fit who speaks; lines stay short enough for a
 *   phone; French typography (a space before ! ? : ;, made a narrow no-break space); every
 *   place and item a slot may name has its words in both languages.
 * - The director over two days of play (a model prisoner at Center Perks, a few friends
 *   among the inmates): never more bubbles than the screen allows, only from people on
 *   screen, no line again among the last 40, nor a speaker's last 6, at least 85% distinct in
 *   every 100 bubbles, gossip only from friends close by, and silence once a bank is spent.
 * Prints counts only (the snapshot pins them).
 */
import { PRISONS } from '../src/content/prisons';
import { ZONES, type ZoneId } from '../src/content/zones';
import { LOOT } from '../src/content/loot';
import { en } from '../src/i18n/en';
import { enBarks, type BankId } from '../src/i18n/barks/en';
import { frBarks } from '../src/i18n/barks/fr';
import { CHAT_ITEMS, itemPhrase, placePhrase, PUBLIC_PLACES } from '../src/i18n/barks/grammar';
import { Director, GLOBAL_MEMORY, SPEAKER_MEMORY, type Bubble, type Stage } from '../src/talk/director';
import { fill, SLOTS, slotsOf, typo } from '../src/talk/fill';
import { generatorsOf, switchPower } from '../src/sim/systems/power';
import { GOSSIP } from '../src/talk/gossip';
import { GUARD_VOICES, INMATE_VOICES, type Line, type LineDef } from '../src/talk/types';
import { UNIT } from '../src/sim/tuning';
import { LAYER } from '../src/sim/world/World';
import { Bot } from './bots';
import { check } from './assert';

const def = (l: Line): LineDef => (typeof l === 'string' ? { t: l } : l);
const banks = Object.keys(enBarks) as BankId[];

// ------------------------------------------------------------------ the banks
let enLines = 0;
let frLines = 0;
const GOSSIP_ONLY = new Set(['n', 'm', 't1', 't2', 'key']);
const capEn = 70;
const capFr = 84;
let longest = { en: 0, fr: 0 };
for (const b of banks) {
  const e = enBarks[b];
  const f = frBarks[b];
  check(!!f, `fr has bank ${b}`);
  if (!f) continue;
  enLines += e.length;
  frLines += f.length;
  const min = b.startsWith('catch.') ? 2 : b.startsWith('go.') ? 3 : 6;
  check(e.length >= min, `${b}: at least ${min} lines in English (${e.length})`);
  check(f.length >= Math.max(min, Math.ceil(e.length * 0.6)), `${b}: French has at least 60% of English's lines (${f.length} of ${e.length})`);
  const guardBank = b.startsWith('gu.') || b.endsWith('.gu') || b === 'sl.gu' || b === 'sl.doze';
  for (const [lang, lines] of [['en', e], ['fr', f]] as const) {
    for (const l of lines) {
      const d = def(l);
      for (const text of [d.t, d.r ?? '']) {
        if (!text) continue;
        for (const s of slotsOf(text)) {
          check(SLOTS.has(s), `${b} (${lang}): unknown slot {${s}} in "${text}"`);
          check(!GOSSIP_ONLY.has(s) || b.startsWith('go.'), `${b} (${lang}): {${s}} belongs to gossip ("${text}")`);
        }
        // Lines read on a phone: short (a name or a place counted at ten letters, a number at three, a time at five).
        const len = text.replace(/\{(\w+)[^}]*\}/g, (_, k: string) => (k === 'n' || k === 'm' ? '000' : k === 't1' || k === 't2' ? '00:00' : '0123456789')).length;
        longest[lang] = Math.max(longest[lang], len);
        check(len <= (lang === 'en' ? capEn : capFr), `${b} (${lang}): too long for a bubble (${len}): "${text}"`);
        if (b.startsWith('go.')) check(!/\d/.test(text.replace(/\{[^}]+\}/g, '')), `${b} (${lang}): gossip types no number of its own: "${text}"`);
        if (lang === 'fr') {
          check(!/[\p{L}\p{N}’»)]([!?;:])/u.test(text), `${b}: French puts a space before ! ? : ; ("${text}")`);
          check(!/ [!?;:»]/.test(typo('fr', text)), `${b}: typography leaves an ordinary space ("${text}")`);
        }
      }
      if (d.v) for (const v of d.v) check(guardBank ? (GUARD_VOICES as readonly string[]).includes(v) : (INMATE_VOICES as readonly string[]).includes(v), `${b}: voice ${v} fits who speaks`);
      check(!b.startsWith('ex.') || !!d.r, `${b}: an exchange line has its reply`);
    }
  }
}
console.log(`${banks.length} banks: ${enLines} lines in English, ${frLines} in French; longest ${longest.en} / ${longest.fr} characters`);

// Words for the slots: every place someone may stand in or name, every item a line may name.
const standing = ZONES.filter((z) => !['none', 'outside', 'tunnels', 'vents', 'roof'].includes(z)) as ZoneId[];
for (const lang of ['en', 'fr'] as const) {
  for (const z of standing) check(!!placePhrase(lang, z), `${lang}: words for ${z}`);
  for (const id of [...CHAT_ITEMS, ...LOOT.merchant.items.map(([i]) => i)]) for (const form of ['', 'a', 'the', 'my'] as const) check(!!itemPhrase(lang, id, form), `${lang}: words for ${form} ${id}`);
}
check(PUBLIC_PLACES.every((z) => standing.includes(z)), 'public places are places people stand in');
// The prisoner's file lists rumors by kind.
for (const k of GOSSIP) {
  check(`rumor.${k}` in en, `rumor.${k} has its line`);
  check(banks.includes(`go.${k}` as BankId), `go.${k} has its bank`);
}
console.log(`${standing.length} places and ${CHAT_ITEMS.length + LOOT.merchant.items.length} items with words; ${GOSSIP.length} kinds of gossip`);

// ------------------------------------------------------------------ the director at work
/** Two days at Center Perks as a model prisoner, the screen a box around the player. */
function run(prison = PRISONS[0], days = 2) {
  const bot = new Bot(prison, 5);
  const sim = bot.sim;
  // A few friends (gossip and friendly lines come from them).
  sim.state.inmates.forEach((m, k) => {
    if (k % 2 === 0) m.opinion = 70;
  });
  const d = new Director();
  d.reset(sim, 5);
  d.setLang('en');
  const said: Bubble[] = [];
  const problems: string[] = [];
  let peak = 0;
  const stage: Stage = {
    now: 0,
    max: 3,
    gap: 2.2,
    phone: false,
    partner: -1,
    sees: (id) => {
      const s = sim.state;
      if (s.layer !== LAYER.GROUND) return false;
      const b = id < s.inmates.length ? s.inmates[id].body : s.guards[id - s.inmates.length].body;
      return Math.abs(b.x - s.player.x) <= 11 * UNIT && Math.abs(b.z - s.player.z) <= 7 * UNIT;
    },
  };
  d.onSay = (b) => {
    said.push(b);
    if (!stage.sees(b.speaker)) problems.push(`off screen: ${b.text}`);
    if (b.style === 'gossip') {
      const m = sim.state.inmates[b.speaker];
      const far = Math.hypot(m.body.x - sim.state.player.x, m.body.z - sim.state.player.z) / UNIT;
      if (m.opinion < 55 || far > 3) problems.push(`gossip from a stranger: ${b.text}`);
    }
  };
  const end = sim.state.step + days * 1440 * 20;
  bot.keepRoutine(() => {
    const s = sim.state;
    stage.now = s.step / 20;
    for (const e of sim.events) d.react(e, sim, stage.now);
    if (!s.sleeping && s.ko <= 0 && s.solitary <= 0) d.tick(sim, stage);
    else d.quiet();
    // The screen's part: every bubble up is seen (gossip reaches the notebook then).
    for (const b of d.active) if (!b.shown) d.seen(b, sim);
    peak = Math.max(peak, d.active.length);
    return s.step >= end;
  }, end + 10);
  return { d, said, problems, peak, sim };
}

const { d, said, problems, peak } = run();
check(problems.length === 0, `bubbles keep the rules: ${problems.slice(0, 3).join(' / ')}`);
check(peak <= 3, `never more bubbles than the screen allows (${peak})`);
check(said.length >= 150, `people talk (${said.length} lines in two days)`);
// No line among the last 40 heard, nor among its speaker's last 6.
let globalRepeats = 0;
let speakerRepeats = 0;
const lastBy = new Map<number, number[]>();
said.forEach((b, i) => {
  const window = said.slice(Math.max(0, i - GLOBAL_MEMORY), i);
  if (window.some((o) => o.line === b.line)) globalRepeats++;
  const mine = lastBy.get(b.speaker) ?? [];
  if (mine.includes(b.line)) speakerRepeats++;
  mine.push(b.line);
  if (mine.length > SPEAKER_MEMORY) mine.shift();
  lastBy.set(b.speaker, mine);
});
check(speakerRepeats === 0, `nobody repeats one of their last ${SPEAKER_MEMORY} lines (${speakerRepeats})`);
check(globalRepeats <= Math.ceil(said.length * 0.02), `lines heard again among the last ${GLOBAL_MEMORY}: ${globalRepeats} (at most 2%, only when nothing fresh is left)`);
// Varied, everywhere along the way.
let worst = 1;
for (let i = 0; i + 100 <= said.length; i += 20) worst = Math.min(worst, new Set(said.slice(i, i + 100).map((b) => b.line)).size / 100);
check(worst >= 0.85, `at least 85% distinct in every 100 bubbles (worst ${Math.round(worst * 100)}%)`);
const styles = new Map<string, number>();
for (const b of said) styles.set(b.style, (styles.get(b.style) ?? 0) + 1);
const kinds = new Set(said.map((b) => b.bank.split('.')[0]));
console.log(`two days: ${said.length} lines (${d.stats.distinct.size} distinct), worst 100 ${Math.round(worst * 100)}% distinct, ${globalRepeats} heard again, at most ${peak} at once`);
const byBank = new Map<string, number>();
for (const b of said) byBank.set(b.bank, (byBank.get(b.bank) ?? 0) + 1);
if (process.env.BANKS) console.error([...byBank].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('\n'));
console.log(`styles: ${[...styles].sort().map(([k, n]) => `${k} ${n}`).join(', ')}; kinds: ${[...kinds].sort().join(', ')}; rumors ${d.rumors.length}`);

// Silence beats repetition: a speaker who has said every line of a bank has nothing more.
{
  const bot = new Bot(PRISONS[0], 1);
  const dd = new Director();
  dd.reset(bot.sim, 1);
  const st: Stage = { now: 0, max: 99, gap: 1, phone: false, partner: -1, sees: () => true };
  const guard = bot.sim.state.inmates.length;
  const bank: BankId = 'gu.bedCheck';
  const lines = enBarks[bank].length;
  let spoke = 0;
  for (let k = 0; k <= lines; k++) if ((dd as unknown as { say: (...a: unknown[]) => unknown }).say(bot.sim, st, guard, bank, 'say')) spoke++;
  check(spoke === Math.min(lines, SPEAKER_MEMORY) && dd.stats.silent >= 1, `a spent bank leaves its speaker silent (${spoke} said, ${dd.stats.silent} silent)`);
  console.log(`a spent bank: ${spoke} lines said, then silence`);
}

// French: a day of it, every line filled and set with French typography.
{
  const prison = PRISONS[0];
  const bot = new Bot(prison, 9);
  const dd = new Director();
  dd.reset(bot.sim, 9);
  dd.setLang('fr');
  const out: string[] = [];
  dd.onSay = (b) => out.push(b.text);
  const st: Stage = { now: 0, max: 3, gap: 2.2, phone: true, partner: -1, sees: () => true };
  const end = 1440 * 20;
  bot.keepRoutine(() => {
    st.now = bot.sim.state.step / 20;
    for (const e of bot.sim.events) dd.react(e, bot.sim, st.now);
    if (!bot.sim.state.sleeping) dd.tick(bot.sim, st);
    for (const b of dd.active) if (!b.shown) dd.seen(b, bot.sim);
    return bot.sim.state.step >= end;
  }, end + 10);
  const bad = out.filter((s) => /\{|\}| [!?;:»]/.test(s));
  check(bad.length === 0, `French lines come out filled and typeset (${bad.slice(0, 2).join(' / ')})`);
  console.log(`a day in French: ${out.length} lines`);
}

// An exchange's reply names the same guard, meal or event as the line it answers.
{
  const bot = new Bot(PRISONS[0], 2);
  const ctx = { lang: 'en' as const, sim: bot.sim, speaker: 0, random: () => 0.99, recent: new Map<string, string[]>(), dayEvent: null };
  const slots = new Map<string, string>();
  const a = fill('I think {guard} likes me.', ctx, slots);
  const b = fill('{guard} likes nobody.', { ...ctx, speaker: 1 }, slots);
  check(!!a && !!b && a.split(' ')[2] === b.split(' ')[0], `a reply names the same guard (${a} / ${b})`);
}
// A merchant holding a grudge greets coldly, shop or not.
{
  const bot = new Bot(PRISONS[0], 2);
  const sim = bot.sim;
  const who = sim.state.inmates.findIndex((m) => sim.prison.merchants.includes(m.cell));
  sim.state.inmates[who].opinion = 10;
  const dd = new Director();
  dd.reset(sim, 2);
  const low = new Set(enBarks['gr.in.low'].map((l) => (typeof l === 'string' ? l : l.t)));
  const said = dd.greeting(sim, who);
  check(low.has(said), `a merchant with a grudge greets coldly ("${said}")`);
}
// Irongate: the first generator runs the detectors and cameras only: no blackout talk.
{
  const prison = PRISONS.find((p) => p.id === 'irongate')!;
  const bot = new Bot(prison, 2);
  const sim = bot.sim;
  const dd = new Director();
  dd.reset(sim, 2);
  switchPower(sim, generatorsOf(sim.world)[0]);
  for (const e of sim.events) dd.react(e, sim, 0);
  const waiting = (dd as unknown as { queue: Array<{ bank: string }> }).queue.map((p) => p.bank);
  check(!waiting.some((b) => b.startsWith('re.power')), `GEN-1 off at Irongate: nobody talks of a blackout (${waiting.join(', ') || 'quiet'})`);
  console.log('greetings, replies and Irongate\'s generators checked');
}
