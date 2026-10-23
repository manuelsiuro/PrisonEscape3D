import { PINS } from '../../content/games';
import { KEY_ITEM_COLORS, itemDef, itemNumber } from '../../content/items';
import { MEDALS } from '../../content/medals';
import { RECIPES } from '../../content/recipes';
import { ROUTINE } from '../../content/routine';
import { openPrisons } from '../../game/campaign';
import { en } from '../../i18n/en';
import { t, type Key } from '../../i18n';
import { withKeys } from '../../i18n/keys';
import { itemIcons } from '../../render/itemIcons';
import { TOUCH, h } from '../dom';
import { icon } from '../icons';
import { HELP, POCKET_SAMPLE, topicById, type HelpTab, type HelpTopic } from './helpTopics';
import { medalDisc } from './trophies';

/**
 * How to play (GDD §13; laid out again in P37): each tab a grid of tiles in groups, a search
 * over every topic, and a page for each topic (its picture or diagram, a summary, steps, key
 * numbers, recipes, a tip and a warning, the fine print folded, its lessons); then the controls
 * of this device (keys or touch, with the other a tab away). Opened from the title, the pause
 * card and H. Resolves when closed: with a lesson to play when one was picked (offered only
 * where `lessons` is set, the title's: in a game it would end the game).
 */
const TABS: HelpTab[] = ['basics', 'life', 'escape', 'controls'];

/** The keys, in groups (read when shown: the language and the keyboard's labels may change). */
const keys = (): Array<[string, Array<[string, Key]>]> => [
  ['move', [['%KeyW% %KeyA% %KeyS% %KeyD%', 'help.k.walk'], [t('help.k.clickKey'), 'help.k.click']]],
  [
    'do',
    [
      ['%KeyE%', 'help.k.act'],
      [t('help.k.space'), 'help.k.use'],
      ['%KeyR%', 'help.k.lock'],
      ['1 – 6', 'help.k.slots'],
      ['%KeyQ%', 'help.k.drop'],
      [t('help.k.rightMouse'), 'help.k.throw'],
      ['%KeyF%', 'help.k.throwAhead'],
      ['%KeyU%', 'help.k.digUp'],
      ['1 – 3', 'help.k.call'],
    ],
  ],
  [
    'panels',
    [
      ['%KeyC%', 'help.k.craft'],
      ['%KeyI%', 'help.k.file'],
      ['%KeyJ%', 'help.k.day'],
      ['%KeyT%', 'help.k.rat'],
      ['%KeyP%', 'help.k.phone'],
      ['%KeyG%', 'help.k.crew'],
      ['%KeyO%', 'help.k.objectives'],
      ['%KeyH%', 'help.k.help'],
      [t('help.k.esc'), 'help.k.pause'],
    ],
  ],
  [
    'games',
    [
      ['1 – 5 · Enter · %KeyL%', 'help.k.cheat'],
      [t('help.k.space'), 'help.k.shoot'],
      [t('help.k.space'), 'help.k.kick'],
      ['%KeyA% %KeyS% %KeyD%', 'help.k.lanes'],
      ['1 – 4', 'help.k.answer'],
    ],
  ],
];

/** The touch controls, in groups: each the HUD's own icon for it. */
const TOUCHES: Array<[string, Array<[string, Key]>]> = [
  ['move', [['walk', 'help.t.stick'], ['pin', 'help.t.tap']]],
  [
    'do',
    [
      ['hand', 'help.t.act'],
      ['pick', 'help.t.use'],
      ['target', 'help.t.lock'],
      ['hammer', 'help.t.slots'],
      ['toss', 'help.t.throw'],
      ['up', 'help.t.digUp'],
    ],
  ],
  [
    'panels',
    [
      ['coin', 'help.t.file'],
      ['clock', 'help.t.day'],
      ['rat', 'help.t.rat'],
      ['phone', 'help.t.phone'],
      ['users', 'help.t.crew'],
      ['bulb', 'help.t.objectives'],
      ['pause', 'help.t.pause'],
    ],
  ],
  ['games', [['ball', 'help.t.kick'], ['music', 'help.t.lanes'], ['brain', 'help.t.answer']]],
];

// ------------------------------------------------------------ words

const has = (k: string) => k in en;
/** A topic's text by its part ('' when it has none). */
const part = (id: string, p: string) => (has(`help.${id}.${p}`) ? t(`help.${id}.${p}` as Key) : '');
const lines = (s: string) => (s ? s.split('\n').filter(Boolean) : []);
/** "value|what" lines. */
const pairs = (s: string) => lines(s).map((l) => l.split('|') as [string, string]);
/** In the new shape (a summary and its parts), or still one paragraph. */
const shaped = (id: string) => has(`help.${id}.sum`);
const title = (id: string) => t(`help.${id}.t` as Key);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Shown here: a prison's own rules once that prison is open. */
const open = (tp: HelpTopic) => !tp.prison || openPrisons().some((p) => p.id === tp.prison);

/** Every word a topic says, for the search (lower case, accents off). */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');
const SEARCHED = ['hook', 'sum', 'sh', 'steps', 'lh', 'list', 'lh2', 'list2', 'nums', 'tip', 'warn', 'more', 'dh', 'meter', 'tl', 'bars'];
const words = (id: string) => fold([title(id), ...SEARCHED.map((p) => part(id, p)), shaped(id) ? '' : t(`help.${id}` as Key)].join(' ')).split(/[^a-z0-9]+/);
/** A word searched for, said whole by a topic (or its plural: "tunnel", "tunnels"). */
const whole = (w: readonly string[], x: string) => w.some((y) => y === x || y === `${x}s` || y === `${x}x` || y === `${x}es`);
/**
 * A topic found: each word searched for is one of its words — whole, when some topic shown says it
 * whole ("lou" is Lou, not "loud"), else the start of one (a word still being typed: "tun").
 */
const found = (w: readonly string[], q: readonly string[], exact: readonly boolean[]) => q.every((x, k) => (exact[k] ? whole(w, x) : w.some((y) => y.startsWith(x))));

// ------------------------------------------------------------ pieces

const tone = (tp: HelpTopic) => `--tone:${tp.tone}`;
const badge = (tp: HelpTopic, size = 22) => `<span class="help-ic" style="${tone(tp)}">${icon(tp.icon, size)}</span>`;
const itemImg = (id: string, cls = '') => `<img class="hd-item ${cls}" src="${itemIcons()[itemNumber(id)]}" alt="" draggable="false">`;
/** An icon for a line: an item's picture or a UI icon. */
const lineIcon = (name: string | undefined) =>
  !name
    ? ''
    : name.startsWith('item:')
      ? `<span class="hd-li-ic item">${itemImg(name.slice(5))}</span>`
      : name.startsWith('dot:')
        ? `<span class="hd-li-ic dot"><i style="background:${name.slice(4)}"></i></span>`
        : `<span class="hd-li-ic">${icon(name, 16)}</span>`;

function tile(tp: HelpTopic) {
  const hook = part(tp.id, 'hook');
  return `<button class="help-tile" data-topic="${tp.id}" style="${tone(tp)}">${badge(tp, 20)}<span class="ht-text"><b>${title(tp.id)}</b>${hook ? `<small>${hook}</small>` : ''}</span></button>`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The day, block by block: when, what, where, and what missing it costs. */
function schedule() {
  const rows = ROUTINE.map((r) => {
    const miss =
      r.miss === 'lockdown'
        ? `<em class="must lock">${t('help.mustLockdown')}</em>`
        : r.miss === 'heat'
          ? `<em class="must">${t('help.mustHeat')}</em>`
          : r.id === 'work'
            ? `<em class="must job">${t('help.mustJob')}</em>`
            : r.id === 'lightsOut'
              ? `<em class="must lock">${t('help.mustCell')}</em>`
              : '';
    return `<li><time>${pad(r.start / 60)}:00</time><span>${t(`routine.${r.id}` as Key)}</span>${miss}</li>`;
  }).join('');
  return `<h4 class="hd-h">${icon('clock', 15)}${t('help.schedule')}</h4><ol class="help-day">${rows}</ol>`;
}

/** A meter (the heat): its marks along a bar, what each means beneath. */
function meter(id: string) {
  const marks = pairs(part(id, 'meter'));
  const ticks = marks.map(([n]) => `<i style="left:${parseInt(n, 10)}%"><span>${n}</span></i>`).join('');
  const legend = marks.map(([n, what], k) => `<li><b class="hd-mark m${k}">${n}</b><span>${what}</span></li>`).join('');
  return `<div class="hd-meter"><div class="hd-bar">${ticks}</div></div><ul class="hd-legend">${legend}</ul>`;
}

/** A timeline: the hours down the side, what happens at each. */
function timeline(id: string) {
  return `<ol class="hd-tl">${pairs(part(id, 'tl'))
    .map(([at, what]) => `<li><time>${at}</time><span>${what}</span></li>`)
    .join('')}</ol>`;
}

/** Distances in tiles: a row of tiles for each. */
function bars(id: string) {
  return `<ul class="hd-bars">${pairs(part(id, 'bars'))
    .map(([n, what]) => `<li><span class="hd-bars-what">${what}</span><span class="hd-tiles">${'<i></i>'.repeat(parseInt(n, 10))}<b>${t('help.tiles', { n })}</b></span></li>`)
    .join('')}</ul>`;
}

/** The pockets as the HUD has them: six, then the weapon and the outfit (one thing in them is contraband). */
function pockets() {
  const slot = (item: string) => `<span class="hd-slot">${item ? itemImg(item) : ''}${item && itemDef(itemNumber(item)).contraband ? '<i class="slot-cb"></i>' : ''}</span>`;
  const { pockets: six, weapon, outfit } = POCKET_SAMPLE;
  return `<div class="hd-pockets">
    <div class="hd-pk-group">${six.map(slot).join('')}<small>${t('help.pk.pockets')}</small></div>
    <div class="hd-pk-group">${slot(weapon)}<small>${t('help.pk.weapon')}</small></div>
    <div class="hd-pk-group">${slot(outfit)}<small>${t('help.pk.outfit')}</small></div>
  </div>`;
}

/** A keyed door's pins, by its colour. */
function pins() {
  return `<ul class="hd-pins">${KEY_ITEM_COLORS.map(([c], k) => `<li aria-label="${esc(`${t(`item.key_${c}` as Key)}: ${t('help.pins', { n: PINS[k + 1] })}`)}">${itemImg(`key_${c}`)}<span aria-hidden="true">${'<i></i>'.repeat(PINS[k + 1])}</span><b aria-hidden="true">${PINS[k + 1]}</b></li>`).join('')}</ul>`;
}

function medals() {
  return `<div class="hd-medals">${MEDALS.map((m) => `<span>${medalDisc(m, 40)}<small>${t(`medal.${m}` as Key)}</small></span>`).join('')}</div>`;
}

function diagram(tp: HelpTopic) {
  switch (tp.diagram) {
    case 'schedule':
      return schedule();
    case 'meter':
      return meter(tp.id);
    case 'timeline':
      return timeline(tp.id);
    case 'bars':
      return bars(tp.id);
    case 'pockets':
      return pockets();
    case 'pins':
      return pins();
    case 'medals':
      return medals();
    default:
      return '';
  }
}

/** A recipe from the handbook: its ingredients, what they make, the Intellect it needs. */
function recipe(result: string) {
  const r = RECIPES.find((x) => x.result === result);
  if (!r) return '';
  const ing = r.ingredients
    .map((a) => {
      const alts = a.split('|');
      const names = esc(alts.map((x) => t(`item.${x}` as Key)).join(' / '));
      return `<span class="hd-ing" title="${names}" role="img" aria-label="${names}">${itemImg(alts[0])}${alts.length > 1 ? `<i class="hd-alt" aria-hidden="true">+${alts.length - 1}</i>` : ''}</span>`;
    })
    .join('<i class="hd-plus">+</i>');
  return `<li class="hd-recipe">${ing}<i class="hd-arrow">${icon('chevronRight', 14)}</i><span class="hd-ing out">${itemImg(r.result)}</span><span class="hd-rname"><b>${t(`item.${r.result}` as Key)}</b><small>${t('help.int', { n: r.int })}</small></span></li>`;
}

function picture(tp: HelpTopic) {
  if (tp.pic) return `<figure class="hd-pic"${tp.picAt ? ` style="--pic-at:${tp.picAt}"` : ''}><img src="./help/${tp.id}.webp" alt="" width="1040" height="480" decoding="async"></figure>`;
  return '';
}

/** Its steps (numbered) or a list (`list`, and a second one, `list2`), each with its heading. */
function list(id: string, p: 'steps' | 'list' | 'list2', icons: readonly string[] | undefined) {
  const items = lines(part(id, p));
  if (!items.length) return '';
  const head = part(id, p === 'steps' ? 'sh' : p === 'list' ? 'lh' : 'lh2') || (p === 'steps' ? t('help.how') : '');
  const tag = p === 'steps' ? 'ol' : 'ul';
  const cls = p === 'steps' ? 'hd-steps' : 'hd-list';
  return `${head ? `<h4 class="hd-h">${head}</h4>` : ''}<${tag} class="${cls}${icons ? ' iconed' : ''}">${items.map((s, k) => `<li>${icons ? lineIcon(icons[k]) : ''}<span>${s}</span></li>`).join('')}</${tag}>`;
}

function callout(id: string, p: 'tip' | 'warn') {
  const items = lines(part(id, p));
  if (!items.length) return '';
  const body = items.length === 1 ? `<p>${items[0]}</p>` : `<ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul>`;
  return `<aside class="hd-call ${p}"><span class="hd-call-ic">${icon(p === 'tip' ? 'bulb' : 'siren', 16)}</span><div><b>${t(p === 'tip' ? 'help.tipTitle' : 'help.warnTitle')}</b>${body}</div></aside>`;
}

/** Its lessons: Play buttons (from the title), else where to find them in the Tutorial. */
function lessonsOf(tp: HelpTopic, playable: boolean) {
  if (!tp.lessons?.length) return '';
  return playable
    ? `<div class="hd-lessons">${tp.lessons.map((l) => `<button class="big-btn primary small" data-lesson="${l}">${icon('play', 16)}<span>${t('help.playLesson', { name: t(`lesson.${l}.t` as Key) })}</span></button>`).join('')}</div>`
    : `<p class="hd-lesson-note">${icon('book', 14)}${t('help.inTutorial', { names: tp.lessons.map((l) => t(`lesson.${l}.t` as Key)).join(' · ') })}</p>`;
}

/** A topic's page. */
function page(tp: HelpTopic, lessons: boolean, seq: readonly HelpTopic[]) {
  const id = tp.id;
  const head = `<header class="hd-head"><button class="icon-btn hd-back" data-back aria-label="${t('common.back')}">${icon('chevronLeft')}</button>${badge(tp)}<h3>${title(id)}</h3></header>`;
  const learn = lessonsOf(tp, lessons);
  if (!shaped(id)) return `${head}<div class="hd-page"><p class="hd-plain">${t(`help.${id}` as Key)}</p>${learn}${nav(tp, seq)}</div>`;
  const nums = pairs(part(id, 'nums'));
  const chips = nums.length ? `<ul class="hd-nums">${nums.map(([v, what]) => `<li><b>${v}</b><span>${what}</span></li>`).join('')}</ul>` : '';
  const recipes = tp.recipes?.length ? `<h4 class="hd-h">${icon('hammer', 15)}${t(tp.recipes.length > 1 ? 'help.recipes' : 'help.recipe')}</h4><ul class="hd-recipes">${tp.recipes.map(recipe).join('')}</ul>` : '';
  const see = tp.see?.length
    ? `<h4 class="hd-h">${t('help.seeAlso')}</h4><div class="hd-see">${tp.see
        .map(topicById)
        .filter((x): x is NonNullable<typeof x> => !!x && open(x))
        .map((x) => `<button class="hd-link" data-topic="${x.id}" style="${tone(x)}">${badge(x, 16)}<span>${title(x.id)}</span>${icon('chevronRight', 14)}</button>`)
        .join('')}</div>`
    : '';
  const more = lines(part(id, 'more'));
  const fine = more.length ? `<details class="hd-more"><summary>${icon('chevronRight', 14)}${t('help.more')}</summary><ul>${more.map((s) => `<li>${s}</li>`).join('')}</ul></details>` : '';
  return `${head}<div class="hd-page">
    ${picture(tp)}
    <p class="hd-sum">${part(id, 'sum')}</p>
    ${chips}
    ${tp.diagram && part(id, 'dh') ? `<h4 class="hd-h">${part(id, 'dh')}</h4>` : ''}${diagram(tp)}
    ${list(id, 'steps', tp.stepIcons)}
    ${list(id, 'list', tp.listIcons)}
    ${list(id, 'list2', tp.list2Icons)}
    ${recipes}
    ${callout(id, 'tip')}
    ${callout(id, 'warn')}
    ${see}
    ${fine}
    ${learn}
    ${nav(tp, seq)}
  </div>`;
}

/** The topics either side of this one in its tab. */
function nav(tp: HelpTopic, seq: readonly HelpTopic[]) {
  const k = seq.findIndex((x) => x.id === tp.id);
  const prev = seq[k - 1];
  const next = seq[k + 1];
  const b = (x: HelpTopic | undefined, dir: 'prev' | 'next') =>
    x ? `<button class="hd-nav-btn ${dir}" data-topic="${x.id}">${dir === 'prev' ? icon('chevronLeft', 16) : ''}<span><small>${t(dir === 'prev' ? 'help.prev' : 'help.next')}</small><b>${title(x.id)}</b></span>${dir === 'next' ? icon('chevronRight', 16) : ''}</button>` : '<span></span>';
  return `<nav class="hd-nav">${b(prev, 'prev')}${b(next, 'next')}</nav>`;
}

/** A tab's topics, shown (in order). */
const shown = (tab: Exclude<HelpTab, 'controls'>) => HELP[tab].flatMap((g) => g.topics.filter(open));

function index(tab: Exclude<HelpTab, 'controls'>, query: string) {
  const q = fold(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (q.length) {
    const pool = TABS.filter((x): x is Exclude<HelpTab, 'controls'> => x !== 'controls')
      .flatMap(shown)
      .map((tp) => ({ tp, w: words(tp.id) }));
    const exact = q.map((x) => pool.some((p) => whole(p.w, x)));
    const hits = pool.filter((p) => found(p.w, q, exact)).map((p) => p.tp);
    return hits.length ? `<h4 class="help-group">${t('help.results', { n: hits.length })}</h4><div class="help-tiles">${hits.map(tile).join('')}</div>` : `<p class="hd-none">${t('help.noResults')}</p>`;
  }
  return HELP[tab]
    .map((g) => {
      const tiles = g.topics.filter(open);
      return tiles.length ? `<h4 class="help-group">${t(`help.group.${g.id}` as Key)}</h4><div class="help-tiles">${tiles.map(tile).join('')}</div>` : '';
    })
    .join('');
}

function controls(touch: boolean) {
  const which = `<div class="seg help-device" role="radiogroup">${(['keys', 'touch'] as const)
    .map((d) => `<button role="radio" data-device="${d}" class="${(d === 'touch') === touch ? 'on' : ''}" aria-checked="${(d === 'touch') === touch}">${icon(d === 'keys' ? 'keyboard' : 'hand', 15)}${t(`help.device.${d}`)}</button>`)
    .join('')}</div>`;
  const groups = touch
    ? TOUCHES.map(([g, rows]) => [g, rows.map(([ic, k]) => `<li><span class="help-btn">${icon(ic, 18)}</span><span>${t(k)}</span></li>`).join('')] as const)
    : keys().map(([g, rows]) => [g, rows.map(([label, k]) => `<li><kbd>${withKeys(label)}</kbd><span>${t(k)}</span></li>`).join('')] as const);
  const body = groups.map(([g, items]) => `<h4 class="help-group">${t(`help.cg.${g}` as Key)}</h4><ul class="help-keys">${items}</ul>`).join('');
  return `${which}${body}<p class="help-foot">${t(touch ? 'help.t.zoom' : 'help.k.zoom')}</p>`;
}

export interface HelpOptions {
  /** The tab to open on. */
  tab?: HelpTab;
  /** A topic to open on. */
  topic?: string;
  /** Lessons can be played from here (the title: Play the lesson resolves with its id). */
  lessons?: boolean;
}

/** How to play. Resolves with a lesson picked to play (and the topic it was picked on), else null. */
export function showHelp(click: () => void, opts: HelpOptions = {}): Promise<{ lesson: string; topic: string } | null> {
  let tab: HelpTab = opts.tab ?? (opts.topic ? (topicById(opts.topic)?.tab ?? 'basics') : 'basics');
  let topic: string | null = opts.topic && topicById(opts.topic) ? opts.topic : null;
  let query = '';
  let touch = TOUCH;
  const el = h(
    'div',
    'modal help-modal',
    `<div class="card help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="settings-head"><h2 id="help-title">${t('help.title')}</h2><button class="icon-btn" data-done aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="seg help-tabs" role="tablist">${TABS.map((k) => `<button role="tab" data-tab="${k}">${t(`help.tab.${k}` as Key)}</button>`).join('')}</div>
      <label class="help-search">${icon('search', 16)}<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('help.search'))}" aria-label="${esc(t('help.search'))}"></label>
      <div class="help-body" role="tabpanel" tabindex="-1"></div>
    </div>`,
  );
  const pane = el.querySelector<HTMLElement>('.help-body')!;
  const search = el.querySelector<HTMLInputElement>('.help-search input')!;
  /** Where each tab's index was scrolled to (back from a topic, it's there again). */
  const indexScroll: Partial<Record<HelpTab, number>> = {};
  const show = (keepScroll = false) => {
    for (const b of el.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    el.classList.toggle('on-topic', !!topic);
    el.classList.toggle('on-controls', tab === 'controls' && !topic);
    const tp = topic ? topicById(topic) : undefined;
    if (tp) pane.innerHTML = page(tp, !!opts.lessons, shown(tp.tab));
    else pane.innerHTML = tab === 'controls' ? controls(touch) : index(tab, query);
    pane.scrollTop = keepScroll && !topic ? (indexScroll[tab] ?? 0) : 0;
  };
  const openTopic = (id: string) => {
    if (!topic && !query) indexScroll[tab] = pane.scrollTop;
    const tp = topicById(id);
    if (!tp) return;
    topic = id;
    tab = tp.tab;
    show();
    pane.focus();
  };
  const back = () => {
    const left = topic;
    topic = null;
    show(true);
    // (Focus on the tile of the topic just left, as the back button is gone.)
    (pane.querySelector<HTMLElement>(`[data-topic="${left}"]`) ?? pane).focus();
  };
  show();
  return new Promise((resolve) => {
    const done = (lesson: string | null = null) => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(lesson && topic ? { lesson, topic } : null);
    };
    const key = (e: KeyboardEvent) => {
      const typing = e.target === search;
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        // A topic goes back to its tab; a search is cleared; else close.
        if (topic) {
          click();
          return back();
        }
        if (query) {
          search.value = query = '';
          return show();
        }
        return done();
      }
      if (typing) {
        // (Letters typed are the search's, not the game's.)
        e.stopImmediatePropagation();
        return;
      }
      if (e.code === 'KeyH') {
        e.stopImmediatePropagation();
        done();
      }
      if (e.code === 'Backspace' && topic) {
        e.stopImmediatePropagation();
        click();
        back();
      }
      // Left and right: the topics either side on a topic's page, else the tabs.
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.stopImmediatePropagation();
        const d = e.code === 'ArrowLeft' ? -1 : 1;
        if (topic) {
          const tp = topicById(topic)!;
          const seq = shown(tp.tab);
          const next = seq[seq.findIndex((x) => x.id === topic) + d];
          if (next) {
            click();
            openTopic(next.id);
          }
          return;
        }
        tab = TABS[(TABS.indexOf(tab) + (d < 0 ? TABS.length - 1 : 1)) % TABS.length];
        click();
        show();
      }
    };
    addEventListener('keydown', key, true);
    search.oninput = () => {
      query = search.value;
      topic = null;
      show();
    };
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as HelpTab | undefined;
      if (k && (k !== tab || topic || query)) {
        click();
        tab = k;
        topic = null;
        search.value = query = '';
        return show(true);
      }
      const to = target.closest<HTMLElement>('[data-topic]')?.dataset.topic;
      if (to) {
        click();
        return openTopic(to);
      }
      if (target.closest('[data-back]')) {
        click();
        return back();
      }
      const lesson = target.closest<HTMLElement>('[data-lesson]')?.dataset.lesson;
      if (lesson) return done(lesson);
      const d = target.closest<HTMLElement>('[data-device]')?.dataset.device;
      if (d && (d === 'touch') !== touch) {
        click();
        touch = d === 'touch';
        return show();
      }
      if (target.closest('[data-done]') || target === el) done();
    };
    document.body.append(el);
    pane.focus();
  });
}
