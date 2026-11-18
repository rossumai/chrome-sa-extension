import { h, Fragment } from 'preact';
import { evaluateTask, type Assertion } from '../../training/checks.js';
import { taskState, type Progress } from '../../training/progress.js';
import type { Names, Task } from '../../training/track.js';
import Rich from './Rich.jsx';
import css from '../Academy.module.css';

/** The assertions a task WILL check, all pending — shown before its first check. */
function preview(task: Task, names: Names): Assertion[] {
  const as = evaluateTask(task, { names }) || [];
  return as.map((a) => ({ id: a.id, label: a.label, state: 'pending' }));
}

export default function TaskCard({
  step,
  task,
  progress,
  names,
  current,
}: {
  /** The task's place in its mission, drawn in the gutter. */
  step: number;
  task: Task;
  progress: Progress;
  names: Names;
  current: boolean;
}) {
  const state = taskState(progress, task.id);
  const assertions = progress.results[task.id]?.assertions || preview(task, names);
  const fix = assertions.find((a) => a.state === 'no' && a.fix);
  const failing = assertions.filter((a) => a.state === 'no').length;
  const label =
    state === 'ok'
      ? 'Checked'
      : failing
        ? `${failing} thing${failing > 1 ? 's' : ''} to fix`
        : 'Not done yet';
  const cls = state === 'ok' ? css.stateOk : failing ? css.stateFix : css.stateWait;
  const open = state !== 'ok';
  return (
    <li
      class={`${css.task} ${current ? css.taskCurrent : ''}`}
      data-task={task.id}
      data-state={state}
    >
      <span class={css.taskStep} aria-hidden="true">
        {state === 'ok' ? '✓' : step}
      </span>
      <div class={css.taskBody}>
        <header class={css.taskHead}>
          <h3 class={css.taskTitle}>
            <Rich text={task.title} names={names} />
          </h3>
          <span class={`${css.state} ${cls}`}>{label}</span>
        </header>
        {open && (
          <>
            <p class={css.why}>
              <Rich text={task.why} names={names} />
            </p>
            <p class={css.where}>
              Where: <Rich text={task.where} names={names} />
            </p>
            <div class={css.doneWhen}>
              <span class={css.doneWhenLabel}>Done when the Academy sees:</span>
              <ul class={css.asserts}>
                {assertions.map((a) => (
                  <li key={a.id} class={css.assert} data-state={a.state}>
                    <span class={css.mark}>
                      {a.state === 'ok' ? '✓' : a.state === 'no' ? '!' : ''}
                    </span>
                    <span class={css.assertLabel}>
                      <Rich text={a.label} names={names} />
                    </span>
                  </li>
                ))}
              </ul>
              {fix && (
                <p class={css.fix}>
                  <Rich text={fix.fix!} names={names} />
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}
