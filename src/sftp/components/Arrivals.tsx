// The arrival strip: the folder's files per day over the last two weeks, with the weekdays
// that had none called out. Clicking a day shows only its files; clicking it again shows all.
import { h } from 'preact';
import { arrivalDays, gapDays, sameDay, DAYS, type Entry } from '../arrivals.js';
import styles from './Arrivals.module.css';
import ctl from '../../ui/controls.module.css';

type Props = {
  entries: Entry[];
  now: Date;
  day: Date | null;
  onDay: (d: Date | null) => void;
};

const longDay = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const MAX_TICKS = 8;

export default function Arrivals({ entries, now, day, onDay }: Props) {
  const days = arrivalDays(entries, now);
  const gaps = gapDays(days);
  const count = days.reduce((n, d) => n + d.files.length, 0);
  const gapNote =
    gaps.length === 0
      ? ''
      : gaps.length <= 2
        ? `Nothing arrived on ${gaps.map((g) => longDay(g.start)).join(' and ')}`
        : `Nothing arrived on ${gaps.length} weekdays, last on ${longDay(gaps[gaps.length - 1].start)}`;
  const gapSet = new Set(gaps);

  return (
    <section class={styles.strip} aria-label="Arrivals">
      <div class={styles.head}>
        <strong>Arrivals</strong>
        <span class={styles.sum}>
          {count === 0
            ? `No files in the last ${DAYS} days`
            : `${count} file${count === 1 ? '' : 's'} in the last ${DAYS} days`}
        </span>
        {gapNote && <span class={styles.gap}>{gapNote}</span>}
        {day && (
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnSm} ${styles.all}`}
            onClick={() => onDay(null)}
          >
            Show all days
          </button>
        )}
      </div>
      <div class={styles.days}>
        {days.map((d, i) => {
          const label = `${longDay(d.start)}: ${d.files.length} file${d.files.length === 1 ? '' : 's'}`;
          const on = !!day && sameDay(day, d.start);
          const cls = [
            styles.day,
            gapSet.has(d) ? styles.missing : '',
            d.weekend ? styles.weekend : '',
            i === days.length - 1 ? styles.today : '',
            on ? styles.on : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              type="button"
              class={cls}
              title={label}
              aria-label={label}
              aria-pressed={on}
              onClick={() => onDay(on ? null : d.start)}
            >
              <span class={styles.stack}>
                {d.files.slice(0, MAX_TICKS).map(() => (
                  <span class={styles.tick} />
                ))}
              </span>
              <span class={styles.label}>
                {i === days.length - 1
                  ? 'Today'
                  : i === 0
                    ? d.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : d.start.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
