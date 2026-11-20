// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import StatsSchema from '../src/mdh/components/StatsSchema.jsx';
import { selectedCollection, activePanel, pendingPipelineLoad } from '../src/mdh/store.js';
import ssum from '../src/mdh/components/StatsSummary.module.css';
import statsSchemaCss from '../src/mdh/components/StatsSchema.module.css';

function mount(schemaShapes: any[] | null) {
  const root = document.createElement('div');
  render(<StatsSchema schemaShapes={schemaShapes} />, root);
  return root;
}

function fieldNames(root: Element, selector: string) {
  return [...root.querySelectorAll(selector)].map((el) =>
    el.textContent!.trim().replace(/^[·+]/, ''),
  );
}

// a1..a20 alphabetically sorted, so index order is exactly field name order.
function longRun(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

beforeEach(() => {
  selectedCollection.value = null;
  activePanel.value = 'data';
  pendingPipelineLoad.value = null;
});

describe('StatsSchema single shape', () => {
  it('renders its fields inside the same shape card as the multi-shape path, with a Consistent summary line', () => {
    const root = mount([{ fieldCount: 3, docCount: 100, fields: ['acme_id', 'name', 'total'] }]);
    const line = root.querySelector(`.${ssum.statsSchemaLine}`)!;
    expect(line.textContent).toContain('Consistent');
    expect(line.textContent).toContain('3 fields');
    const col = root.querySelector(`.${statsSchemaCss.statsShapeCol}`)!;
    expect(fieldNames(col, 'li')).toEqual(['acme_id', 'name', 'total']);
    expect(root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`).length).toBe(1);
    expect(root.querySelector('.stats-schema-list')).toBeNull();
    expect(root.querySelector(`.${statsSchemaCss.statsSchemaMore}`)).toBeNull();
  });

  it("shows the document count and the records button, and no 'Shape 1' label or percentage", () => {
    const root = mount([{ fieldCount: 3, docCount: 100, fields: ['acme_id', 'name', 'total'] }]);
    const header = root.querySelector(`.${statsSchemaCss.statsShapeColH}`)!;
    expect(header.textContent).toContain('100 documents');
    expect(header.textContent).not.toContain('Shape 1');
    expect(header.textContent).not.toContain('most common');
    expect(header.textContent).not.toContain('%');
    expect(root.querySelector(`.${statsSchemaCss.statsShapeRecords}`)).not.toBeNull();
  });

  it('marks no field as added or gone against its own single shape', () => {
    const root = mount([{ fieldCount: 3, docCount: 100, fields: ['acme_id', 'name', 'total'] }]);
    expect(
      root.querySelector(`.${statsSchemaCss.statsShapeCol} li.${statsSchemaCss.isAdd}`),
    ).toBeNull();
    expect(
      root.querySelector(`.${statsSchemaCss.statsShapeCol} li.${statsSchemaCss.isGone}`),
    ).toBeNull();
  });

  it('collapses a long single-shape union into exactly one elision row, keeping head and tail', () => {
    const fields = longRun('f', 20);
    const root = mount([{ fieldCount: 20, docCount: 100, fields }]);
    const list = root.querySelector(`.${statsSchemaCss.statsShapeCol} ul`)!;
    const rendered = [...list.children].map((li) =>
      li.classList.contains(statsSchemaCss.statsSchemaMore) ? '…' : li.textContent,
    );
    expect(rendered.slice(0, 6)).toEqual(fields.slice(0, 6));
    expect(rendered.slice(-3)).toEqual(fields.slice(-3));
    expect(rendered.filter((r) => r === '…').length).toBe(1);
  });
});

describe('StatsSchema no collapse below the threshold', () => {
  it('renders the full union in every column, with absent/added fields marked, no elision', () => {
    const shapes = [
      { fieldCount: 5, docCount: 80, fields: ['a', 'b', 'c', 'd', 'e'] },
      { fieldCount: 5, docCount: 20, fields: ['a', 'b', 'c', 'd', 'f'] },
    ];
    const root = mount(shapes);
    expect(root.querySelector(`.${statsSchemaCss.statsSchemaMore}`)).toBeNull();
    const cols = root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`);
    // Common fields (a, b, c, d) first, then differing fields (e, f) after.
    expect(fieldNames(cols[0], 'li')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(fieldNames(cols[1], 'li')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    const rowFor = (col: Element, field: string) =>
      [...col.querySelectorAll('li')].find((li) => li.textContent!.includes(field))!;
    // shape A (baseline) lacks "f"; shape B lacks "e" and adds "f" over the baseline.
    expect(rowFor(cols[0], 'f').classList.contains(statsSchemaCss.isGone)).toBe(true);
    expect(rowFor(cols[1], 'e').classList.contains(statsSchemaCss.isGone)).toBe(true);
    expect(rowFor(cols[1], 'f').classList.contains(statsSchemaCss.isAdd)).toBe(true);
  });

  it('reports the summary line with the shape count and the union field count', () => {
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    const line = root.querySelector(`.${ssum.statsSchemaLine}`)!;
    expect(line.textContent).toContain('2 shapes');
    expect(line.textContent).toContain('4 fields across all');
  });

  it('still renders shape doc counts and percentages', () => {
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    const metas = [...root.querySelectorAll(`.${statsSchemaCss.statsShapeColMeta}`)].map(
      (m) => m.textContent,
    );
    expect(metas[0]).toContain('80');
    expect(metas[0]).toContain('80%');
    expect(metas[1]).toContain('20');
    expect(metas[1]).toContain('20%');
  });
});

describe('StatsSchema groups the union by category, collapsing only the common block', () => {
  // Union: c01..c20 common to both shapes, plus three differing fields chosen so
  // their alphabetical position falls scattered through the common run
  // (c03a right after c03, c12a deep in the collapsed middle, c19a near the
  // tail) — the exact arrangement that used to force several elision gaps.
  const common = longRun('c', 20);
  const differing = ['c03a', 'c12a', 'c19a'];
  const shapeA = { fieldCount: 23, docCount: 60, fields: [...common, ...differing].sort() };
  const shapeB = { fieldCount: 20, docCount: 40, fields: [...common] };
  const union = [...common, ...differing].sort();

  it('renders exactly one elision row per column, whatever the arrangement of differing fields', () => {
    const root = mount([shapeA, shapeB]);
    for (const col of root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`)) {
      expect(col.querySelectorAll(`.${statsSchemaCss.statsSchemaMore}`).length).toBe(1);
    }
  });

  it('renders common fields first and differing fields after, in the rendered order', () => {
    const root = mount([shapeA, shapeB]);
    const col = root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`)[0];
    const names = fieldNames(col, `li:not(.${statsSchemaCss.statsSchemaMore})`);
    const commonNames = names.filter((n) => common.includes(n));
    const differingNames = names.filter((n) => differing.includes(n));
    expect(names).toEqual([...commonNames, ...differingNames]);
    expect(commonNames).toEqual([...commonNames].sort());
    expect(differingNames).toEqual([...differing].sort());
  });

  it('renders the identical row sequence in every column, elision included', () => {
    const root = mount([shapeA, shapeB]);
    const cols = root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`);
    const shape = (col: Element) =>
      [...col.querySelectorAll('ul > li')].map((li) =>
        li.classList.contains(statsSchemaCss.statsSchemaMore)
          ? '…'
          : li.textContent!.replace(/^[·+]?/, ''),
      );
    expect(shape(cols[0])).toEqual(shape(cols[1]));
  });

  it('renders the elision as a button; clicking it expands, and Show fewer collapses it again', () => {
    const root = mount([shapeA, shapeB]);
    const more = root.querySelector<HTMLButtonElement>(
      `.${statsSchemaCss.statsSchemaMore} button`,
    )!;
    expect(more.tagName).toBe('BUTTON');
    act(() => {
      more.click();
    });
    expect(root.querySelector(`.${statsSchemaCss.statsSchemaMore}`)).not.toBeNull();
    const col = root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`)[0];
    expect(fieldNames(col, `li:not(.${statsSchemaCss.statsSchemaMore})`).length).toBe(union.length);
    // Expanded, the collapse control terminates the list rather than sitting
    // between two now-identical-looking runs of common fields.
    expect(
      col.querySelector('ul')!.lastElementChild!.classList.contains(statsSchemaCss.statsSchemaMore),
    ).toBe(true);
    const fewer = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Show fewer'),
    )!;
    act(() => {
      fewer.click();
    });
    expect(root.querySelector(`.${statsSchemaCss.statsSchemaMore}`)).not.toBeNull();
    expect(
      [...root.querySelectorAll('button')].some((b) => b.textContent!.includes('Show fewer')),
    ).toBe(false);
    const colAfter = root.querySelectorAll(`.${statsSchemaCss.statsShapeCol}`)[0];
    expect(fieldNames(colAfter, `li:not(.${statsSchemaCss.statsSchemaMore})`).length).toBeLessThan(
      union.length,
    );
  });
});

describe('StatsSchema "Show these records" jump', () => {
  it('stages a shape-filter pipeline and switches the panel to data', () => {
    selectedCollection.value = 'invoices';
    activePanel.value = 'schema';
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>(`.${statsSchemaCss.statsShapeRecords}`),
    ];
    expect(buttons.length).toBe(2);
    act(() => {
      buttons[1].click();
    });
    expect(pendingPipelineLoad.value.collection).toBe('invoices');
    const pipelineText = pendingPipelineLoad.value.pipelineText;
    expect(pipelineText).toContain('$exists');
    expect(pipelineText).toContain('$size');
    expect(pipelineText).not.toContain('$setEquals');
    expect(activePanel.value).toBe('data');
  });

  it('passes the differing fields this shape lacks as absent fields, not recomputed', () => {
    selectedCollection.value = 'invoices';
    activePanel.value = 'schema';
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>(`.${statsSchemaCss.statsShapeRecords}`),
    ];
    // Shape 2 (fields id, name, phone) lacks "email", the field the union's
    // other shape carries — that is the absent field this jump must encode.
    act(() => {
      buttons[1].click();
    });
    const pipeline = JSON.parse(pendingPipelineLoad.value.pipelineText);
    expect(pipeline[0].$match.$and).toContainEqual({ email: { $exists: false } });
    expect(pipeline[0].$match.$and).toContainEqual({ phone: { $exists: true } });
  });
});

describe('StatsSchema multi-shape headers', () => {
  it('shows shape labels, baseline markers, and metadata in multi-shape headers', () => {
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    const firstHeader = root.querySelector(`.${statsSchemaCss.statsShapeColH}`)!;
    expect(firstHeader.textContent).toContain('Shape 1');
    expect(firstHeader.querySelector(`.${statsSchemaCss.statsShapeBaseline}`)).not.toBeNull();
    expect(firstHeader.querySelector(`.${statsSchemaCss.statsShapeColMeta}`)).not.toBeNull();
    expect(firstHeader.querySelector(`.${statsSchemaCss.statsShapeRecords}`)).not.toBeNull();
  });
});

describe('StatsSchema no chips, no "in every shape" label', () => {
  it('never renders the retired common-chip markup', () => {
    const shapes = [
      { fieldCount: 3, docCount: 80, fields: ['id', 'name', 'email'] },
      { fieldCount: 3, docCount: 20, fields: ['id', 'name', 'phone'] },
    ];
    const root = mount(shapes);
    expect(root.querySelector('.stats-schema-common')).toBeNull();
    expect(root.querySelector('.stats-schema-common-label')).toBeNull();
    expect(root.querySelector('.stats-schema-field')).toBeNull();
    expect(root.textContent).not.toContain('in every shape');
  });
});
