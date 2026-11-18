// Issuing the completion summary. Every task is checked again against the LIVE
// org first (scope 'all'), and every one must pass NOW — a task that passed once
// and was undone since blocks it.
//
// What that buys: the trainee's own named objects must still exist and still have
// the right shape. What it does NOT buy is forgery resistance: RECEIPT_KEY ships
// in the bundle by design (same trade-off as src/usage/ga4Config.ts). The summary
// is a training artifact, not a credential, and the in-app copy says so.
import { TRACK, allTasks } from '../training/track.js';
import { runChecks, type Get } from '../training/load.js';
import { recordResults, taskState, type Progress } from '../training/progress.js';
import { renderReceipt, mintCode, parseReceipt, canonicalString } from '../training/receipt.js';
import { hmacSha256 } from '../training/hmac.js';
import { RECEIPT_KEY } from '../training/receiptKey.js';
import { readProgress, writeProgress } from '../training/storage.js';
import * as store from './store.js';
import { track } from '../usage/track.js';

const sign = (msg: string) => hmacSha256(RECEIPT_KEY, msg);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What mintReceipt reports. Each arm declares the other arm's keys as `?: undefined`, so a
 * caller can read `.text` / `.failedTask` / `.message` and narrow from the value it finds.
 */
export type MintResult =
  | { ok: true; text: string; reason?: undefined; failedTask?: undefined; message?: undefined }
  | { ok: false; reason: string; failedTask?: string; message?: string; text?: undefined };

type MintDeps = { get: Get; whoami: () => Promise<any>; now: () => Date };

async function mint({ get, whoami, now }: MintDeps): Promise<MintResult> {
  const origin = store.getOrigin();
  const start = store.progress.value as Progress;
  const run = await runChecks(TRACK, start, get, { scope: 'all' });
  const latest = (await readProgress(origin, TRACK)) || start;
  let progress = recordResults(latest, run.results, run.build, Date.now()).progress;
  await writeProgress(origin, progress);
  store.progress.value = progress;

  // The visit task cannot be judged from the Console; its last result stands.
  const failing = allTasks(TRACK).find(({ task }) => taskState(progress, task.id) !== 'ok');
  if (failing) return { ok: false, reason: 'not-passing', failedTask: failing.task.id };

  const b = progress.build;
  const ids = [b.queueId, b.hookId, b.ruleId, b.annotationId];
  if (ids.some((n) => !Number.isInteger(n))) return { ok: false, reason: 'not-passing' };

  const me = await whoami();
  const userId = Number.isInteger(me?.id) ? me.id : Number(/\/(\d+)\/?$/.exec(me?.url || '')?.[1]);
  const username = String(me?.username ?? '').trim();
  // Both are load-bearing for the printed `user | <name> (id <n>)` line, which the
  // trainer's check has to parse back; `|` and newlines would make the signed string
  // ambiguous (canonicalString joins with `|` and does not escape).
  if (!Number.isFinite(userId) || !username || /[|\r\n]/.test(username)) {
    return { ok: false, reason: 'identity' };
  }

  const fields = {
    trackId: TRACK.id,
    trackVersion: TRACK.version,
    host: new URL(origin).host,
    userId,
    username,
    queueId: b.queueId as number,
    hookId: b.hookId as number,
    ruleId: b.ruleId as number,
    annotationId: b.annotationId as number,
    dateUtc: iso(now()),
  };
  const code = await mintCode(fields, sign);
  const text = renderReceipt(fields, code);
  // Last gate: a summary that does not survive parse-and-re-sign can never verify.
  const back = parseReceipt(text);
  if (!back || back.code !== code || canonicalString(back.fields) !== canonicalString(fields)) {
    return { ok: false, reason: 'unverifiable' };
  }

  progress = { ...progress, receipt: { text, issuedAt: Date.now() } };
  await writeProgress(origin, progress);
  store.progress.value = progress;
  track('sa_training_receipt_issue');
  return { ok: true, text };
}

// Error boundary: an expired token rejects every read, and this is the last click of
// the whole track — without it the button would sit on "Checking…" for ever.
export async function mintReceipt({
  get,
  whoami,
  now = () => new Date(),
}: Partial<MintDeps> & Pick<MintDeps, 'get' | 'whoami'>): Promise<MintResult> {
  try {
    return await mint({ get, whoami, now });
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e as any)?.message || e) };
  }
}
