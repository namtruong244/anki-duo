import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathMap } from '../../src/components/path/PathMap';
import { initI18n } from '../../src/i18n';
import type { PathNode } from '@anki-duo/domain';

afterEach(cleanup);
initI18n('en');

const node = (index: number, status: PathNode['status'], studied = 0, count = 10): PathNode => ({
  index,
  cardIds: [],
  cardCount: count,
  studiedCount: studied,
  mastery: studied / count,
  status,
});
const nodes = [node(0, 'completed', 10), node(1, 'in_progress', 3), node(2, 'locked')];

describe('PathMap', () => {
  it('names every node with its state in text, not colour alone', () => {
    render(<PathMap nodes={nodes} onStart={() => {}} onLocked={() => {}} motion="full" />);
    expect(screen.getByRole('button', { name: /Node 1.*completed/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Node 2.*in progress/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Node 3.*locked/i })).toBeTruthy();
  });

  it('starts a node session for available and in-progress nodes (also completed ones)', () => {
    const onStart = vi.fn();
    render(<PathMap nodes={nodes} onStart={onStart} onLocked={() => {}} motion="full" />);
    fireEvent.click(screen.getByRole('button', { name: /Node 2/ }));
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it('tapping a locked node starts nothing and reports which node must be finished first', () => {
    const onStart = vi.fn();
    const onLocked = vi.fn();
    render(<PathMap nodes={nodes} onStart={onStart} onLocked={onLocked} motion="full" />);
    fireEvent.click(screen.getByRole('button', { name: /Node 3/ }));
    expect(onStart).not.toHaveBeenCalled();
    expect(onLocked).toHaveBeenCalledWith(2, 1);
  });

  it('marks the current node and shows mastery', () => {
    render(<PathMap nodes={nodes} onStart={() => {}} onLocked={() => {}} motion="full" />);
    expect(screen.getByRole('button', { name: /Node 2/ }).getAttribute('aria-current')).toBe(
      'step',
    );
    expect(screen.getByRole('button', { name: /Node 1/ }).textContent).toContain('100%');
  });

  it('uses a fade, not movement, for the unlock animation with reduced motion', () => {
    render(
      <PathMap
        nodes={nodes}
        onStart={() => {}}
        onLocked={() => {}}
        motion="reduced"
        justUnlocked={1}
      />,
    );
    expect(screen.getByRole('button', { name: /Node 2/ }).getAttribute('data-unlock')).toBe('fade');
  });
});
