import { h } from 'preact';
import { queues, error } from '../store.js';

export default function App({ connected }: { connected: boolean | null }) {
  if (!connected) {
    return (
      <div class="app-root">
        <div class="empty-state">{error.value || 'Open the Console from a Rossum tab to connect.'}</div>
      </div>
    );
  }
  return (
    <div class="app-root">
      <ul>
        {queues.value.map((q) => (
          <li key={q.id}>{q.name}</li>
        ))}
      </ul>
    </div>
  );
}
