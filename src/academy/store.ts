// The Academy's state. Progress lives in chrome.storage.local per org origin
// (src/training/storage.ts), and another Console tab may write it too, so every
// write here is a read-modify-write against what is stored NOW.
import { signal } from '@preact/signals';
import { TRACK, newRunCode, isRunCode } from '../training/track.js';
import {
  emptyProgress,
  recordResults,
  currentMission,
  type Progress,
} from '../training/progress.js';
import { runChecks } from '../training/load.js';
import { readProgress, writeProgress, clearProgress } from '../training/storage.js';
import { isRateLimited, rateLimitMessage } from '../net/rateLimit.js';
import { fetchAcademyApi } from './api.js';
import { findRunObjects, deleteRunObjects, type RunObject } from './cleanup.js';
import { track } from '../usage/track.js';

export const connected = signal<boolean | null>(null); // null = unprobed
export const progress = signal<Progress | null>(null);
/** The mission the trainee is reading; null follows the current one. */
export const selectedMission = signal<string | null>(null);
export const error = signal<string | null>(null);
export const checking = signal(false);
/** One line under the mission header: when the org was last checked, or why not. */
export const checkStatus = signal<string | null>(null);
export const rateLimited = signal(false);
export const showTrainer = signal(false);
// The outcome of the last receipt attempt. Kept here, not in the component, so it survives
// the re-render a failed re-check causes.
export const mintNote = signal<string | null>(null);

let origin = '';
export function setOrigin(value: string) {
  origin = value;
}
export function getOrigin() {
  return origin;
}

export async function refreshProgress() {
  progress.value = await readProgress(origin, TRACK);
  return progress.value;
}

/**
 * Runs the current mission's checks against the org and stores the results. When that
 * completes the mission, the next one is checked too, and so on — resuming a run whose
 * objects already exist walks forward to where the trainee really is.
 */
export async function checkNow() {
  for (let i = 0; i < TRACK.missions.length; i++) {
    const before = progress.value && currentMission(TRACK, progress.value)?.id;
    await checkOnce();
    const after = progress.value && currentMission(TRACK, progress.value)?.id;
    if (!before || before === after || rateLimited.value) return;
  }
}

async function checkOnce() {
  const p = progress.value;
  if (!p || checking.value) return;
  checking.value = true;
  try {
    const run = await runChecks(TRACK, p, fetchAcademyApi);
    const latest = (await readProgress(origin, TRACK)) || p;
    const before = currentMission(TRACK, latest);
    const next = recordResults(latest, run.results, run.build, Date.now()).progress;
    await writeProgress(origin, next);
    progress.value = next;
    rateLimited.value = false;
    checkStatus.value = `Checked your org at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (before && currentMission(TRACK, next)?.id !== before.id) {
      track('sa_training_mission_complete');
      // Follow the trainee into the mission that just opened.
      if (selectedMission.value === before.id) selectedMission.value = null;
    }
  } catch (e) {
    if (isRateLimited(e)) {
      rateLimited.value = true;
      checkStatus.value = rateLimitMessage(e);
    } else {
      checkStatus.value = `Could not check your org: ${(e as any)?.message || e}`;
    }
  } finally {
    checking.value = false;
  }
}

/** Starts a run with a fresh code — never the one just finished, so its objects stay out. */
export async function startTrack(now = Date.now, random = Math.random) {
  try {
    const existing = await readProgress(origin, TRACK);
    if (existing) {
      progress.value = existing;
      return;
    }
    let run = newRunCode(random);
    for (let i = 0; i < 8 && run === lastRun; i++) run = newRunCode(random);
    const fresh = emptyProgress(TRACK, run, now());
    await writeProgress(origin, fresh);
    progress.value = fresh;
    selectedMission.value = null;
    track('sa_training_start');
    await checkNow();
  } catch (e) {
    error.value = `Could not start the project: ${(e as any)?.message || e}`;
  }
}

/**
 * Continues a run from its code: on another computer, or after this browser's storage
 * was cleared. Progress lives in this browser only; the run's objects live in the org,
 * and the checks re-derive what passed from them.
 */
export async function continueRun(code: string, now = Date.now) {
  const run = code.trim().toLowerCase();
  if (!isRunCode(run)) {
    error.value = `"${code.trim()}" is not a run code. It looks like barge-17: a word, a dash, two digits.`;
    return;
  }
  try {
    const fresh = emptyProgress(TRACK, run, now());
    await writeProgress(origin, fresh);
    progress.value = fresh;
    selectedMission.value = null;
    error.value = null;
    await checkNow();
  } catch (e) {
    error.value = `Could not continue run ${run}: ${(e as any)?.message || e}`;
  }
}

// The run that was just left, so the next one never reuses its code.
let lastRun: string | null = null;

/**
 * Start over: what the run built, and where the dialog is. `failed` lists what could not
 * be deleted, with Rossum's answer; the run is kept until everything is gone.
 */
export type StartOver =
  | { phase: 'loading' }
  | { phase: 'ready'; items: RunObject[] }
  | { phase: 'working'; items: RunObject[] }
  | { phase: 'failed'; items: RunObject[]; failed: Array<{ item: RunObject; message: string }> }
  | { phase: 'error'; message: string };
export const startOver = signal<StartOver | null>(null);

export async function openStartOver() {
  const p = progress.value;
  if (!p) return;
  startOver.value = { phase: 'loading' };
  try {
    startOver.value = { phase: 'ready', items: await findRunObjects(p.run, fetchAcademyApi) };
  } catch (e) {
    startOver.value = {
      phase: 'error',
      message: isRateLimited(e) ? rateLimitMessage(e) : String((e as any)?.message || e),
    };
  }
}

async function beginNewRun() {
  lastRun = progress.value?.run ?? null;
  await clearProgress(origin);
  progress.value = null;
  selectedMission.value = null;
  mintNote.value = null;
  checkStatus.value = null;
  startOver.value = null;
  await startTrack();
}

/** "Keep them": a new run with a new code. Nothing in the org changes. */
export async function startOverKeeping() {
  try {
    await beginNewRun();
  } catch (e) {
    error.value = `Could not start over: ${(e as any)?.message || e}`;
  }
}

/** "Delete them": deletes what this run built, then starts a new run — only if all went. */
export async function startOverDeleting() {
  const s = startOver.value;
  if (!s || (s.phase !== 'ready' && s.phase !== 'failed')) return;
  const items = s.phase === 'failed' ? s.failed.map((f) => f.item) : s.items;
  startOver.value = { phase: 'working', items };
  const result = await deleteRunObjects(items, fetchAcademyApi);
  if (result.failed.length) {
    startOver.value = { phase: 'failed', items, failed: result.failed };
    return;
  }
  try {
    await beginNewRun();
  } catch (e) {
    error.value = `Could not start over: ${(e as any)?.message || e}`;
  }
}

/** Opens a Rossum page next to this one. */
export async function openInRossum(path: string) {
  // Right next to the Console's own tab, not at the end of the window.
  const here = await chrome.tabs.getCurrent();
  chrome.tabs.create(
    here
      ? {
          url: `${origin}${path}`,
          index: here.index + 1,
          windowId: here.windowId,
          openerTabId: here.id,
        }
      : { url: `${origin}${path}` },
  );
}
