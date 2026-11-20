import { h } from 'preact';
import { selectedCollection } from '../store.js';
import useStageCounts from '../hooks/useStageCounts.js';
import pd from './PipelineDebug.module.css';

// A stage/input whose measured end-to-end latency exceeds this is flagged slow
// (the timing turns orange). Matches the threshold the record-list footer used
// before the slow-query warning moved here from the footer.
const SLOW_QUERY_MS = 1000;
const timeCls = (ms: number) =>
  pd.pipelineDebugTime + (ms > SLOW_QUERY_MS ? ` ${pd.pipelineDebugTimeSlow}` : '');

// Map a stage/input count result ({count} | {error} | undefined) to the count
// cell's text + class. Shared by the per-stage rows and the 0th input row.
function countCell(info: any) {
  if (!info) return { text: '…', cls: pd.pipelineDebugCount };
  if (info.error) {
    return {
      text: info.error.status ? `HTTP ${info.error.status}` : 'error',
      cls: `${pd.pipelineDebugCount} ${pd.pipelineDebugError}`,
    };
  }
  return {
    text: `${info.count.toLocaleString()} docs`,
    cls: pd.pipelineDebugCount + (info.count === 0 ? ` ${pd.pipelineDebugZero}` : ''),
  };
}

export default function PipelineDebug({
  entries,
  onToggleStage,
  onInspectStage,
}: {
  entries?: any[];
  onToggleStage?: (i: number) => void;
  onInspectStage?: (i: number) => void;
}) {
  const collection = selectedCollection.value;

  const list = Array.isArray(entries) ? entries : [];
  const activeStages = list.filter((e) => !e.disabled).map((e) => e.stage);
  const { counts: stageCounts, inputInfo } = useStageCounts(collection as string, activeStages) as {
    counts: Record<number, any>;
    inputInfo: any;
  };

  if (list.length === 0) return null;

  function inspectStage(activeIndex: number) {
    if (onInspectStage) onInspectStage(activeIndex);
  }
  function inspectInput() {
    if (onInspectStage) onInspectStage(-1);
  }

  const timingTitle =
    'End-to-end latency for the prefix up to this stage (network + server + contention with parallel debug requests). Cumulative — not per-stage MongoDB executor time. Data Storage does not expose explain output.';
  const inputTimingTitle =
    'End-to-end latency of the $collStats document count for the whole collection (network + server). This is a metadata count, so it is typically near-instant — not a measure of how long a full scan would take.';
  const inputCell = countCell(inputInfo);

  let activeIdx = -1;
  let displayNo = 0;

  return (
    <div class={pd.pipelineDebug}>
      <div class={pd.placeholderLabel}>Aggregate Pipeline Debug</div>
      <div class={pd.pipelineDebugStageWrap}>
        <div
          class={`${pd.pipelineDebugRow} ${pd.pipelineDebugInputRow}`}
          onClick={inspectInput}
          title="All documents in the collection — the input to stage 1. Click to preview the first few raw documents."
        >
          <span class={pd.pipelineStageToggleSpacer} />
          <span class={pd.pipelineDebugNum}>0.</span>
          <span class={pd.pipelineDebugStage}>input</span>
          <span class={pd.pipelineDebugPreview}>all records (pipeline input)</span>
          <span class={pd.pipelineDebugArrow}>{'→'}</span>
          <span class={inputCell.cls}>{inputCell.text}</span>
          {inputInfo?.ms != null && (
            <span class={timeCls(inputInfo.ms)} title={inputTimingTitle}>
              {inputInfo.ms}ms
            </span>
          )}
        </div>
        {inputInfo?.error && (
          <div class={pd.pipelineDebugErrorDetail} onClick={(e) => e.stopPropagation()}>
            <div class={pd.pipelineDebugErrorMsg}>{inputInfo.error.message}</div>
            <div class={pd.pipelineDebugErrorHint}>
              Couldn{'’'}t read the collection{'’'}s documents.
            </div>
          </div>
        )}
      </div>
      {list.map((entry, entryIndex) => {
        const stage = entry.stage || {};
        const stageKey = Object.keys(stage)[0] || '?';
        const stageStr = JSON.stringify(stage);
        const preview = stageStr.length > 50 ? stageStr.slice(0, 50) + '…' : stageStr;
        const toggle = (
          <input
            type="checkbox"
            class={pd.pipelineStageToggle + (entry.disabled ? ' pipeline-stage-toggle-off' : '')}
            checked={!entry.disabled}
            title={entry.disabled ? 'Enable stage' : 'Disable stage'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStage && onToggleStage(entryIndex);
            }}
          />
        );

        if (entry.disabled) {
          return (
            <div class={pd.pipelineDebugStageWrap} key={entryIndex}>
              <div class={`${pd.pipelineDebugRow} ${pd.pipelineDebugDisabled}`}>
                {toggle}
                <span class={pd.pipelineDebugNum}>{'–'}</span>
                <span class={pd.pipelineDebugStage}>{stageKey}</span>
                <span class={pd.pipelineDebugPreview}>{preview}</span>
                <span class={pd.pipelineDebugDisabledBadge}>disabled</span>
              </div>
            </div>
          );
        }

        activeIdx += 1;
        displayNo += 1;
        const myActiveIdx = activeIdx;
        const myDisplayNo = displayNo;
        const info = stageCounts[myActiveIdx];
        const { text: countText, cls: countCls } = countCell(info);

        return (
          <div class={pd.pipelineDebugStageWrap} key={entryIndex}>
            <div class={pd.pipelineDebugRow} onClick={() => inspectStage(myActiveIdx)}>
              {toggle}
              <span class={pd.pipelineDebugNum}>{myDisplayNo}.</span>
              <span class={pd.pipelineDebugStage}>{stageKey}</span>
              <span class={pd.pipelineDebugPreview}>{preview}</span>
              <span class={pd.pipelineDebugArrow}>{'→'}</span>
              <span class={countCls}>{countText}</span>
              {info?.ms != null && (
                <span class={timeCls(info.ms)} title={timingTitle}>
                  {info.ms}ms
                </span>
              )}
            </div>
            {info?.error && (
              <div class={pd.pipelineDebugErrorDetail} onClick={(e) => e.stopPropagation()}>
                <div class={pd.pipelineDebugErrorMsg}>{info.error.message}</div>
                <div class={pd.pipelineDebugErrorHint}>
                  Edit this stage in the pipeline editor above. Errors only show here when a stage
                  fails — they are not the same as a stage that legitimately matches zero documents.
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
