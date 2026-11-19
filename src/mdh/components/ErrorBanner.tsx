import { h } from 'preact';
import { error } from '../store.js';
import eb from '../../ui/ErrorBanner.module.css';

export default function ErrorBanner() {
  const err = error.value;
  if (!err) return null;

  return (
    <div class={eb.root}>
      <span>{err.message}</span>
      <button
        class={eb.dismiss}
        onClick={() => {
          error.value = null;
        }}
      >
        {'\u00d7'}
      </button>
    </div>
  );
}
