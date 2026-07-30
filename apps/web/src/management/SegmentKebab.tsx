import { useEffect, useId, useRef, type ReactElement } from 'react';

import type { KebabAction } from './status-actions';

export interface SegmentKebabProps {
  open: boolean;
  actions: readonly KebabAction[];
  onAction: (action: KebabAction) => void;
  onClose: () => void;
  anchorLabel: string;
}

export function SegmentKebab({
  open,
  actions,
  onAction,
  onClose,
  anchorLabel,
}: SegmentKebabProps): ReactElement | null {
  const menuId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="segment-kebab"
      role="menu"
      id={menuId}
      aria-label={`Actions for ${anchorLabel}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {actions.map((action, index) => (
        <button
          key={action.id}
          ref={index === 0 ? firstRef : undefined}
          type="button"
          role="menuitem"
          className="segment-kebab__item"
          onClick={() => {
            onAction(action);
            onClose();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
