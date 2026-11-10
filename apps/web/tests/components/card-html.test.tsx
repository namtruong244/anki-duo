import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { CardHtml } from '../../src/components/card/CardHtml';

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
});
