import { h, Fragment } from 'preact';
import { fill, type Names } from '../../training/track.js';
import CopyName from './CopyName.jsx';

/**
 * Copy with the run's names filled in and `backtick` spans as code. A code span that IS
 * one of the run's names gets a Copy button, since the trainee must use it exactly.
 */
export default function Rich({ text, names }: { text: string; names: Names }) {
  return (
    <>
      {fill(text, names)
        .split('`')
        .map((part, i) =>
          !(i % 2) ? (
            part
          ) : Object.values(names).includes(part) ? (
            <CopyName key={i} value={part} inline />
          ) : (
            <code key={i}>{part}</code>
          ),
        )}
    </>
  );
}
