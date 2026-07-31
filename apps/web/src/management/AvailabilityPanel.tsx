import {
  canEditResourceAvailability,
  type AvailabilityWindow,
  type CurrentUser,
  type ResourceDto,
} from '@scanflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactElement } from 'react';

import {
  fetchResourceAvailability,
  fetchResources,
  setResourceAvailability,
} from '../api/client';

import { ModalShell } from './ModalShell';

export interface AvailabilityPanelProps {
  user: CurrentUser;
  date: string;
  onClose: () => void;
}

/**
 * Role-scoped editor for resource availability on one calendar date.
 * Supports multiple intervals per day (e.g. morning clinic + afternoon clinic).
 */
export function AvailabilityPanel({
  user,
  date,
  onClose,
}: AvailabilityPanelProps): ReactElement {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([
    { startsAt: '08:00', endsAt: '17:00' },
  ]);

  const resources = useQuery({
    queryKey: ['resources'],
    queryFn: fetchResources,
  });

  const editable =
    resources.data?.items.filter((resource) =>
      canEditResourceAvailability(user.role, user.resourceId, {
        id: resource.id,
        type: resource.type,
      }),
    ) ?? [];

  const selected =
    selectedId === null
      ? editable[0]
      : editable.find((resource) => resource.id === selectedId);

  const loaded = useQuery({
    queryKey: ['resource-availability', selected?.id, date],
    queryFn: () => fetchResourceAvailability(selected?.id ?? '', date),
    enabled: selected !== undefined,
  });

  useEffect(() => {
    if (loaded.data === undefined) return;
    const next =
      loaded.data.windows.length === 0
        ? [{ startsAt: '08:00', endsAt: '17:00' }]
        : loaded.data.windows.map((window) => ({ ...window }));
    // Reset the draft when fetched availability for this resource/date changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync draft from server
    setWindows(next);
  }, [loaded.data]);

  function addWindow(): void {
    setWindows((current) => [
      ...current,
      { startsAt: '13:00', endsAt: '17:00' },
    ]);
  }

  function removeWindow(index: number): void {
    setWindows((current) =>
      current.length <= 1 ? current : current.filter((_, i) => i !== index),
    );
  }

  function updateWindow(
    index: number,
    field: keyof AvailabilityWindow,
    value: string,
  ): void {
    setWindows((current) =>
      current.map((window, i) =>
        i === index ? { ...window, [field]: value } : window,
      ),
    );
  }

  async function save(): Promise<void> {
    if (selected === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await setResourceAvailability(selected.id, { date, windows });
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      await queryClient.invalidateQueries({
        queryKey: ['resource-availability', selected.id, date],
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save availability.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      active
      onClose={onClose}
      className="availability-panel"
      labelledBy={titleId}
    >
      <header className="availability-panel__header">
        <h2 id={titleId} className="availability-panel__title">
          Set availability
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <p className="availability-panel__hint">
        Applies to <strong>{formatCalendarDate(date)}</strong> only. Add
        multiple intervals when a resource is open in the morning and again in
        the afternoon (gaps between intervals stay closed).
        {loaded.data?.savedForDate === false ? (
          <>
            {' '}
            Showing the usual {formatWeekday(date)} template — save to set this
            date.
          </>
        ) : null}
      </p>

      {editable.length === 0 ? (
        <p className="availability-panel__empty">
          Your role cannot edit any resource availability.
        </p>
      ) : (
        <>
          <label className="field availability-panel__field">
            <span className="field__label">Resource</span>
            <select
              value={selected?.id ?? ''}
              onChange={(event) => {
                setSelectedId(event.target.value);
              }}
            >
              {editable.map((resource: ResourceDto) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name} ({formatResourceType(resource.type)})
                </option>
              ))}
            </select>
          </label>

          {loaded.isLoading ? (
            <p className="availability-panel__loading">
              Loading current hours…
            </p>
          ) : null}

          <ul className="availability-panel__windows">
            {windows.map((window, index) => (
              <li key={index} className="availability-panel__window">
                <span className="availability-panel__window-label">
                  Interval {String(index + 1)}
                </span>
                <div className="availability-panel__times">
                  <label className="field">
                    <span className="field__label">From</span>
                    <input
                      type="time"
                      value={window.startsAt}
                      onChange={(event) => {
                        updateWindow(index, 'startsAt', event.target.value);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Until</span>
                    <input
                      type="time"
                      value={window.endsAt}
                      onChange={(event) => {
                        updateWindow(index, 'endsAt', event.target.value);
                      }}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  disabled={windows.length <= 1}
                  onClick={() => {
                    removeWindow(index);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn btn--ghost availability-panel__add"
            onClick={addWindow}
          >
            Add interval
          </button>

          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="availability-panel__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={saving || selected === undefined || loaded.isLoading}
              onClick={() => {
                void save();
              }}
            >
              {saving ? 'Saving…' : 'Save availability'}
            </button>
          </footer>
        </>
      )}
    </ModalShell>
  );
}

function formatWeekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(parsed);
}

function formatCalendarDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatResourceType(type: ResourceDto['type']): string {
  if (type === 'DOCTOR') return 'Doctor';
  if (type === 'NMT_ROOM') return 'NMT room';
  return 'Scan room';
}
