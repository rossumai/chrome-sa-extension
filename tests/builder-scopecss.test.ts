import { describe, it, expect } from 'vitest';
import { scopeToShadow } from '../src/builder/scopeCss.js';

describe('scopeToShadow', () => {
  it('moves page-level selectors (:root, html, body) onto the shadow host', () => {
    const css = [
      ':root { --a: 1; }',
      '@media (prefers-color-scheme: dark) {\n  :root { --a: 2; }\n}',
      'html,\nbody { margin: 0; }',
      'body { font: 12px x; }',
      'body.popup-wide .mdh-card { width: 1px; }',
      '.card .body-text { color: red; }',
    ].join('\n');
    const out = scopeToShadow(css);
    expect(out).toContain(':host { --a: 1; }');
    expect(out).toContain('  :host { --a: 2; }');
    expect(out).toContain(':host { margin: 0; }');
    expect(out).toContain(':host { font: 12px x; }');
    expect(out).toContain(':host.popup-wide .mdh-card');
    expect(out).toContain('.card .body-text'); // a class merely containing "body" is untouched
    expect(out).not.toMatch(/(^|[\s,{}])(html|body)\b(?!-)/m);
  });
});
