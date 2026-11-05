import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { heatmapBuckets } from '@anki-duo/domain';
import { DonutRing } from '../../src/components/charts/DonutRing';
import { Heatmap } from '../../src/components/charts/Heatmap';
import { initI18n } from '../../src/i18n';

afterEach(cleanup);
initI18n('en');

describe('DonutRing', () => {
  const counts = { suspended: 1, new: 4, learning: 2, due: 3, notDue: 10 };

  it('shows 5 labelled segments with their numbers, readable without colour', () => {
    render(<DonutRing counts={counts} centre={7} />);
    const list = screen.getByRole('list', { name: /cards by status/i });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/New.*4/),
      expect.stringMatching(/Learning.*2/),
      expect.stringMatching(/Due.*3/),
      expect.stringMatching(/Not due.*10/),
      expect.stringMatching(/Suspended.*1/),
    ]);
  });

  it('puts today’s workload in the centre and describes the chart', () => {
    render(<DonutRing counts={counts} centre={7} />);
    expect(screen.getByTestId('donut-centre').textContent).toContain('7');
    expect(screen.getByRole('img', { name: /20 cards/i })).toBeTruthy();
  });

  it('renders with no cards', () => {
    render(
      <DonutRing counts={{ suspended: 0, new: 0, learning: 0, due: 0, notDue: 0 }} centre={0} />,
    );
    expect(screen.getByTestId('donut-centre').textContent).toContain('0');
  });
});

describe('Heatmap', () => {
  const cells = heatmapBuckets(
    [
      { studyDay: '2026-03-09', reviews: 5 },
      { studyDay: '2026-03-10', reviews: 1 },
    ],
    '2026-03-10',
  );

  it('gives every cell an accessible name', () => {
    render(<Heatmap cells={cells} />);
    expect(screen.getByRole('img', { name: '2026-03-09: 5 reviews' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '2026-03-10: 1 review' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '2026-03-08: 0 reviews' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(365);
  });

  it('shows a tooltip on hover, focus and tap', () => {
    render(<Heatmap cells={cells} />);
    const cell = screen.getByRole('img', { name: '2026-03-09: 5 reviews' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole('tooltip').textContent).toBe('2026-03-09: 5 reviews');
    fireEvent.mouseLeave(cell);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(cell);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(cell);
    fireEvent.click(screen.getByRole('img', { name: '2026-03-10: 1 review' }));
    expect(screen.getByRole('tooltip').textContent).toBe('2026-03-10: 1 review');
  });

  it('moves between cells with the arrow keys', () => {
    render(<Heatmap cells={cells} />);
    const cell = screen.getByRole('img', { name: '2026-03-09: 5 reviews' });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('img', { name: '2026-03-10: 1 review' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cell);
    fireEvent.keyDown(cell, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('img', { name: '2026-03-02: 0 reviews' }));
  });
});
