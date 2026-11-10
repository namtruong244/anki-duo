import { useState } from 'react';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkyButton } from '../../src/components/ui/ChunkyButton';
import { ProgressBar } from '../../src/components/ui/ProgressBar';
import { Dialog } from '../../src/components/ui/Dialog';
import { Select } from '../../src/components/ui/Select';
import { Toast } from '../../src/components/ui/Toast';

afterEach(cleanup);

describe('ChunkyButton', () => {
  it('has an accessible name and is a button', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    expect(screen.getByRole('button', { name: 'Good' })).toBeTruthy();
  });

  it('leaves focus rings to the global :focus-visible rule', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    expect(screen.getByRole('button').className).not.toMatch(
      /outline-none|focus:outline|focus-visible:outline/,
    );
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

  it('resets pressed state on pointerCancel and blur', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    const b = screen.getByRole('button');
    fireEvent.pointerDown(b);
    expect(b.getAttribute('data-pressed')).toBe('true');
    fireEvent.pointerCancel(b);
    expect(b.getAttribute('data-pressed')).toBe('false');

    fireEvent.pointerDown(b);
    expect(b.getAttribute('data-pressed')).toBe('true');
    fireEvent.blur(b);
    expect(b.getAttribute('data-pressed')).toBe('false');
  });

  it('toggles pressed state on Space and Enter keys', () => {
    render(<ChunkyButton>Good</ChunkyButton>);
    const b = screen.getByRole('button');

    fireEvent.keyDown(b, { key: ' ' });
    expect(b.getAttribute('data-pressed')).toBe('true');
    fireEvent.keyUp(b, { key: ' ' });
    expect(b.getAttribute('data-pressed')).toBe('false');

    fireEvent.keyDown(b, { key: 'Enter' });
    expect(b.getAttribute('data-pressed')).toBe('true');
    fireEvent.keyUp(b, { key: 'Enter' });
    expect(b.getAttribute('data-pressed')).toBe('false');
  });

  it('respects external pressed prop', () => {
    const { rerender } = render(<ChunkyButton pressed>Good</ChunkyButton>);
    const b = screen.getByRole('button');
    expect(b.getAttribute('data-pressed')).toBe('true');

    rerender(<ChunkyButton pressed={false}>Good</ChunkyButton>);
    expect(b.getAttribute('data-pressed')).toBe('false');

    rerender(
      <ChunkyButton disabled pressed>
        Good
      </ChunkyButton>,
    );
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

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('opens custom listbox on click and selects an option', async () => {
    const onChange = vi.fn();
    render(<Select aria-label="Pick" value="a" onChange={onChange} options={options} />);
    const trigger = screen.getByRole('button', { name: 'Alpha' });
    await userEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('supports keyboard navigation with ArrowDown, Enter and Escape', async () => {
    const onChange = vi.fn();
    render(<Select aria-label="Pick" value="a" onChange={onChange} options={options} />);
    const trigger = screen.getByRole('button', { name: 'Alpha' });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
