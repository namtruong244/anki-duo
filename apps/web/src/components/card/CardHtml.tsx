import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { sanitizeCss, sanitizeHtml, type Interaction } from '@anki-duo/domain';
import { useColorScheme } from '../../client/theme';
import { slotWidgets } from '../answer';

const MEDIA = /^media:([0-9a-f-]{36})$/i;
const SOUND = /\[sound:([0-9a-f-]{36})\]/gi;

/** Built-in styles; user CSS comes after and may override them. */
const BASE_CSS = `
:host { display: block; }
.card { color: var(--color-text, #222); font-size: 1.25rem; line-height: 1.5; text-align: center; overflow-wrap: anywhere; }
.card img { max-width: 100%; height: auto; }
.card a { color: var(--color-nav-active-text, #1565c0); font-weight: 700; text-decoration: underline; }
.card table { border-collapse: collapse; }
.card pre, .card code { font-family: ui-monospace, monospace; }
.cloze { font-weight: 700; color: var(--color-secondary, #1899d6); }
.cloze.cloze-hidden { color: var(--color-text-muted, #777); letter-spacing: 0.05em; }
.ad-hint { margin: 0.5em 0; text-align: start; }
.ad-hint > summary { cursor: pointer; font-size: 0.9rem; font-weight: 800; color: var(--color-secondary, #1899d6); min-height: 2rem; }
.ad-hint > summary:focus-visible { outline: 3px solid var(--color-text, #222); outline-offset: 2px; }
.ad-slot { display: inline-block; max-width: 100%; vertical-align: middle; }
.ad-slot:empty { display: none; }
.replay-btn { display: inline-flex; align-items: center; gap: 0.4em; min-height: 2.75rem; padding: 0.4em 1em; margin: 0 0.25em; border: 0; border-radius: 1rem; cursor: pointer; font: inherit; font-size: 0.9rem; font-weight: 800; background: var(--color-secondary, #1cb0f6); color: var(--color-on-secondary, #fff); box-shadow: 0 3px 0 var(--color-secondary-depth, #1899d6); vertical-align: middle; }
.replay-btn:active { transform: translateY(2px); box-shadow: none; }
.replay-btn:focus-visible { outline: 3px solid var(--color-text, #222); outline-offset: 2px; }
`;

const mq = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function useIsDark(): boolean {
  const [choice] = useColorScheme();
  const system = useSyncExternalStore(
    (cb) => {
      const m = mq();
      m?.addEventListener?.('change', cb);
      return () => m?.removeEventListener?.('change', cb);
    },
    () => mq()?.matches ?? false,
    () => false,
  );
  return choice === 'dark' || (choice === 'system' && system);
}

/** Rewrites media, links and sound tokens in already-sanitised DOM. */
function postProcess(root: HTMLElement, replayLabel: string, hintLabel: string) {
  for (const sum of Array.from(root.querySelectorAll('details.ad-hint > summary'))) {
    if (!sum.textContent?.trim()) sum.textContent = hintLabel;
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const m = MEDIA.exec(img.getAttribute('src') ?? '');
    if (m) img.setAttribute('src', `/api/v1/media/${m[1]}`);
    img.setAttribute('loading', 'lazy');
    img.addEventListener('error', () => {
      const alt = img.getAttribute('alt');
      img.replaceWith(document.createTextNode(alt ?? ''));
    });
  }
  for (const a of Array.from(root.querySelectorAll('a'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (new RegExp(SOUND.source, 'i').test(n.nodeValue ?? '')) texts.push(n as Text);
  }
  for (const node of texts) {
    const value = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of value.matchAll(SOUND)) {
      frag.append(value.slice(last, m.index));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'replay-btn';
      btn.setAttribute('aria-label', replayLabel);
      btn.dataset.sound = m[1]!;
      btn.textContent = `▶ ${replayLabel}`;
      frag.append(btn);
      last = (m.index ?? 0) + m[0].length;
    }
    frag.append(value.slice(last));
    node.replaceWith(frag);
  }
}

/** Renders note-card HTML inside an isolated shadow root (sanitised twice, CSS scoped to the card). */
export function CardHtml({
  html,
  css,
  className,
  interaction,
  side = 'front',
}: {
  html: string;
  css: string;
  className?: string;
  /** Slot widgets are mounted into `#ad-slot-N` for `interaction.slots[N]` (R4). */
  interaction?: Interaction | null;
  side?: 'front' | 'back';
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const [mounts, setMounts] = useState<{ el: Element; index: number }[]>([]);
  const dark = useIsDark();
  const replayLabel = t('media.replay');
  const hintLabel = t('card.showHint');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!root || !card) return;
    card.replaceChildren();
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitizeHtml(html);
    card.append(tpl.content);
    postProcess(card, replayLabel, hintLabel);
    const found: { el: Element; index: number }[] = [];
    for (const el of Array.from(card.querySelectorAll('span.ad-slot[id^="ad-slot-"]'))) {
      const m = /^ad-slot-(\d+)$/.exec(el.id);
      if (m) found.push({ el, index: Number(m[1]) });
    }
    setMounts(found);
    const onClick = (e: Event) => {
      const btn = (e.target as Element).closest?.('button[data-sound]') as HTMLElement | null;
      if (!btn) return;
      const audio = new Audio(`/api/v1/media/${btn.dataset.sound}`);
      void audio.play().catch(() => undefined);
    };
    card.addEventListener('click', onClick);
    return () => card.removeEventListener('click', onClick);
  }, [root, html, replayLabel, hintLabel]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        contain: 'paint',
        isolation: 'isolate',
        overflow: 'auto',
        maxHeight: '100%',
      }}
    >
      {root &&
        createPortal(
          <>
            <style>{BASE_CSS + sanitizeCss(css)}</style>
            <div ref={cardRef} className={dark ? 'card nightMode night_mode' : 'card'} />
            {mounts.map(({ el, index }) => {
              const slot = interaction?.slots[index];
              const Widget = slot ? slotWidgets[slot.kind] : undefined;
              if (!slot || !Widget) return null;
              return createPortal(
                <Widget slot={slot} side={side} index={index} />,
                el,
                `slot-${index}`,
              );
            })}
          </>,
          root as unknown as Element,
        )}
    </div>
  );
}
