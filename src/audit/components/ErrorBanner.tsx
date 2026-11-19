import { h } from 'preact';
import { error } from '../store.js';
import eb from '../../ui/ErrorBanner.module.css';

export default function ErrorBanner() {
  if (!error.value) return null;
  return (
    <div class={eb.root}>
      <span>{error.value}</span>
      <button class={eb.dismiss} onClick={() => (error.value = null)}>
        {'×'}
      </button>
    </div>
  );
}
