// PURE. No chrome APIs, no DOM, no network. Owns the shape of a trainee's
// progress for ONE org and the unlock rule.
//
// A task is complete when its LATEST check passes, and only then (owner,
// 2026-11-16): work undone in the org — a deleted queue — makes its task, and its
// mission, incomplete again, and the missions after it wait. There is no separate
// "passed once" state.
import { allTasks, isRunCode, type Mission, type Track } from './track.js';
import { taskOk, type Assertion, type Build } from './checks.js';
export type TaskResult = { at: number; assertions: Assertion[] };

export type Progress = {
  trackId: string;
  trackVersion: number;
  startedAt: number;
  /** This run's code (newRunCode); every object name of the run is built from it. */
  run: string;
  results: Record<string, TaskResult>;
  build: Build;
  receipt?: { text: string; issuedAt: number } | null;
};

/** 'ok' when the latest check passed; 'open' otherwise. */
export type TaskState = 'ok' | 'open';

export function emptyProgress(track: Track, run: string, at: number): Progress {
  return {
    trackId: track.id,
    trackVersion: track.version,
    startedAt: at,
    run,
    results: {},
    build: {},
  };
}

/** Folds one check run in. Returns the ids of tasks that are complete now and were not. */
export function recordResults(
  progress: Progress,
  results: Record<string, Assertion[]>,
  build: Build,
  at: number,
): { progress: Progress; newlyPassed: string[] } {
  const nextResults = { ...progress.results };
  const newlyPassed: string[] = [];
  for (const [id, assertions] of Object.entries(results)) {
    if (taskOk(assertions) && !taskOk(progress.results[id]?.assertions)) newlyPassed.push(id);
    nextResults[id] = { at, assertions };
  }
  return {
    progress: { ...progress, results: nextResults, build: { ...progress.build, ...build } },
    newlyPassed,
  };
}

export function taskState(progress: Progress, taskId: string): TaskState {
  return taskOk(progress.results[taskId]?.assertions) ? 'ok' : 'open';
}

const complete = (progress: Progress, mission: Mission) =>
  mission.tasks.every((t) => taskState(progress, t.id) === 'ok');

export function missionStatus(
  track: Track,
  progress: Progress,
  missionId: string,
): 'done' | 'active' | 'locked' {
  const idx = track.missions.findIndex((m) => m.id === missionId);
  if (idx < 0) return 'locked';
  if (complete(progress, track.missions[idx])) return 'done';
  return track.missions.slice(0, idx).every((m) => complete(progress, m)) ? 'active' : 'locked';
}

/** The first mission not yet complete; the last one once the whole track is. */
export function currentMission(track: Track, progress: Progress): Mission | null {
  return (
    track.missions.find((m) => !complete(progress, m)) ||
    track.missions[track.missions.length - 1] ||
    null
  );
}

/**
 * The missions opened so far: the complete ones and the current one. Checks re-read all
 * of them, so undoing earlier work makes its mission incomplete again at once.
 */
export function reachedMissions(track: Track, progress: Progress): Mission[] {
  const current = currentMission(track, progress);
  const end = current ? track.missions.indexOf(current) : -1;
  return track.missions.slice(0, end + 1);
}

/** The task to work on: the first incomplete task of the current mission. */
export function currentTask(track: Track, progress: Progress) {
  const mission = currentMission(track, progress);
  if (!mission) return null;
  const index = mission.tasks.findIndex((t) => taskState(progress, t.id) !== 'ok');
  if (index < 0) return null;
  return { mission, task: mission.tasks[index], index };
}

/** Every task passes NOW — the receipt's condition. */
export function isTrackComplete(track: Track, progress: Progress): boolean {
  return allTasks(track).every(({ task }) => taskState(progress, task.id) === 'ok');
}

export function checkedCount(track: Track, progress: Progress): { done: number; total: number } {
  const tasks = allTasks(track);
  return {
    done: tasks.filter(({ task }) => taskState(progress, task.id) === 'ok').length,
    total: tasks.length,
  };
}

// Reconcile stored progress against the shipped track: drop task ids that no
// longer exist, and mark a receipt issued against another version stale.
export function migrate(track: Track, progress: Progress | null | undefined): Progress | null {
  // A record without a run code predates run codes and cannot be checked.
  if (!progress || progress.trackId !== track.id || !isRunCode(progress.run)) return null;
  if (progress.trackVersion === track.version) return progress;
  const known = new Set(allTasks(track).map(({ task }) => task.id));
  const keep = <T>(rec: Record<string, T>) =>
    Object.fromEntries(Object.entries(rec || {}).filter(([k]) => known.has(k)));
  return {
    ...progress,
    trackVersion: track.version,
    results: keep(progress.results),
    receipt: null,
  };
}
