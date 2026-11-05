import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../client/api';
import { MediaRejected, uploadMedia } from '../../client/media-upload';
import { useOnlineOnly } from '../../client/online-only';
import { dexieStore } from '../../client/store';
import { ChunkyButton, ProgressBar } from '../ui';
import { describeApiError } from '../../lib/api-error';

/** Attach an image or audio clip to one side of a saved card; inserts its token into the text. */
export function MediaPicker({
  cardId,
  side,
  onInsert,
}: {
  cardId: string;
  side: 'front' | 'back';
  onInsert: (token: string) => void;
}) {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const { token } = await uploadMedia(
        { api, store: dexieStore },
        { cardId, side, file },
        setProgress,
      );
      onInsert(token);
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

  return (
    <div className="flex flex-col gap-2">
      <ChunkyButton variant="neutral" onClick={() => input.current?.click()} {...net.buttonProps}>
        {t('media.add')} ({side === 'front' ? t('media.front') : t('media.back')})
      </ChunkyButton>
      <input
        ref={input}
        type="file"
        hidden
        data-testid={`media-input-${side}`}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
      {progress !== null && (
        <div>
          <ProgressBar
            value={Math.round(progress * 100)}
            max={100}
            label={t('media.uploading', { percent: Math.round(progress * 100) })}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
