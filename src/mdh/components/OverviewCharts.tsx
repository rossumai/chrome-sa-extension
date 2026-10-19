import { h } from 'preact';
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { buildTreemap, TOP_N, SCALE_MODES } from '../overviewCharts.js';

const CHART_H = 240;
// Fallback width so the treemap renders immediately on first paint even before
// the container is measured — the measurement only refines it afterwards.
const DEFAULT_TM_W = 600;
// How many folded collections the "Other" tooltip names before summarising.
const OTHER_TIP_MAX = 8;
const SCALE_KEY = 'mdhOverviewChartsScale';

const SCALE_LABEL: Record<string, string> = { linear: 'Linear', sqrt: '√', log: 'log' };
const SCALE_TITLE: Record<string, string> = {
  linear: 'Area = true storage share',
  sqrt: 'Square-root scale (compress small collections)',
  log: 'Log scale (maximum legibility)',
};
const SCALE_NOTE: Record<string, string> = {
  linear: 'Tile area = true storage share.',
  sqrt: '√ scale — small collections stay visible; areas are compressed, not exact share.',
  log: 'log scale — every tile readable; area is not proportional to size.',
};
function formatBytes(n: any) {
  if (n == null) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
function getPref(keys: any, cb: any) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  try {
    chrome.storage.local.get(keys, cb);
  } catch {
    /* non-extension context */
  }
}
function setPref(obj: any) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  try {
    chrome.storage.local.set(obj);
  } catch {
    /* non-extension context */
  }
}

export default function OverviewCharts({
  rows,
  settled,
  onOpen,
}: {
  rows: any[];
  settled?: boolean;
  onOpen: (name: string) => void;
}) {
  const [mode, setMode] = useState<string>('sqrt');
  const [hovered, setHovered] = useState<any>(null);
  const [tip, setTip] = useState<any>(null);
  const [tmW, setTmW] = useState(DEFAULT_TM_W);
  const tmRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  // Restore the persisted scale preference once.
  useEffect(() => {
    let active = true;
    getPref([SCALE_KEY], (res: any) => {
      if (!active || !res) return;
      if (SCALE_MODES.includes(res[SCALE_KEY])) setMode(res[SCALE_KEY]);
    });
    return () => {
      active = false;
    };
  }, []);

  const anyTreemap = rows.some(
    (r) => r && !r.error && typeof r.storageSize === 'number' && r.storageSize > 0,
  );

  // Measure the treemap width. Runs before paint (useLayoutEffect) and re-runs when
  // data first appears, so it sizes correctly on a fresh page load — and
  // never collapse to 0 width (we keep the last good / default width otherwise).
  useLayoutEffect(() => {
    const measure = () => {
      if (tmRef.current) {
        const w = tmRef.current.clientWidth;
        if (w > 0) setTmW(w);
      }
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      if (tmRef.current) ro.observe(tmRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [anyTreemap]);

  // Keep the hover tooltip inside the viewport: offset from the cursor, flip to
  // the other side near the right/bottom edge, and clamp so it never spills off
  // screen. Runs before paint (useLayoutEffect) so there's no visible jump.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const gap = 14;
    const pad = 8;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = tip.x + gap;
    let top = tip.y + gap;
    if (left + tw > window.innerWidth - pad) left = tip.x - gap - tw;
    if (top + th > window.innerHeight - pad) top = tip.y - gap - th;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - th - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [tip]);

  function pickMode(m: any) {
    setMode(m);
    setPref({ [SCALE_KEY]: m });
  }

  // Memoised so hover (which re-renders on every mouse move) does not re-run
  // the layout.
  const tiles = useMemo(
    () =>
      anyTreemap ? buildTreemap(rows, { width: tmW, height: CHART_H, topN: TOP_N, mode }) : [],
    [rows, anyTreemap, tmW, mode],
  );

  // Nothing to chart once the stream has settled (e.g. every collection errored
  // or is empty) → don't show the panel at all.
  if (settled && !anyTreemap) return null;

  function moveTip(e: any, title: any, lines: any) {
    setTip({ x: e.clientX, y: e.clientY, title, lines });
  }
  function clearHover() {
    setHovered(null);
    setTip(null);
  }

  return (
    <div class="overview-charts">
      <div class="overview-charts-body">
        <div class="oc-col oc-col-map">
          <div class="oc-label">
            <span>Storage map</span>
            <span class="oc-scale-toggle">
              {SCALE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  class={mode === m ? 'is-active' : ''}
                  title={SCALE_TITLE[m]}
                  onClick={() => pickMode(m)}
                >
                  {SCALE_LABEL[m]}
                </button>
              ))}
            </span>
          </div>

          <div class="oc-treemap" ref={tmRef} style={{ height: `${CHART_H}px` }}>
            {tiles.length === 0 ? (
              <div class="oc-placeholder" style={{ height: `${CHART_H}px` }}>
                {settled ? 'No storage data' : `Charting${'…'}`}
              </div>
            ) : (
              tiles.map((t) => {
                const showLabel = t.w > 52 && t.h > 26;
                const showSub = t.h > 42;
                const sizes = `data ${formatBytes(t.storageSize)} + indexes ${formatBytes(t.totalIndexSize)}`;
                const lines = t.isOther
                  ? [
                      `${formatBytes(t.footprint)} on disk · ${t.memberCount} folded collections`,
                      sizes,
                      ...t.members
                        .slice(0, OTHER_TIP_MAX)
                        .map((m: any) => `${m.name} · ${formatBytes(m.footprint)}`),
                      ...(t.memberCount > OTHER_TIP_MAX
                        ? [`+ ${t.memberCount - OTHER_TIP_MAX} more`]
                        : []),
                    ]
                  : [
                      `${formatBytes(t.footprint)} on disk · ${t.row.count != null ? t.row.count.toLocaleString() : '—'} docs`,
                      sizes,
                      `avg doc ${formatBytes(t.row.avgObjSize)}`,
                    ];
                return (
                  <div
                    key={t.name}
                    class={
                      'oc-tile' +
                      (t.isOther ? ' is-other' : '') +
                      (hovered === t.name ? ' is-hover' : '')
                    }
                    style={{
                      left: `${t.x}px`,
                      top: `${t.y}px`,
                      width: `${t.w}px`,
                      height: `${t.h}px`,
                      background: t.isOther ? undefined : t.color,
                      color: t.isOther ? undefined : t.textColor,
                    }}
                    onMouseMove={(e) => {
                      setHovered(t.name);
                      moveTip(e, t.name, lines);
                    }}
                    onMouseLeave={clearHover}
                    onClick={() => {
                      if (!t.isOther) onOpen(t.name);
                    }}
                  >
                    {showLabel && (
                      <div class={'oc-tile-name' + (t.w > 120 ? ' is-lg' : '')}>{t.name}</div>
                    )}
                    {showLabel && showSub && (
                      <div class="oc-tile-sub">{formatBytes(t.footprint)}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div class="oc-legend">
            <span>data-heavy</span>
            <div class="oc-legend-bar" />
            <span>index-heavy</span>
          </div>
          <div class="oc-note">{SCALE_NOTE[mode]}</div>
        </div>

        {tip && (
          <div
            class="oc-tooltip"
            ref={tipRef}
            style={{ left: `${tip.x + 14}px`, top: `${tip.y + 14}px` }}
          >
            <b>{tip.title}</b>
            {tip.lines.map((l: any, i: any) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
