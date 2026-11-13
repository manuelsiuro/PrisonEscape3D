import type { CityMood } from '../audio/cityScore';

/**
 * Which of the city's five moods plays (2.51), from what is happening: the last stand at a way out
 * before anything; then being chased, which lingers a few seconds after the last of the dead loses
 * the player (no flicker at a corner); then the hour, and at night whether the player is behind a
 * barred door or in a survivor's building. Pure: `citymusictest` walks it through a night.
 */
export interface MusicCue {
  /** The last stand: a way out set going in this district and the dead called to it (the beacon's and the gates' holds; the boat only while its tide is in). */
  going: boolean;
  /** How many of the dead are after the player. */
  chasing: number;
  night: boolean;
  /** In a building the dead leave alone: every street door barred, or a survivor's. */
  safe: boolean;
}

/** The chase's music goes on this long (seconds) after the last of them gives up. */
export const CHASE_LINGER = 4;

export class CityMusic {
  /** When one of the dead was last after the player (seconds; far back: never). */
  private chased = -1e9;

  reset() {
    this.chased = -1e9;
  }

  pick(cue: MusicCue, now: number): CityMood {
    if (cue.chasing > 0) this.chased = now;
    if (cue.going) return 'cityHold';
    if (now - this.chased < CHASE_LINGER) return 'cityChase';
    if (!cue.night) return 'cityDay';
    return cue.safe ? 'cityShelter' : 'cityNight';
  }
}
