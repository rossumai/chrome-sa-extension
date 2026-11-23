import { useState, useEffect, useRef } from 'preact/hooks';
import { queryRun } from '../store.js';
import * as api from '../api.js';
import { stripWriteStages } from '../pipelineOps.js';

// Fetch the cumulative document count after each active stage (prefix + $count)
// plus the whole-collection input count ($collStats), with per-request timing.
// Shared by the Aggregate Pipeline Debug panel and the full-pipeline inspector
// modal so both report identical numbers (and the modal stays correct when
// stages are toggled, since the active-stage set drives the recompute).
//
// Returns:
//   counts: { [activeIndex]: { count, ms } | { error: { message, status }, ms } }
//   inputInfo: { count, ms } | { error: { message, status }, ms } | null
//   stopped: true once the Data panel's query was cancelled or failed — the
//     in-flight count requests are aborted with it, and counts that never
//     arrived are not coming (the panel shows them as —). The next run of the
//     query starts the counts again.
// Both clear (to {} / null) whenever the collection or active-stage set changes,
// and write stages ($out/$merge) are stripped so a count probe never writes.
export default function useStageCounts(collection: string, activeStages: any[]) {
  const [counts, setCounts] = useState({});
  const [inputInfo, setInputInfo] = useState<any>(null);
  const stages = Array.isArray(activeStages) ? activeStages : [];
  const activeKey = JSON.stringify(stages);
  const [stopped, setStopped] = useState(false);
  // Bumped to restart the counts when a stopped query is run again unchanged.
  const [generation, setGeneration] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const phase = queryRun.value.phase;

  useEffect(() => {
    if (phase === 'cancelled' || phase === 'failed') {
      controllerRef.current?.abort();
      setStopped(true);
    } else if (phase === 'running' && stopped) {
      setGeneration((g) => g + 1);
    }
  }, [phase]);

  useEffect(() => {
    if (!collection || stages.length === 0) {
      setCounts({});
      setInputInfo(null);
      return;
    }
    setCounts({});
    setInputInfo(null);
    setStopped(false);

    const controller = new AbortController();
    controllerRef.current = controller;
    stages.forEach((_, i) => {
      const prefix = stages.slice(0, i + 1);
      const t0 = performance.now();
      api
        .aggregate(collection, [...stripWriteStages(prefix), { $count: 'n' }], {
          signal: controller.signal,
        })
        .then((res) => {
          if (controller.signal.aborted) return;
          const n = res?.result?.[0]?.n ?? 0;
          setCounts((prev) => ({
            ...prev,
            [i]: { count: n, ms: Math.round(performance.now() - t0) },
          }));
        })
        .catch((err) => {
          if (err?.name === 'AbortError' || controller.signal.aborted) return;
          setCounts((prev) => ({
            ...prev,
            [i]: {
              error: {
                message: (err as any)?.message || String(err),
                status: (err as any)?.status,
              },
              ms: Math.round(performance.now() - t0),
            },
          }));
        });
    });

    const inputT0 = performance.now();
    api
      .aggregate(collection, [{ $collStats: { count: {} } }, { $limit: 1 }], {
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        setInputInfo({
          count: res?.result?.[0]?.count ?? 0,
          ms: Math.round(performance.now() - inputT0),
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setInputInfo({
          error: { message: (err as any)?.message || String(err), status: (err as any)?.status },
          ms: Math.round(performance.now() - inputT0),
        });
      });

    return () => controller.abort();
  }, [collection, activeKey, generation]);

  return { counts, inputInfo, stopped };
}
