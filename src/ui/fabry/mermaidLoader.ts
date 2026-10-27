// On-demand loader for the beautiful-mermaid SVG renderer bundle
// (dist/console/mermaid.js, see src/fabry/mermaidEntry.js), through lazyScript. A failed
// load leaves MermaidBlocks on a plain code fence.
import { lazyScript } from '../lazyScript.js';

/** The renderer the lazy bundle registers on `window`. */
export type MermaidRenderer = (text: string, themeOpts?: any) => string;

declare global {
  interface Window {
    __fabryMermaidSvg?: MermaidRenderer;
  }
}

export function getMermaidRenderer(): MermaidRenderer | null {
  return (typeof window !== 'undefined' && window.__fabryMermaidSvg) || null;
}

export const loadMermaidRenderer = lazyScript('mermaid.js', getMermaidRenderer, 'mermaid bundle');

// Console theme → beautiful-mermaid theme options, read live from the CSS
// custom properties so diagrams match the active (light/dark) theme. Blue
// accent per the console-wide scheme.
export type MermaidTheme = {
  bg: string;
  fg: string;
  line: string;
  accent: string;
  muted: string;
  surface: string;
  border: string;
};

export function themeFromTokens(doc: Document = document): MermaidTheme {
  const cs = getComputedStyle(doc.documentElement);
  const v = (name: string, fallback: string) =>
    (cs.getPropertyValue(name) || '').trim() || fallback;
  // bg = the PAGE color (the svg has no background rect — probe-verified — so
  // bg only drives contrast math); surface = card color so nodes read as
  // elevated cards sitting directly on the page.
  return {
    bg: v('--bg-base', '#f1f1f5'),
    fg: v('--text-primary', '#1a1a24'),
    line: v('--text-secondary', '#7a7a8c'),
    accent: v('--accent', '#4270db'),
    muted: v('--text-secondary', '#7a7a8c'),
    surface: v('--bg-card', '#ffffff'),
    border: v('--border', '#dcdce4'),
  };
}
