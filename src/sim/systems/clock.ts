import { START_MINUTE, STEPS_PER_MINUTE } from '../tuning';

export interface Clock {
  /** 1 on the first day. */
  day: number;
  /** 0–1439. */
  minuteOfDay: number;
  hour: number;
  minute: number;
}

/** The prison clock after a number of steps (time is a pure function of the step). */
export function clockAt(step: number): Clock {
  const total = START_MINUTE + Math.floor(step / STEPS_PER_MINUTE);
  const minuteOfDay = total % 1440;
  return { day: Math.floor(total / 1440) + 1, minuteOfDay, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

/** "08:05". */
export const formatTime = (c: Clock) => `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;

/** True on the first step of each game hour (not at the very start). */
export const hourStarts = (step: number) => step > 0 && step % (STEPS_PER_MINUTE * 60) === 0;
