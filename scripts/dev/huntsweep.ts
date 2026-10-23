/**
 * Dev tool (P41): the getaway bot over every outside map and start, at night and by day, with
 * the alarm up at once or a little later; prints each run's outcome (for tuning the maps).
 *   npx tsx scripts/dev/huntsweep.ts
 */
import { itemNumber } from '../../src/content/items';
import { OUTSIDES } from '../../src/content/outside';
import { START_KINDS } from '../../src/content/outside/types';
import { PRISONS } from '../../src/content/prisons';
import { Hunt, OVER } from '../../src/sim/hunt/Hunt';
import { HuntBot } from '../huntbot';

let won = 0;
let runs = 0;
for (const minute of [23 * 60 + 40, 14 * 60])
  for (const hs of [0, 5])
    for (const def of OUTSIDES) {
      const prison = PRISONS.find((p) => p.id === def.prison)!;
      for (const kind of START_KINDS) {
        if (!def.starts[kind]) continue;
        const hunt = new Hunt(def, prison, { prison: def.prison, via: 'fence', kind, spd: 40, outfit: itemNumber('inmate_outfit'), kit: [], crew: 0, lou: false, headStart: hs, minute, salt: 7 });
        const r = new HuntBot(hunt).run();
        const f = hunt.state.feats;
        runs++;
        if (r.over === OVER.SAFE) won++;
        const notable = r.log.filter((l) => /CAUGHT|spotted|dog|lit/.test(l)).join('; ');
        console.log(`${minute} hs${hs} ${def.prison} ${kind}: ${r.over === OVER.SAFE ? 'away' : r.over === OVER.CAUGHT ? `CAUGHT ${Math.round(hunt.progress * 100)}%` : 'out'} ${r.secs}s spotted ${f[0]} hid ${f[2]} lit ${f[7]} | ${notable}`);
      }
    }
console.log(`${won} of ${runs} away`);
