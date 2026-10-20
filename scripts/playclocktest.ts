/**
 * Play time (src/play/game.ts): the clock the cards' short holds and the hoops ball count. It
 * moves only with frames of play (the loop ticks it while the game isn't paused), so a pause
 * never eats a talent night's 6-second verdict or lands a ball behind the pause card.
 */
import { check } from './assert';
import { clearPlayTimers, playLater, playNow, tickPlayClock } from '../src/play/game';

const fired: string[] = [];
const t0 = playNow();
// The talent night's verdict, shown at t0 and held RESULT_MS (6 s) of play.
const RESULT_MS = 6000;
const held = () => playNow() - t0 < RESULT_MS;
// A shot: the landing at 0.9 s, its bounce 0.42 s later; queued out of order.
playLater(1320, () => fired.push('bounce'));
playLater(900, () => fired.push('land'));
playLater(900 + 300, () => fired.push('toast'));

// One second of play at 60 frames a second.
for (let k = 0; k < 60; k++) tickPlayClock(1000 / 60);
check(fired.join() === 'land', `after 1 s of play only the landing: ${fired.join()}`);
// Paused for any length of real time: nothing ticks, nothing fires, the verdict still holds.
check(held(), 'the verdict holds through a pause');
check(fired.join() === 'land', 'nothing fires while paused');
// Play on: the rest fire in their order, and the verdict lapses after 6 s of play in all.
for (let k = 0; k < 60; k++) tickPlayClock(1000 / 60);
check(fired.join() === 'land,toast,bounce', `in order after 2 s: ${fired.join()}`);
check(held(), 'still held at 2 s of play');
for (let k = 0; k < 4 * 60 + 1; k++) tickPlayClock(1000 / 60);
check(!held(), 'the verdict gone after 6 s of play');
// A new game drops what was waiting.
playLater(10, () => fired.push('stale'));
clearPlayTimers();
tickPlayClock(100);
check(!fired.includes('stale'), 'a new game drops waiting timers');

console.log(`play clock: ${fired.join(', ')}; held 6 s of play, through a pause; a new game drops what waits`);
