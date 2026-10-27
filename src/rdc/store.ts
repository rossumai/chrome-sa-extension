// src/rdc/store.ts
import { signal } from '@preact/signals';

// Shared connection (set by the console shell at boot). Nothing else is kept: the project
// lives in the app's component state, in memory, and is gone on reload.
export const domain = signal('');
export const token = signal('');
export const connected = signal<boolean | null>(null);
