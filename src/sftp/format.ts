// src/sftp/format.ts
// Paths, sizes and times as the SFTP browser shows them. Pure.

// Paths are relative to the folder the user signs in to; '' is that folder.
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function parentOf(dir: string): string {
  const i = dir.lastIndexOf('/');
  return i < 0 ? '' : dir.slice(0, i);
}

export function segmentsOf(dir: string): { name: string; path: string }[] {
  if (!dir) return [];
  const parts = dir.split('/');
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `mtime` in seconds: "Today 09:41", "Yesterday 09:38", "17 Nov 09:42", "17 Nov 2025". */
export function formatWhen(mtime: number, now: Date): string {
  const t = new Date(mtime * 1000);
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(t)) / 86_400_000);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Yesterday ${hm}`;
  const date = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return t.getFullYear() === now.getFullYear() ? `${date} ${hm}` : `${date} ${t.getFullYear()}`;
}
