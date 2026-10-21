// src/builder/scopeCss.ts
// popup.css is written for a whole page: it sets its color variables on :root and styles
// html/body. Inside a shadow root those selectors match nothing, so they move to :host — the
// card then gets its own variables without touching the Console's.

export function scopeToShadow(css: string): string {
  return css
    .replace(/:root\b/g, ':host')
    .replace(/(^|[\s,{}])html,\s*body\b/g, '$1:host')
    .replace(/(^|[\s,{}])(?:html|body)\b(?![-\w])/g, '$1:host');
}
