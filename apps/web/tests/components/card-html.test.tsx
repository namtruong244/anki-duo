import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { CardHtml } from '../../src/components/card/CardHtml';
import { AnswerContext, slotWidgets, useAnswer } from '../../src/components/answer';
import type { Interaction } from '@anki-duo/domain';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

beforeAll(async () => {
  await initI18n('en');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function shadow(c: HTMLElement): ShadowRoot {
  const host = c.firstElementChild as HTMLElement;
  expect(host.shadowRoot).toBeTruthy();
  return host.shadowRoot!;
}

describe('CardHtml', () => {
  it('renders sanitised content inside an open shadow root', () => {
    const { container } = render(<CardHtml html="<b>Hello</b>" css="" />);
    const root = shadow(container);
    expect(root.querySelector('.card b')?.textContent).toBe('Hello');
    expect(container.querySelector('b')).toBeNull();
  });

  it('strips scripts and event handlers', () => {
    const { container } = render(
      <CardHtml
        html={'<p onclick="x()">a</p><script>window.__x=1</script><img src="x" onerror="y()">'}
        css=""
      />,
    );
    const root = shadow(container);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('[onclick]')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
  });

  it('rewrites media: image sources', () => {
    const { container } = render(<CardHtml html={`<img src="media:${ID}" alt="pic">`} css="" />);
    expect(shadow(container).querySelector('img')?.getAttribute('src')).toBe(`/api/v1/media/${ID}`);
  });

  it('turns [sound:id] into an accessible replay button that plays the clip', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const urls: string[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        constructor(url: string) {
          urls.push(url);
        }
        play = play;
      },
    );
    const { container } = render(<CardHtml html={`<p>x [sound:${ID}] y</p>`} css="" />);
    const btn = shadow(container).querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Replay');
    expect(shadow(container).textContent).not.toContain('[sound:');
    fireEvent.click(btn);
    expect(urls).toEqual([`/api/v1/media/${ID}`]);
    expect(play).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('opens links in a new tab safely', () => {
    const { container } = render(<CardHtml html='<a href="https://example.com">l</a>' css="" />);
    const a = shadow(container).querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('applies card css and confines the host', () => {
    const { container } = render(<CardHtml html="x" css=".card { color: red; }" />);
    expect(shadow(container).querySelector('style')?.textContent).toContain('color: red');
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.contain).toBe('paint');
    expect(host.style.isolation).toBe('isolate');
    expect(host.style.maxHeight).toBe('100%');
  });

  it('adds night mode classes in the dark theme', () => {
    localStorage.setItem('color-scheme', 'dark');
    const { container } = render(<CardHtml html="x" css="" />);
    expect(shadow(container).querySelector('.card')?.classList.contains('night_mode')).toBe(true);
  });

  describe('interactive slots', () => {
    const interaction: Interaction = {
      v: 1,
      slots: [{ kind: 'type' }, { kind: 'tts', lang: 'ja', text: 'hi' }],
      answer: null,
    };
    afterEach(() => {
      delete slotWidgets.type;
      delete slotWidgets.tts;
    });

    it('mounts the registered widget inside the shadow root', () => {
      slotWidgets.type = ({ index, side }) => <b data-testid="w">{`type-${index}-${side}`}</b>;
      const { container } = render(
        <CardHtml
          html={'<p>a <span class="ad-slot" id="ad-slot-0"></span></p>'}
          css=""
          interaction={interaction}
          side="front"
        />,
      );
      const root = shadow(container);
      expect(root.querySelector('#ad-slot-0 b')?.textContent).toBe('type-0-front');
      expect(container.querySelector('b')).toBeNull();
    });

    it('mounts each slot by its own kind and index', () => {
      slotWidgets.type = ({ slot }) => <i>{slot.kind}</i>;
      slotWidgets.tts = ({ slot }) => <u>{slot.kind === 'tts' ? slot.text : ''}</u>;
      const { container } = render(
        <CardHtml
          html={
            '<span class="ad-slot" id="ad-slot-0"></span><span class="ad-slot" id="ad-slot-1"></span>'
          }
          css=""
          interaction={interaction}
          side="back"
        />,
      );
      const root = shadow(container);
      expect(root.querySelector('#ad-slot-0 i')?.textContent).toBe('type');
      expect(root.querySelector('#ad-slot-1 u')?.textContent).toBe('hi');
    });

    it('renders nothing for a missing slot entry or an unregistered kind', () => {
      slotWidgets.type = () => <b>w</b>;
      const { container } = render(
        <CardHtml
          html={
            '<span class="ad-slot" id="ad-slot-5"></span><span class="ad-slot" id="ad-slot-1"></span>'
          }
          css=""
          interaction={interaction}
        />,
      );
      const root = shadow(container);
      expect(root.querySelector('#ad-slot-5')?.childNodes.length).toBe(0);
      expect(root.querySelector('#ad-slot-1')?.childNodes.length).toBe(0);
    });

    it('widgets can read the answer context through the portal', () => {
      const submit = vi.fn();
      slotWidgets.type = () => {
        const a = useAnswer();
        return (
          <button type="button" onClick={() => a.submitAnswer({ verdict: 'correct', given: 'x' })}>
            {a.status}
          </button>
        );
      };
      const { container } = render(
        <AnswerContext.Provider
          value={{
            status: 'answering',
            answer: null,
            result: null,
            suggested: null,
            submitAnswer: submit,
          }}
        >
          <CardHtml
            html={'<span class="ad-slot" id="ad-slot-0"></span>'}
            css=""
            interaction={interaction}
            side="front"
          />
        </AnswerContext.Provider>,
      );
      const btn = shadow(container).querySelector('#ad-slot-0 button') as HTMLButtonElement;
      expect(btn.textContent).toBe('answering');
      fireEvent.click(btn);
      expect(submit).toHaveBeenCalledWith({ verdict: 'correct', given: 'x' });
    });

    it('labels an empty hint summary and leaves a filled one alone', () => {
      const { container } = render(
        <CardHtml
          html={
            '<details class="ad-hint"><summary></summary>tip</details><details class="ad-hint"><summary>Mine</summary>x</details>'
          }
          css=""
        />,
      );
      const sums = shadow(container).querySelectorAll('details.ad-hint > summary');
      expect(sums[0]?.textContent).toBe('Show hint');
      expect(sums[1]?.textContent).toBe('Mine');
    });

    it('ships base styles for cloze, hints and slots', () => {
      const { container } = render(<CardHtml html="x" css="" />);
      const css = shadow(container).querySelector('style')?.textContent ?? '';
      expect(css).toContain('.cloze');
      expect(css).toContain('.ad-hint');
      expect(css).toContain('.ad-slot');
    });

    it('renders Basic cards exactly as before when no interaction is given', () => {
      const { container } = render(<CardHtml html="<b>Hello</b>" css="" />);
      expect(shadow(container).querySelector('.card')?.innerHTML).toBe('<b>Hello</b>');
    });
  });
});
