import { h } from 'preact';
import { healthLabel } from '../statsSummary.js';
import { formatBytes } from './StatsBits.jsx';
import Tip from '../../ui/Tip.jsx';
import ssum from './StatsSummary.module.css';

function healthColor(score: any) {
  if (score >= 90) return 'var(--success)';
  if (score >= 75) return 'var(--accent)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

const COMPONENT_LABELS = [
  [
    'fieldCoverage',
    'Field coverage',
    'Average share of documents that have a real value (not null, missing, or empty), averaged across all fields.',
  ],
  [
    'typeConsistency',
    'Type consistency',
    'Share of fields whose values are all one data type. Mixing types (e.g. text and number) lowers this; whole vs. decimal numbers are both "number" and do not count as a mix.',
  ],
  [
    'valueCompleteness',
    'Value completeness',
    'Share of fields with no null, empty, missing, or placeholder values ("n/a", "none", "-", …).',
  ],
  [
    'whitespace',
    'Cleanliness',
    'Share of text fields with no leading or trailing whitespace — invisible spaces that make identical-looking values fail to match.',
  ],
  [
    'schema',
    'Schema',
    'Whether all documents share the same structure. Multiple field-count shapes (from merged imports or optional fields) lower this.',
  ],
];

function Ring({ health }: { health?: number | null }) {
  const tone = health != null ? healthColor(health) : 'var(--text-secondary)';
  const R = 44;
  const circ = 2 * Math.PI * R; // 276.46
  const off = health != null ? circ * (1 - health / 100) : circ;
  return (
    <div class={ssum.statsRing}>
      <svg width="104" height="104" viewBox="0 0 104 104">
        <circle cx="52" cy="52" r={R} fill="none" stroke="var(--bg-hover)" stroke-width="11" />
        {health != null && (
          <circle
            cx="52"
            cy="52"
            r={R}
            fill="none"
            stroke={tone}
            stroke-width="11"
            stroke-linecap="round"
            stroke-dasharray={circ}
            stroke-dashoffset={off}
            transform="rotate(-90 52 52)"
          />
        )}
      </svg>
      <div class={ssum.statsRingNum}>
        <b style={{ color: tone }}>{health != null ? health : '?'}</b>
        <span>/ 100</span>
      </div>
    </div>
  );
}

export default function StatsSummary({
  health,
  components,
  total,
  fieldCount,
  fieldsTotal,
  storage,
  docSize,
  sampled,
}: {
  health?: number | null;
  components?: any;
  /** Read unconditionally by the overview cards. */
  total: number;
  fieldCount: number;
  fieldsTotal: number;
  /** $collStats storage figures; each card is guarded on the object being present. */
  storage?: { size: number; freeStorageSize: number; storageSize: number } | null;
  docSize?: { min: number | null; max: number | null; avg: number } | null;
  /** Sample size the field-level numbers came from, or null on an exact run. */
  sampled?: number | null;
}) {
  const tone = health != null ? healthColor(health) : 'var(--text-secondary)';
  return (
    <div>
      <div class={ssum.statsBandLabel}>Summary</div>
      <div class={ssum.statsDash}>
        <div
          class={ssum.statsHealth}
          title={health != null ? healthLabel(health) : `calculating${'…'}`}
        >
          <Ring health={health} />
          {health != null && (
            <div class={ssum.statsHealthLabel} style={{ color: tone }}>
              {healthLabel(health)}
            </div>
          )}
        </div>
        <div class={ssum.statsDashRight}>
          <div class={ssum.statsOverviewGrid}>
            <div class={ssum.statsOverviewCard}>
              <div class={ssum.statsMetricValue}>{total.toLocaleString()}</div>
              <div class={ssum.statsMetricLabel}>Documents</div>
            </div>
            <div
              class={ssum.statsOverviewCard}
              title={
                fieldsTotal > fieldCount
                  ? `Analyzing the ${fieldCount} most common of ${fieldsTotal} fields found`
                  : undefined
              }
            >
              <div class={ssum.statsMetricValue}>{fieldCount}</div>
              <div class={ssum.statsMetricLabel}>Fields</div>
            </div>
            {storage && (
              <div
                class={ssum.statsOverviewCard}
                title={`Logical: ${formatBytes(storage.size)} · Free: ${formatBytes(storage.freeStorageSize)}`}
              >
                <div class={ssum.statsMetricValue}>{formatBytes(storage.storageSize)}</div>
                <div class={ssum.statsMetricLabel}>On disk</div>
              </div>
            )}
            {docSize && (
              <div
                class={ssum.statsOverviewCard}
                title={
                  docSize.min != null && docSize.max != null
                    ? `Min: ${formatBytes(docSize.min)} · Max: ${formatBytes(docSize.max)}`
                    : undefined
                }
              >
                <div class={ssum.statsMetricValue}>{formatBytes(docSize.avg)}</div>
                <div class={ssum.statsMetricLabel}>Avg doc</div>
              </div>
            )}
          </div>
          {fieldsTotal > fieldCount && (
            <div class={ssum.statsFieldsNote}>
              Analyzing the {fieldCount} most common of {fieldsTotal} fields found in the sample.
            </div>
          )}
          {components && (
            <div class={ssum.statsHcompWrap}>
              {[COMPONENT_LABELS.slice(0, 3), COMPONENT_LABELS.slice(3)].map((group) => (
                <div class={ssum.statsHcomp}>
                  {group.map(([key, label, tip]) => {
                    const v = Math.round(components[key]);
                    const c = healthColor(v);
                    return (
                      <div class={ssum.statsHcompRow}>
                        <span class={ssum.statsHcompLabel}>
                          {label}
                          <Tip text={tip}>
                            <span class={ssum.statsHelp}>?</span>
                          </Tip>
                        </span>
                        <div class={ssum.statsHbar}>
                          <i style={{ width: `${v}%`, background: c }} />
                        </div>
                        <span class={ssum.statsHcompVal}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sampled != null && (
        <div class={ssum.statsNote} style={{ marginTop: '10px' }}>
          Estimated from a random sample of <b>{sampled.toLocaleString()}</b> of{' '}
          {total.toLocaleString()} documents. Document count and storage are exact.
        </div>
      )}
    </div>
  );
}
