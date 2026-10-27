// The deployment header band, shown on every screen: the source org, the target org, and between
// them either the conveyor (no step) or the five steps (a step).
import { h, Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { KINDS, STEPS, type Source, type StepId } from '../deploy.js';
import { CROSS_MS, FADE, SPAWN_MS, beltStops, stillPositions } from '../conveyor.js';
import styles from './Band.module.css';

export type BandTarget = {
  name: string;
  host: string;
  orgId: number;
  env: 'Production' | 'Sandbox' | null;
};

// The icons the band draws; the Console page has no sprite of its own.
function Sprite() {
  return (
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <symbol id="i-queue" viewBox="0 0 16 16">
        <path
          d="M2 9.5h3l1 2h4l1-2h3M2 9.5 3.5 3h9L14 9.5V13H2z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      </symbol>
      <symbol id="i-schema" viewBox="0 0 16 16">
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <path d="M2 6h12M6 6v8" stroke="currentColor" stroke-width="1.5" />
      </symbol>
      <symbol id="i-hook" viewBox="0 0 16 16">
        <path
          d="M9 2v6.5a3 3 0 1 1-6 0V7"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <circle cx="9" cy="2.5" r="1.3" fill="currentColor" />
        <path d="M11 6h3M11 9h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </symbol>
      <symbol id="i-rule" viewBox="0 0 16 16">
        <path
          d="M8 1.8 13.5 4v4c0 3.2-2.4 5.3-5.5 6.2C4.9 13.3 2.5 11.2 2.5 8V4z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path
          d="m5.6 8 1.7 1.7L10.6 6.4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </symbol>
      <symbol id="i-label" viewBox="0 0 16 16">
        <path
          d="M2 2.5h5.5L14 9l-5 5-6.5-6.5V2.5z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <circle cx="5.3" cy="5.5" r="1.2" fill="currentColor" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 16 16">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" />
      </symbol>
      <symbol id="i-pen" viewBox="0 0 16 16">
        <path d="M11 2.5 13.5 5 6 12.5 2.5 13.5 3.5 10z" fill="currentColor" />
      </symbol>
      <symbol id="i-pin" viewBox="0 0 16 16">
        <path
          d="M10 1.5 14.5 6l-2 1-2.5 2.5.5 3-1.5 1.5L3 7.5 4.5 6l3 .5L10 4z"
          fill="currentColor"
        />
        <path d="M5.5 10.5 2 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 16 16">
        <path
          d="m3 8.5 3.2 3.2L13 5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </symbol>
    </svg>
  );
}

const Icon = ({ id, size }: { id: string; size: number }) => (
  <svg width={size} height={size} aria-hidden="true">
    <use href={`#${id}`} />
  </svg>
);

function Stack() {
  return (
    <div class={styles.stack}>
      {KINDS.map((k) => (
        <span class={styles.ico} data-kind={k.kind} title={k.label}>
          <svg aria-hidden="true">
            <use href={`#${k.icon}`} />
          </svg>
        </span>
      ))}
    </div>
  );
}

const pulse = (el: Element | null | undefined, cls: string) => {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
};

// The belt. One object per SPAWN_MS crosses at one speed. The effect belongs to the track element.
function useConveyor(
  track: { current: HTMLDivElement | null },
  src: { current: HTMLDivElement | null },
  dst: { current: HTMLDivElement | null },
  active: boolean,
) {
  useEffect(() => {
    const el = track.current;
    if (!active || !el) return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const make = (icon: string) => {
      const t = document.createElement('span');
      t.className = styles.token;
      t.setAttribute('data-belt-icon', '');
      t.innerHTML = `<svg><use href="#${icon}"/></svg>`;
      el.appendChild(t);
      return t;
    };
    const kindIcon = (root: HTMLElement | null, kind: string) =>
      root?.querySelector(`[data-kind="${kind}"]`);

    if (reduce) {
      // three still objects on the belt, nothing moves
      const xs = stillPositions(el.clientWidth);
      ['i-schema', 'i-hook', 'i-rule'].forEach((icon, i) => {
        const t = make(icon);
        t.style.transform = `translateX(${xs[i]}px)`;
        t.style.boxShadow = '0 3px 8px rgba(0,0,0,.18)';
      });
      return () => el.querySelectorAll('[data-belt-icon]').forEach((n) => n.remove());
    }

    let n = 0;
    const spawn = () => {
      if (document.hidden || typeof el.animate !== 'function') return;
      const { kind, icon } = KINDS[n++ % KINDS.length];
      const t = make(icon);
      const { x0, x1 } = beltStops(el.clientWidth);
      const speed = (x1 - x0) / (CROSS_MS * 0.84);
      if (speed > 0) el.style.setProperty('--belt', `${(18 / speed).toFixed(0)}ms`);
      pulse(kindIcon(src.current, kind), styles.read);
      const at = (f: number) => `translateX(${x0 + (x1 - x0) * f}px)`;
      const shadow = '0 3px 8px rgba(0,0,0,.18)';
      // linear in the middle, so the belt runs at one speed; it lifts on and settles in at the ends
      const a = t.animate(
        [
          {
            transform: at(0),
            opacity: 0,
            background: '#e3f4f8',
            boxShadow: '0 0 0 1px rgba(138,220,239,.35)',
            offset: 0,
          },
          {
            transform: at(FADE),
            opacity: 1,
            background: '#e8f6f9',
            boxShadow: `0 0 0 1px rgba(138,220,239,.3), ${shadow}`,
            offset: FADE,
          },
          {
            transform: at(0.5),
            opacity: 1,
            background: '#f4f5f8',
            boxShadow: `0 0 0 1px rgba(255,255,255,.25), ${shadow}`,
            offset: 0.5,
          },
          {
            transform: at(1 - FADE),
            opacity: 1,
            background: '#f9f1f1',
            boxShadow: `0 0 0 1px rgba(255,138,128,.3), ${shadow}`,
            offset: 1 - FADE,
          },
          {
            transform: at(1),
            opacity: 0,
            background: '#f9f1f1',
            boxShadow: '0 0 0 1px rgba(255,138,128,.3)',
            offset: 1,
          },
        ],
        { duration: CROSS_MS, easing: 'linear' },
      );
      a.onfinish = () => {
        t.remove();
        pulse(kindIcon(dst.current, kind), styles.got);
      };
    };
    spawn();
    const timer: ReturnType<typeof setInterval> = setInterval(spawn, SPAWN_MS);
    return () => {
      clearInterval(timer);
      el.querySelectorAll('[data-belt-icon]').forEach((x) => x.remove());
    };
  }, [active]);
}

export default function Band({
  source,
  target,
  step,
  lastDeployment,
  locked,
}: {
  source: Source | null;
  target: BandTarget;
  step: StepId | null;
  lastDeployment: string | null;
  locked: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const srcStack = useRef<HTMLDivElement>(null);
  const dstStack = useRef<HTMLDivElement>(null);
  const compact = step !== null;
  useConveyor(track, srcStack, dstStack, !compact);

  const srcName = source ? source.name : 'Your test org';
  const srcHost = source ? new URL(source.domain).host : '';
  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const envChip = target.env && (
    <span class={`${styles.env} ${target.env === 'Production' ? styles.prd : styles.sbx}`}>
      {target.env}
    </span>
  );

  return (
    <div class={`${styles.lane} ${compact ? styles.compact : ''}`}>
      <Sprite />
      <div class={styles.laneIn}>
        <div
          class={`${styles.org} ${styles.src}`}
          data-role="source"
          data-locked={locked ? 'true' : 'false'}
        >
          <div class={styles.who}>
            {compact ? (
              <span class={styles.ro}>
                <Icon id="i-lock" size={9} />
                only read
              </span>
            ) : (
              <>
                <Icon id="i-lock" size={11} />
                Deploys from
              </>
            )}
          </div>
          <div class={styles.nm}>{srcName}</div>
          <div class={styles.host}>{compact && source ? `org ${source.orgId}` : srcHost}</div>
          {!compact && (
            <div ref={srcStack}>
              <Stack />
            </div>
          )}
        </div>

        {compact ? (
          <div class={styles.track}>
            <div class={styles.railLine} />
            <div class={styles.stages}>
              {STEPS.map((s, i) => {
                const state = i < stepIdx ? styles.done : i === stepIdx ? styles.cur : '';
                return (
                  <div
                    class={`${styles.stage} ${s.id === 'write' ? styles.write : ''} ${state}`}
                    data-step={s.id}
                    data-state={i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'}
                  >
                    <span class={styles.dot}>
                      {i < stepIdx ? <Icon id="i-check" size={12} /> : i + 1}
                    </span>
                    <span class={styles.lb}>
                      {s.id === 'write' ? `Write to ${target.name}` : s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div class={`${styles.track} ${styles.belt}`} ref={track}>
            <div class={styles.railLine} />
            <div class={styles.cap}>
              {lastDeployment === null ? (
                'No deployment yet'
              ) : (
                <>
                  last deployment <b>{lastDeployment}</b>
                </>
              )}
            </div>
          </div>
        )}

        <div class={`${styles.org} ${styles.dst}`} data-role="target">
          <div class={styles.who}>
            {compact ? (
              <span class={styles.rw}>
                <Icon id="i-pen" size={9} />
                changes
              </span>
            ) : (
              <>
                <Icon id="i-pen" size={11} />
                You are signed in here
              </>
            )}
          </div>
          <div class={styles.nm}>
            {target.name} {envChip}
          </div>
          <div class={styles.host}>
            {compact ? `org ${target.orgId}, you` : `${target.host} · org ${target.orgId}`}
          </div>
          {!compact && (
            <div ref={dstStack}>
              <Stack />
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div class={styles.foot}>
          <div>
            <Icon id="i-lock" size={16} />
            <span>
              <b>{srcName} is only read.</b> You give a token for it each time. It is not kept.
            </span>
          </div>
          <div>
            <Icon id="i-pen" size={16} />
            <span>
              <b>{target.name} is the only org that changes,</b> with your own sign-in, after you
              review the changes.
            </span>
          </div>
          <div>
            <Icon id="i-pin" size={16} />
            <span>
              <b>{target.name} keeps its own values,</b> like its token owner and its automation
              level.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
