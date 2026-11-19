// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import JsonTree from '../src/mdh/components/JsonTree.jsx';
import jv from '../src/mdh/components/jsonValues.module.css';
import specialTextCss from '../src/mdh/components/SpecialText.module.css';

function mount(data: any, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <JsonTree
      data={data}
      sortState={{}}
      filterState={{}}
      onSort={() => {}}
      onFilter={() => {}}
      {...extra}
    />,
    root,
  );
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('JsonTree compact type tags', () => {
  it('renders an EJSON value with the shared compact value-type-tag (short + title), not the full-word badge', () => {
    const root = mount({ _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
    expect(root.querySelector('.json-tree-badge')).toBeNull();
    const tag = root.querySelector(`.${jv.valueTypeTag}`)!;
    expect(tag).not.toBeNull();
    expect(tag.textContent).toBe('oid');
    expect(tag.getAttribute('title')).toBe('ObjectId');
    expect(tag.classList.contains(jv.jsonTreeValueOid)).toBe(true);
    expect(root.textContent).toContain('aaaaaaaaaaaaaaaaaaaaaaaa');
    // In the list view the tag is shown AFTER the value.
    const row = tag.closest(`.${jv.jsonTreeRow}`);
    const kids = [...row!.children];
    const valIdx = kids.findIndex((k) => k.classList.contains(jv.jsonTreeValue));
    const tagIdx = kids.findIndex((k) => k.classList.contains(jv.valueTypeTag));
    expect(valIdx).toBeGreaterThanOrEqual(0);
    expect(tagIdx).toBeGreaterThan(valIdx);
  });

  it('uses the num tag for numeric EJSON types', () => {
    const root = mount({ n: { $numberDecimal: '1.50' } });
    const tag = root.querySelector(`.${jv.valueTypeTag}`)!;
    expect(tag.textContent).toBe('num');
    expect(tag.getAttribute('title')).toBe('Decimal');
  });
});

describe('JsonTree special-character reveal', () => {
  it('reveals a special char in a string value', () => {
    const root = mount({ name: 'a\u00a0b' });
    const span = root.querySelector(
      `.${specialTextCss.mdhSpecial}.${specialTextCss.mdhSpecialSpace}`,
    );
    expect(span).not.toBeNull();
    expect(span!.getAttribute('title')).toBe('U+00A0 NO-BREAK SPACE');
  });

  it('reveals a special char in a string array item', () => {
    const root = mount({ tags: ['x\u200bz'] });
    expect(
      root.querySelector(`.${specialTextCss.mdhSpecial}.${specialTextCss.mdhSpecialZeroWidth}`),
    ).not.toBeNull();
  });

  it('also reveals in read-only mode', () => {
    const root = mount({ name: 'a\u00a0b' }, { readOnly: true });
    expect(
      root.querySelector(`.${specialTextCss.mdhSpecial}.${specialTextCss.mdhSpecialSpace}`),
    ).not.toBeNull();
  });

  it('leaves a clean string untouched', () => {
    const root = mount({ name: 'Alice' });
    expect(root.querySelectorAll(`.${specialTextCss.mdhSpecial}`).length).toBe(0);
    expect(root.textContent).toContain('"Alice"');
  });
});
