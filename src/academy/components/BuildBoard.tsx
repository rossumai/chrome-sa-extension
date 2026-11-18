import { h } from 'preact';
import { TRACK, type Names } from '../../training/track.js';
import { OUR_FIELDS } from '../../training/checks.js';
import { missionStatus, taskState, type Progress } from '../../training/progress.js';
import css from '../Academy.module.css';

type NodeState = 'built' | 'partial' | 'ghost';

// Where each object sits on the 520×456 board, and which mission builds it.
const LAYOUT = {
  queue: { mission: 'kickoff', left: 16, top: 18 },
  schema: { mission: 'fields', left: 16, top: 112 },
  hook: { mission: 'matching', left: 16, top: 262 },
  dataset: { mission: 'vendors', left: 328, top: 262 },
  rule: { mission: 'rules', left: 16, top: 376 },
  invoice: { mission: 'golive', left: 328, top: 376 },
} as const;

/** Built once its mission's tasks all pass now; partial while it exists or is being built. */
function stateOf(progress: Progress, missionId: string, exists: boolean): NodeState {
  const mission = TRACK.missions.find((m) => m.id === missionId)!;
  if (mission.tasks.every((t) => taskState(progress, t.id) === 'ok')) return 'built';
  if (exists || missionStatus(TRACK, progress, missionId) === 'active') return 'partial';
  return 'ghost';
}

export default function BuildBoard({ progress, names }: { progress: Progress; names: Names }) {
  const b = progress.build;
  const s = {
    queue: stateOf(progress, 'kickoff', !!b.queueId),
    schema: stateOf(progress, 'fields', (b.fields || []).length > 0),
    hook: stateOf(progress, 'matching', !!b.hookId),
    dataset: stateOf(progress, 'vendors', !!b.dataset),
    rule: stateOf(progress, 'rules', !!b.ruleId),
    invoice: stateOf(progress, 'golive', !!b.annotationCount),
  };
  const pos = (k: keyof typeof LAYOUT) => ({
    left: `${LAYOUT[k].left}px`,
    top: `${LAYOUT[k].top}px`,
  });
  const wire = (a: NodeState, z: NodeState): NodeState =>
    a === 'ghost' || z === 'ghost' ? 'ghost' : a === 'built' && z === 'built' ? 'built' : 'partial';
  return (
    <section class={css.build} aria-label="Your build">
      <div class={css.buildHead}>
        <h2 class={css.buildTitle}>Your build</h2>
        <span class={css.buildSub}>What the Academy reads in your org</span>
      </div>
      <div class={css.boardWrap}>
        <div class={css.board}>
          <svg class={css.wires} viewBox="0 0 520 456" aria-hidden="true">
            <path class={css.wire} data-state={wire(s.queue, s.schema)} d="M104 76 V112" />
            <path class={css.wire} data-state={wire(s.schema, s.hook)} d="M104 226 V262" />
            <path class={css.wire} data-state={wire(s.hook, s.dataset)} d="M192 296 H328" />
            <path class={css.wire} data-state={wire(s.hook, s.rule)} d="M104 336 V376" />
            <path class={css.wire} data-state={wire(s.rule, s.invoice)} d="M192 406 H328" />
          </svg>
          <div class={css.node} data-state={s.queue} style={pos('queue')}>
            <span class={css.nodeKind}>Queue</span>
            <b class={css.nodeName} title={names.queue}>
              {names.queue}
            </b>
            <span class={css.nodeId}>{b.queueId ? `queue ${b.queueId}` : 'not created yet'}</span>
          </div>
          <div class={css.node} data-state={s.schema} style={pos('schema')}>
            <span class={css.nodeKind}>Schema</span>
            <b class={css.nodeName}>
              {b.schemaId ? `schema ${b.schemaId}` : 'Your queue’s schema'}
            </b>
            <ul class={css.nodeFields}>
              {OUR_FIELDS.map((f) => {
                const on = (b.fields || []).includes(f);
                return (
                  <li key={f} class={on ? css.fieldOn : css.fieldOff}>
                    {on ? '+ ' : '○ '}
                    {f}
                  </li>
                );
              })}
            </ul>
          </div>
          <div class={css.node} data-state={s.hook} style={pos('hook')}>
            <span class={css.nodeKind}>Extension</span>
            <b class={css.nodeName}>Master Data Hub</b>
            <span class={css.nodeId}>{b.hookId ? `hook ${b.hookId}` : 'not attached yet'}</span>
            {b.matchesOn === 'other' && <span class={css.flag}>matches on another field</span>}
            {b.matchesOn === 'vat' && (
              <span class={`${css.flag} ${css.flagOk}`}>matches on VAT</span>
            )}
          </div>
          <div class={css.node} data-state={s.dataset} style={pos('dataset')}>
            <span class={css.nodeKind}>Dataset</span>
            <b class={css.nodeName} title={names.dataset}>
              {names.dataset}
            </b>
            <span class={css.nodeId}>
              {b.dataset ? `${b.records ?? 0} records` : 'not created yet'}
            </span>
          </div>
          <div class={css.node} data-state={s.rule} style={pos('rule')}>
            <span class={css.nodeKind}>Rule</span>
            <b class={css.nodeName}>PO required</b>
            <span class={css.nodeId}>{b.ruleId ? `rule ${b.ruleId}` : 'not created yet'}</span>
          </div>
          <div class={css.node} data-state={s.invoice} style={pos('invoice')}>
            <span class={css.nodeKind}>Invoice</span>
            <b class={css.nodeName}>
              {b.annotationId ? 'Confirmed' : b.annotationCount ? 'In your queue' : 'Not uploaded'}
            </b>
            <span class={css.nodeId}>
              {b.annotationId
                ? `annotation ${b.annotationId}`
                : `${b.annotationCount ?? 0} in queue`}
            </span>
          </div>
        </div>
      </div>
      <div class={css.legend}>
        <span class={`${css.legendItem} ${css.legendBuilt}`}>Checked</span>
        <span class={`${css.legendItem} ${css.legendPartial}`}>In progress</span>
        <span class={`${css.legendItem} ${css.legendGhost}`}>Later missions</span>
      </div>
    </section>
  );
}
