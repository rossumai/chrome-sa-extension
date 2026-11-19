import { h } from 'preact';
import sfc from './StatsFieldCard.module.css';

export function FieldName({ path }: { path: string }) {
  const parts = path.split('.');
  if (parts.length === 1) return <span class={sfc.statsFieldName}>{path}</span>;
  const parent = parts.slice(0, -1).join('.');
  const leaf = parts[parts.length - 1];
  return (
    <span class={sfc.statsFieldName}>
      <span class={sfc.statsFieldParent}>{parent}.</span>
      {leaf}
    </span>
  );
}

export function formatBytes(n: number) {
  if (n == null) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatDate(d: any) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.$date || String(d);
  try {
    return new Date(s).toISOString().split('T')[0];
  } catch {
    return String(s);
  }
}

export function formatValue(v: any) {
  if (v === null) return 'null';
  if (v === '') return 'empty';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function isSpecialValue(v: any) {
  return v === null || v === '' || v === true || v === false || typeof v === 'undefined';
}

export function FormattedValue({ value }: { value: any }) {
  if (value === null) return <span class={sfc.statsDistSpecial}>null</span>;
  if (value === '') return <em class={sfc.statsDistSpecial}>empty</em>;
  if (value === true) return <span class={sfc.statsDistSpecial}>true</span>;
  if (value === false) return <span class={sfc.statsDistSpecial}>false</span>;
  if (typeof value === 'object')
    return <span class={sfc.statsDistObject}>{JSON.stringify(value)}</span>;
  return String(value);
}
