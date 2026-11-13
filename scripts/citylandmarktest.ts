/**
 * City Escape's landmarks' own models (2.50, render only): on many cities, every district's landmark
 * gets its pieces, and each stands where nobody walks or lies flat where nothing is in its way. The
 * coping and the corners on walls; the sign over an unbroken stretch of the north wall; the hospital's
 * pad on clear floor of the hospital; the boat on the water beside the pier's end, its bow out to sea;
 * the metro's grille on the tile the way out is taken from, sliding onto clear floor (a floor, no doorway,
 * no furniture, nobody standing there); the rooftop pieces on walls clear of the sign. And the models
 * build: the still ones merged, on or over the floor, near their building; the ones that change with
 * the story (LandmarkLive) put up, drawn through the story's states and taken down again.
 */
import { check } from './assert';
import { DISTRICTS } from '../src/city/content/districts';
import { landmarkPlan, SIGN_REACH } from '../src/city/render/landmarkPlan';
import { LANDMARK_PAINT, LandmarkLive, landmarkParts } from '../src/city/render/landmarks';
import { City } from '../src/city/sim/City';
import { tilesOf } from '../src/city/sim/story';
import { merge, type Part } from '../src/render/kit';
import { MAP_W as W } from '../src/sim/world/grid';

const lines: string[] = [];
const CITIES = 24;
let pads = 0;
let wide = 0;
let boats = 0;
let slides = 0;
let grilles = 0;
let roofs = 0;
const live = new LandmarkLive();
let tris = 0;
let most = 0;
for (let n = 1; n <= CITIES; n++) {
  const seed = n * 7717 + 3;
  const c = new City(seed);
  for (let d = 0; d < 9; d++) {
    const dist = c.districtOf(d);
    const solid = c.districtGrid(d);
    const at = `city ${seed}, district ${d} (${dist.kind})`;
    const people = c.story.people.filter((q) => q.district === d).map((q) => q.tile);
    const lm = landmarkPlan(dist, c.story, solid, people);
    if (!lm) {
      check(false, `${at}: no landmark`);
      continue;
    }
    const ch = (i: number) => dist.rows[Math.floor(i / W)][i % W];
    const furnished = new Set(dist.props.flatMap((_, k) => tilesOf(dist, k)));
    const clear = (i: number) =>
      !solid[i] && !furnished.has(i) && !people.includes(i) && 'w:_'.includes(ch(i)) && dist.lots[dist.lotAt[i] - 1] === lm.lot;
    check(lm.use === DISTRICTS[dist.kind].landmark && LANDMARK_PAINT[lm.use] !== undefined, `${at}: the landmark's use and paint`);
    check(lm.coping.length >= 30 && lm.coping.every((i) => ch(i) === '#'), `${at}: the coping lies on walls`);
    check(
      lm.corners.every((i) => ch(i) === '#'),
      `${at}: the corners are walls`,
    );
    const sx = Math.floor(lm.signX);
    check(ch(lm.lot.z0 * W + sx) === '#' && sx > lm.lot.x0 && sx < lm.lot.x1, `${at}: the sign stands on the north wall`);
    // (Its legs, at three tenths of its width to either side of its middle: on the wall too.)
    const half = (lm.use === 'mall' ? 2.3 : 1.7) * 0.3;
    check(
      [lm.signX - half, lm.signX + half].every((x) => ch(lm.lot.z0 * W + Math.floor(x)) === '#'),
      `${at}: the sign's legs stand on the wall`,
    );
    for (const x of lm.roof.flat()) {
      roofs++;
      check(
        ch(lm.lot.z0 * W + x) === '#' && x > lm.lot.x0 + 1 && x < lm.lot.x1 - 1 && Math.abs(x + 0.5 - lm.signX) >= SIGN_REACH,
        `${at}: a rooftop place at x ${x} is a wall clear of the sign and the corners`,
      );
    }
    const way = c.story.wayDistrict.indexOf(d);
    check(
      !!lm.pad === (way === 0) && !!lm.grille === (way === 2) && (!lm.boat || way === 1),
      `${at}: the ways' pieces are in their own districts`,
    );
    if (lm.pad) {
      pads++;
      const t = lm.pad.tile;
      if (lm.pad.wide) {
        wide++;
        let ok = true;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ok &&= clear(t + dz * W + dx);
        check(ok, `${at}: the pad's nine tiles are clear floor of the hospital`);
      } else check(t === c.story.exits[0], `${at}: a small pad lies on the beacon's tile`);
    }
    if (way === 1) {
      check(!!lm.boat, `${at}: a boat at the pier`);
      if (lm.boat) {
        boats++;
        const b = lm.boat;
        const far = Math.abs((b.tile % W) - (c.story.pier % W)) + Math.abs(Math.floor(b.tile / W) - Math.floor(c.story.pier / W));
        check(far === 1 && ch(b.tile) === '~', `${at}: the boat lies on the water beside the pier's end`);
        check(ch(b.tile + b.dz * W + b.dx) === '~' && ch(b.tile - b.dz * W - b.dx) === '~', `${at}: water at the boat's bow and stern`);
      }
    }
    if (lm.grille) {
      const g = lm.grille;
      grilles++;
      check(g.tile === c.story.exits[2], `${at}: the grille lies on the way down`);
      if (g.dx || g.dz) {
        slides++;
        check(clear(g.tile + g.dz * W + g.dx), `${at}: the grille slides onto clear floor`);
      }
    }
    // The models: built, merged, on or over the floor.
    const parts: Part[] = [];
    landmarkParts(lm, parts);
    const geo = merge(parts);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const count = geo.attributes.position.count / 3;
    tris += count;
    most = Math.max(most, count);
    check(box.min.y >= 0 && box.max.y < 12, `${at}: the model stands on the floor (${box.min.y.toFixed(2)} … ${box.max.y.toFixed(2)})`);
    check(
      box.min.x >= lm.lot.x0 - 0.5 && box.max.x <= lm.lot.x1 + 2 && box.min.z >= lm.lot.z0 - 2.5 && box.max.z <= lm.lot.z1 + 1.5,
      `${at}: the model keeps to its building (a sign tipped back and a pennant reach a little past it)`,
    );
    geo.dispose();
    // What changes with the story: put up, drawn through its states, taken down.
    live.set(lm);
    const frame = { time: 1, still: false, beacon: false, heli: 0, boat: false, open: false };
    live.draw(frame);
    const idle = live.group.children.length;
    check(idle === (lm.use === 'hospital' ? 1 : 0) + (lm.boat ? 1 : 0) + (lm.grille ? 1 : 0), `${at}: the changing pieces (${idle})`);
    live.draw({ ...frame, time: 1.05, beacon: true, heli: 0.5, boat: true, open: true });
    check(live.group.children.length === idle + (lm.pad ? 1 : 0), `${at}: the helicopter comes only over a pad`);
    live.draw({ ...frame, time: 9, still: true, open: true });
    check(live.group.children.length === idle, `${at}: the helicopter is taken away when it isn't coming`);
    if (lm.grille) {
      const g = live.group.children[live.group.children.length - 1];
      const [gx, gz] = [(lm.grille.tile % W) + 0.5 + lm.grille.dx * 0.96, Math.floor(lm.grille.tile / W) + 0.5 + lm.grille.dz * 0.96];
      check(
        Math.abs(g.position.x - gx) < 1e-6 && Math.abs(g.position.z - gz) < 1e-6,
        `${at}: the grille open lies on the tile beside the stairs`,
      );
    }
    live.clear();
    check(live.group.children.length === 0, `${at}: the changing pieces taken down`);
  }
}
lines.push(`${CITIES} cities, ${CITIES * 9} landmarks`);
lines.push(`pads ${pads} (three tiles across: ${wide})`);
lines.push(`boats ${boats}`);
lines.push(`grilles ${grilles} (sliding aside: ${slides})`);
lines.push(`rooftop places clear of the sign: ${roofs}`);
lines.push(`triangles a landmark: ${Math.round(tris / (CITIES * 9))} on average, ${most} at most`);
console.log(lines.join('\n'));
