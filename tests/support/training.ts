// Shared fixtures for the Academy tests.
//
// Track/Mission/Task carry presentation fields (letter, why, where) that the
// progress arithmetic never reads. Tests still build the complete shape rather
// than a partial one, so a fixture cannot drift from the type the real TRACK
// satisfies; pass only the fields the assertion is about.
import type { Track, Mission, Task } from '../../src/training/track.js';
import { TRACK } from '../../src/training/track.js';
import { emptyProgress, type Progress } from '../../src/training/progress.js';
import type { Assertion } from '../../src/training/checks.js';

export const task = (p: Partial<Task> & Pick<Task, 'id'>): Task => ({
  title: '',
  why: '',
  where: '',
  needs: [],
  ...p,
});

export const mission = (p: Partial<Mission> & Pick<Mission, 'id' | 'tasks'>): Mission => ({
  title: '',
  summary: '',
  minutes: 1,
  letter: [],
  ...p,
});

export const track = (p: Partial<Track> & Pick<Track, 'id' | 'version' | 'missions'>): Track => ({
  title: '',
  client: { name: '', initials: '', contact: '', role: '' },
  ...p,
});

export const okAssertion = (id = 'a'): Assertion => ({ id, label: id, state: 'ok' });
export const noAssertion = (id = 'a'): Assertion => ({ id, label: id, state: 'no', fix: 'fix it' });

/** Progress on the real TRACK where every task of the first `missions` missions passes now. */
export function progressThrough(missions: number, run = 'barge-17'): Progress {
  const p = emptyProgress(TRACK, run, 1);
  for (const m of TRACK.missions.slice(0, missions)) {
    for (const t of m.tasks) {
      p.results[t.id] = { at: 1, assertions: [okAssertion()] };
    }
  }
  return p;
}
