import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PathNode as Node } from '@anki-duo/domain';
import { PathNode } from './PathNode';

interface Props {
  nodes: Node[];
  motion: 'reduced' | 'full';
  onStart: (nodeIndex: number) => void;
  /** Called for a locked node with its index and the index of the node to finish first. */
  onLocked: (nodeIndex: number, previousIndex: number) => void;
  /** A node that has just unlocked: it animates in. */
  justUnlocked?: number | undefined;
}

// A gentle winding path: offsets in rem, repeating every 4 nodes, narrow enough for 320 px.
const WIND = [0, 3, 0, -3];

export function PathMap({ nodes, motion, onStart, onLocked, justUnlocked }: Props) {
  const { t } = useTranslation();
  const currentRef = useRef<HTMLLIElement>(null);
  const current = nodes.find((n) => n.status === 'in_progress' || n.status === 'available')?.index;

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({
      block: 'center',
      behavior: motion === 'reduced' ? 'auto' : 'smooth',
    });
  }, [current, motion]);

  return (
    <ol aria-label={t('path.title')} className="flex flex-col items-center gap-3 py-4">
      {nodes.map((n, i) => (
        <li
          key={n.index}
          ref={n.index === current ? currentRef : undefined}
          style={{ transform: `translateX(${WIND[i % WIND.length]}rem)` }}
          className="flex flex-col items-center"
        >
          <PathNode
            node={n}
            position={i + 1}
            current={n.index === current}
            motion={motion}
            justUnlocked={justUnlocked === n.index}
            onPress={() =>
              n.status === 'locked'
                ? onLocked(n.index, nodes[i - 1]?.index ?? n.index)
                : onStart(n.index)
            }
          />
          <span className="text-xs text-text-muted">
            {t('path.studied', { studied: n.studiedCount, total: n.cardCount })}
          </span>
        </li>
      ))}
    </ol>
  );
}
