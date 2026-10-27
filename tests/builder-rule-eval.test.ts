import { describe, it, expect } from 'vitest';
import { parseRuleEval, evalText } from '../src/builder/ruleEval.js';

describe('parseRuleEval', () => {
  it('reads the first rule’s results and the error messages', () => {
    expect(
      parseRuleEval({
        condition_values: [[true, false]],
        messages: [
          { type: 'error', content: 'Trigger condition: invalid syntax' },
          { type: 'warning', content: 'from an action' },
        ],
      }),
    ).toEqual({ values: [true, false], errors: ['Trigger condition: invalid syntax'] });
  });

  it('reads an unexpected response as no result', () => {
    expect(parseRuleEval(null)).toEqual({ values: [], errors: [] });
    expect(parseRuleEval({ condition_values: 'x' })).toEqual({ values: [], errors: [] });
  });
});

describe('evalText', () => {
  it('is the value of a header rule', () => {
    expect(evalText([false])).toBe('false');
    expect(evalText([])).toBe('');
  });

  it('per table line: true on the lines where it is, or false on all', () => {
    expect(evalText([true, false, true])).toBe('true on lines 1, 3 of 3');
    expect(evalText([false, true])).toBe('true on line 2 of 2');
    expect(evalText([false, false])).toBe('false on all 2 lines');
  });
});
