import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Strict schema (research R11): no raw HTML is parsed at all, and the sanitiser additionally
// limits link and image protocols. Images must be https (or one of our own media: assets).
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
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

function urlTransform(url: string) {
  const media = MEDIA.exec(url);
  return media ? `/api/v1/media/${media[1]}` : defaultUrlTransform(url);
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
          a: (props) => (
            <a {...omitNode(props)} target="_blank" rel="noopener noreferrer nofollow" />
          ),
          img: ({ src, alt }) =>
            typeof src === 'string' &&
            (src.startsWith('https://') || src.startsWith('/api/v1/media/')) ? (
              <img src={src} alt={alt ?? ''} loading="lazy" className="max-w-full" />
            ) : (
              <span>{alt}</span>
            ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
