import type { ReactElement } from 'react';

/**
 * The application shell: a header and the region the schedule grid will occupy.
 *
 * The layout constraint that drives everything else is that a full clinic day —
 * 36 fifteen-minute rows at 28px — must fit on a 1080p screen without scrolling,
 * so the shell above the grid is deliberately shallow.
 */
export function App(): ReactElement {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">ScanFlow</h1>
        <p className="app__subtitle">Radiology appointment scheduling</p>
      </header>
      <main className="app__main" />
    </div>
  );
}
