import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GradeBar, useSessionHotkeys } from '../../src/components/session/GradeBar';
import { intervalParts } from '../../src/lib/interval';
import { initI18n } from '../../src/i18n';

afterEach(cleanup);
initI18n('en');

const MIN = 60_000;
const DAY = 86_400_000;
const previews = { again: MIN, hard: 6 * MIN, good: 3 * DAY, easy: 40 * DAY };

describe('intervalParts', () => {
  it('picks a sensible unit', () => {
    expect(intervalParts(30_000)).toEqual({ unit: 'lessThanMinute', n: 0 });
    expect(intervalParts(10 * MIN)).toEqual({ unit: 'minutes', n: 10 });
    expect(intervalParts(5 * 3_600_000)).toEqual({ unit: 'hours', n: 5 });
    expect(intervalParts(3 * DAY)).toEqual({ unit: 'days', n: 3 });
    expect(intervalParts(60 * DAY)).toEqual({ unit: 'months', n: 2 });
    expect(intervalParts(800 * DAY)).toEqual({ unit: 'years', n: 2 });
  });
});

describe('GradeBar', () => {
  it('shows four buttons with grade and interval, e.g. "Good · 3d"', () => {
    render(<GradeBar previews={previews} onGrade={() => {}} />);
    expect(screen.getByRole('button', { name: 'Again · 1m' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hard · 6m' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Good · 3d' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Easy · 1mo' })).toBeTruthy();
  });

  it('calls onGrade with 1-4', () => {
    const onGrade = vi.fn();
    render(<GradeBar previews={previews} onGrade={onGrade} />);
    fireEvent.click(screen.getByRole('button', { name: 'Easy · 1mo' }));
    expect(onGrade).toHaveBeenCalledWith(4);
  });
});

describe('GradeBar suggested', () => {
  it('rings the suggested grade and shows a Suggested text badge', () => {
    render(<GradeBar previews={previews} onGrade={() => {}} suggested={2} />);
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hard · 6m' }).getAttribute('data-suggested')).toBe(
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Good · 3d' }).getAttribute('data-suggested'),
    ).toBeNull();
  });

  it('shows no badge without a suggestion', () => {
    render(<GradeBar previews={previews} onGrade={() => {}} />);
    expect(screen.queryByText('Suggested')).toBeNull();
  });
});

describe('useSessionHotkeys', () => {
  function Harness(p: {
    revealed: boolean;
    onReveal: () => void;
    onGrade: (g: number) => void;
    onUndo: () => void;
  }) {
    useSessionHotkeys(p as never);
    return <input aria-label="field" />;
  }
  const setup = (revealed: boolean) => {
    const h = { onReveal: vi.fn(), onGrade: vi.fn(), onUndo: vi.fn() };
    render(<Harness revealed={revealed} {...h} />);
    return h;
  };

  it('Space reveals, then 1-4 grade, Z undoes', () => {
    const front = setup(false);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '3' });
    expect(front.onReveal).toHaveBeenCalledOnce();
    expect(front.onGrade).not.toHaveBeenCalled(); // not revealed yet
    cleanup();
    const back = setup(true);
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'z' });
    expect(back.onGrade).toHaveBeenCalledWith(2);
    expect(back.onUndo).toHaveBeenCalledOnce();
  });

  it('is ignored while typing in a field', () => {
    const h = setup(false);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: ' ' });
    expect(h.onReveal).not.toHaveBeenCalled();
  });
});
