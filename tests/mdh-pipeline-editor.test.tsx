// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { h, render } from 'preact';
import JSON5 from 'json5';

globalThis.chrome = {
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  } as any,
} as any;
vi.mock('../src/mdh/components/JsonEditor.jsx', () => ({
  default: () => <div data-testid="editor" />,
  extractFieldNames: () => [],
}));

import PipelineEditor from '../src/mdh/components/PipelineEditor.jsx';
import { selectedCollection } from '../src/mdh/store.js';
import pipelineEditorCss from '../src/mdh/components/PipelineEditor.module.css';
import menuCss from '../src/mdh/components/toolbarMenu.module.css';

describe('PipelineEditor Beautify', () => {
  it('preserves a disabled stage when beautifying', async () => {
    selectedCollection.value = 'vendors';
    const root = document.createElement('div');
    document.body.appendChild(root);

    const editorRef = {
      current: {
        _v: '[{"$match":{}},/* @disabled-stage {"$sort":{"a":-1}} */{"$limit":5}]',
        getValue() {
          return this._v;
        },
        setValue(v: any) {
          this._v = v;
        },
      },
    };

    render(
      <PipelineEditor
        editorRef={editorRef as any}
        initialValue=""
        onChange={() => {}}
        onValidChange={() => {}}
        onLoadPipeline={() => {}}
        onReset={() => {}}
      />,
      root,
    );

    // Open the overflow menu and click Beautify.
    root.querySelector<HTMLElement>(`.${pipelineEditorCss.pipelineOverflowBtn}`)!.click();
    await vi.waitFor(() =>
      expect(
        [...root.querySelectorAll(`.${menuCss.toolbarMenuItem}`)].some(
          (b) => b.textContent === 'Beautify',
        ),
      ).toBe(true),
    );
    (
      [...root.querySelectorAll(`.${menuCss.toolbarMenuItem}`)].find(
        (b) => b.textContent === 'Beautify',
      ) as HTMLElement
    ).click();

    const out = editorRef.current.getValue();
    expect(JSON5.parse(out)).toEqual([{ $match: {} }, { $limit: 5 }]);
    expect(out).toContain('/* @disabled-stage');
  });
});
