// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { h, render } from 'preact';
import PlaceholderInputs, { parseAnnotationId } from '../src/mdh/components/PlaceholderInputs.jsx';
import placeholderInputsCss from '../src/mdh/components/PlaceholderInputs.module.css';

function renderInputs(props: any) {
  const container = document.createElement('div');
  render(<PlaceholderInputs {...props} />, container);
  return { container };
}

describe('PlaceholderInputs Auto label — value-based guess', () => {
  it('marks the Auto option with "?" when no field type resolved', () => {
    const { container } = renderInputs({
      names: ['cust'],
      values: { cust: '21199417' },
      types: {},
      resolvedTypeFor: () => ({ type: undefined, autoType: undefined }),
    });
    const autoOpt = container.querySelector(
      `.${placeholderInputsCss.placeholderTypeSelect} option[value="auto"]`,
    );
    expect(autoOpt!.textContent).toBe('Auto (Number?)');
  });

  it('does NOT mark with "?" when a field type resolved', () => {
    const { container } = renderInputs({
      names: ['cust'],
      values: { cust: '21199417' },
      types: {},
      resolvedTypeFor: () => ({ type: 'string', autoType: 'string' }),
    });
    const autoOpt = container.querySelector(
      `.${placeholderInputsCss.placeholderTypeSelect} option[value="auto"]`,
    );
    expect(autoOpt!.textContent).toBe('Auto (String)');
  });
});
