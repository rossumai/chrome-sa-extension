import { h } from 'preact';
import { useState } from 'preact/hooks';
import * as store from '../store.js';
import { mintReceipt, type MintResult } from '../mint.js';
import { fetchAcademyApi, whoami } from '../api.js';
import { TRACK, allTasks, namesFor } from '../../training/track.js';
import { isTrackComplete, taskState, type Progress } from '../../training/progress.js';
import { parseReceipt } from '../../training/receipt.js';
import Rich from './Rich.jsx';
import { useCopy } from './useCopy.js';
import css from '../Academy.module.css';
import ctl from '../../ui/controls.module.css';

// Each failure gets its own wording: only a check that no longer passes asks the trainee
// to change anything in the org.
export function noteFor(res: MintResult | null): string | null {
  if (!res || res.ok) return null;
  const task = allTasks(TRACK).find((x) => x.task.id === res.failedTask)?.task;
  switch (res.reason) {
    case 'not-passing':
      return task
        ? `Not issued. "${task.title.replace(/`/g, '')}" no longer checks out in your org. Fix it and issue again.`
        : 'Not issued. A task no longer checks out in your org.';
    case 'identity':
      return 'Not issued. The Academy could not read your Rossum user name and id. Reopen the Console from the extension popup and try again.';
    case 'unverifiable':
      return 'Not issued. The summary could not be read back, so your trainer’s check would reject it.';
    default:
      return `Not issued. Something went wrong${res.message ? `: ${res.message}` : ''}. Try again.`;
  }
}

const ROWS: Array<{ label: string; task: string; id: (p: Progress) => string }> = [
  {
    label: 'A queue for Acme invoices',
    task: 'kickoff.queue',
    id: (p) => `queue ${p.build.queueId ?? '–'}`,
  },
  {
    label: 'Fields `po_number`, `vendor_vat_id`, `vendor_match`',
    task: 'fields.match',
    id: (p) => `schema ${p.build.schemaId ?? '–'}`,
  },
  { label: 'The vendor master', task: 'vendors.records', id: (p) => namesFor(p.run).dataset },
  {
    label: 'Vendor matching by VAT number',
    task: 'matching.map',
    id: (p) => `hook ${p.build.hookId ?? '–'}`,
  },
  {
    label: 'A rule that stops invoices without a PO number',
    task: 'rules.block',
    id: (p) => `rule ${p.build.ruleId ?? '–'}`,
  },
  {
    label: 'One invoice confirmed end to end',
    task: 'golive.confirm',
    id: (p) => `annotation ${p.build.annotationId ?? '–'}`,
  },
];

export default function Handover({ progress }: { progress: Progress }) {
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();
  const names = namesFor(progress.run);
  const complete = isTrackComplete(TRACK, progress);
  const text = progress.receipt?.text || null;
  const parsed = text ? parseReceipt(text) : null;
  const missionOf = (taskId: string) =>
    TRACK.missions.find((m) => m.tasks.some((t) => t.id === taskId))!;

  const issue = async () => {
    setBusy(true);
    store.mintNote.value = null;
    try {
      store.mintNote.value = noteFor(await mintReceipt({ get: fetchAcademyApi, whoami }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article class={css.sheet}>
      <h1 class={css.sheetTitle}>
        {complete ? 'Acme Freight is live' : 'Acme Freight is not live yet'}
      </h1>
      <p class={css.sheetSub}>
        {complete
          ? `${names.queue} processes invoices end to end.`
          : 'Every row below must check out in your org before you can issue your summary.'}
      </p>
      {complete && (
        <blockquote class={css.reply}>
          The invoice arrived, Rossum matched the vendor by its VAT number, and it reached us with
          the right vendor id. That is exactly the rework we wanted gone.
          <span class={css.replyBy}>
            {TRACK.client.contact}, {TRACK.client.role} (fictional)
          </span>
        </blockquote>
      )}
      <table class={css.inv}>
        <thead>
          <tr>
            <th>What you built</th>
            <th>In the org</th>
            <th>Checked</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const mission = missionOf(r.task);
            const ok = mission.tasks.every((t) => taskState(progress, t.id) === 'ok');
            return (
              <tr key={r.task}>
                <td>
                  <Rich text={r.label} names={names} />
                </td>
                <td>
                  <code>{r.id(progress)}</code>
                </td>
                <td class={ok ? css.cellOk : css.cellNo}>{ok ? '✓ Passes' : 'Not yet'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div class={css.codeRow}>
        <div>
          <span class={css.codeLabel}>Completion code</span>
          <div class={css.code}>{parsed?.code || '––––-––––-––––-––––'}</div>
          <p class={css.fine}>
            Your trainer pastes the whole summary into their Academy to check it. Before issuing it,
            the Academy checks every row above in your org again. It is a training summary, not a
            credential: the signing key ships in the extension.
          </p>
        </div>
        {text ? (
          <button type="button" class={`${ctl.btn} ${ctl.btnPrimary}`} onClick={() => copy(text)}>
            <span aria-live="polite">
              {copied === 'copied'
                ? '✓ Copied. Paste it to your trainer'
                : copied === 'failed'
                  ? 'Copy failed. Select the text below'
                  : 'Copy summary for your trainer'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnPrimary}`}
            disabled={!complete || busy}
            onClick={issue}
          >
            {busy ? 'Checking your org…' : 'Issue summary'}
          </button>
        )}
        {text && <pre class={css.receiptText}>{text}</pre>}
        {store.mintNote.value && <p class={css.warnNote}>{store.mintNote.value}</p>}
      </div>
    </article>
  );
}
