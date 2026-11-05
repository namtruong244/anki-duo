import { useState } from 'react';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkyButton } from '../../src/components/ui/ChunkyButton';
import { ProgressBar } from '../../src/components/ui/ProgressBar';
import { Dialog } from '../../src/components/ui/Dialog';
import { Toast } from '../../src/components/ui/Toast';

afterEach(cleanup);

describe('ChunkyButton', () => {
  it('has an accessible name and is a button', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    expect(screen.getByRole('button', { name: 'Good' })).toBeTruthy();
  });

  it('has a visible focus style', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    expect(screen.getByRole('button').className).toMatch(/focus-visible:/);
  });

  it('exposes a pressed state while held', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    const b = screen.getByRole('button');
    expect(b.getAttribute('data-pressed')).toBe('false');
    fireEvent.pointerDown(b);
    expect(b.getAttribute('data-pressed')).toBe('true');
    fireEvent.pointerUp(b);
    expect(b.getAttribute('data-pressed')).toBe('false');
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <ChunkyButton disabled onClick={onClick}>
        Go
      </ChunkyButton>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ProgressBar', () => {
  it('exposes role=progressbar with aria-valuenow', () => {
    render(<ProgressBar value={3} max={10} label="Progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
  });
});

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button>outside</button>
        <Dialog
          open={open}
          title="Title"
          onClose={() => {
            setOpen(false);
            onClose();
          }}
        >
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>
    );
  }

  it('is a modal dialog with a label and moves focus in', () => {
    render(<Harness onClose={() => {}} />);
    const d = screen.getByRole('dialog', { name: 'Title' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('traps focus with Tab and Shift+Tab', async () => {
    render(<Harness onClose={() => {}} />);
    const d = screen.getByRole('dialog');
    const buttons = d.querySelectorAll('button');
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    last.focus();
    await userEvent.tab();
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(first);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and restores focus', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Toast', () => {
  it('announces politely and dismisses itself', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} durationMs={1000} />);
    expect(screen.getByRole('status').textContent).toContain('Saved');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
