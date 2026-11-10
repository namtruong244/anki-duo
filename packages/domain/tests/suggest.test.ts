import { describe, expect, it } from 'vitest';
import { suggestGrade } from '../src/index.js';

describe('suggestGrade', () => {
  it('maps verdicts to Again/Hard/Good', () => {
    expect(suggestGrade('wrong')).toBe(1);
    expect(suggestGrade('almost')).toBe(2);
    expect(suggestGrade('correct')).toBe(3);
  });
  it('never returns Easy and takes only the verdict', () => {
    expect(suggestGrade.length).toBe(1);
    for (const v of ['wrong', 'almost', 'correct'] as const)
      expect(suggestGrade(v)).toBeLessThan(4);
  });
});
