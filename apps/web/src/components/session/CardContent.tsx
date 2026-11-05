import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

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

/** An audio clip with an explicit replay button (Story 2 #3). */
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
        className="min-h-11 rounded-full border border-border px-3"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          el.currentTime = 0;
          void el.play().catch(() => setFailed(true));
        }}
      >
        {t('media.replay')}
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
      className="max-w-full"
      onError={() => setFailed(true)}
    />
  );
}

/** Renders card Markdown safely (FR-010, FR-034). Long content scrolls inside this box. */
export function CardContent({
  markdown,
  className = '',
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={`max-h-full overflow-y-auto break-words ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm, htmlAsText]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        urlTransform={urlTransform}
        components={{
          a: (props) =>
            typeof props.href === 'string' && props.href.endsWith('#audio') ? (
              <AudioClip src={props.href} />
            ) : (
              <a {...omitNode(props)} target="_blank" rel="noopener noreferrer nofollow" />
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' &&
            (src.startsWith('https://') || src.startsWith('/api/v1/media/')) ? (
              <MediaImage src={src} alt={alt ?? ''} />
            ) : (
              <span>{alt}</span>
            ),
        }}
      >
        {withAudioLinks(markdown)}
      </Markdown>
    </div>
  );
}
