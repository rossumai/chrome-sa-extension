// src/sftp/store.ts
import { signal } from '@preact/signals';

// Shared connection (set by the console shell at boot). The saved servers live in the org, as
// one helper hook each (see servers.ts); nothing is kept on this device.
export const domain = signal('');
export const token = signal('');
export const connected = signal<boolean | null>(null);
