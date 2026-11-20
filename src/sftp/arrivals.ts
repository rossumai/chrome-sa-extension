// src/sftp/arrivals.ts
// The arrival strip above a folder's files: how many files were modified on each of the last
// DAYS days, and which weekdays had none. A daily export that missed a day, or a client upload
// that never came, shows up as a gap. Pure; days are local calendar days.

export type Entry = { name: string; size: number; mtime: number; dir: boolean };

export type Day = {
  /** Local midnight of the day. */
  start: Date;
  files: Entry[];
  weekend: boolean;
};

export const DAYS = 14;

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `mtime` is in seconds, as SFTP returns it. */
export function dayOf(e: { mtime: number }): Date {
  return midnight(new Date(e.mtime * 1000));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function arrivalDays(entries: Entry[], now: Date): Day[] {
  const today = midnight(now);
  const days: Day[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ start, files: [], weekend: start.getDay() === 0 || start.getDay() === 6 });
  }
  for (const e of entries) {
    if (e.dir) continue;
    const d = dayOf(e);
    const day = days.find((x) => sameDay(x.start, d));
    if (day) day.files.push(e);
  }
  return days;
}

/**
 * The weekdays with nothing, but only those after the first day that had a file: a folder
 * that started receiving files a week ago has no gaps before that.
 */
export function gapDays(days: Day[]): Day[] {
  const first = days.findIndex((d) => d.files.length > 0);
  if (first < 0) return [];
  return days.slice(first).filter((d) => !d.weekend && d.files.length === 0);
}
