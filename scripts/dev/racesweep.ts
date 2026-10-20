// Scratch: tunes P28's race luck and fed bonus (blind bets lose, knowing who ate wins).
import { rollInt, SALT, mix32 } from '../../src/sim/rng';
const LEGS = 10, SAMPLES = 300, MARGIN = 85, RIVAL_FED = 65;
type E = { speed: number; fed: boolean; cell: number };
function odds(salt: number, day: number, card: E[], LUCK: number, FB: number) {
  const wins = card.map(() => 0);
  for (let k = 0; k < SAMPLES; k++) {
    let best = -1, bd = -1;
    card.forEach((e, lane) => {
      const fed = rollInt(salt, SALT.RACE, 7_000_000 + day * 1024 + k, lane, 100) < RIVAL_FED;
      let d = 0;
      for (let l = 0; l < LEGS; l++) d += e.speed + (fed ? FB : 0) + rollInt(salt, SALT.RACE, 8_000_000 + (day * 1024 + k) * 16 + l, lane, LUCK + 1);
      if (d > bd) { bd = d; best = lane; }
    });
    wins[best]++;
  }
  return wins.map((w) => Math.max(11, Math.min(200, Math.floor((MARGIN * SAMPLES) / Math.max(1, w) / 50) * 5)));
}
function race(salt: number, day: number, card: E[], LUCK: number, FB: number) {
  let best = -1, bd = -1;
  card.forEach((e, lane) => {
    let d = 0;
    for (let l = 0; l < LEGS; l++) d += e.speed + (e.fed ? FB : 0) + rollInt(salt, SALT.RACE, day * 16 + l, 4000 + lane, LUCK + 1);
    if (d > bd) { bd = d; best = lane; }
  });
  return best;
}
for (const [LUCK, FB, SPREAD] of [[200, 35, 50], [200, 40, 50], [200, 50, 50], [250, 40, 50], [250, 50, 50], [250, 60, 50], [300, 60, 50]]) {
  let blind = 0, nb = 0, fav = 0, nf = 0, inf = 0, ni = 0, pet = 0, petEv = 0, nights = 0, unfedPet = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const salt = mix32(seed);
    for (let day = 1; day <= 39; day += 2) {
      const card: E[] = [0, 1, 2].map((j) => { const cell = 2 + ((seed * 7 + day * 3 + j * 5) % 12); return { cell, speed: 30 + rollInt(salt, SALT.RACE, 0, 1000 + cell, SPREAD + 1), fed: rollInt(salt, SALT.RACE, day, 2000 + cell, 100) < RIVAL_FED }; });
      const o = odds(salt, day, card, LUCK, FB);
      const w = race(salt, day, card, LUCK, FB);
      nights++;
      card.forEach((_, l) => { nb++; blind += w === l ? o[l] / 10 : 0; });
      const f = o.indexOf(Math.min(...o)); nf++; fav += w === f ? o[f] / 10 : 0;
      card.forEach((e, l) => { if (e.fed) { ni++; inf += w === l ? o[l] / 10 : 0; } });
      const withPet = [...card, { cell: 1, speed: 80, fed: true }];
      const op = odds(salt, day, withPet, LUCK, FB);
      const wp = race(salt, day, withPet, LUCK, FB);
      if (wp === 3) pet++;
      petEv += wp === 3 ? op[3] / 10 : 0;
      const withPet2 = [...card, { cell: 1, speed: 80, fed: false }];
      if (race(salt, day, withPet2, LUCK, FB) === 3) unfedPet++;
    }
  }
  console.log(`LUCK ${LUCK} FED ${FB} spread ${SPREAD}: blind ×${(blind / nb).toFixed(2)} fav ×${(fav / nf).toFixed(2)} on fed ×${(inf / ni).toFixed(2)}; pet 80 fed wins ${Math.round((pet * 100) / nights)}% (×${(petEv / nights).toFixed(2)}), unfed ${Math.round((unfedPet * 100) / nights)}%`);
}
