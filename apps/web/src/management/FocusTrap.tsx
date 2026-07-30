import { useRef, type ReactElement, type ReactNode } from 'react';

import { useFocusTrap } from './use-focus-trap';

export function FocusTrap({
  active,
  onEscape,
  children,
  className,
  labelledBy,
}: {
  active: boolean;
  onEscape: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}
