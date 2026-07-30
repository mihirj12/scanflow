import type { CandidateDto, ChainStep } from '@scanflow/contracts';
import { type ReactElement } from 'react';

import { describeCandidate } from './ghost-preview';

export interface SuggestionsPanelProps {
  candidates: readonly CandidateDto[];
  steps: readonly ChainStep[];
  timeZone: string;
  conflictBanner: string | null;
  selected: CandidateDto | null;
  preview: CandidateDto | null;
  notes: string;
  booking: boolean;
  bookError: string | null;
  onPreview: (candidate: CandidateDto | null) => void;
  onSelect: (candidate: CandidateDto) => void;
  onNotesChange: (notes: string) => void;
  onBook: () => void;
  onBack: () => void;
  onClose: () => void;
}

export function SuggestionsPanel({
  candidates,
  steps,
  timeZone,
  conflictBanner,
  selected,
  preview,
  notes,
  booking,
  bookError,
  onPreview,
  onSelect,
  onNotesChange,
  onBook,
  onBack,
  onClose,
}: SuggestionsPanelProps): ReactElement {
  return (
    <aside className="suggestions" aria-label="Suggested times">
      <div className="suggestions__header">
        <h2 className="suggestions__title">Suggestions</h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {conflictBanner !== null ? (
        <p className="suggestions__banner" role="alert">
          {conflictBanner}
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="suggestions__empty">
          No times fit this chain on the selected day. Change the date or
          shorten a step, then try again.
        </p>
      ) : (
        <ul className="suggestions__list">
          {candidates.map((candidate, index) => {
            const copy = describeCandidate(
              candidate,
              steps,
              timeZone,
              index === 0,
            );
            const isSelected =
              selected !== null &&
              selected.start === candidate.start &&
              selected.end === candidate.end;
            const isPreview =
              preview !== null &&
              preview.start === candidate.start &&
              preview.end === candidate.end;

            return (
              <li key={`${candidate.start}-${candidate.end}-${String(index)}`}>
                <button
                  type="button"
                  className={[
                    'suggestions__row',
                    isSelected ? 'suggestions__row--selected' : '',
                    isPreview ? 'suggestions__row--preview' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => {
                    onPreview(candidate);
                  }}
                  onMouseLeave={() => {
                    onPreview(null);
                  }}
                  onFocus={() => {
                    onPreview(candidate);
                  }}
                  onBlur={() => {
                    onPreview(null);
                  }}
                  onClick={() => {
                    onSelect(candidate);
                  }}
                >
                  <span className="suggestions__time">{copy.timeRange}</span>
                  <span className="suggestions__meta">
                    {copy.spanLabel} · {copy.gapLabel}
                  </span>
                  {copy.badge !== null ? (
                    <span className="suggestions__badge">{copy.badge}</span>
                  ) : null}
                  {copy.delayNotes.map((note) => (
                    <span key={note} className="suggestions__note">
                      {note}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected !== null ? (
        <div className="suggestions__confirm">
          <h3 className="suggestions__confirm-title">Confirm</h3>
          <label className="field">
            <span className="field__label">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => {
                onNotesChange(event.target.value);
              }}
              rows={3}
              maxLength={2000}
            />
          </label>
          {bookError !== null ? (
            <p className="field__error" role="alert">
              {bookError}
            </p>
          ) : null}
          <div className="wizard__actions">
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={booking}
              onClick={onBook}
            >
              {booking ? 'Booking…' : 'Book'}
            </button>
          </div>
        </div>
      ) : (
        <div className="wizard__actions">
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            Back
          </button>
        </div>
      )}
    </aside>
  );
}
