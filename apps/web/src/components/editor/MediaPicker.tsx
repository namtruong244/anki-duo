import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../client/api';
import { MediaRejected, uploadMedia } from '../../client/media-upload';
import { useOnlineOnly } from '../../client/online-only';
import { dexieStore } from '../../client/store';
import { ChunkyButton, Icon, ProgressBar } from '../ui';
import { describeApiError } from '../../lib/api-error';

type Kind = 'image' | 'audio';
const ACCEPT: Record<Kind, string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
  audio: 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav',
};

/**
 * "+ ẢNH" / "+ ÂM THANH" buttons: attach an image or audio clip to a saved card (the upload is
 * tied to a card id) and insert its token into the chosen side. Attached files show as chips.
 */
export function MediaPicker({
  cardId,
  side,
  onInsert,
}: {
  /** Undefined until the card is saved; the buttons are disabled meanwhile. */
  cardId: string | undefined;
  side: 'front' | 'back';
  onInsert: (token: string) => void;
}) {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const inputs = { image: useRef<HTMLInputElement>(null), audio: useRef<HTMLInputElement>(null) };
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ name: string; kind: Kind }[]>([]);

  const pick = async (file: File, kind: Kind) => {
    if (!cardId) return;
    setError(null);
    setProgress(0);
    try {
      const { token } = await uploadMedia(
        { api, store: dexieStore },
        { cardId, side, file },
        setProgress,
      );
      onInsert(token);
      setAttached((a) => [...a, { name: file.name, kind }]);
    } catch (e) {
      setError(
        e instanceof MediaRejected
          ? e.reason === 'too_large'
            ? t('media.tooLarge')
            : t('media.unsupported')
          : describeApiError(t, e) === t('decks.error')
            ? t('media.failed')
            : describeApiError(t, e),
      );
    } finally {
      setProgress(null);
    }
  };

  const disabled = !net.online || !cardId;
  const hint = !cardId ? t('ui.editor.saveFirst') : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {(['image', 'audio'] as const).map((kind) => (
          <span key={kind} className="contents">
            <ChunkyButton
              variant="outline"
              size="sm"
              disabled={disabled}
              title={hint}
              onClick={() => inputs[kind].current?.click()}
            >
              {kind === 'image' ? t('ui.editor.addImage') : t('ui.editor.addAudio')}
            </ChunkyButton>
            <input
              ref={inputs[kind]}
              type="file"
              hidden
              data-testid={`media-input-${kind}`}
              accept={ACCEPT[kind]}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pick(f, kind);
              }}
            />
          </span>
        ))}
        {attached.map((a, i) => (
          <span
            key={i}
            className="inline-flex max-w-full items-center gap-1.5 rounded-xl border-2 border-secondary bg-[var(--color-card)] px-3 py-1.5 text-xs font-extrabold text-nav-active-text"
          >
            <Icon name={a.kind === 'audio' ? 'volume-2' : 'image'} size={14} />
            <span className="truncate">{a.name}</span>
          </span>
        ))}
      </div>
      {!cardId && <p className="text-xs font-semibold text-text-muted">{hint}</p>}
      {progress !== null && (
        <ProgressBar
          value={Math.round(progress * 100)}
          max={100}
          label={t('media.uploading', { percent: Math.round(progress * 100) })}
        />
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
