import { useRef, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from './use-focus-trap';

/**
 * Full-screen modal shell (backdrop + centred panel). Portalled to `document.body`
 * so flex layout and the schedule grid cannot intercept clicks or focus.
 */
export function ModalShell({
  active,
  onClose,
  children,
  className,
  labelledBy,
  overlayClassName = 'modal-shell',
}: {
  active: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  overlayClassName?: string;
}): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, active, onClose);

  if (!active) return null;

  return createPortal(
    <div className={overlayClassName} role="presentation">
      <button
        type="button"
        className={`${overlayClassName}__backdrop`}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
