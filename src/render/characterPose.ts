import { DOING } from '../sim/systems/inmates';

/** On the pay phone (P34): the raised arm's turn (nearly straight up beside the head, the fist just over the ear). */
const PHONE_ARM = -2.75;

/** The limbs' turns, the body's height and its bend, as `Character.pose` builds them up each frame. */
export interface Limbs {
  legL: number;
  legR: number;
  armLx: number;
  armRx: number;
  armLz: number;
  armRz: number;
  legZ: number;
  bob: number;
  bend: number;
}

/**
 * What an activity's pose reads (the character as it stands this frame, filled in by `pose`), and
 * the little it keeps from frame to frame (`straight`, `headBack`, `strainNow`, `sip`: theirs alone).
 */
export interface Moves {
  dt: number;
  /** The time with the character's own offset. */
  t: number;
  /** How far into the activity (0 with reduced motion). */
  a: number;
  motion: boolean;
  moving: boolean;
  ko: boolean;
  act: number;
  lie: number;
  phase: number;
  swing: number;
  pumped: number;
  pumps: number;
  washSeed: number;
  attention: boolean;
  strain: number;
  shudder: boolean;
  diceShake: boolean;
  /** Standing straight for the warden (eased), the head tipped back (a yawn, a rinse), the arm-wrestle's strain as drawn, a sip's tip. */
  straight: number;
  headBack: number;
  strainNow: number;
  sip: number;
}

/**
 * What the character does at its spot (DOING), on top of the walk: the limbs, the height and the
 * bend, eased in by `a` (out of `pose`, v2.34.2; one branch per activity, as they were).
 */
export function activityPose(doing: number, l: Limbs, m: Moves) {
  const { t, a, motion, ko, moving } = m;
  const k = (rate: number) => Math.min(1, m.dt * rate);
  if (doing === DOING.EAT) {
    // Spoon to mouth, bite by bite, the head down to meet it; the other hand on the tray.
    const lift = Math.max(0, Math.sin(t * 2.6)) ** 2;
    l.armRx += (-0.75 - lift * 1.55) * a;
    l.armRz += -0.22 * a;
    l.armLx += -0.75 * a;
    l.armLz += 0.18 * a;
    l.bend = (0.05 + lift * 0.07) * a;
  } else if (doing === DOING.EXERCISE) {
    // Jumping jacks.
    const j = (Math.sin(t * 6) + 1) / 2;
    l.armLz -= j * 2.5 * a;
    l.armRz += j * 2.5 * a;
    l.legZ = j * 0.28 * a;
    l.bob += Math.abs(Math.sin(t * 6)) * 0.08 * a;
  } else if (doing === DOING.SEARCH) {
    // Rummaging through a desk: bent over, hands digging in turn.
    l.armLx += (-1.3 + Math.sin(t * 7) * 0.35) * a;
    l.armRx += (-1.3 + Math.cos(t * 7) * 0.35) * a;
    l.bob -= 0.03 * a;
  } else if (doing === DOING.DIG) {
    // Digging under the bed (P40, the odd jobs' lookout): crouched low, both hands scraping at the
    // floor in turn, a stroke down and back. (Held still with reduced motion: a crouch over the hole.)
    const s = motion ? Math.sin(t * 5.5) : 0;
    l.armLx += (-1.55 + s * 0.4) * a;
    l.armRx += (-1.55 - s * 0.4) * a;
    l.armLz -= 0.12 * a;
    l.armRz += 0.12 * a;
    l.legL += 0.5 * a;
    l.legR += 0.5 * a;
    l.bob -= (0.16 + (motion ? Math.abs(s) * 0.02 : 0)) * a;
  } else if (ko) {
    // Out cold: arms flung out.
    l.armLz -= 1.1 * m.lie;
    l.armRz += 1.1 * m.lie;
    l.legZ = 0.25 * m.lie;
  } else if (doing === DOING.CRAWL) {
    // Elbows forward in turn, knees after them.
    const c = Math.sin(m.phase * 0.7) * 0.45 * m.swing;
    l.armLx = -2.5 + c;
    l.armRx = -2.5 - c;
    l.armLz = -0.25;
    l.armRz = 0.25;
    l.legL = 0.15 - c * 0.6;
    l.legR = 0.15 + c * 0.6;
    l.bob = 0;
  } else if (doing === DOING.WORK) {
    // At work: hands busy at waist height, a little bent.
    l.armLx += (-0.9 + Math.sin(t * 5) * 0.3) * a;
    l.armRx += (-0.9 + Math.cos(t * 5) * 0.3) * a;
    l.bob -= 0.015 * a;
  } else if (doing === DOING.MOP) {
    // Mopping (2.30): the handle in both hands, swept from side to side, the body going with it.
    const sweep = motion ? Math.sin(t * 3.2) : 0;
    l.armLx += (-1.05 + sweep * 0.12) * a;
    l.armRx += (-1.05 - sweep * 0.12) * a;
    l.armLz -= sweep * 0.22 * a;
    l.armRz -= sweep * 0.22 * a;
    l.bob -= 0.02 * a;
  } else if (doing === DOING.LIFT) {
    // Pressing a weight overhead: up on each rep, slowly down between.
    const up = m.pumped;
    l.armLx += (-2.2 - up * 0.7) * a;
    l.armRx += (-2.2 - up * 0.7) * a;
    l.armLz -= (0.5 - up * 0.3) * a;
    l.armRz += (0.5 - up * 0.3) * a;
    l.bob -= (1 - up) * 0.03 * a;
  } else if (doing === DOING.BENCH) {
    // On their back on the bench (2.29), the bar over the chest: straight up on each rep, slowly back.
    const up = m.pumped;
    l.armLx += (-1.95 + up * 0.45) * a;
    l.armRx += (-1.95 + up * 0.45) * a;
    l.armLz -= 0.12 * a;
    l.armRz += 0.12 * a;
  } else if (doing === DOING.PULLUP) {
    // Hanging from the bar, hands up on it; up to it on each rep, slowly down.
    const up = m.pumped;
    l.armLx += -3.0 * a;
    l.armRx += -3.0 * a;
    l.armLz -= 0.15 * a;
    l.armRz += 0.15 * a;
    l.bob += up * 0.22 * a;
  } else if (doing === DOING.PUSHUP) {
    // Hands under the shoulders, straight arms; the body lifted on each rep (below).
    l.armLx += -1.5 * a;
    l.armRx += -1.5 * a;
  } else if (doing === DOING.BAG) {
    // Fists up, one thrown at each rep, in turn.
    const up = m.pumped;
    const left = m.pumps % 2 === 0;
    l.armLx += (-1.35 - (left ? up * 0.45 : 0)) * a;
    l.armRx += (-1.35 - (left ? 0 : up * 0.45)) * a;
    l.armLz += 0.35 * a;
    l.armRz -= 0.35 * a;
  } else if (doing === DOING.RUN) {
    // Running in place on the belt: quicker with each rep.
    const r = Math.sin(t * (9 + m.pumped * 5)) * 0.8 * a;
    l.legL += r;
    l.legR -= r;
    l.armLx -= r * 0.9;
    l.armRx += r * 0.9;
    l.bob += Math.abs(Math.cos(t * (9 + m.pumped * 5))) * 0.05 * a;
  } else if (doing === DOING.SIT) {
    // Sitting back: hands on the knees.
    l.armLx += -0.75 * a;
    l.armRx += -0.75 * a;
  } else if (doing === DOING.READ || doing === DOING.SIT_READ) {
    // A book held up in both hands; a page turns on each rep.
    l.armLx += -1.25 * a;
    l.armRx += (-1.25 - m.pumped * 0.25) * a;
    // (2.31: hands together, in front of the chest, as a book's held: they stood out to the sides before.)
    l.armLz += 0.42 * a;
    l.armRz -= 0.42 * a;
  } else if (doing === DOING.COUNT) {
    // The warden, clipboard in one hand, the pen in the other. (Held still with reduced motion: it says what they're doing.)
    const wa = m.act;
    const tick = motion ? Math.sin(t * 6) * 0.07 : 0;
    l.armLx -= 1.25 * wa;
    l.armLz += 0.45 * wa;
    l.armRx += (-1.15 + tick) * wa;
    l.armRz -= 0.5 * wa;
  } else if (doing === DOING.LINE_UP) {
    // In line, bored: shifting about, a yawn, a scratch; straight as the warden comes to them.
    m.straight += ((m.attention ? 1 : 0) - m.straight) * k(6);
    const loose = motion ? m.act * (1 - m.straight) : 0;
    const beat = motion ? (t * 0.14 + m.washSeed) % 4 : 3;
    const stage = Math.floor(beat);
    const on = Math.sin(Math.min(1, (beat - stage) * 1.6) * Math.PI);
    // (A yawn: a hand up to the mouth, the head back. A scratch at the back of the head.)
    const yawn = stage === 0 ? on * loose : 0;
    const scratch = stage === 1 ? on * loose : 0;
    l.armRx -= 2.1 * yawn;
    l.armRz -= 0.55 * yawn;
    m.headBack = 0.8 * yawn;
    l.armLx -= 2.5 * scratch;
    l.armLz -= 0.4 * scratch;
    // Shoulders back.
    l.armLz -= 0.06 * m.straight * m.act;
    l.armRz += 0.06 * m.straight * m.act;
  } else if (doing === DOING.SHOWER) {
    // Hair, then soap, then a rinse, round and round, each one easing into the next.
    // (With reduced motion, held scrubbing the hair: the pose says what they're doing.)
    const wa = m.act;
    const beat = motion ? (t * 0.42 + m.washSeed) % 3 : 0;
    const stage = Math.floor(beat);
    const mix = Math.max(0, (beat - stage - 0.8) / 0.2);
    const hair = stage === 0 ? 1 - mix : stage === 2 ? mix : 0;
    const soap = stage === 1 ? 1 - mix : stage === 0 ? mix : 0;
    const rinse = stage === 2 ? 1 - mix : stage === 1 ? mix : 0;
    const rub = motion ? Math.sin(t * 9) : 0;
    const rub2 = motion ? Math.cos(t * 9) : 0;
    l.armLx += (hair * (-2.7 + rub * 0.15) + soap * (-1.3 + rub * 0.22) - rinse * 0.2) * wa;
    l.armRx += (hair * (-2.7 + rub2 * 0.15) + soap * (-1.3 + rub2 * 0.22) - rinse * 0.2) * wa;
    l.armLz += (-hair * 0.35 + soap * 0.6 - rinse * 0.16) * wa;
    l.armRz += (hair * 0.35 - soap * 0.6 + rinse * 0.16) * wa;
    m.headBack = rinse * wa;
  } else if (doing === DOING.TOWEL) {
    // Rubbing the hair dry.
    const wa = m.act;
    const rub = motion ? Math.sin(t * 7) : 0;
    l.armLx += (-2.45 + rub * 0.22) * wa;
    l.armRx += (-2.45 - rub * 0.22) * wa;
    l.armLz -= 0.22 * wa;
    l.armRz += 0.22 * wa;
  } else if (doing === DOING.SHOWER_WAIT) {
    // Arms folded, waiting for a head.
    const wa = m.act;
    l.armLx -= 1.2 * wa;
    l.armRx -= 1.2 * wa;
    l.armLz += 0.62 * wa;
    l.armRz -= 0.62 * wa;
  } else if (doing === DOING.WRESTLE) {
    // An arm-wrestle (P22): right hands locked between the two at chest height, the left
    // braced on the hip; winning, the arm drives forward and the body leans into it; losing,
    // it's forced back and up, the body giving way. A shudder under the other's surge.
    // (These poses carry their meaning: with reduced motion they hold still rather than vanish.)
    const ga = m.act;
    m.strainNow += (m.strain - m.strainNow) * k(6);
    const g = m.strainNow;
    const shake = motion ? Math.sin(t * (m.shudder ? 47 : 31)) * (m.shudder ? 0.07 : 0.035) : 0;
    // (The strain is carried by the lean and the stance, View: the grip stays at one height for both.)
    l.armRx += (-1.42 - g * 0.08 + shake) * ga;
    l.armRz += (-0.32 + shake * 0.5) * ga;
    l.armLx += -0.35 * ga;
    l.armLz += 0.45 * ga;
    l.bob -= 0.03 * ga;
  } else if (doing === DOING.PICK) {
    // At a lock (P22): bent to it, both hands at the keyhole, the right one working the pick
    // (a twitch at each pin, `pumped`).
    const ga = m.act;
    l.armRx += (-1.05 - m.pumped * 0.25 + (motion ? Math.sin(t * 13) * 0.04 : 0)) * ga;
    l.armRz += -0.28 * ga;
    l.armLx += -0.95 * ga;
    l.armLz += 0.3 * ga;
    l.bob -= 0.06 * ga;
  } else if (doing === DOING.DICE) {
    // Dice (P22): crouched over them, the right hand cupped and shaking, flung out at a throw (`pumped`).
    const ga = m.act;
    const shake = motion && m.diceShake && m.pumped < 0.05 ? Math.sin(t * 24) * 0.12 : 0;
    l.armRx += (-0.85 - m.pumped * 0.7 + shake) * ga;
    l.armRz += -0.12 * ga;
    l.armLx += -0.55 * ga;
    l.legL -= 0.35 * ga;
    l.legR -= 0.35 * ga;
    l.bob -= 0.1 * ga;
  } else if (doing === DOING.CARDS) {
    // Cheat (P27): crouched over the pile, the hand of cards held up close in the left, the
    // right laying them down now and then.
    const ga = m.act;
    const lay = motion ? Math.max(0, Math.sin(t * 1.3)) ** 6 : 0;
    l.armLx += -1.15 * ga;
    l.armLz += 0.32 * ga;
    l.armRx += (-0.6 - lay * 0.5) * ga;
    l.armRz += -0.12 * ga;
    l.legL -= 0.35 * ga;
    l.legR -= 0.35 * ga;
    l.bob -= 0.1 * ga;
  } else if (doing === DOING.BOARD) {
    // Checkers (P27): crouched at the board, the left hand on the knee, the right hovering over the pieces.
    const ga = m.act;
    const hover = motion ? Math.sin(t * 0.9) * 0.08 : 0;
    l.armLx += -0.55 * ga;
    l.armLz += 0.12 * ga;
    l.armRx += (-0.75 + hover) * ga;
    l.armRz += -0.1 * ga;
    l.legL -= 0.4 * ga;
    l.legR -= 0.4 * ga;
    l.bob -= 0.11 * ga;
  } else if (doing === DOING.SHOOT) {
    // A shot at the hoop (P27): the ball up over the head in both hands, the knees bent.
    const ga = m.act;
    // (The hands in under the ball, either side of it: in toward the middle.)
    l.armLx += -2.75 * ga;
    l.armRx += -2.75 * ga;
    l.armLz += 0.35 * ga;
    l.armRz -= 0.35 * ga;
    l.legL -= 0.18 * ga;
    l.legR -= 0.18 * ga;
    l.bob -= 0.035 * ga;
  } else if (doing === DOING.TATTOO) {
    // At work on a tattoo (P29): the working hand low and forward, buzzing a little; the other steadying the arm.
    const ga = m.act;
    const buzz = motion ? Math.sin(t * 40) * 0.03 : 0;
    l.armRx += (-0.75 + buzz) * ga;
    l.armLx += -0.55 * ga;
    l.armRz -= 0.15 * ga;
    l.armLz += 0.15 * ga;
    l.bob -= 0.02 * ga;
  } else if (doing === DOING.DRUMS) {
    // Bucket drums (P30): both sticks down onto the buckets in turn, on the beat; the head nods along.
    const ga = m.act;
    const beat = motion ? Math.sin(t * 13) : 0;
    l.armRx += (-0.62 + beat * 0.3) * ga;
    l.armLx += (-0.62 - beat * 0.3) * ga;
    l.armRz -= 0.12 * ga;
    l.armLz += 0.12 * ga;
    l.legL -= 0.25 * ga;
    l.legR -= 0.25 * ga;
    l.bob += (motion ? Math.abs(Math.sin(t * 6.5)) * 0.02 : 0) * ga - 0.06 * ga;
  } else if (doing === DOING.GUITAR) {
    // A guitar (P30): the left hand up the neck, the right strumming across the body.
    const ga = m.act;
    const strum = motion ? Math.sin(t * 12) * 0.16 : 0;
    l.armLx += -1.1 * ga;
    l.armLz += 0.42 * ga;
    l.armRx += (-1.0 + strum * 0.6) * ga;
    l.armRz -= 0.42 * ga;
    l.bob += (motion ? Math.abs(Math.sin(t * 4)) * 0.015 : 0) * ga;
  } else if (doing === DOING.QUIZ) {
    // At the buzzer (P30): the right hand ready over it, the left at the side, a little forward.
    const ga = m.act;
    l.armRx += -1.0 * ga;
    l.armRz -= 0.35 * ga;
    l.armLx += -0.15 * ga;
  } else if (doing === DOING.FOOTBALL && !moving) {
    // A kick wound up (P29): the kicking leg back, the arms out for balance.
    const ga = m.act;
    l.legR += 0.75 * ga;
    l.legL -= 0.12 * ga;
    l.armLz += 0.45 * ga;
    l.armRz -= 0.45 * ga;
    l.bob -= 0.03 * ga;
  } else if (doing === DOING.PHONE) {
    // On the pay phone (P34): the left hand up at the ear with the handset (the head tipped to
    // it), the right hand talking a little at the side. Held still with reduced motion.
    const ga = m.act;
    const talk = motion ? Math.sin(t * 1.7) * 0.14 + Math.sin(t * 0.6) * 0.06 : 0;
    l.armLx += PHONE_ARM * ga;
    l.armLz += -0.1 * ga;
    l.armRx += (-0.42 + talk) * ga;
    l.armRz += -0.08 * ga;
  } else if (doing === DOING.KIOSK) {
    // At the internet kiosk (P35): both forearms forward over the keyboard on its shelf, a little in
    // toward the middle, the hands tapping in turn (a typing bob). Held still with reduced motion.
    const ga = m.act;
    const tap = motion ? Math.sin(t * 15) * 0.07 + Math.sin(t * 6.1) * 0.03 : 0;
    l.armLx += (-1.38 + tap) * ga;
    l.armRx += (-1.38 - tap) * ga;
    l.armLz += 0.22 * ga;
    l.armRz -= 0.22 * ga;
  } else if (doing === DOING.VEND) {
    // At the vending machine (2.32): the right hand out at its keys, pressing, the other at the side. Held still with reduced motion.
    const ga = m.act;
    const tap = motion ? Math.max(0, Math.sin(t * 7)) * 0.09 : 0;
    l.armRx += (-1.35 + tap) * ga;
    l.armRz -= 0.12 * ga;
  } else if (doing === DOING.THUMP) {
    // Thumping it: the fist back and into its side, the shoulders with it; with reduced motion, the fist up against it.
    const ga = m.act;
    const hit = motion ? Math.sin(t * 16) * 0.42 : 0;
    l.armRx += (-1.3 + hit) * ga;
    l.armLx += (-0.5 - hit * 0.3) * ga;
    l.armRz -= 0.1 * ga;
  } else if (doing === DOING.SNACK) {
    // Something from the machine: a hand up to the mouth now and then, the other at the side.
    const ga = m.act;
    // (2.33: in toward the middle of the face, as at the water cooler, not out to the side.)
    const up = motion ? (Math.sin(t * 1.5) > 0.2 ? 1 : 0.55) : 0.8;
    l.armRx += -1.8 * up * ga;
    l.armRz -= 0.4 * up * ga;
  } else if (doing === DOING.DRINK) {
    // At the water cooler (2.33): the paper cup held in front of the mouth, the hand in toward the middle of the face,
    // lifted a little for each sip as the cup tips toward the lips (the cup's own tilt: below); the other hand at the side.
    const ga = m.act;
    m.sip = motion ? Math.max(0, Math.sin(t * 2.2)) : 0.5;
    l.armRx += (-1.86 - 0.14 * m.sip) * ga;
    l.armRz -= 0.42 * ga;
  } else if (doing === DOING.SCRIBBLE) {
    // At the menu board (2.33): the right arm up at it, the hand scrawling small loops; the other hand on the hip.
    const ga = m.act;
    const loop = motion ? Math.sin(t * 11) * 0.12 : 0;
    l.armRx += (-2.55 + loop) * ga;
    l.armRz -= (0.18 + (motion ? Math.cos(t * 11) * 0.1 : 0)) * ga;
    l.armLz += 0.35 * ga;
  } else if (doing === DOING.QUEUE) {
    // Waiting in line for the phone (P34): arms crossed, the weight shifting slowly from foot to foot (below).
    const ga = m.act;
    l.armLx += -0.95 * ga;
    l.armRx += -0.95 * ga;
    l.armLz += 0.55 * ga;
    l.armRz -= 0.55 * ga;
  } else if (doing === DOING.LOOKOUT) {
    // On watch (P23): a hand at the brow, clear of the head (a salute's reach: a rigid arm can't
    // get in front of the face), the other arm a little out; the whole body sweeps from side to
    // side (above), the head held still. Held still with reduced motion: it still says "on watch".
    const ga = m.act;
    l.armRx += -2.57 * ga;
    l.armRz += 0.15 * ga;
    l.armLx += -0.3 * ga;
    l.armLz += -0.15 * ga;
  } else if (doing === DOING.BRAWL) {
    // A brawl (P23): fists up, bobbing on the toes, a jab now and then from each hand in turn.
    const ga = m.act;
    const beat = (t * 1.9) % 2;
    const jabR = motion && beat < 0.35 ? Math.sin((beat / 0.35) * Math.PI) : 0;
    const jabL = motion && beat >= 1 && beat < 1.35 ? Math.sin(((beat - 1) / 0.35) * Math.PI) : 0;
    l.armRx += (-1.25 - jabR * 0.45) * ga;
    l.armRz += (-0.38 + jabR * 0.2) * ga;
    l.armLx += (-1.45 - jabL * 0.3) * ga;
    l.armLz += (0.36 - jabL * 0.2) * ga;
    l.legL += 0.18 * ga;
    l.legR -= 0.12 * ga;
    l.bob += (motion ? Math.abs(Math.sin(t * 7)) * 0.035 : 0) * ga - 0.02 * ga;
  }
}
