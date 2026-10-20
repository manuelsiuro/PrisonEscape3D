/**
 * The picture's rules that can be checked without a screen (P23–P30 polish):
 * - trees: the zone where a tree's leaves fade over a character covers every place the canopy
 *   would hide their body from the camera (and not much more);
 * - hoops: a side wall's hoop is turned toward the camera about its rim (the rim stays where the
 *   court has it, the board stays on its tile and faces the camera);
 * - the football pitch kept clean: which hoop spots and roll call marks would cross it, and when
 *   the roll call's marks over it show (the match's framing: pitchframetest).
 */
import * as THREE from 'three';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { CANOPY, CANOPY_SHADE, canopyCovers, decorMatrix, HOOP_BOARD, HOOP_RIM, ROT_ANGLE } from '../src/render/decor';
import { ROLL_CALL_LEAD, rollCallOverPitch, rollCallShows, rollCallSoon } from '../src/render/ground';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { DAY_EVENTS, WEATHERS } from '../src/content/days';
import { routineAt } from '../src/content/routine';
import { Sim } from '../src/sim/Sim';
import { pitchOf } from '../src/sim/systems/football';
import { drillOn, planOf } from '../src/sim/systems/calendar';
import { clockAt, DAY_STEPS } from '../src/sim/systems/clock';
import { STEPS_PER_MINUTE } from '../src/sim/tuning';
import { spotsOnPitch } from '../src/render/Pastimes';
import { check } from './assert';

const ALL = [...PRISONS, TRAINING];

// ------------------------------------------------------------------ trees
{
  // The camera looks down 38 for every 24 back (render/View.ts CAMERA_OFFSET): a point higher up
  // hides what stands this much further north per unit of height.
  const back = 24 / 38;
  /** Whether the canopy hides a body standing at (dx, dz) from the trunk: its middle or a shoulder, from the hips to the head. */
  const hidden = (dx: number, dz: number): boolean => {
    for (const side of [-0.15, 0, 0.15])
      for (let yb = 0.5; yb <= 1.2001; yb += 0.1)
        for (const c of CANOPY)
          for (let y = c.y0; y <= c.y1 + 1e-9; y += 0.05) {
            if (y < yb) continue;
            const z = dz + (y - yb) * back;
            if ((dx + side - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true;
          }
    return false;
  };
  let covered = 0;
  let inZone = 0;
  let spare = 0;
  for (let dx = -1.6; dx <= 1.6001; dx += 0.05)
    for (let dz = -3; dz <= 1.5001; dz += 0.05) {
      const h = hidden(dx, dz);
      const z = canopyCovers(dx, dz);
      if (h) covered++;
      if (z) inZone++;
      if (z && !h) spare++;
      check(!h || z, `trees: a body at (${dx.toFixed(2)}, ${dz.toFixed(2)}) from the trunk is hidden by the leaves, outside the fade zone`);
    }
  check(spare / inZone < 0.2, `trees: the fade zone isn't much wider than where the leaves hide someone (${spare} of ${inZone} spare)`);
  console.log(`trees: the leaves fade within ${CANOPY_SHADE.r} of the line ${CANOPY_SHADE.north} north to ${CANOPY_SHADE.south} south of the trunk; ${covered} hidden samples all inside, ${spare} of ${inZone} in the zone not hidden`);
  for (const p of ALL) {
    const trees = (p.decor ?? []).filter((d) => d.kind === 'tree');
    if (trees.length) console.log(`trees: ${p.id} ${trees.length} (${trees.map((t) => `${t.x},${t.z}`).join(' ')})`);
  }
}

// ------------------------------------------------------------------ hoops
{
  const m = new THREE.Matrix4();
  const flat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of ALL) {
    for (const d of (p.decor ?? []).filter((d) => d.kind === 'hoop')) {
      decorMatrix(d, m);
      const rot = d.rot ?? 0;
      // The hoop as it stood before (turned by its rot alone).
      flat.compose(new THREE.Vector3(d.x + 0.5, 0, d.z + 0.5), q.setFromAxisAngle(up, ROT_ANGLE[rot]), new THREE.Vector3(1, 1, 1));
      const rim = new THREE.Vector3(0, HOOP_RIM.y, HOOP_RIM.z).applyMatrix4(m);
      const rim0 = new THREE.Vector3(0, HOOP_RIM.y, HOOP_RIM.z).applyMatrix4(flat);
      check(rim.distanceTo(rim0) < 1e-9, `hoops: ${p.id}'s rim stays where it was (${rim.x.toFixed(3)}, ${rim.z.toFixed(3)})`);
      // The board's face toward the camera (+z), at least half of it seen.
      const face = new THREE.Vector3(0, 0, 1).transformDirection(m);
      check(face.z >= 0.5, `hoops: ${p.id}'s backboard faces the camera (${face.z.toFixed(2)})`);
      // Its corners clear of the wall behind the tile (measured in the unturned hoop's own terms: −z is back).
      const back = flat.clone().invert();
      let clear = Infinity;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const c = new THREE.Vector3((sx * HOOP_BOARD.w) / 2, 2.2, HOOP_BOARD.z + (sz * HOOP_BOARD.d) / 2).applyMatrix4(m).applyMatrix4(back);
          clear = Math.min(clear, c.z + 0.5);
        }
      check(clear > 0.01, `hoops: ${p.id}'s backboard stays off the wall behind (${clear.toFixed(3)})`);
      console.log(`hoops: ${p.id} rot ${rot}, the board ${face.z.toFixed(2)} toward the camera, ${clear.toFixed(2)} off the wall`);
    }
  }
}

// ------------------------------------------------------------------ the pitch kept clean
{
  for (const p of ALL) {
    const pitch = p.leisure?.pitch;
    const court = p.leisure?.hoop;
    const on = court ? spotsOnPitch(court, pitch) : [];
    // Every spot always painted is off the pitch.
    court?.spots.forEach((s, k) => {
      const inside = !!pitch && s.x >= pitch.x && s.x < pitch.x + pitch.w && s.z >= pitch.z && s.z < pitch.z + pitch.d;
      check(inside === on[k], `pitch: ${p.id}'s spot ${k} is told apart right`);
    });
    // The roll call's marks: off the pitch, or on their own layer.
    const layer = rollCallOverPitch(p);
    if (pitch && !layer) for (const s of p.rollCall) check(!(s.x >= pitch.x && s.x < pitch.x + pitch.w && s.z >= pitch.z && s.z < pitch.z + pitch.d), `pitch: ${p.id}'s roll call box ${s.x},${s.z} on the pitch, baked`);
    console.log(`pitch: ${p.id} ${pitch ? `${pitch.w}×${pitch.d}` : 'none'}; hoop spots on it ${on.filter(Boolean).length}; roll call ${layer ? 'on its own layer (shown for roll call)' : 'baked'}`);
  }
  // When the roll call's marks over a pitch show: roll call, and the minutes before.
  const at = (id: string) => ROUTINE.findIndex((r) => r.id === id);
  const cases: Array<[string, number, boolean]> = [
    ['rollCall', 8 * 60 + 30, true],
    ['eveningRollCall', 22 * 60 + 10, true],
    ['lightsOut', 8 * 60 - ROLL_CALL_LEAD, true],
    ['lightsOut', 8 * 60 - ROLL_CALL_LEAD - 5, false],
    ['eveningFreeTime', 22 * 60 - 5, true],
    ['eveningFreeTime', 21 * 60, false],
    ['freeTime', 11 * 60, false],
    ['exercise', 15 * 60 + 30, false],
  ];
  for (const [id, minute, want] of cases) check(rollCallSoon(at(id), minute) === want, `pitch: roll call's marks at ${id} ${minute} ${want ? 'shown' : 'hidden'}`);
  console.log(`pitch: the roll call's marks over a pitch show for roll call and ${ROLL_CALL_LEAD} minutes before`);
  // A fire drill (P17) musters everyone at roll call outside the routine: the marks show for it too.
  const sim = new Sim(STALAG_FLUCHT, 5);
  sim.state.calendar = [
    [0, 0, 0],
    [2, DAY_EVENTS.indexOf('drill'), WEATHERS.indexOf('clear')],
  ];
  const plan = planOf(sim, 2);
  const put = (dayMin: number) => {
    sim.state.step = DAY_STEPS + dayMin * STEPS_PER_MINUTE;
    const minute = clockAt(sim.state.step).minuteOfDay;
    sim.state.routine = routineAt(minute);
    return minute;
  };
  check(plan.event === 'drill', 'pitch: the forced drill day');
  const during = put(plan.at + 1);
  check(drillOn(sim) && !rollCallSoon(sim.state.routine, during) && rollCallShows(sim, during), `pitch: the marks show for the drill at ${during} (out of the routine's roll call)`);
  const after = put(plan.until + 5);
  check(!drillOn(sim) && rollCallShows(sim, after) === rollCallSoon(sim.state.routine, after), 'pitch: the drill over, the routine decides again');
  console.log(`pitch: the roll call's marks show for the drill at ${String(Math.floor(during / 60)).padStart(2, '0')}:${String(during % 60).padStart(2, '0')} at ${STALAG_FLUCHT.id}`);
}

// ------------------------------------------------------------------ a 2.5.0 replay's pitch
{
  // A replay of a 2.5.0 run plays on the pitch it had (football.ts pitchOf): the paint keeps off that one.
  const def = STALAG_FLUCHT;
  const was = def.leisure!.pitchWas!;
  const old = new Sim(def, 3);
  old.rules250 = true;
  check(pitchOf(old) === was && pitchOf(new Sim(def, 3)) === def.leisure!.pitch, 'replay pitch: a 2.5.0 replay plays on the old pitch, a game on the new');
  const crossed = rollCallOverPitch(def, was);
  const spots = spotsOnPitch(def.leisure!.hoop!, was).filter(Boolean).length;
  check(crossed && !rollCallOverPitch(def), 'replay pitch: the roll call goes on its own layer over the old pitch, baked beside the new');
  console.log(`replay pitch: ${def.id} 2.5.0 replays on ${was.x},${was.z} ${was.w}×${was.d}: roll call ${crossed ? 'on its own layer' : 'baked'}, hoop spots on it ${spots}`);
}
