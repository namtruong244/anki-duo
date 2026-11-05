import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardContent } from '../../src/components/session/CardContent';

afterEach(cleanup);

describe('CardContent', () => {
  it('renders bold, lists, code and GFM tables', () => {
    const { container } = render(
      <CardContent
        markdown={'**bold** and `code`\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |'}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('shows raw HTML and <script> as text, never as elements', () => {
    const { container } = render(
      <CardContent markdown={'<script>alert(1)</script> <b onclick="x()">hi</b>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('strips javascript: links', () => {
    render(<CardContent markdown={'[click](javascript:alert(1)) and [ok](https://example.com)'} />);
    const bad = screen.getByText('click');
    expect(bad.getAttribute('href')).toBeNull();
    expect(screen.getByText('ok').getAttribute('href')).toBe('https://example.com');
  });

  it('opens external links safely', () => {
    render(<CardContent markdown={'[ok](https://example.com)'} />);
    const a = screen.getByText('ok');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('blocks external images that are not https', () => {
    const { container } = render(
      <CardContent
        markdown={
          '![a](http://example.com/a.png) ![b](data:image/png;base64,AAAA) ![c](https://example.com/c.png)'
        }
      />,
    );
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['https://example.com/c.png']);
  });

  it('serves media: images from the API', () => {
    const { container } = render(
      <CardContent markdown={'![pic](media:11111111-1111-4111-8111-111111111111)'} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/media/11111111-1111-4111-8111-111111111111',
    );
  });

  it('keeps long content scrollable inside its own box (FR edge case)', () => {
    const { container } = render(<CardContent markdown={'x '.repeat(5000)} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('overflow-y-auto');
  });
});
