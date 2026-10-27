import { h, Fragment, type ComponentChildren } from 'preact';

// ‹ n/N ›: steps through a table's rows. `children` follow the count ("of items"); `action`
// names the buttons (prev-<action>, next-<action>).
export default function Stepper({
  at,
  count,
  onStep,
  action,
  children,
}: {
  at: number;
  count: number;
  onStep: (i: number) => void;
  action?: string;
  children?: ComponentChildren;
}) {
  // A step is not a click on the row (or panel) around it.
  const go = (d: number) => (e: Event) => {
    e.stopPropagation();
    onStep(at + d);
  };
  return (
    <Fragment>
      <button
        type="button"
        class="icon-btn"
        data-action={action && `prev-${action}`}
        disabled={at === 0}
        onClick={go(-1)}
      >
        ‹
      </button>
      {at + 1}/{count}
      {children}
      <button
        type="button"
        class="icon-btn"
        data-action={action && `next-${action}`}
        disabled={at >= count - 1}
        onClick={go(1)}
      >
        ›
      </button>
    </Fragment>
  );
}
