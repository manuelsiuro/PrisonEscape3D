/**
 * The simulation is deterministic and its rules hold: same commands, same state; snapshots
 * and keyframe seeks are exact; walls stop the player; door frames guide them through; the
 * clock reads right.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { command } from '../src/sim/command';
import { Recorder } from '../src/sim/Recorder';
import { Sim } from '../src/sim/Sim';
import { clockAt, formatTime } from '../src/sim/systems/clock';
import { tileOfBody } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { check } from './assert';

/** Compass directions (command.ts): 1 east, 5 south, 9 west, 13 north. */
const E = 1, SE = 3, S = 5, W = 9, N = 13;
/** A walk out of the cell, down the hall and into the roll call yard, then wandering. */
const PLAN: Array<[number, number]> = [
  [W, 8],
  [S, 60],
  [E, 120],
  [SE, 40],
  [S, 30],
  [W, 50],
  [0, 20],
];
/** Plays the plan (repeated `loops` times) and returns the recorder. */
function play(loops = 1, seed = 7) {
  const rec = new Recorder(new Sim(CENTER_PERKS, seed));
  for (let k = 0; k < loops; k++) for (const [d, n] of PLAN) for (let i = 0; i < n; i++) rec.step(command(d === 0 ? 0 : d));
  return rec;
}

// Same commands, same state.
const a = play(3);
const b = play(3);
check(a.sim.hash() === b.sim.hash(), 'same commands give the same state');
const end = a.sim.hash();
const endStep = a.sim.state.step;
console.log(`after ${endStep} steps: ${end}, player in ${a.sim.playerZone}`);

// Snapshot, run on, restore, run the same: identical.
const sim = new Sim(CENTER_PERKS, 7);
for (let i = 0; i < 50; i++) sim.step(command(S));
const snap = sim.snapshot();
for (let i = 0; i < 40; i++) sim.step(command(E));
const h1 = sim.hash();
sim.restore(snap);
for (let i = 0; i < 40; i++) sim.step(command(E));
check(sim.hash() === h1, 'restoring a snapshot and replaying is exact');

// Seeking through keyframes: a long run, seek back, replay forward.
const long = play(30);
const longEnd = long.sim.hash();
const longStep = long.sim.state.step;
long.seek(1500);
check(long.sim.state.step === 1500, 'seek lands on the step asked');
long.seek(longStep);
check(long.sim.hash() === longEnd, 'seeking back and forth through keyframes is exact');

// Walls: walking north from the bed area only reaches the cell's back wall.
const wall = new Sim(CENTER_PERKS);
for (let i = 0; i < 200; i++) wall.step(command(N));
check(wall.playerZone === 'playerCell', 'the back wall holds');
check(tileOfBody(wall.state.player).z === 7, 'the player stops flush against the wall');

// Straight south from the middle of the cell hits the wall beside the door (x = 9, door at 8).
const blocked = new Sim(CENTER_PERKS);
for (let i = 0; i < 100; i++) blocked.step(command(S));
check(blocked.playerZone === 'playerCell', 'the wall beside the door holds');

// Half over the door frame: the frame guides the player through.
const assisted = new Sim(CENTER_PERKS);
assisted.state.player.x = 8 * UNIT + UNIT / 2 + 380;
for (let i = 0; i < 60 && tileOfBody(assisted.state.player).z < 13; i++) assisted.step(command(S));
check(assisted.playerZone === 'cellBlock', 'a door frame slides the player into the doorway and out to the hall');

// Speed: about 3.6 tiles a second on open floor.
const run = new Sim(CENTER_PERKS);
run.state.player.x = 10 * UNIT;
run.state.player.z = 13 * UNIT + UNIT / 2;
const x0 = run.state.player.x;
for (let i = 0; i < 20; i++) run.step(command(E));
console.log(`one second east: ${((run.state.player.x - x0) / UNIT).toFixed(3)} tiles`);

// The clock: 08:00 on day 1, Lights Out at 23:00, midnight rolls the day.
check(formatTime(clockAt(0)) === '08:00' && clockAt(0).day === 1, 'day 1 starts at 08:00');
check(formatTime(clockAt(15 * 60 * STEPS_PER_MINUTE)) === '23:00', '15 hours later it is 23:00');
const midnight = clockAt(16 * 60 * STEPS_PER_MINUTE);
check(midnight.day === 2 && formatTime(midnight) === '00:00', 'midnight starts day 2');
let hours = 0;
const clock = new Sim(CENTER_PERKS);
for (let i = 0; i < 3 * 60 * STEPS_PER_MINUTE; i++) {
  clock.step(0);
  hours += clock.events.filter((e) => e.type === 'hour').length;
}
check(hours === 3, 'an hour event every game hour');
console.log(`3 hours: ${hours} hour events, clock ${formatTime(clock.clock)}`);
