import { describe, it, expect } from 'vitest';
import { splitList } from '../src/builder/components/fields.jsx';

describe('splitList', () => {
  it('splits at commas, or at line breaks, trimming and dropping blanks', () => {
    expect(splitList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(splitList('a, b\n\n c', true)).toEqual(['a, b', 'c']);
  });
});
