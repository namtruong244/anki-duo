import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { sanitizeHtml } from '@anki-duo/domain';
import { useTranslation } from 'react-i18next';
import { api } from '../../client/api';
import { dexieStore } from '../../client/store';
import { MediaRejected, uploadMedia } from '../../client/media-upload';
import { describeApiError } from '../../lib/api-error';

const ACCEPT = {
  image: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
  audio: 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav',
};

/** A lone `<p>…</p>` is unwrapped so single-line fields stay plain; empty content is ''. */
export function normalizeEditorHtml(html: string, empty: boolean): string {
  if (empty) return '';
  const m = /^<p>((?:(?!<\/p>)[\s\S])*)<\/p>$/.exec(html);
  return sanitizeHtml(m ? m[1]! : html);
}

export interface RichFieldEditorProps {
  id: string;
  label: string;
  /** HTML in. */
  value: string;
  /** Sanitized HTML out (raw text while typing in HTML mode; sanitized on blur). */
  onChange: (html: string) => void;
  disabled?: boolean | undefined;
  /** Card the media is uploaded against; undefined until the note exists. */
  mediaCardId?: string | undefined;
}

const toolBtn =
  'flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-[var(--color-card)] px-2 text-xs font-black text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-nav-active-border aria-pressed:bg-nav-active-bg aria-pressed:text-nav-active-text';

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={toolBtn}
    >
      {children}
    </button>
  );
}

/**
 * WYSIWYG field editor (TipTap) with a raw-HTML mode. Value in/out is an HTML string that goes
 * through `sanitizeHtml`; images are `<img src="media:<id>">` and audio is the `[sound:<id>]` token.
 */
export function RichFieldEditor({
  id,
  label,
  value,
  onChange,
  disabled = false,
  mediaCardId,
}: RichFieldEditorProps) {
  const { t } = useTranslation();
  const [htmlMode, setHtmlMode] = useState(false);
  const [raw, setRaw] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const files = { image: useRef<HTMLInputElement>(null), audio: useRef<HTMLInputElement>(null) };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Image.configure({ inline: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class:
          'min-h-24 rounded-2xl border-2 border-border bg-surface px-4 py-3 text-sm font-semibold text-text focus:border-secondary focus:bg-[var(--color-card)] focus:outline-none [&_img]:max-w-full [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-secondary [&_a]:underline',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = normalizeEditorHtml(ed.getHTML(), ed.isEmpty);
      last.current = html;
      onChangeRef.current(html);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // External value changes (loading a note, "save & add another") replace the content.
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    setRaw(value);
    editor?.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  const toggleHtml = () => {
    if (htmlMode) {
      const clean = sanitizeHtml(raw);
      last.current = clean;
      setRaw(clean);
      editor?.commands.setContent(clean, { emitUpdate: false });
      onChange(clean);
    } else {
      setRaw(last.current);
    }
    setHtmlMode(!htmlMode);
  };

  const chain = (fn: (e: Editor) => boolean) => () => {
    if (editor) fn(editor);
  };

  const setLink = () => {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
    const url = window.prompt(t('notes.toolbar.linkPrompt'), prev);
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const upload = async (file: File, kind: 'image' | 'audio') => {
    if (!mediaCardId || !editor) return;
    setError(null);
    setBusy(true);
    try {
      const { media } = await uploadMedia(
        { api, store: dexieStore },
        { cardId: mediaCardId, side: 'front', file },
      );
      if (kind === 'image') {
        editor
          .chain()
          .focus()
          .setImage({ src: `media:${media.id}`, alt: file.name.replace(/[<>"]/g, '') })
          .run();
      } else {
        editor.chain().focus().insertContent(`[sound:${media.id}]`).run();
      }
    } catch (e) {
      setError(
        e instanceof MediaRejected
          ? e.reason === 'too_large'
            ? t('media.tooLarge')
            : t('media.unsupported')
          : describeApiError(t, e),
      );
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || !editor;
  const mediaOff = off || !mediaCardId || busy;
  const mediaHint = mediaCardId ? undefined : t('notes.toolbar.saveFirst');

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={htmlMode ? `${id}-html` : id}
          className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted"
        >
          {label}
        </label>
      </div>
      <div
        role="toolbar"
        aria-label={t('notes.toolbar.label', { field: label })}
        className="flex flex-wrap gap-1.5"
      >
        {!htmlMode && (
          <>
            <Tool
              label={t('notes.toolbar.bold')}
              active={editor?.isActive('bold')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleBold().run())}
            >
              <b>B</b>
            </Tool>
            <Tool
              label={t('notes.toolbar.italic')}
              active={editor?.isActive('italic')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleItalic().run())}
            >
              <i>I</i>
            </Tool>
            <Tool
              label={t('notes.toolbar.underline')}
              active={editor?.isActive('underline')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleUnderline().run())}
            >
              <u>U</u>
            </Tool>
            <Tool
              label={t('notes.toolbar.strike')}
              active={editor?.isActive('strike')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleStrike().run())}
            >
              <s>S</s>
            </Tool>
            <Tool
              label={t('notes.toolbar.subscript')}
              active={editor?.isActive('subscript')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleSubscript().run())}
            >
              x₂
            </Tool>
            <Tool
              label={t('notes.toolbar.superscript')}
              active={editor?.isActive('superscript')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleSuperscript().run())}
            >
              x²
            </Tool>
            <label
              className={`${toolBtn} relative overflow-hidden`}
              title={t('notes.toolbar.color')}
            >
              <span aria-hidden>A</span>
              <input
                type="color"
                aria-label={t('notes.toolbar.color')}
                disabled={off}
                defaultValue="#d32f2f"
                onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <label
              className={`${toolBtn} relative overflow-hidden`}
              title={t('notes.toolbar.highlight')}
            >
              <span aria-hidden className="rounded bg-yellow-200 px-1 text-black">
                H
              </span>
              <input
                type="color"
                aria-label={t('notes.toolbar.highlight')}
                disabled={off}
                defaultValue="#fff176"
                onChange={(e) =>
                  editor?.chain().focus().setHighlight({ color: e.target.value }).run()
                }
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <Tool
              label={t('notes.toolbar.bulletList')}
              active={editor?.isActive('bulletList')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleBulletList().run())}
            >
              •≡
            </Tool>
            <Tool
              label={t('notes.toolbar.orderedList')}
              active={editor?.isActive('orderedList')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().toggleOrderedList().run())}
            >
              1.
            </Tool>
            <Tool
              label={t('notes.toolbar.alignLeft')}
              active={editor?.isActive({ textAlign: 'left' })}
              disabled={off}
              onClick={chain((e) => e.chain().focus().setTextAlign('left').run())}
            >
              ⇤
            </Tool>
            <Tool
              label={t('notes.toolbar.alignCenter')}
              active={editor?.isActive({ textAlign: 'center' })}
              disabled={off}
              onClick={chain((e) => e.chain().focus().setTextAlign('center').run())}
            >
              ↔
            </Tool>
            <Tool
              label={t('notes.toolbar.alignRight')}
              active={editor?.isActive({ textAlign: 'right' })}
              disabled={off}
              onClick={chain((e) => e.chain().focus().setTextAlign('right').run())}
            >
              ⇥
            </Tool>
            <Tool
              label={t('notes.toolbar.link')}
              active={editor?.isActive('link')}
              disabled={off}
              onClick={setLink}
            >
              🔗
            </Tool>
            <Tool
              label={t('notes.toolbar.clear')}
              disabled={off}
              onClick={chain((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}
            >
              Tx
            </Tool>
            <button
              type="button"
              aria-label={t('notes.toolbar.image')}
              title={mediaHint ?? t('notes.toolbar.image')}
              disabled={mediaOff}
              onClick={() => files.image.current?.click()}
              className={toolBtn}
            >
              🖼
            </button>
            <button
              type="button"
              aria-label={t('notes.toolbar.audio')}
              title={mediaHint ?? t('notes.toolbar.audio')}
              disabled={mediaOff}
              onClick={() => files.audio.current?.click()}
              className={toolBtn}
            >
              🔊
            </button>
            {(['image', 'audio'] as const).map((kind) => (
              <input
                key={kind}
                ref={files[kind]}
                type="file"
                hidden
                data-testid={`rich-media-${kind}`}
                accept={ACCEPT[kind]}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f, kind);
                }}
              />
            ))}
          </>
        )}
        <button
          type="button"
          aria-pressed={htmlMode}
          disabled={disabled}
          onClick={toggleHtml}
          className={`${toolBtn} ml-auto font-mono`}
        >
          {t('notes.toolbar.html')}
        </button>
      </div>
      {htmlMode ? (
        <textarea
          id={`${id}-html`}
          aria-label={t('notes.toolbar.htmlSource', { field: label })}
          className="min-h-24 w-full resize-y rounded-2xl border-2 border-border bg-surface px-4 py-3 font-mono text-sm leading-relaxed text-text focus:border-secondary focus:outline-none disabled:opacity-60"
          value={raw}
          disabled={disabled}
          onChange={(e) => {
            setRaw(e.target.value);
            last.current = e.target.value;
            onChange(e.target.value);
          }}
          onBlur={() => {
            const clean = sanitizeHtml(raw);
            if (clean !== raw) setRaw(clean);
            last.current = clean;
            onChange(clean);
          }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      {!mediaCardId && !htmlMode && (
        <p className="text-xs font-semibold text-text-muted">{mediaHint}</p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-xs font-bold text-text"
        >
          {error}
        </p>
      )}
    </div>
  );
}
