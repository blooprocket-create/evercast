import { useRef, useState } from 'react';
import { ledgerWindow, shouldVirtualize } from './LedgerWindow';
import styles from './Ledger.module.css';

/**
 * Archetype 2 of 5. A list of fixed-height rows, windowed once it gets long
 * enough to be worth it. Gear, achievements, the bestiary and every future
 * list are this component with different data.
 */
export const LEDGER_ROW_HEIGHT = 52;

interface LedgerProps<T> {
  items: readonly T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  rowKey: (item: T, index: number) => string;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  rowHeight?: number;
}

export function Ledger<T>({
  items,
  renderRow,
  rowKey,
  header,
  empty,
  rowHeight = LEDGER_ROW_HEIGHT,
}: LedgerProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const virtualize = shouldVirtualize(items.length);
  const window = virtualize
    ? ledgerWindow({ scrollTop, viewportHeight, rowHeight, count: items.length })
    : { start: 0, end: items.length, padTop: 0, padBottom: 0, totalHeight: 0 };

  const visible = items.slice(window.start, window.end);

  return (
    <div className={styles.ledger}>
      {header && <div className={styles.header}>{header}</div>}
      <div
        ref={scrollRef}
        className={styles.scroll}
        onScroll={(event) => {
          if (!virtualize) return;
          setScrollTop(event.currentTarget.scrollTop);
          setViewportHeight(event.currentTarget.clientHeight);
        }}
      >
        {items.length === 0 && empty !== undefined ? (
          <div className={styles.empty}>{empty}</div>
        ) : (
          <>
            {window.padTop > 0 && <div style={{ height: window.padTop }} />}
            {visible.map((item, offset) => (
              <div key={rowKey(item, window.start + offset)}>
                {renderRow(item, window.start + offset)}
              </div>
            ))}
            {window.padBottom > 0 && <div style={{ height: window.padBottom }} />}
          </>
        )}
      </div>
    </div>
  );
}
