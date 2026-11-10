import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../client/api';
import { countReviewed } from '../../client/removal';
import { ChunkyButton, Dialog } from '../ui';

type Save = (confirmRemoval: boolean) => Promise<void>;

export interface RemovalConfirm {
  /**
   * Runs `save(false)` unless some of `vanishedCardIds` were reviewed, in which case the dialog
   * opens first. Confirming runs `save(true)` (send `confirmRemoval: true`). A server 409
   * `cards_would_be_removed` from `save(false)` opens the same dialog. Other errors from the
   * first attempt reject; errors after confirming go to `onError`.
   */
  guard(vanishedCardIds: string[], save: Save): Promise<void>;
  /** Render this once in the component. */
  dialog: ReactNode;
}

/** Reusable "these reviewed cards will be removed" confirmation (FR-003). */
export function useRemovalConfirm(onError: (e: unknown) => void): RemovalConfirm {
  const { t } = useTranslation();
  const [pending, setPending] = useState<{ count: number } | null>(null);
  const saveRef = useRef<Save | null>(null);

  const guard = useCallback(async (vanishedCardIds: string[], save: Save) => {
    const reviewed = await countReviewed(vanishedCardIds);
    if (reviewed > 0) {
      saveRef.current = save;
      setPending({ count: reviewed });
      return;
    }
    try {
      await save(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cards_would_be_removed') {
        saveRef.current = save;
        setPending({ count: e.count ?? 1 });
        return;
      }
      throw e;
    }
  }, []);

  const close = () => {
    saveRef.current = null;
    setPending(null);
  };
  const confirm = async () => {
    const save = saveRef.current;
    close();
    try {
      await save?.(true);
    } catch (e) {
      onError(e);
    }
  };

  const dialog = (
    <Dialog open={!!pending} title={t('editor.removeCardsTitle')} onClose={close}>
      <p className="mb-4 text-sm font-semibold text-text-muted">
        {t('editor.removeCardsBody', { count: pending?.count ?? 0 })}
      </p>
      <div className="flex justify-end gap-3">
        <ChunkyButton variant="outline" onClick={close}>
          {t('cards.close')}
        </ChunkyButton>
        <ChunkyButton variant="danger" onClick={() => void confirm()}>
          {t('cards.delete')}
        </ChunkyButton>
      </div>
    </Dialog>
  );
  return { guard, dialog };
}
