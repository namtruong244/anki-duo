import { Parser } from 'htmlparser2';

const MAX_CSS = 100_000;

const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'p',
  'br',
  'hr',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'mark',
  'small',
  'big',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'img',
  'a',
  'ruby',
  'rt',
  'rp',
  'font',
  'center',
  'details',
  'summary',
  'figure',
  'figcaption',
]);
const DROP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
  'head',
  'title',
  'textarea',
  'select',
  'frame',
  'frameset',
  'applet',
  'noembed',
  'noframes',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const BLOCK_TAGS = new Set([
  'div',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'tr',
  'figure',
  'figcaption',
  'details',
  'summary',
  'center',
]);
const GLOBAL_ATTRS = new Set(['class', 'id', 'style', 'title', 'lang', 'dir']);
const TAG_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
  font: new Set(['color', 'size', 'face']),
};

const MEDIA_RE = /^media:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001f\u007f]/;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeImgSrc(v: string): string | null {
  const t = v.trim();
  if (CTRL_RE.test(t)) return null;
  if (/^https:\/\/[^\s]+$/i.test(t) || MEDIA_RE.test(t)) return t;
  return null;
}
function safeHref(v: string): string | null {
  const t = v.trim();
  if (CTRL_RE.test(t)) return null;
  if (/^(https?:\/\/|mailto:)[^\s]*$/i.test(t) || /^#[\w-]*$/.test(t)) return t;
  return null;
}

function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\\([\s\S])/g, '$1');
}

export function sanitizeCss(css: string): string {
  let out = String(css ?? '').slice(0, MAX_CSS);
  for (let i = 0; i < 10; i++) {
    const before = out;
    out = out.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
    out = decodeCssEscapes(out);
    // eslint-disable-next-line no-control-regex
    out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    out = out.replace(/@(import|charset)\b[^;{}]*(;|$)/gi, '');
    out = out.replace(/<\s*\/?\s*style/gi, '');
    out = out.replace(/<!--|-->|<\//g, '');
    out = out.replace(
      /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|((?:[^()]|\([^()]*\))*?))\s*\)/gi,
      (_m, a?: string, b?: string, c?: string) => {
        const v = (a ?? b ?? c ?? '').trim();
        return safeImgSrc(v) ? `url("${v.replace(/["\\]/g, '')}")` : 'none';
      },
    );
    out = out.replace(/expression\s*\(/gi, '');
    out = out.replace(/behavior\s*:/gi, '');
    out = out.replace(/-moz-binding/gi, '');
    out = out.replace(/javascript\s*:/gi, '');
    out = out.replace(/vbscript\s*:/gi, '');
    out = out.replace(/(-webkit-)?image-set\s*\(/gi, 'none(');
    if (out === before) break;
  }
  return out.slice(0, MAX_CSS);
}

function filterAttr(tag: string, name: string, value: string): string | null {
  if (!GLOBAL_ATTRS.has(name) && !TAG_ATTRS[tag]?.has(name)) return null;
  switch (name) {
    case 'style': {
      const s = sanitizeCss(value).trim();
      return s || null;
    }
    case 'href':
      return safeHref(value);
    case 'src':
      return safeImgSrc(value);
    case 'width':
    case 'height':
      return /^\d{1,5}(%|px)?$/.test(value.trim()) ? value.trim() : null;
    case 'colspan':
    case 'rowspan':
      return /^\d{1,4}$/.test(value.trim()) ? value.trim() : null;
    default:
      return value;
  }
}

type Entry = { void: boolean; emitted: boolean };

export function sanitizeHtml(html: string): string {
  let out = '';
  const stack: Entry[] = [];
  const names: string[] = [];
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (skip > 0) {
          skip++;
          stack.push({ void: false, emitted: false });
          names.push(name);
          return;
        }
        if (DROP_CONTENT_TAGS.has(name)) {
          skip = 1;
          stack.push({ void: false, emitted: false });
          names.push(name);
          return;
        }
        const isVoid = VOID_TAGS.has(name);
        if (!ALLOWED_TAGS.has(name)) {
          stack.push({ void: isVoid, emitted: false });
          names.push(name);
          return;
        }
        let attrs = '';
        let dropTag = false;
        for (const [k, v] of Object.entries(attribs)) {
          const fv = filterAttr(name, k, v);
          if (fv === null) {
            if (name === 'img' && k === 'src') dropTag = true;
            continue;
          }
          attrs += ` ${k}="${escapeAttr(fv)}"`;
        }
        if (name === 'img' && (dropTag || !('src' in attribs))) {
          stack.push({ void: true, emitted: false });
          names.push(name);
          return;
        }
        out += `<${name}${attrs}>`;
        stack.push({ void: isVoid, emitted: true });
        names.push(name);
      },
      ontext(text) {
        if (skip === 0) out += escapeHtml(text);
      },
      onclosetag(name) {
        const e = stack.pop();
        names.pop();
        if (!e) return;
        if (skip > 0) {
          skip--;
          return;
        }
        if (e.emitted && !e.void) out += `</${name}>`;
      },
    },
    { decodeEntities: true },
  );
  parser.write(String(html ?? ''));
  parser.end();
  return out;
}

export function htmlToText(html: string): string {
  let out = '';
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (skip > 0 || DROP_CONTENT_TAGS.has(name)) {
          skip++;
          return;
        }
        if (BLOCK_TAGS.has(name)) out += '\n';
      },
      ontext(text) {
        if (skip === 0) out += text;
      },
      onclosetag(name) {
        if (skip > 0) {
          skip--;
          return;
        }
        if (BLOCK_TAGS.has(name)) out += '\n';
      },
    },
    { decodeEntities: true },
  );
  parser.write(String(html ?? ''));
  parser.end();
  return out
    .replace(/[ \t\f\r\u00a0\u200b]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
