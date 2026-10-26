// src/cib/store.ts
import { signal } from '@preact/signals';

// Shared connection (set by the console shell at boot).
export const domain = signal('');
export const token = signal('');
export const connected = signal<boolean | null>(null);
