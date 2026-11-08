import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Icon } from '../ui';

// Strict schema (research R11): no raw HTML is parsed at all, and the sanitiser additionally
// limits link and image protocols. Images must be https (or one of our own media: assets).
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'audio'],
    src: ['https', 'media'],
  },
};

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** Turns raw HTML in the Markdown into plain text so it is shown, never executed (FR-034). */
function htmlAsText() {
  const walk = (n: MdNode) => {
    if (n.type === 'html') n.type = 'text';
    n.children?.forEach(walk);
  };
  return walk;
}

/** react-markdown passes the hast `node`; it must not reach the DOM element. */
function omitNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

const MEDIA = /^media:([0-9a-f-]{36})$/i;

const AUDIO = /^audio:([0-9a-f-]{36})$/i;
const AUDIO_TOKEN = /\[\[audio:([0-9a-f-]{36})\]\]/gi;

/** `[[audio:id]]` becomes a link with the `audio:` scheme, rendered as a player below. */
const withAudioLinks = (markdown: string) => markdown.replace(AUDIO_TOKEN, '[audio](audio:$1)');

function urlTransform(url: string) {
  const media = MEDIA.exec(url);
  if (media) return `/api/v1/media/${media[1]}`;
  const audio = AUDIO.exec(url);
  if (audio) return `/api/v1/media/${audio[1]}#audio`;
  return defaultUrlTransform(url);
}

/** An audio clip with an explicit replay button (Story 2 #3, .pen 3D blue speaker pill). */
function AudioClip({ src }: { src: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-text-muted">{t('media.unavailable')}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <audio
        ref={ref}
        src={src.replace('#audio', '')}
        preload="auto"
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl bg-secondary px-4 py-2 font-extrabold text-on-secondary shadow-[0_3px_0_var(--color-secondary-depth)] hover:brightness-[1.03] active:translate-y-[2px] active:shadow-none transition-transform"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          el.currentTime = 0;
          void el.play().catch(() => setFailed(true));
        }}
      >
        <Icon name="volume-2" size={18} />
        <span>{t('media.replay')}</span>
      </button>
    </span>
  );
}

function MediaImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  // Media that was never downloaded for offline use shows a placeholder, not a broken icon.
  if (failed) return <span className="text-text-muted">{alt || t('media.unavailable')}</span>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="my-3 max-h-80 max-w-full rounded-2xl"
      onError={() => setFailed(true)}
    />
  );
}

const VARIANTS = {
  default: 'overflow-y-auto',
  word: 'text-text [&>:first-child]:text-4xl [&>:first-child]:font-black [&>:first-child]:leading-tight [&>:first-child]:tracking-tight sm:[&>:first-child]:text-5xl [&>p:not(:first-child)]:text-base [&>p:not(:first-child)]:font-semibold [&>p:not(:first-child)]:text-text-muted',
  meaning:
    'text-text [&>p:first-child]:text-2xl [&>p:first-child]:font-black [&>p:first-child]:leading-snug [&>p:first-child]:text-primary-accent [&>p:not(:first-child)]:text-base',
} as const;

/** Renders card Markdown safely (FR-010, FR-034). Long content scrolls inside this box. */
export function CardContent({
  markdown,
  className = '',
  variant = 'default',
}: {
  markdown: string;
  className?: string;
  /**
   * `word`: the first block is the headword, later paragraphs are the quiet pronunciation line.
   * `meaning`: the first paragraph is the green meaning, block quotes are examples. Arbitrary
   * Markdown still renders normally in every variant.
   */
  variant?: 'default' | 'word' | 'meaning';
}) {
  return (
    <div className={`max-h-full break-words leading-relaxed ${VARIANTS[variant]} ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm, htmlAsText]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        urlTransform={urlTransform}
        components={{
          a: (props) =>
            typeof props.href === 'string' && props.href.endsWith('#audio') ? (
              <AudioClip src={props.href} />
            ) : (
              <a
                {...omitNode(props)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-bold text-nav-active-text underline hover:brightness-95"
              />
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' &&
            (src.startsWith('https://') || src.startsWith('/api/v1/media/')) ? (
              <MediaImage src={src} alt={alt ?? ''} />
            ) : (
              <span>{alt}</span>
            ),
          pre: (props) => (
            <pre
              className="my-2.5 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-sm"
              {...omitNode(props)}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]"
              {...omitNode(props)}
            />
          ),
          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table
                className="w-full border-collapse rounded-lg border border-border text-sm"
                {...omitNode(props)}
              />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-border bg-surface-2 p-2.5 text-left font-bold text-text"
              {...omitNode(props)}
            />
          ),
          td: (props) => (
            <td className="border border-border p-2.5 text-text" {...omitNode(props)} />
          ),
          p: (props) => <p className="my-2.5 first:mt-0 last:mb-0" {...omitNode(props)} />,
          ul: (props) => (
            <ul className="my-2 list-inside list-disc space-y-1" {...omitNode(props)} />
          ),
          ol: (props) => (
            <ol className="my-2 list-inside list-decimal space-y-1" {...omitNode(props)} />
          ),
          blockquote: (props) => (
            <blockquote
              className="my-3 border-l-4 border-secondary py-1 pl-4 text-text [&>p:first-child]:font-bold [&>p:not(:first-child)]:text-sm [&>p:not(:first-child)]:text-text-muted"
              {...omitNode(props)}
            />
          ),
        }}
      >
        {withAudioLinks(markdown)}
      </Markdown>
    </div>
  );
}
