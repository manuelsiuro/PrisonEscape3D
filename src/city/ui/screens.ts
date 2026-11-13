import { t, type Key } from '../../i18n';
import { keyCode } from '../../input/bindings';
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { CITY_N, CITY_W, gateOpen, LANES, laneAt, neighbour, ROAD_W, SIDE } from '../gen/plan';
import { FLAG, NOTES, THINGS, WAYS, thingBit } from '../content/story';
import type { City } from '../sim/City';
import { MODE } from '../sim/City';
import { errandOf, objectives, wants } from '../sim/story';
import { cityItemNumber } from '../content/items';
import { PEOPLE } from '../content/people';
import { CITY_RECIPES } from '../content/recipes';
import { FEATS, readRecord, type Feat } from '../record';
import { itemName } from './pockets';
import { LANDMARKS, paintDistrict, useColour } from './mapPaint';
import { mapXY, objectiveText } from './story';

/** A screen over the game: shown until one of its `[data-c]` buttons is pressed (Escape: `esc`). */
function modal<T extends string>(html: string, esc: T, focus: string, setup?: (el: HTMLElement) => void): Promise<T> {
  const el = h('div', 'modal', html);
  setup?.(el);
  return new Promise((resolve) => {
    const done = (c: T) => {
      removeEventListener('keydown', key);
      el.remove();
      resolve(c);
    };
    const key = (e: KeyboardEvent) => {
      const code = keyCode(e.code);
      if (e.code === 'Escape' || (esc === 'close' && (code === 'KeyM' || code === 'KeyJ') && !e.repeat)) done(esc);
    };
    addEventListener('keydown', key);
    el.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
      if (btn?.dataset.pick) {
        for (const b of el.querySelectorAll('[data-pick]')) b.setAttribute('aria-pressed', String(b === btn));
        return;
      }
      if (btn) done(btn.dataset.c as T);
      else if (e.target === el) done(esc);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>(focus)?.focus();
  });
}

/** A new city: what it is, and how death is taken (chosen once). Null: not now. */
export async function showNewCity(click: () => void): Promise<number | null> {
  let mode: number = MODE.SURVIVOR;
  const choice = await modal<'start' | 'back' | 'feats'>(
    `<div class="card city-new">
      <h2>${icon('map', 20)}${t('city.title')}</h2>
      <p class="card-note">${t('city.new.about')}</p>
      <div class="city-modes" role="group" aria-label="${t('city.new.mode')}">
        <button class="city-mode" data-c="mode" data-pick="${MODE.SURVIVOR}" aria-pressed="true">${icon('heart', 20)}<b>${t('city.mode.survivor')}</b><small>${t('city.mode.survivorSub')}</small></button>
        <button class="city-mode" data-c="mode" data-pick="${MODE.HARDCORE}" aria-pressed="false">${icon('flame', 20)}<b>${t('city.mode.hardcore')}</b><small>${t('city.mode.hardcoreSub')}</small></button>
      </div>
      <p class="card-note city-preview">${icon('wrench', 14)}${t('city.preview')}</p>
      <div class="actions">
        <button class="big-btn ghost" data-c="back">${icon('chevronLeft', 18)}${t('city.new.back')}</button>
        <button class="big-btn ghost" data-c="feats">${icon('trophy', 18)}${t('city.feats.title')}</button>
        <button class="big-btn primary" data-c="start">${icon('play', 18)}${t('city.new.start')}</button>
      </div>
    </div>`,
    'back',
    '[data-c="start"]',
    (el) =>
      el.addEventListener('click', (e) => {
        const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
        if (pick !== undefined) {
          click();
          mode = Number(pick);
        }
      }),
  );
  click();
  if (choice === 'feats') {
    await showCityFeats(click);
    return showNewCity(click);
  }
  return choice === 'start' ? mode : null;
}

/** City Escape's own menu, a city in progress: carry on, a new one, or back. */
export async function showCityMenu(where: string, click: () => void): Promise<'continue' | 'new' | 'back'> {
  const el = `<div class="card city-new">
      <h2>${icon('map', 20)}${t('city.title')}</h2>
      <p class="card-note">${t('city.tagline')}</p>
      <div class="city-menu">
        <button class="hero-card play-card" data-c="continue"><span class="hero-ic">${icon('play', 22)}</span><span class="hero-text"><b>${t('title.continue')}</b><small></small></span></button>
        <button class="menu-btn" data-c="new" style="--tone:var(--orange);--tone-2:var(--orange-2)"><span class="menu-ic">${icon('replay', 18)}</span><span class="menu-text"><span class="menu-label">${t('city.new.title')}</span></span>${icon('chevronRight', 16)}</button>
      </div>
      <div class="actions"><button class="big-btn ghost" data-c="back">${icon('chevronLeft', 18)}${t('city.new.back')}</button><button class="big-btn ghost" data-c="feats">${icon('trophy', 18)}${t('city.feats.title')}</button></div>
    </div>`;
  const choice = await modal<'continue' | 'new' | 'back' | 'feats'>(el, 'back', '[data-c="continue"]', (m) => {
    m.querySelector('.hero-text small')!.textContent = where;
  });
  click();
  if (choice === 'feats') {
    await showCityFeats(click);
    return showCityMenu(where, click);
  }
  return choice;
}

/** The story so far, before the first steps. */
export async function showCityIntro(click: () => void): Promise<void> {
  await modal<'go'>(
    `<div class="card city-intro">
      <h2>${t('city.intro.title')}</h2>
      <p>${t('city.intro.one')}</p>
      <p>${t('city.intro.two')}</p>
      <p>${t('city.intro.three')}</p>
      <div class="actions"><button class="big-btn primary" data-c="go">${icon('walk', 18)}${t('city.intro.go')}</button></div>
    </div>`,
    'go',
    '[data-c="go"]',
  );
  click();
}

/** Hardcore: the city is lost. */
export async function showCityOver(day: number, where: string, click: () => void): Promise<void> {
  await modal<'back'>(
    `<div class="card city-intro city-over">
      <h2>${t('city.over.title')}</h2>
      <p class="city-over-line"></p>
      <p>${t('city.over.text')}</p>
      <div class="actions"><button class="big-btn primary" data-c="back">${icon('home', 18)}${t('pause.quit')}</button></div>
    </div>`,
    'back',
    '[data-c="back"]',
    (el) => {
      el.querySelector('.city-over-line')!.textContent = t('city.over.line', { n: day, where });
    },
  );
  click();
}

/** A tile's size on the city's map (CSS pixels are the canvas's own: it's scaled to fit). */
const GAP = 4;

/**
 * The city's map: the nine districts as seen so far (a district never entered is dark, its name
 * unknown), the streets that cross between them, the walls where none does, the sea, and the player.
 */
export async function showCityMap(city: City, click: () => void): Promise<void> {
  const plan = city.plan;
  const size = CITY_W * MAP_W + (CITY_W + 1) * GAP;
  const names = Array.from({ length: CITY_N }, (_, d) => {
    const been = ((city.state.visited >> d) & 1) === 1;
    const here = d === city.state.district;
    const pct = Math.round(city.seenShare(d) * 100);
    return `<li class="${here ? 'here' : ''}${been ? '' : ' unknown'}">${
      been
        ? `<b>${plan.names[d]}</b><small>${t(`city.kind.${plan.kinds[d]}` as Key)} · ${t('city.map.seen', { n: pct })}</small>`
        : `<b>${t('city.map.unknown')}</b><small>&nbsp;</small>`
    }</li>`;
  }).join('');
  const legend = LANDMARKS.map((u) => `<li><i style="background:${useColour(u)}"></i>${t(`city.use.${u}` as Key)}</li>`).join('');
  await modal<'close'>(
    `<div class="card city-map">
      <h2>${icon('map', 20)}${t('city.map.title')}</h2>
      <div class="city-map-body">
        <div class="city-map-pic"><canvas width="${size}" height="${size}" role="img" aria-label="${t('city.map.title')}"></canvas><ol class="city-map-names" aria-hidden="true">${names}</ol></div>
        <ul class="city-map-legend">${legend}<li><i class="lg-gate"></i>${t('city.map.gate')}</li><li><i class="lg-wall"></i>${t('city.map.wall')}</li><li><i class="lg-home"></i>${t('city.map.home')}</li><li><i class="lg-goal"></i>${t('city.map.goal')}</li><li><i class="lg-person"></i>${t('city.map.person')}</li><li><i class="lg-you"></i>${t('city.map.you')}</li></ul>
      </div>
      <div class="actions"><button class="big-btn primary" data-c="close">${icon('check', 18)}${t('city.map.close')}</button></div>
    </div>`,
    'close',
    '[data-c="close"]',
    (el) => {
      const c = el.querySelector('canvas')!.getContext('2d')!;
      c.fillStyle = '#07090c';
      c.fillRect(0, 0, size, size);
      for (let d = 0; d < CITY_N; d++) {
        const ox = GAP + (d % CITY_W) * (MAP_W + GAP);
        const oz = GAP + Math.floor(d / CITY_W) * (MAP_H + GAP);
        c.putImageData(paintDistrict(city.districtOf(d), city.seen[d]), ox, oz);
        // The streets across to the east and the south, once either side has been walked into.
        for (const side of [SIDE.E, SIDE.S]) {
          const n = neighbour(d, side);
          if (n < 0 || (((city.state.visited >> d) | (city.state.visited >> n)) & 1) === 0) continue;
          for (let k = 0; k < LANES; k++) {
            if (!gateOpen(plan, d, side, k)) continue;
            const at = laneAt(plan, d, side, k);
            c.fillStyle = '#f2c230';
            if (side === SIDE.E) c.fillRect(ox + MAP_W, oz + at, GAP, ROAD_W);
            else c.fillRect(ox + at, oz + MAP_H, ROAD_W, GAP);
          }
        }
      }
      // Home (the last bed slept in): a small house.
      const [hd, ht] = city.state.home;
      if (city.state.step > 0 && ((city.state.visited >> hd) & 1) === 1) {
        const hx = GAP + (hd % CITY_W) * (MAP_W + GAP) + (ht % MAP_W) + 0.5;
        const hz = GAP + Math.floor(hd / CITY_W) * (MAP_H + GAP) + Math.floor(ht / MAP_W) + 0.5;
        c.fillStyle = '#6ff0a8';
        c.beginPath();
        c.moveTo(hx, hz - 4);
        c.lineTo(hx + 4, hz);
        c.lineTo(hx + 3, hz);
        c.lineTo(hx + 3, hz + 3.5);
        c.lineTo(hx - 3, hz + 3.5);
        c.lineTo(hx - 3, hz);
        c.lineTo(hx - 4, hz);
        c.closePath();
        c.fill();
      }
      // The survivors known of (Dispatch names them once the radio works; else those met): a dot each.
      city.story.people.forEach((p, k) => {
        if (!(city.state.flags & FLAG.FIXED) && !(city.state.met & (1 << k))) return;
        const { x, y } = mapXY(p.district, p.tile, GAP);
        c.fillStyle = '#6fd0c4';
        c.strokeStyle = '#07090c';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x, y, 3.2, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      });
      // Where the journal points: a diamond each.
      for (const o of objectives(city)) {
        if (o.done || !o.at) continue;
        const { x, y } = mapXY(o.at.district, o.at.tile, GAP);
        c.fillStyle = '#f2c230';
        c.strokeStyle = '#07090c';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y - 4.5);
        c.lineTo(x + 4.5, y);
        c.lineTo(x, y + 4.5);
        c.lineTo(x - 4.5, y);
        c.closePath();
        c.fill();
        c.stroke();
      }
      // The player: a ring round a dot, in their district.
      const d = city.state.district;
      const px = GAP + (d % CITY_W) * (MAP_W + GAP) + (city.tile % MAP_W) + 0.5;
      const pz = GAP + Math.floor(d / CITY_W) * (MAP_H + GAP) + Math.floor(city.tile / MAP_W) + 0.5;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(px, pz, 2.2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ff5a4a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(px, pz, 4.5, 0, Math.PI * 2);
      c.stroke();
    },
  );
  click();
}

/**
 * The journal (C3): the act and what it asks, the ways out (each chosen here once seen), what Dispatch
 * has said, the notes found. Resolves with the way out chosen (0: none).
 */
export async function showCityJournal(city: City, click: () => void): Promise<number> {
  const s = city.state;
  const list = objectives(city);
  const todo = list
    .map(
      (o) =>
        `<li class="${o.done ? 'done' : ''}">${icon(o.done ? 'check' : 'chevronRight', 14)}<span>${objectiveText(city, o)}</span></li>`,
    )
    .join('');
  const fixed = (s.flags & FLAG.FIXED) !== 0;
  const ways = !fixed
    ? ''
    : `<section><h3>${icon('route', 16)}${t('city.journal.ways')}</h3><div class="cj-ways">${WAYS.map((w, k) => {
        const n = k + 1;
        const seen = (s.scouted & (1 << k)) !== 0;
        const needs = w.needs
          .map(
            (id) =>
              `<li class="${s.kit & thingBit(id) ? 'done' : ''}">${icon(s.kit & thingBit(id) ? 'check' : 'chevronRight', 12)}${t(`city.kit.${id}` as Key)}</li>`,
          )
          .join('');
        const state =
          s.way === n
            ? `<span class="cj-state on">${icon('check', 14)}${t(s.ready ? 'city.journal.locked' : 'city.journal.chosen')}</span>`
            : !seen
              ? `<span class="cj-state">${icon('eyeOff', 14)}${t('city.journal.unseen')}</span>`
              : s.ready
                ? ''
                : `<button class="big-btn primary" data-c="way${n}">${t('city.journal.choose')}</button>`;
        return `<div class="cj-way${s.way === n ? ' chosen' : ''}"><b>${icon(w.id === 'heli' ? 'heli' : w.id === 'boat' ? 'boat' : 'lock', 16)}${t(`city.way.${n}` as Key)}<small>${city.plan.names[city.story.wayDistrict[k]]}</small></b><p>${t(`city.way.sub.${n}` as Key)}</p><ul>${needs}</ul>${state}</div>`;
      }).join('')}</div></section>`;
  const hasRadio = (s.kit & thingBit('radio')) !== 0;
  const heard = [...s.heard].reverse();
  const radio = !hasRadio
    ? `<p class="card-note">${t('city.journal.noRadio')}</p>`
    : `${fixed ? '' : `<p class="card-note">${t('city.journal.static')}</p>`}${heard.map((b) => `<p class="cj-line">${t(`city.say.${b}` as Key)}</p>`).join('')}`;
  const found = Array.from({ length: NOTES }, (_, n) => n).filter((n) => s.notes & (1 << n));
  const notes = found.length
    ? found
        .map((n) => `<details><summary>${t(`city.note.${n}.title` as Key)}</summary><p>${t(`city.note.${n}.text` as Key)}</p></details>`)
        .join('')
    : `<p class="card-note">${t('city.journal.noNotes')}</p>`;
  const kit = THINGS.filter((id) => s.kit & thingBit(id)).map((id) => t(`city.kit.${id}` as Key));
  const known = PEOPLE.map((_, k) => k).filter((k) => fixed || s.met & (1 << k));
  const people = !known.length
    ? ''
    : `<section><h3>${icon('users', 16)}${t('city.journal.people')}</h3><ul class="cj-people">${known
        .map((k) => {
          const p = city.story.people[k];
          const dist = city.districtOf(p.district);
          const met = (s.met & (1 << k)) !== 0;
          return `<li><b>${t(`city.person.${PEOPLE[k].id}.name` as Key)}<small>${t(`city.person.${PEOPLE[k].id}.role` as Key)}</small></b><span>${t(`city.use.${dist.lots[p.lot].use}` as Key)}, ${city.plan.names[p.district]}</span><small>${met ? errandLine(city, k) || t('city.journal.errands', { n: s.errand[k] }) : t('city.journal.unmet')}</small></li>`;
        })
        .join('')}</ul></section>`;
  const choice = await modal<'close' | 'way1' | 'way2' | 'way3'>(
    `<div class="card city-journal">
      <h2>${icon('book', 20)}${t('city.journal.title')}<small>${t('city.act.n', { n: s.act })} · ${t(`city.act.${s.act}` as Key)}</small></h2>
      <div class="cj-body">
        <section><h3>${icon('clipboard', 16)}${t('city.journal.todo')}</h3><ul class="cj-todo">${todo}</ul>${kit.length ? `<p class="card-note cj-kit">${t('city.journal.kit')}: ${kit.join(', ')}</p>` : ''}</section>
        ${ways}
        ${people}
        <section><h3>${icon('megaphone', 16)}${t('city.journal.radio')}</h3>${radio}</section>
        <section><h3>${icon('letter', 16)}${t('city.journal.notes', { n: found.length, of: NOTES })}</h3>${notes}</section>
      </div>
      <div class="actions"><button class="big-btn primary" data-c="close">${icon('check', 18)}${t('city.journal.close')}</button></div>
    </div>`,
    'close',
    '[data-c="close"]',
  );
  click();
  return choice === 'close' ? 0 : Number(choice.slice(3));
}

/** Out of the city: by which way, how it went, and the last thing on the radio. */
export async function showCityEscaped(city: City, feats: readonly Feat[], click: () => void): Promise<void> {
  const s = city.state;
  let notes = 0;
  for (let n = 0; n < NOTES; n++) if (s.notes & (1 << n)) notes++;
  await modal<'back'>(
    `<div class="card city-intro city-escaped">
      <h2>${icon('flag', 20)}${t('city.escaped.title')}<small>${t(`city.way.${s.won}` as Key)}</small></h2>
      <p>${t(`city.escaped.${s.won}` as Key)}</p>
      <p class="city-over-line">${t('city.escaped.line', { n: city.day, kills: s.kills, deaths: s.deaths, notes, of: NOTES })}</p>
      <blockquote><small>${t('city.escaped.last')}</small>${t(`city.say.win${s.won}` as Key)}</blockquote>
      ${feats.length ? `<ul class="city-feats new">${feats.map((f) => featRow(f, true, true)).join('')}</ul>` : ''}
      <div class="actions"><button class="big-btn primary" data-c="back">${icon('home', 18)}${t('pause.quit')}</button></div>
    </div>`,
    'back',
    '[data-c="back"]',
  );
  click();
}

/** What a survivor's open errand wants, in a line ('' none open). */
function errandLine(city: City, k: number): string {
  const e = errandOf(city, k);
  const w = wants(city, k);
  if (!e || !w) return '';
  return e.bring
    ? t('city.person.wants.bring', { n: w.n, what: itemName(w.item), have: w.have })
    : t('city.person.wants.kills', { n: w.n, have: w.have });
}

/**
 * A survivor's card (C3b): what they say (first met, an errand just handed in, or a word), the errand
 * open and what it pays, their swaps. Resolves with the swap asked for (0–2), 3: the errand handed over, or -1: left.
 */
export async function showCityPerson(city: City, k: number, what: 'met' | 'done' | 'chat', click: () => void): Promise<number> {
  const s = city.state;
  const who = PEOPLE[k];
  const stage = s.errand[k];
  const e = errandOf(city, k);
  const w = wants(city, k);
  // (Just met: hello, then what they ask. Just paid: their thanks, then the next thing. Else what they ask, or a word.)
  const lines =
    what === 'met'
      ? [`${who.id}.met`, `${who.id}.ask0`]
      : what === 'done'
        ? [`${who.id}.done${stage - 1}`, ...(e ? [`${who.id}.ask${stage}`] : [])]
        : [e ? `${who.id}.ask${stage}` : `${who.id}.idle`];
  const taught = CITY_RECIPES.find((r) => r.taught === k);
  const pay = !e
    ? ''
    : [
        ...(e.key ? [t('city.person.key')] : []),
        ...e.gives.map(([id, n]) => `${itemName(cityItemNumber(id))}${n > 1 ? ` × ${n}` : ''}`),
        ...(stage === 0 && taught ? [t('city.person.teaches', { what: itemName(cityItemNumber(taught.makes)) })] : []),
      ].join(', ');
  const errand = !e
    ? `<p class="card-note">${t('city.person.noMore')}</p>`
    : `<div class="cp-errand${w && w.have >= w.n ? ' ready' : ''}"><b>${errandLine(city, k)}</b><small>${t('city.person.gives', { what: pay })}</small>${w && w.have >= w.n ? `<button class="big-btn primary cp-give" data-c="t3">${icon('check', 16)}${t('city.person.ready')}</button>` : ''}</div>`;
  const swaps = who.trades
    .map(([give, get], n) => {
      const g = cityItemNumber(give[0]);
      const can = city.count(g) >= give[1];
      const a = `${itemName(g)}${give[1] > 1 ? ` × ${give[1]}` : ''}`;
      const b = `${itemName(cityItemNumber(get[0]))}${get[1] > 1 ? ` × ${get[1]}` : ''}`;
      return `<button class="cp-swap" data-c="t${n}"${can ? '' : ' disabled'} aria-label="${t('city.person.swap', { give: a, get: b })}"><span>${a}</span>${icon('chevronRight', 14)}<b>${b}</b></button>`;
    })
    .join('');
  const choice = await modal<'close' | 't0' | 't1' | 't2' | 't3'>(
    `<div class="card city-person">
      <h2>${icon('chat', 20)}${t(`city.person.${who.id}.name` as Key)}<small>${t(`city.person.${who.id}.role` as Key)}</small></h2>
      ${lines.map((l) => `<p class="cj-line">${t(`city.person.${l}` as Key)}</p>`).join('')}
      ${errand}
      <h3>${icon('hand', 16)}${t('city.person.swaps')}</h3>
      <div class="cp-swaps">${swaps}</div>
      <div class="actions"><button class="big-btn primary" data-c="close">${icon('check', 18)}${t('city.person.close')}</button></div>
    </div>`,
    'close',
    '[data-c="close"]',
  );
  click();
  return choice === 'close' ? -1 : Number(choice.slice(1));
}

/** A feat's row: had or not (`fresh`: just had, on the end card). */
function featRow(f: Feat, had: boolean, fresh = false): string {
  return `<li class="${had ? 'had' : ''}">${icon(had ? 'trophy' : 'lock', 16)}<span><b>${t(`city.feat.${f}` as Key)}${fresh ? `<i>${t('city.feats.new')}</i>` : ''}</b><small>${t(`city.feat.${f}.sub` as Key)}</small></span></li>`;
}

/** City Escape's records: the ways out taken over every city, the quickest, its feats. */
export async function showCityFeats(click: () => void): Promise<void> {
  const r = readRecord();
  const any = r.wins.some((n) => n > 0);
  await modal<'close'>(
    `<div class="card city-journal city-records">
      <h2>${icon('trophy', 20)}${t('city.feats.title')}<small>${r.feats.length} / ${FEATS.length}</small></h2>
      <p class="card-note">${any ? `${t('city.feats.wins', { a: r.wins[0], b: r.wins[1], c: r.wins[2] })} · ${t('city.feats.best', { n: r.best })}` : t('city.feats.none')}</p>
      <div class="cj-body"><ul class="city-feats">${FEATS.map((f) => featRow(f, r.feats.includes(f))).join('')}</ul></div>
      <div class="actions"><button class="big-btn primary" data-c="close">${icon('check', 18)}${t('city.journal.close')}</button></div>
    </div>`,
    'close',
    '[data-c="close"]',
  );
  click();
}
