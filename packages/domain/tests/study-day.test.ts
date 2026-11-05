import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { endOfStudyDay, studyDay } from '../src/time/study-day.js';

interface Case {
  name: string;
  instant: string;
  timeZone: string;
  dayStartHour: number;
  studyDay: string;
  endOfStudyDay: string;
}
const { cases } = loadFixture<{ cases: Case[] }>('study-day');

describe('studyDay / endOfStudyDay (fixtures/study-day.json)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const day = studyDay(new Date(c.instant), c.timeZone, c.dayStartHour);
      expect(day).toBe(c.studyDay);
      expect(endOfStudyDay(day, c.timeZone, c.dayStartHour).toISOString()).toBe(c.endOfStudyDay);
    });
  }

  it('end of the study day is after the instant and starts the next study day', () => {
    for (const c of cases) {
      const end = endOfStudyDay(c.studyDay, c.timeZone, c.dayStartHour);
      expect(end.getTime()).toBeGreaterThan(new Date(c.instant).getTime());
      expect(studyDay(end, c.timeZone, c.dayStartHour)).not.toBe(c.studyDay);
      expect(studyDay(new Date(end.getTime() - 1), c.timeZone, c.dayStartHour)).toBe(c.studyDay);
    }
  });
});
