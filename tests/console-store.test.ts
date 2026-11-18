import { describe, it, expect } from 'vitest';
import { activeApp } from '../src/console/store.js';

describe('console store', () => {
  it('defaults to mdh', () => {
    expect(activeApp.value).toBe('mdh');
  });
});
