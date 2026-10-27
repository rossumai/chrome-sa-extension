import { describe, it, expect } from 'vitest';
import { parseRuleEval, evalForRow, evalSummary } from '../src/builder/ruleEval.js';

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

describe('evalForRow', () => {
  it('a header rule has one result for every row', () => {
    expect(evalForRow([true], null, 0)).toBe(true);
    expect(evalForRow([false], 3, 2)).toBe(false);
  });

  it('one result per table row picks the row', () => {
    expect(evalForRow([false, true, false], 3, 1)).toBe(true);
  });

  it('results that do not match the table rows give none', () => {
    expect(evalForRow([false, true], 3, 1)).toBeNull();
    expect(evalForRow([], null, 0)).toBeNull();
  });
});

describe('evalSummary', () => {
  it('is the value, or how many rows are true', () => {
    expect(evalSummary([false])).toBe('false');
    expect(evalSummary([true, false, true])).toBe('2 of 3 true');
  });
});
