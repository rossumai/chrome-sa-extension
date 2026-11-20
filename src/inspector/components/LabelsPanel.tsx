import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import * as store from '../store.js';
import { loadLabelContext } from '../index.jsx';
import { labelAttribution, contrastText } from '../culprit.js';
import CulpritChip from './CulpritChip.jsx';
import ReliabilityBadge from './ReliabilityBadge.jsx';
import FoldableCode from './FoldableCode.jsx';
import dg from '../../ui/fabry/Diagnosis.module.css';
import styles from './Inspector.module.css';

// Render a label with its real color, as a tag (Rossum labels carry only a
// color hex — no shape attribute — so this is the conventional label shape).
function LabelChip({ name, color }: { name?: string; color?: string }) {
  const style = color ? `background:${color};color:${contrastText(color)}` : undefined;
  return (
    <span class={styles.labelTag + (color ? '' : ' ' + styles.noColor)} style={style}>
      {name}
    </span>
  );
}

// Applied WITHOUT a rule: no audited applier exists, so an agent reads the
// queue's hook code/settings/logs and reasons out which extension applied it.
function AiLabelAttribution({ label }: { label: any }) {
  const key = `label:${label.id}`;
  const attr = store.attributions.value[key];
  if (!store.aiAvailable.value)
    return <span class={styles.labelWhy}>AI attribution unavailable</span>;
  if (!attr || attr.status === 'loading')
    return (
      <span class={styles.labelWhy + ' ' + styles.loading + ' ' + styles.aiPhase}>
        {(attr && attr.phase) || 'thinking'}…
      </span>
    );
  if (attr.status === 'error') return <span class={styles.labelWhy}>AI attribution failed</span>;
  const v = attr.verdict;
  return (
    <span class={styles.aiVerdictInline}>
      <CulpritChip culprit={v.culprit} /> <ReliabilityBadge level={v.confidence} />
      {v.explanation && <span class={styles.why}>{v.explanation}</span>}
    </span>
  );
}

export default function LabelsPanel() {
  const d = store.data.value;

  useEffect(() => {
    if (store.data.value && store.data.value.resolved.labelsById === undefined) loadLabelContext();
  }, [store.annotationId.value]);

  if (!d) return null;
  if (d.resolved.labelsById === undefined) return <div class={styles.loading}>Loading labels…</div>;

  const { applied, notApplied } = labelAttribution({
    annotation: d.annotation,
    labelsById: d.resolved.labelsById,
    labelRules: d.resolved.labelRules || [],
  });
  // Verified signal only: rule-governed label automation. Non-rule applications
  // are now individually explained by the AI attribution card above (which may
  // find a hook or conclude manual) rather than a queue-wide capability guess.
  const hasLabelAutomation = (d.resolved.labelRules || []).length > 0;

  return (
    <div class={styles.panel}>
      <div class={styles.sect}>Applied labels ({applied.length})</div>
      {applied.length === 0 && <div class={dg.empty}>No labels applied to this annotation.</div>}
      {applied.map((l: any) => {
        if (l.rule) {
          return (
            <div class={styles.bcard} data-evidence-id={`label:${l.id}`}>
              <div class={styles.ttl}>
                <LabelChip name={l.name} color={l.color} />
                <span class={styles.labelWhy}>
                  applied by rule <b>{l.rule.name}</b>
                </span>
                <ReliabilityBadge level="verified" />
              </div>
              {l.rule.trigger ? (
                <div class={styles.why}>
                  fires when: <FoldableCode code={l.rule.trigger} />
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <div class={styles.bcard} data-evidence-id={`label:${l.id}`}>
            <div class={styles.ttl}>
              <LabelChip name={l.name} color={l.color} /> <AiLabelAttribution label={l} />
            </div>
          </div>
        );
      })}

      {notApplied.length > 0 && (
        <div>
          <div class={styles.sect} style="margin-top:18px">
            Governed by a rule but not applied ({notApplied.length})
          </div>
          {notApplied.map((l) => (
            <div class={styles.bcard} data-evidence-id={`label-not:${l.id}`}>
              <div class={styles.ttl}>
                <LabelChip name={l.name} color={l.color} />
                <span class={styles.labelWhy}>
                  not applied — rule <b>{l.rule.name}</b> did not fire
                </span>
                <ReliabilityBadge level={l.reliability} />
              </div>
              {l.rule.trigger ? (
                <div class={styles.why}>
                  would apply when: <FoldableCode code={l.rule.trigger} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!hasLabelAutomation && (
        <div class={styles.note}>
          {applied.length > 0
            ? 'No queue rule governs labels — see the attribution shown for each applied label above.'
            : 'No queue rule governs labels on this queue.'}
        </div>
      )}
    </div>
  );
}
